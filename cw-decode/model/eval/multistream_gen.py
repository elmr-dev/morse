"""
Generate a labeled multi-stream CW eval set.

Each sample contains N (1, 2, or 3) simultaneous CW signals at different tone
frequencies in the same audio. Every signal has its own ground-truth text,
WPM, tone_freq, RMS amplitude, and per-signal SNR — so the eval script can
loop over each signal as the "target" and score CER while the others act as
interferers.

Why this exists:
    morse-audio v1.3.1 generates ONE labeled signal + optional UNLABELED
    QRM interferers. For a multi-signal model evaluation we need labels for
    *every* signal. This script generates each stream individually with
    morse-audio (clean, snrDb=60) and mixes them in Python with controlled
    per-stream amplitudes, then adds AWGN to hit the requested per-stream
    SNR.

SNR semantics (computed by us, not by morse-audio):
    Each generated stream WAV is RMS-normalized to unit RMS, then scaled by
    its `relative_amp_db`. The mixture has streams summed. AWGN is added at
    a level chosen so the *primary* stream hits its target SNR. Per-stream
    SNRs in the metadata are computed AFTER mixing as
    `20·log10(stream_rms / noise_rms)`.

Usage:
    uv run python eval/multistream_gen.py
    # → 200 NPZs in eval/multistream_data/, plus eval/multistream_data/index.json
"""
import concurrent.futures
import json
import os
import subprocess
import tempfile
import wave
from dataclasses import dataclass, asdict, field
from pathlib import Path

import numpy as np

# ============================================================================
# Paths
# ============================================================================

OUT_DIR = Path(__file__).parent / "multistream_data"
MODEL_ROOT = Path(__file__).parent.parent
MORSE_AUDIO_DIR = (MODEL_ROOT.parent.parent / "morse-audio").resolve()
GENERATE_CLI = (MORSE_AUDIO_DIR / "packages" / "morse-audio" /
                "src" / "ml-training" / "generate-cli.ts")

AUDIO_SR = 8000
DURATION_SEC = 8
DECIMATION = 16              # 8000 Hz audio → 500 Hz envelope
ENVELOPE_SR = AUDIO_SR // DECIMATION

CW_TEXTS = [
    "CQ CQ DE W1ABC", "W1ABC 599 GA K", "QTH ATL NAME MARK K",
    "5NN TNX FER QSO K", "CQ DX DE K4XYZ K", "K4XYZ DE W1ABC 579 K",
    "DE W6TM 599 CA K", "CQ TEST DE N5TW K", "N5TW 5NN OH K",
    "QRM QRN 73 K", "DE VK2ABC 59 K", "QTH DAL ES NAME BOB K",
    "UR 599 FINE SIG K", "CQ CQ DE KD9ABC", "KD9ABC UR 57 K",
    "DE W3XY 599 MD K", "RST 579 NAME TOM K", "73 ES GL DE W1ABC K",
]

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
# Sample config dataclasses
# ============================================================================

@dataclass
class StreamSpec:
    text: str
    wpm: float
    tone_freq: float
    relative_amp_db: float        # before noise; primary stream is reference (0 dB)
    is_primary: bool              # the stream whose SNR matches `snr_target_db`


@dataclass
class SampleSpec:
    idx: int
    n_streams: int
    separation_hz: int             # 0 for n=1
    snr_target_db: float           # SNR of the primary stream after mixing
    strength_pattern: str          # "equal" or "weak_target"
    seed: int
    streams: list[StreamSpec] = field(default_factory=list)


# ============================================================================
# WAV I/O (copied from cw-dsp-research/generate_eval.py for portability)
# ============================================================================

def _read_wav_float32(wav_path: str, target_sr: int = AUDIO_SR) -> np.ndarray:
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
# Ground-truth binary timeline (copied from cw-dsp-research/generate_eval.py)
# ============================================================================

def _gt_binary_from_characters(characters, effective_wpm, n_audio, audio_sr):
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
                t_ms += dit_ms
    return gt


def _decimate_binary(gt, factor, n_out):
    need = n_out * factor
    if len(gt) < need:
        gt = np.pad(gt, (0, need - len(gt)))
    return (gt[:need].reshape(n_out, factor).mean(axis=1) > 0.5).astype(np.float32)


# ============================================================================
# Single-stream synthesis via morse-audio CLI
# ============================================================================

def _generate_clean_stream(text: str, wpm: float, tone_freq: float,
                           seed: int, work_dir: str) -> tuple[np.ndarray, dict]:
    """Generate one clean CW WAV (snrDb=60 ≈ no noise) and return (audio, metadata)."""
    wav_path = os.path.join(work_dir, f"stream_{seed}.wav")
    cfg_path = os.path.join(work_dir, f"cfg_{seed}.json")

    gen_cfg = {
        "text": text,
        "wpm": round(float(wpm), 1),
        "frequency": float(tone_freq),
        "sampleRate": AUDIO_SR,
        "durationSec": DURATION_SEC,
        "seed": int(seed),
        "noise": {"snrDb": 60},   # effectively clean (still applies AGC to signal)
    }
    with open(cfg_path, "w") as f:
        json.dump(gen_cfg, f)

    result = subprocess.run(
        ["npx", "tsx", str(GENERATE_CLI), "--from-json", cfg_path, "-o", wav_path],
        capture_output=True, text=True,
        cwd=str(MORSE_AUDIO_DIR),
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"morse-audio failed: {result.stderr}")
    metadata = json.loads(result.stdout.strip())
    audio = _read_wav_float32(wav_path, target_sr=AUDIO_SR)
    return audio, metadata


