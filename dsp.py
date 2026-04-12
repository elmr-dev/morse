"""
CW DSP envelope extraction.
This file is the ONLY mutable file in the autoresearch loop.

Contract:
  - extract_envelope(audio, sample_rate, tone_freq) → np.ndarray shape (T, C)
  - T = len(audio) // 16  (decimation: 8000 Hz → 500 Hz)
  - C = number of channels (1–4, see constants.py)
  - Values must be in [0, 1], dtype float32
  - tone_freq is the CW carrier frequency in Hz (typically 400–900 Hz)
  - Dependencies: numpy, scipy only
"""
import numpy as np
from scipy.signal import butter, sosfiltfilt


def extract_envelope(audio: np.ndarray, sample_rate: int = 8000,
                     tone_freq: float = 600.0) -> np.ndarray:
    """
    Single-channel IQ magnitude envelope.

    ch0: IQ magnitude, 22 Hz zero-phase Butterworth (sosfiltfilt).
         No group delay — edges land at the correct frame.
    """
    n_out = len(audio) // 16
    n = len(audio)

    # Bandpass ±22Hz around tone_freq + Hilbert envelope.
    # Equivalent to IQ demod but avoids DC bias from the mixing products.
    from scipy.signal import hilbert
    lo = max(tone_freq - 22, 1.0)
    hi = min(tone_freq + 22, sample_rate / 2 - 1)
    sos = butter(1, [lo, hi], btype="bandpass", fs=sample_rate, output="sos")
    bp = sosfiltfilt(sos, audio)
    mag = np.abs(hilbert(bp))
    ch0 = _decimate(mag, 16)[:n_out]
    # Power compression expands low-amplitude region for better noise-floor separation.
    ch0 = ch0 ** 0.69
    ch0 = _normalize(ch0)
    # Sigmoid sharpening: push values toward 0/1 for sharper edges.
    # gamma=37 is empirically optimal: output is near-binary around 0.5.
    ch0 = _sharpen(ch0, gamma=37.0)

    return ch0[:, np.newaxis].astype(np.float32)


def _decimate(x: np.ndarray, factor: int) -> np.ndarray:
    """Decimate by averaging blocks of `factor` samples."""
    n = len(x) // factor * factor
    return x[:n].reshape(-1, factor).mean(axis=1)


def _sharpen(x: np.ndarray, gamma: float = 2.0) -> np.ndarray:
    """Push values toward 0/1: x^g / (x^g + (1-x)^g). AUC-preserving."""
    xg = x ** gamma
    return xg / (xg + (1.0 - x) ** gamma + 1e-12)


def _normalize(env: np.ndarray) -> np.ndarray:
    """Normalize envelope to [0, 1] using global percentile noise floor.

    Global 17th percentile as noise floor is more stable than a running window:
    less clip at very_low SNR, better separation between tone-on and tone-off.
    """
    noise_floor = np.percentile(env, 22)
    signal_level = np.percentile(env, 84)
    denom = max(signal_level - noise_floor, 1e-10)
    return np.clip((env - noise_floor) / denom, 0.0, 1.0)
