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

    ch0: IQ magnitude, 35 Hz zero-phase Butterworth (sosfiltfilt).
         No group delay — edges land at the correct frame.
    """
    n_out = len(audio) // 16
    n = len(audio)

    # IQ downconversion
    t = np.arange(n) / sample_rate
    I = audio * np.cos(2 * np.pi * tone_freq * t)
    Q = audio * -np.sin(2 * np.pi * tone_freq * t)

    # ch0: zero-phase IQ envelope, 1st-order 40Hz Butterworth
    sos = butter(1, 40, btype="low", fs=sample_rate, output="sos")
    mag = np.sqrt(sosfiltfilt(sos, I) ** 2 + sosfiltfilt(sos, Q) ** 2)
    ch0 = _decimate(mag, 16)[:n_out]
    ch0 = _normalize(ch0, noise_win_ms=1000)
    # Sigmoid sharpening: push values toward 0/1 for sharper edges and better F1/IoU.
    # AUC is rank-invariant, so this can only improve or maintain AUC.
    # gamma=2: output = x^2 / (x^2 + (1-x)^2). Halves apparent rise time.
    ch0 = _sharpen(ch0, gamma=10.0)

    return ch0[:, np.newaxis].astype(np.float32)


def _decimate(x: np.ndarray, factor: int) -> np.ndarray:
    """Decimate by averaging blocks of `factor` samples."""
    n = len(x) // factor * factor
    return x[:n].reshape(-1, factor).mean(axis=1)


def _sharpen(x: np.ndarray, gamma: float = 2.0) -> np.ndarray:
    """Push values toward 0/1: x^g / (x^g + (1-x)^g). AUC-preserving."""
    xg = x ** gamma
    return xg / (xg + (1.0 - x) ** gamma + 1e-12)


def _normalize(env: np.ndarray, noise_win_ms: float = 500.0, sr: int = 500) -> np.ndarray:
    """Normalize envelope to [0, 1] using running noise floor estimate."""
    from scipy.ndimage import minimum_filter1d

    win = max(int(noise_win_ms * sr / 1000), 1)
    kernel = np.ones(max(win // 10, 1)) / max(win // 10, 1)
    smoothed = np.convolve(env, kernel, mode="same")
    noise_floor = minimum_filter1d(smoothed, size=win)
    signal_level = np.percentile(env, 75)
    denom = max(signal_level - float(np.median(noise_floor)), 1e-10)
    return np.clip((env - noise_floor) / denom, 0.0, 1.0)
