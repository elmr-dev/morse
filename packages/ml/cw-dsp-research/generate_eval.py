"""
Generate a fixed, focused evaluation set for cw-dsp-research autoresearch.

Run once to populate evaldata/.  NEVER re-run unless you want to invalidate
all historical results.tsv comparisons (the seed is fixed for reproducibility).

Design:
  - 160 samples, stratified by SNR tier (weighted toward low SNR)
  - WPM: uniform [25, 45] — operational target range
  - Tone freq: varied [500, 550, 600, 650, 700, 750, 800] Hz
  - CW content: variety of realistic QSO exchanges
  - Fading: 30% of low/very-low SNR samples have mild ionospheric QSB
  - Machine-perfect timing (no fist jitter) for clean ground-truth
  - Each NPZ embeds audio + gt_binary (500 Hz) — self-contained, no WAV files

Usage:
    uv run python generate_eval.py
"""
import concurrent.futures
import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

from constants import AUDIO_SR, DECIMATION, ENVELOPE_SR

# ============================================================================
# Paths
# ============================================================================

EVAL_DIR = "evaldata"
MORSE_AUDIO_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "morse-audio")
GENERATE_CLI = os.path.join(
    MORSE_AUDIO_DIR,
    "packages", "morse-audio", "src", "ml-training", "generate-cli.ts"
)

# ============================================================================
# Morse code table (for gt reconstruction)
# ============================================================================

MORSE_CODE = {
    'A': '.-',   'B': '-...',  'C': '-.-.',  'D': '-..',   'E': '.',
    'F': '..-.',  'G': '--.',   'H': '....',  'I': '..',    'J': '.---',
    'K': '-.-',   'L': '.-..',  'M': '--',    'N': '-.',    'O': '---',
    'P': '.--.',  'Q': '--.-',  'R': '.-.',   'S': '...',   'T': '-',
    'U': '..-',   'V': '...-',  'W': '.--',   'X': '-..-',  'Y': '-.--',
    'Z': '--..',  '0': '-----', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.',  '/': '-..-.', '?': '..--..', '.': '.-.-.-',
    ',': '--..--', '=': '-...-',
}

# Varied realistic CW content — short enough to fit in 8 seconds at 25 WPM
CW_TEXTS = [
    "CQ CQ DE W1ABC",
    "W1ABC 599 GA K",
    "QTH ATLANTA NAME MARK K",
    "5NN TNX FER QSO K",
    "CQ DX DE K4XYZ K",
    "K4XYZ DE W1ABC 579 K",
    "QSB HERE NAME ALICE K",
    "DE W6TM 599 CA K",
    "CQ TEST DE N5TW K",
    "N5TW 5NN OH K",
    "QRM QRN 73 K",
    "DE VK2ABC 59 K",
    "QTH DALLAS ES NAME BOB K",
    "UR 599 FINE SIG K",
    "CQ CQ DE KD9ABC",
    "KD9ABC UR 57 K",
    "DE W3XY 599 MDK",
    "RST 579 NAME TOM K",
    "CQ DE UA9XYZ K",
    "73 ES GL DE W1ABC K",
]

# ============================================================================
# Eval config grid
# ============================================================================
# Total: 200 samples uniform in SNR [-16, -8] dB — the operationally-hard
# range where DSP improvements matter most. WPM uniform [25, 45].
# Tier labels (constants.SNR_TIERS) fall out as:
#   very_low (-16 to -10): ~150 samples (75%)
#   low      (-10 to  -8): ~50 samples (25%)
#   mid/high: empty (scorer renormalizes weights over present tiers)

def _build_configs(seed=42):
    rng = np.random.RandomState(seed)

    n_total = 200
    snrs = rng.uniform(-16.0, -8.0, n_total)
    wpms = rng.uniform(25.0, 45.0, n_total)
    tone_freqs = [500, 550, 600, 650, 700, 750, 800]

    configs = []
    for i in range(n_total):
        snr = float(snrs[i])
        # Tier label matches constants.SNR_TIERS bucket
        tier = "very_low" if snr < -10.0 else "low"
        # QSB fading: 30% of very_low, 20% of low (matches old policy)
        fading_prob = 0.30 if tier == "very_low" else 0.20
        add_fading = rng.random() < fading_prob
        configs.append({
            "tier": tier,
            "snr_db": snr,
            "wpm": float(wpms[i]),
            "tone_freq": tone_freqs[i % len(tone_freqs)],
            "text": CW_TEXTS[i % len(CW_TEXTS)],
            "add_fading": bool(add_fading),
        })

    # Shuffle so samples aren't ordered by tier (fairer for per-N diagnostics)
    idxs = rng.permutation(len(configs))
    return [configs[i] for i in idxs]


# ============================================================================
# Ground-truth reconstruction
# ============================================================================

def _gt_binary_from_characters(characters, effective_wpm, n_audio, audio_sr):
    """Reconstruct tone-on/off binary at audio_sr from character metadata."""
    dit_ms = 1200.0 / effective_wpm
    gt = np.zeros(n_audio, dtype=np.float32)

    for char_meta in characters:
        char = char_meta["char"].upper()
        start_ms = char_meta["startMs"]
        code = MORSE_CODE.get(char)
        if not code:
            continue
        t_ms = 0.0
        for idx, sym in enumerate(code):
            dur = dit_ms if sym == "." else 3 * dit_ms
            s = int((start_ms + t_ms) / 1000.0 * audio_sr)
            e = int((start_ms + t_ms + dur) / 1000.0 * audio_sr)
            gt[max(0, s):min(n_audio, e)] = 1.0
            t_ms += dur
            if idx < len(code) - 1:
                t_ms += dit_ms  # intra-char gap
    return gt