# ============================================================================
# Mixing + noise
# ============================================================================

def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-30)


def _mix_and_noise(streams: list[np.ndarray],
                   stream_amps_linear: list[float],
                   primary_idx: int,
                   primary_snr_db: float,
                   rng: np.random.RandomState) -> tuple[np.ndarray, list[float]]:
    """
    Mix N streams at given linear amplitudes, then add AWGN s.t. the primary
    stream hits primary_snr_db. Returns (noisy_mix, per_stream_snr_db).
    """
    # Pad / truncate to common length
    max_len = max(len(s) for s in streams)
    streams = [
        np.pad(s, (0, max_len - len(s))) if len(s) < max_len else s[:max_len]
        for s in streams
    ]

    # Each stream → RMS-normalized → scaled by amp
    scaled = []
    scaled_rms = []
    for s, amp in zip(streams, stream_amps_linear):
        norm = s / _rms(s)             # unit RMS
        scaled.append(norm * amp)
        scaled_rms.append(_rms(norm * amp))

    mixed = np.sum(scaled, axis=0).astype(np.float32)

    # Noise power chosen so primary stream's signal RMS / noise RMS = target SNR
    primary_signal_rms = scaled_rms[primary_idx]
    noise_rms = primary_signal_rms / (10.0 ** (primary_snr_db / 20.0))
    noise = rng.randn(len(mixed)).astype(np.float32) * noise_rms

    noisy = mixed + noise

    # Per-stream realized SNR
    per_stream_snr_db = [
        20.0 * float(np.log10(rms / max(noise_rms, 1e-30)))
        for rms in scaled_rms
    ]
    return noisy, per_stream_snr_db


# ============================================================================
# Build the sample grid
# ============================================================================

def _build_sample_specs(seed: int = 42) -> list[SampleSpec]:
    """
    200 samples, stratified across n_streams × separation × snr × strength.

    n=1:  5 SNRs × 8 reps = 40 samples (no separation, no strength axis)
    n=2:  2 sep × 5 SNRs × 2 strength × 4 reps = 80
    n=3:  2 sep × 5 SNRs × 2 strength × 4 reps = 80
    Total: 200
    """
    rng = np.random.RandomState(seed)
    snr_grid = [-10.0, -6.0, -3.0, 0.0, 3.0]
    seps_multi = [100, 200]
    strengths = ["equal", "weak_target"]

    specs: list[SampleSpec] = []
    idx = 0

    def _pick_text():
        return CW_TEXTS[rng.randint(0, len(CW_TEXTS))]

    def _pick_wpm():
        return float(rng.uniform(22, 30))      # 25 ± 3 WPM

    # n=1
    for snr in snr_grid:
        for _rep in range(8):
            spec = SampleSpec(
                idx=idx, n_streams=1, separation_hz=0,
                snr_target_db=snr, strength_pattern="equal",
                seed=10_000 + idx,
            )
            spec.streams.append(StreamSpec(
                text=_pick_text(), wpm=_pick_wpm(), tone_freq=700.0,
                relative_amp_db=0.0, is_primary=True,
            ))
            specs.append(spec); idx += 1

    # n=2 and n=3
    for n in (2, 3):
        for sep in seps_multi:
            for snr in snr_grid:
                for strength in strengths:
                    for _rep in range(4):
                        # Stream tone_freqs
                        if n == 2:
                            freqs = [700.0, 700.0 + sep]
                        else:
                            freqs = [700.0 - sep, 700.0, 700.0 + sep]
                        # Primary = first stream (lowest freq) for n=2;
                        #           middle stream for n=3.
                        primary_idx = 0 if n == 2 else 1
                        # Strength pattern → relative amps
                        if strength == "equal":
                            amps_db = [0.0] * n
                        else:                              # weak_target
                            amps_db = [0.0] * n
                            amps_db[primary_idx] = -6.0    # primary is 6 dB weaker
                        spec = SampleSpec(
                            idx=idx, n_streams=n, separation_hz=sep,
                            snr_target_db=snr, strength_pattern=strength,
                            seed=10_000 + idx,
                        )
                        for k in range(n):
                            spec.streams.append(StreamSpec(
                                text=_pick_text(), wpm=_pick_wpm(),
                                tone_freq=freqs[k],
                                relative_amp_db=amps_db[k],
                                is_primary=(k == primary_idx),
                            ))
                        specs.append(spec); idx += 1

    # Shuffle so a worker pool's order isn't tier-correlated
    perm = rng.permutation(len(specs))
    return [specs[i] for i in perm]


