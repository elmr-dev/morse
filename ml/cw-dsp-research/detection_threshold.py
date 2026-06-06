"""
Characterize the SNR detection floor of the DSP alone (no ML).

Generates pure machine-driven CW (no fist jitter, no fading, AWGN only) across
SNRs from -22 to 0 dB. For each SNR, runs dsp.extract_envelope() on ch0,
thresholds at 0.5, extracts the dit/dah sequence, and scores it via
Levenshtein edit distance against the known ground-truth element string.

Metric: element_accuracy = 1 - LD(predicted, gt) / len(gt)
  - Insertions (noise spikes), deletions (missed elements), substitutions
    (dit↔dah classification errors) all count.
  - WPM is the generator's known value (passed in), not estimated — this
    measures the DETECTION limit, not the WPM-estimation limit.

Output: per-SNR mean accuracy + the SNR thresholds at 99%, 90%, 50%.

Usage:
    uv run python detection_threshold.py
"""
import concurrent.futures
import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

import dsp
from constants import AUDIO_SR

# ============================================================================
# Paths / config
# ============================================================================

OUT_DIR = "detection_audio"
MORSE_AUDIO_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "morse-audio")
GENERATE_CLI = os.path.join(
    MORSE_AUDIO_DIR,
    "packages", "morse-audio", "src", "ml-training", "generate-cli.ts"
)

SNR_RANGE = list(range(-22, 1, 1))         # -22..0 dB in 1 dB steps
WPMS = [20, 25, 30, 40]                    # span the operational range
TONE_FREQS = [500, 600, 700]
N_TRIALS_PER_SNR = 12                      # 4 WPMs × 3 freqs

# Long text → many elements per sample → stable EER. Repeat to fill ~8 s
# at any WPM. Generator will truncate to durationSec.
LONG_TEXT = (
    "PARIS PARIS PARIS PARIS PARIS PARIS PARIS PARIS "
    "CQ CQ DE W1ABC W1ABC K "
    "5NN TNX FER QSO 73 K "
    "1234567890"
)

DURATION_SEC = 8

MORSE_CODE = {
    'A': '.-',   'B': '-...',  'C': '-.-.',  'D': '-..',   'E': '.',
    'F': '..-.', 'G': '--.',   'H': '....',  'I': '..',    'J': '.---',
    'K': '-.-',  'L': '.-..',  'M': '--',    'N': '-.',    'O': '---',
    'P': '.--.', 'Q': '--.-',  'R': '.-.',   'S': '...',   'T': '-',
    'U': '..-',  'V': '...-',  'W': '.--',   'X': '-..-',  'Y': '-.--',
    'Z': '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.',
}


# ============================================================================
# WAV reading (same convention as generate_eval.py)
# ============================================================================

