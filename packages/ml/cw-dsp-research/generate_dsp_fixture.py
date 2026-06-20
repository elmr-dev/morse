#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "numpy>=1.26",
#   "scipy>=1.12",
# ]
# ///
"""
DSP golden-fixture generator (bootstrap, owner: Mark to ratify).

Proposed by John as the cross-language conformance suite for the 4-channel DSP
envelope extractor. The authoritative implementation is the training-side
scipy Butterworth bandpass in ``dsp.py`` — every other port (apps/web's dsp.ts
today, the future Rust decoder, etc.) must match this fixture per-channel
within a small epsilon.

Mark may relocate this script, rewrite the audio generator (e.g. switch to the
morse-audio TS CLI used by generate_testset.py), or restructure the on-disk
layout. The contract worth preserving is:

  fixtures/dsp/index.json + per-clip {input.wav, envelope.npy, envelope.json}

with envelope being the (T, 4) float32 result of extract_envelope on the
committed WAV at DSP_SAMPLE_RATE.

Run from the repo root::

  uv run --script packages/ml/cw-dsp-research/generate_dsp_fixture.py

The script computes a content hash and git short-SHA of the authoritative
dsp.py and refuses to run if the cw-dsp-research and model/data copies differ
in their bandpass.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
CW_DSP_PY = REPO_ROOT / "packages" / "ml" / "cw-dsp-research" / "dsp.py"
MODEL_DSP_PY = REPO_ROOT / "packages" / "ml" / "model" / "data" / "dsp.py"
FIXTURE_DIR = REPO_ROOT / "fixtures" / "dsp"

# Authoritative copy — the cw-dsp-research file IS the source; the model/data
# copy is synced from it (verified byte-identical in the bandpass block by
# _assert_bandpass_identical below). We import the cw-dsp-research copy so the
# script's runtime dependencies stay numpy+scipy (model/data/dsp.py pulls in
# soundfile via a process_wav helper unrelated to the bandpass).
CANONICAL_DSP = CW_DSP_PY

DSP_SAMPLE_RATE = 8000
ENVELOPE_SR = 500
DECIMATION = 16
SCHEMA_VERSION = 1


# ---------------------------------------------------------------------------
# Bandpass-parity check between the two dsp.py copies
# ---------------------------------------------------------------------------

_BANDPASS_RE = re.compile(
    r"sos_bp\s*=\s*butter\([^)]*\)\s*\n\s*bp\s*=\s*sosfiltfilt\(sos_bp,\s*audio64\)",
    re.MULTILINE,
)


def _extract_bandpass_block(path: Path) -> str:
    src = path.read_text()
    m = _BANDPASS_RE.search(src)
    if not m:
        raise SystemExit(
            f"Could not locate the butter(...)+sosfiltfilt bandpass block in {path}."
        )
    return m.group(0)


def _assert_bandpass_identical() -> None:
    a = _extract_bandpass_block(CW_DSP_PY)
    b = _extract_bandpass_block(MODEL_DSP_PY)
    if a != b:
        raise SystemExit(
            "Bandpass blocks in cw-dsp-research/dsp.py and model/data/dsp.py disagree.\n"
            "Refusing to generate fixtures until both copies match the authoritative filter.\n"
            f"--- {CW_DSP_PY}\n{a}\n--- {MODEL_DSP_PY}\n{b}\n"
        )


# ---------------------------------------------------------------------------
# Import the canonical extract_envelope
# ---------------------------------------------------------------------------

def _load_canonical_dsp():
    # Import by path so we don't have to add the package to sys.path / install it.
    import importlib.util

    spec = importlib.util.spec_from_file_location("_canonical_dsp", CANONICAL_DSP)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.extract_envelope


# ---------------------------------------------------------------------------
# Audio synthesis — Morse code → tone bursts + RMS-calibrated Gaussian noise
# ---------------------------------------------------------------------------

MORSE = {
    "A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".",
    "F": "..-.", "G": "--.", "H": "....", "I": "..", "J": ".---",
    "K": "-.-", "L": ".-..", "M": "--", "N": "-.", "O": "---",
    "P": ".--.", "Q": "--.-", "R": ".-.", "S": "...", "T": "-",
    "U": "..-", "V": "...-", "W": ".--", "X": "-..-", "Y": "-.--",
    "Z": "--..", "0": "-----", "1": ".----", "2": "..---", "3": "...--",
    "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..",
    "9": "----.", "/": "-..-.", "=": "-...-",
}


def _key_pattern(text: str, dit_s: float, sr: int) -> np.ndarray:
    """Build a 0/1 keying signal for ``text`` at the given dit duration."""
    samples_per_dit = max(1, int(round(dit_s * sr)))

    chunks: list[np.ndarray] = []
    on = np.ones(samples_per_dit, dtype=np.float32)
    on3 = np.ones(3 * samples_per_dit, dtype=np.float32)
    intra = np.zeros(samples_per_dit, dtype=np.float32)  # 1 dit between elements
    char_gap = np.zeros(3 * samples_per_dit, dtype=np.float32)  # 3 dits between chars
    word_gap = np.zeros(7 * samples_per_dit, dtype=np.float32)  # 7 dits between words

    words = text.upper().split(" ")
    for w_i, word in enumerate(words):
        for c_i, ch in enumerate(word):
            code = MORSE.get(ch)
            if not code:
                continue
            for e_i, sym in enumerate(code):
                chunks.append(on if sym == "." else on3)
                if e_i < len(code) - 1:
                    chunks.append(intra)
            if c_i < len(word) - 1:
                chunks.append(char_gap)
        if w_i < len(words) - 1:
            chunks.append(word_gap)
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks)


def synthesize_clip(
    text: str,
    wpm: int,
    snr_db: float,
    tone_freq_hz: float,
    seed: int,
    sr: int = DSP_SAMPLE_RATE,
    pad_s: float = 0.25,
) -> np.ndarray:
    """
    Synthesize a noisy CW clip at ``sr``.

    SNR convention: ``10 * log10(rms(signal)**2 / rms(noise)**2)``, where
    ``rms(signal)`` is taken over the keyed-on samples only (the in-band tone
    burst), and ``rms(noise)`` is the broadband Gaussian noise standard
    deviation. This matches the common "signal power / noise power" reading
    used in CW SNR tables; it is NOT identical to morse-audio's AGC-calibrated
    SNR, but the fixture is about deterministic input regardless of which
    convention generated it.
    """
    dit_s = 1.2 / wpm  # 1200 ms / WPM
    key = _key_pattern(text, dit_s, sr)
    pad = int(round(pad_s * sr))
    key = np.concatenate(
        [np.zeros(pad, dtype=np.float32), key, np.zeros(pad, dtype=np.float32)]
    )

    n = len(key)
    t = np.arange(n, dtype=np.float64) / sr
    tone = np.sin(2.0 * np.pi * tone_freq_hz * t).astype(np.float32)
    signal = (tone * key).astype(np.float32)

    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(n).astype(np.float32)

    on = key > 0.5
    if on.any():
        sig_rms = float(np.sqrt(np.mean(signal[on] ** 2)))
    else:
        sig_rms = 0.0
    noise_rms = float(np.sqrt(np.mean(noise**2)))
    target_noise_rms = sig_rms / (10.0 ** (snr_db / 20.0)) if sig_rms > 0 else 0.0
    if noise_rms > 0:
        noise *= target_noise_rms / noise_rms

    out = signal + noise
    peak = float(np.max(np.abs(out)))
    if peak > 0.97:
        out = out * (0.97 / peak)
    return out.astype(np.float32)


def write_wav_pcm16(path: Path, audio: np.ndarray, sr: int) -> None:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


def read_wav_pcm16(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getsampwidth() == 2
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, sr


# ---------------------------------------------------------------------------
# Provenance helpers
# ---------------------------------------------------------------------------

def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _git_short_sha(path: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "log", "-n", "1", "--pretty=format:%h", "--", str(path)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Clip manifest
# ---------------------------------------------------------------------------

# (id, text, wpm, snr_db, tone_freq, seed)
# Mirrors apps/web/src/lib/cw-message.ts realistic CW content (CQ calls,
# exchanges, RST reports) at the SNRs and WPMs the model is graded against.
CLIPS = [
    ("cq_clean_20wpm", "CQ CQ DE W1ABC W1ABC K", 20, 10.0, 700.0, 101),
    ("cq_0db_20wpm", "CQ CQ DE W1ABC K", 20, 0.0, 700.0, 102),
    ("exch_minus6_20wpm", "W1ABC 599 GA 599 GA", 20, -6.0, 700.0, 103),
    ("exch_minus10_20wpm", "DE K7XYZ 579 OH", 20, -10.0, 700.0, 104),
    ("rst_minus12_20wpm", "5NN TU 73", 20, -12.0, 700.0, 105),
    ("cq_clean_28wpm", "CQ DX DE N0CALL K", 28, 10.0, 700.0, 106),
    ("exch_0db_28wpm", "QTH BOSTON NAME JIM", 28, 0.0, 700.0, 107),
    ("exch_minus10_28wpm", "TU 73 DE W1ABC", 28, -10.0, 700.0, 108),
    # Off-700 tones to keep the parity tight for live-mic/pitch-shift later.
    ("cq_600hz_24wpm", "CQ CQ DE K7XYZ K", 24, 0.0, 600.0, 109),
    ("cq_800hz_24wpm", "CQ TEST DE W1ABC", 24, 0.0, 800.0, 110),
]


def main() -> int:
    _assert_bandpass_identical()
    extract_envelope = _load_canonical_dsp()

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    clips_dir = FIXTURE_DIR / "clips"
    clips_dir.mkdir(exist_ok=True)

    clip_records: list[dict] = []
    for clip_id, text, wpm, snr_db, tone, seed in CLIPS:
        audio = synthesize_clip(text, wpm, snr_db, tone, seed)
        wav_path = clips_dir / f"{clip_id}.input.wav"
        env_npy_path = clips_dir / f"{clip_id}.envelope.npy"
        env_json_path = clips_dir / f"{clip_id}.envelope.json"

        write_wav_pcm16(wav_path, audio, DSP_SAMPLE_RATE)

        # Read back via the same WAV path the TS side will use, so both ports
        # consume the same quantized PCM (not the float32 we generated in RAM).
        audio_in, sr = read_wav_pcm16(wav_path)
        assert sr == DSP_SAMPLE_RATE

        env = extract_envelope(audio_in.astype(np.float32), DSP_SAMPLE_RATE, tone)
        assert env.dtype == np.float32 and env.ndim == 2 and env.shape[1] == 4

        np.save(env_npy_path, env)
        # JSON copy: tiny, language-neutral, easy to load from TS without an npy reader.
        env_json_path.write_text(
            json.dumps(
                {
                    "shape": list(env.shape),
                    "dtype": "float32",
                    "data": env.flatten().tolist(),
                },
                separators=(",", ":"),
            )
        )

        clip_records.append(
            {
                "id": clip_id,
                "text": text,
                "wpm": wpm,
                "snr_db": snr_db,
                "tone_freq_hz": tone,
                "seed": seed,
                "sample_rate": DSP_SAMPLE_RATE,
                "n_samples": int(len(audio_in)),
                "n_envelope_frames": int(env.shape[0]),
                "input_wav": str(wav_path.relative_to(FIXTURE_DIR)),
                "envelope_npy": str(env_npy_path.relative_to(FIXTURE_DIR)),
                "envelope_json": str(env_json_path.relative_to(FIXTURE_DIR)),
                "input_wav_sha256": _sha256_file(wav_path),
                "envelope_npy_sha256": _sha256_file(env_npy_path),
            }
        )
        print(
            f"  {clip_id:30s} {len(audio_in)/DSP_SAMPLE_RATE:5.2f}s  "
            f"T={env.shape[0]}  SNR={snr_db:+.1f}dB  tone={tone:.0f}Hz",
            file=sys.stderr,
        )

    index = {
        "schema_version": SCHEMA_VERSION,
        "purpose": (
            "Golden DSP conformance vectors. The authoritative DSP is the "
            "training-side scipy Butterworth pipeline in "
            "packages/ml/model/data/dsp.py (synced from "
            "packages/ml/cw-dsp-research/dsp.py). Every port — apps/web's "
            "dsp.ts now, the future Rust decoder, dsp.py itself — must match "
            "the (T, 4) envelope here per channel within epsilon."
        ),
        "dsp_sample_rate": DSP_SAMPLE_RATE,
        "envelope_sr": ENVELOPE_SR,
        "decimation": DECIMATION,
        "channels": ["amplitude", "tkeo", "matched_48ms", "matched_200ms"],
        "provenance": {
            "canonical_dsp_path": str(CANONICAL_DSP.relative_to(REPO_ROOT)),
            "canonical_dsp_sha256": _sha256_file(CANONICAL_DSP),
            "canonical_dsp_git_short_sha": _git_short_sha(CANONICAL_DSP),
            "regen_command": (
                "uv run --script packages/ml/cw-dsp-research/generate_dsp_fixture.py"
            ),
            "audio_source": "inline numpy synthesis (deterministic seeded gaussian noise)",
            "snr_convention": (
                "10*log10(rms(signal_keyed_on)^2 / rms(noise)^2); broadband "
                "Gaussian noise. Note: distinct from morse-audio's "
                "AGC-calibrated SNR — the fixture is about deterministic "
                "input WAVs, not SNR-tier conformance."
            ),
        },
        "clips": clip_records,
    }
    (FIXTURE_DIR / "index.json").write_text(json.dumps(index, indent=2))
    print(f"Wrote {FIXTURE_DIR / 'index.json'} ({len(clip_records)} clips)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