# ============================================================================
# Sample generation worker (1 sample = N morse-audio calls + mix + noise)
# ============================================================================

def _generate_sample(spec: SampleSpec) -> dict:
    """Produce the NPZ payload for one sample."""
    rng = np.random.RandomState(spec.seed + 7919)

    with tempfile.TemporaryDirectory() as tmpdir:
        per_stream_audio = []
        per_stream_meta = []
        for k, s in enumerate(spec.streams):
            audio, meta = _generate_clean_stream(
                text=s.text, wpm=s.wpm, tone_freq=s.tone_freq,
                seed=spec.seed * 100 + k, work_dir=tmpdir,
            )
            per_stream_audio.append(audio)
            per_stream_meta.append(meta)

    # Mix + noise
    primary_idx = next(i for i, s in enumerate(spec.streams) if s.is_primary)
    amps_linear = [10.0 ** (s.relative_amp_db / 20.0) for s in spec.streams]
    noisy_mix, per_stream_snr_db = _mix_and_noise(
        per_stream_audio, amps_linear, primary_idx, spec.snr_target_db, rng,
    )

    # Per-stream ground truth at 500 Hz
    n_audio = len(noisy_mix)
    n_env = n_audio // DECIMATION
    streams_meta = []
    for k, (s, meta) in enumerate(zip(spec.streams, per_stream_meta)):
        gt_audio = _gt_binary_from_characters(
            meta["characters"], meta["effectiveWpm"], n_audio, AUDIO_SR
        )
        gt_500 = _decimate_binary(gt_audio, DECIMATION, n_env)
        streams_meta.append({
            "text": meta["fullText"],
            "wpm": float(meta["effectiveWpm"]),
            "tone_freq": float(s.tone_freq),
            "relative_amp_db": float(s.relative_amp_db),
            "snr_db": float(per_stream_snr_db[k]),
            "is_primary": bool(s.is_primary),
            "gt_binary_500": gt_500,        # per-stream tone-on at envelope rate
        })

    return {
        "idx": spec.idx,
        "n_streams": spec.n_streams,
        "separation_hz": spec.separation_hz,
        "snr_target_db": spec.snr_target_db,
        "strength_pattern": spec.strength_pattern,
        "audio": noisy_mix,
        "streams": streams_meta,
    }


def _save_npz(payload: dict, out_dir: Path):
    """Flatten the per-stream list into NPZ-friendly arrays."""
    n = payload["n_streams"]
    streams = payload["streams"]
    np.savez_compressed(
        out_dir / f"sample_{payload['idx']:04d}.npz",
        audio=payload["audio"],
        n_streams=np.int32(n),
        separation_hz=np.int32(payload["separation_hz"]),
        snr_target_db=np.float32(payload["snr_target_db"]),
        strength_pattern=payload["strength_pattern"],
        # per-stream parallel arrays (length = n)
        stream_text=np.array([s["text"] for s in streams], dtype=object),
        stream_wpm=np.array([s["wpm"] for s in streams], dtype=np.float32),
        stream_tone_freq=np.array([s["tone_freq"] for s in streams], dtype=np.float32),
        stream_rel_amp_db=np.array([s["relative_amp_db"] for s in streams], dtype=np.float32),
        stream_snr_db=np.array([s["snr_db"] for s in streams], dtype=np.float32),
        stream_is_primary=np.array([s["is_primary"] for s in streams], dtype=bool),
        stream_gt_binary_500=np.stack([s["gt_binary_500"] for s in streams], axis=0),
    )


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    specs = _build_sample_specs(seed=42)

    print(f"Generating {len(specs)} multi-stream samples → {OUT_DIR}")
    print(f"Audio SR {AUDIO_SR} Hz, duration {DURATION_SEC} s, "
          f"morse-audio at {MORSE_AUDIO_DIR}")
    print()

    # Distribution summary
    from collections import Counter
    n_dist = Counter(s.n_streams for s in specs)
    snr_dist = Counter(s.snr_target_db for s in specs)
    print(f"  n_streams: {dict(sorted(n_dist.items()))}")
    print(f"  snr_target_db: {dict(sorted(snr_dist.items()))}")
    print()

    n_done = 0
    n_total = len(specs)
    errors: list[tuple[int, str]] = []

    # Each sample = up to 3 morse-audio CLI calls + numpy work. Use a thread
    # pool so the subprocess waits overlap.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_generate_sample, s): s for s in specs}
        for fut in concurrent.futures.as_completed(futures):
            spec = futures[fut]
            try:
                payload = fut.result()
                _save_npz(payload, OUT_DIR)
                n_done += 1
                if n_done % 20 == 0 or n_done == n_total:
                    print(f"  [{n_done:3d}/{n_total}] done")
            except Exception as e:
                errors.append((spec.idx, str(e)))
                print(f"  ERROR sample_{spec.idx:04d}: {str(e)[:120]}")

    print()
    if errors:
        print(f"FAILED: {len(errors)} samples")
        raise SystemExit(1)

    print(f"Done. {n_done} samples in {OUT_DIR}/")