def _decimate_binary(gt, factor, n_out):
    """Majority-vote decimation of binary ground truth."""
    need = n_out * factor
    if len(gt) < need:
        gt = np.pad(gt, (0, need - len(gt)))
    return (gt[:need].reshape(n_out, factor).mean(axis=1) > 0.5).astype(np.float32)


# ============================================================================
# WAV reading
# ============================================================================

def _read_wav_float32(wav_path, target_sr=8000):
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
        from scipy.signal import resample_poly
        from math import gcd
        g = gcd(target_sr, fr)
        samples = resample_poly(samples, target_sr // g, fr // g)

    return samples.astype(np.float32)


# ============================================================================
# Single sample generation
# ============================================================================

def _generate_one(args):
    idx, config, seed, out_dir = args
    # WAV is written directly into out_dir so the user can listen/spot-check;
    # the matching .npz next to it is what the scorer loads.
    # Absolute path required — the CLI runs with cwd=MORSE_AUDIO_DIR.
    wav_path = os.path.abspath(os.path.join(out_dir, f"sample_{idx:03d}.wav"))
    with tempfile.TemporaryDirectory() as tmpdir:
        cfg_path = os.path.join(tmpdir, "config.json")

        gen_cfg = {
            "text": config["text"],
            "wpm": round(config["wpm"], 1),
            "frequency": config["tone_freq"],
            "sampleRate": AUDIO_SR,
            "durationSec": 8,
            "seed": seed,
            "noise": {"snrDb": round(config["snr_db"], 2)},
        }
        if config["add_fading"]:
            gen_cfg["ionosphericFading"] = {"depth": 0.3, "rate": 0.2, "components": 3}

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
            raise RuntimeError(
                f"morse-audio failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
            )

        stdout = result.stdout.strip()
        if not stdout:
            raise RuntimeError(f"No metadata. stderr: {result.stderr}")

        metadata = json.loads(stdout)
        audio = _read_wav_float32(wav_path, target_sr=AUDIO_SR)
        n_audio = len(audio)

        # Ground truth at AUDIO_SR, then decimate to ENVELOPE_SR (500 Hz)
        gt_audio = _gt_binary_from_characters(
            metadata["characters"], metadata["effectiveWpm"], n_audio, AUDIO_SR
        )
        n_env = n_audio // DECIMATION
        gt_500 = _decimate_binary(gt_audio, DECIMATION, n_env)

        return idx, config, audio, gt_500, float(metadata["effectiveWpm"])


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    Path(EVAL_DIR).mkdir(exist_ok=True)

    configs = _build_configs(seed=42)
    n = len(configs)

    print(f"Generating {n} eval samples → {EVAL_DIR}/")
    print(f"WPM range: 25–45  |  SNR range: –16 to –8 dB  |  seed: 42 (fixed)")
    print(f"Generator: morse-audio v1.3.1 (AGC-calibrated SNR)")
    print()

    # Tier summary
    from collections import Counter
    tier_counts = Counter(c["tier"] for c in configs)
    for tier in ["very_low", "low", "mid", "high"]:
        print(f"  {tier}: {tier_counts[tier]} samples")
    print()

    args = [(i, c, 1000 + i, EVAL_DIR) for i, c in enumerate(configs)]
    errors = []
    done = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_generate_one, a): a[0] for a in args}
        for fut in concurrent.futures.as_completed(futures):
            idx = futures[fut]
            try:
                idx, cfg, audio, gt_500, actual_wpm = fut.result()
                out_path = os.path.join(EVAL_DIR, f"sample_{idx:03d}.npz")
                np.savez_compressed(
                    out_path,
                    audio=audio,
                    gt_binary=gt_500,          # (T_500,) float32, 500 Hz
                    snr_db=np.float32(cfg["snr_db"]),
                    wpm=np.float32(actual_wpm),
                    tone_freq=np.float32(cfg["tone_freq"]),
                    tier=cfg["tier"],
                )
                done += 1
                print(f"  [{done:3d}/{n}] sample_{idx:03d} "
                      f"SNR={cfg['snr_db']:+5.1f}dB  WPM={actual_wpm:.0f}  "
                      f"freq={cfg['tone_freq']}Hz  "
                      f"{'[QSB]' if cfg['add_fading'] else '     '}")
            except Exception as e:
                errors.append((idx, str(e)))
                print(f"  ERROR sample_{idx:03d}: {e}")

    print()
    if errors:
        print(f"FAILED: {len(errors)} samples — re-run or investigate:")
        for idx, msg in errors:
            print(f"  sample_{idx:03d}: {msg[:120]}")
        raise SystemExit(1)
    else:
        print(f"Done. {n} samples in {EVAL_DIR}/")
        print()
        # Quick sanity check
        d = np.load(os.path.join(EVAL_DIR, "sample_000.npz"), allow_pickle=True)
        print(f"Sanity: sample_000  audio={d['audio'].shape}  "
              f"gt_binary={d['gt_binary'].shape}  "
              f"snr={float(d['snr_db']):+.1f}dB  wpm={float(d['wpm']):.0f}")