def _read_wav_float32(wav_path, target_sr=AUDIO_SR):
    with wave.open(str(wav_path), "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        fr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
    if sw == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sw == 4:
        samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width {sw}")
    if nch > 1:
        samples = samples.reshape(-1, nch).mean(axis=1)
    if fr != target_sr:
        from math import gcd
        from scipy.signal import resample_poly
        g = gcd(target_sr, fr)
        samples = resample_poly(samples, target_sr // g, fr // g)
    return samples.astype(np.float32)


# ============================================================================
# Audio generation (clean: no fading, no fist jitter, AWGN only)
# ============================================================================

def _generate_one(args):
    idx, snr_db, wpm, tone_freq, text, seed, out_dir = args
    wav_path = os.path.abspath(os.path.join(out_dir, f"sample_{idx:04d}.wav"))

    with tempfile.TemporaryDirectory() as tmpdir:
        cfg_path = os.path.join(tmpdir, "config.json")
        gen_cfg = {
            "text": text,
            "wpm": float(wpm),
            "frequency": float(tone_freq),
            "sampleRate": AUDIO_SR,
            "durationSec": DURATION_SEC,
            "seed": int(seed),
            "noise": {"snrDb": float(snr_db)},
            # No `fist`, no `ionosphericFading` → pure machine + AWGN
        }
        with open(cfg_path, "w") as f:
            json.dump(gen_cfg, f)

        result = subprocess.run(
            ["npx", "tsx", os.path.abspath(GENERATE_CLI),
             "--from-json", cfg_path, "-o", wav_path],
            capture_output=True, text=True,
            cwd=os.path.abspath(MORSE_AUDIO_DIR),
            timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(f"generator failed: {result.stderr}")

        metadata = json.loads(result.stdout.strip())
        audio = _read_wav_float32(wav_path, target_sr=AUDIO_SR)
        return idx, snr_db, wpm, tone_freq, audio, metadata


# ============================================================================
# Ground-truth and prediction
# ============================================================================

def _gt_element_string(characters):
    """Concatenate per-character morse codes into a single dit/dah string."""
    out = []
    for c in characters:
        ch = c["char"].upper()
        code = MORSE_CODE.get(ch)
        if code:
            out.append(code)
    return "".join(out)


def _predicted_element_string(binary, wpm, sr=500):
    """Extract ON segments, classify each as dit/dah by duration vs 2*dit_ms."""
    dit_ms = 1200.0 / wpm
    threshold_samples = int(2.0 * dit_ms / 1000.0 * sr)
    diff = np.diff(np.concatenate(([0], binary.astype(np.int32), [0])))
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]
    out = []
    for s, e in zip(starts, ends):
        out.append("." if (e - s) < threshold_samples else "-")
    return "".join(out)


def _levenshtein(a, b):
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        cur = [i + 1]
        for j, cb in enumerate(b):
            cur.append(min(
                prev[j + 1] + 1,        # deletion
                cur[j] + 1,              # insertion
                prev[j] + (ca != cb),    # substitution
            ))
        prev = cur
    return prev[-1]


def _element_accuracy(pred, gt):
    if not gt:
        return 1.0
    return max(0.0, 1.0 - _levenshtein(pred, gt) / len(gt))


# ============================================================================
# Per-sample scoring
# ============================================================================

def _score_sample(audio, wpm, tone_freq, gt_str):
    env = dsp.extract_envelope(audio, sample_rate=AUDIO_SR, tone_freq=tone_freq)
    ch0 = env[:, 0]
    binary = (ch0 > 0.5).astype(np.int32)
    pred_str = _predicted_element_string(binary, wpm)
    return _element_accuracy(pred_str, gt_str), len(gt_str), len(pred_str)


# ============================================================================
# Main sweep
# ============================================================================

def main():
    Path(OUT_DIR).mkdir(exist_ok=True)

    # Build job list: SNR_RANGE × N_TRIALS_PER_SNR
    jobs = []
    idx = 0
    for snr_db in SNR_RANGE:
        for trial in range(N_TRIALS_PER_SNR):
            wpm = WPMS[trial % len(WPMS)]
            tone_freq = TONE_FREQS[trial % len(TONE_FREQS)]
            seed = 5000 + idx
            jobs.append((idx, snr_db, wpm, tone_freq, LONG_TEXT, seed, OUT_DIR))
            idx += 1

    n = len(jobs)
    print(f"Generating {n} samples ({len(SNR_RANGE)} SNRs × {N_TRIALS_PER_SNR} trials)")
    print(f"WPMs: {WPMS}  freqs: {TONE_FREQS}  text: {len(LONG_TEXT)} chars")
    print()

    samples = {}  # idx -> (snr, wpm, freq, audio, metadata)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_generate_one, j): j[0] for j in jobs}
        done = 0
        for fut in concurrent.futures.as_completed(futures):
            idx, snr, wpm, freq, audio, meta = fut.result()
            samples[idx] = (snr, wpm, freq, audio, meta)
            done += 1
            if done % 25 == 0 or done == n:
                print(f"  generated {done}/{n}")
    print()

    # Score each sample, accumulate per-SNR
    print("Scoring with DSP + threshold(0.5) + dit/dah extraction...")
    per_snr_accs = {snr: [] for snr in SNR_RANGE}
    per_snr_pred_lens = {snr: [] for snr in SNR_RANGE}
    per_snr_gt_lens = {snr: [] for snr in SNR_RANGE}

    for idx in sorted(samples):
        snr, wpm, freq, audio, meta = samples[idx]
        gt_str = _gt_element_string(meta["characters"])
        acc, gt_len, pred_len = _score_sample(audio, wpm, freq, gt_str)
        per_snr_accs[snr].append(acc)
        per_snr_pred_lens[snr].append(pred_len)
        per_snr_gt_lens[snr].append(gt_len)

    # Report
    print()
    print("SNR (dB)  |  acc%   |  pred_len / gt_len  |  notes")
    print("-" * 60)
    rows = []
    for snr in SNR_RANGE:
        accs = per_snr_accs[snr]
        mean_acc = float(np.mean(accs)) if accs else 0.0
        std_acc = float(np.std(accs)) if accs else 0.0
        mean_pred = float(np.mean(per_snr_pred_lens[snr])) if accs else 0.0
        mean_gt = float(np.mean(per_snr_gt_lens[snr])) if accs else 0.0
        rows.append((snr, mean_acc, std_acc, mean_pred, mean_gt))
        print(f"  {snr:+3d}    |  {mean_acc*100:5.1f}  |  {mean_pred:5.0f} / {mean_gt:5.0f}      |  ±{std_acc*100:.1f}")

    # Identify thresholds
    print()
    print("Detection thresholds (lowest SNR where mean accuracy ≥ X):")
    sorted_rows = sorted(rows, key=lambda r: r[0])
    for target in [0.99, 0.90, 0.50]:
        threshold = None
        for snr, acc, _, _, _ in sorted_rows:
            if acc >= target:
                threshold = snr
                break
        if threshold is not None:
            print(f"  ≥ {target*100:.0f}%: SNR ≥ {threshold:+d} dB")
        else:
            print(f"  ≥ {target*100:.0f}%: not reached in tested range")

    # Save raw rows for plotting / further analysis
    out_csv = "detection_threshold.csv"
    with open(out_csv, "w") as f:
        f.write("snr_db,mean_accuracy,std_accuracy,mean_pred_len,mean_gt_len\n")
        for snr, acc, std, pl, gl in sorted_rows:
            f.write(f"{snr},{acc:.4f},{std:.4f},{pl:.1f},{gl:.1f}\n")
    print(f"\nWrote per-SNR results to {out_csv}")


if __name__ == "__main__":
    main()
