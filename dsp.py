"""
CW DSP envelope extraction — 3-channel orthogonal physics.

ch0: amplitude       — ±30 Hz bandpass + Hilbert + pct-norm + gentle sharpen
ch1: TKEO            — Teager-Kaiser energy on bandpassed signal (zero-delay)
ch2: matched filter  — 48 ms coherent IQ box — narrow BW for low-SNR

Contract:
  extract_envelope(audio, sample_rate, tone_freq) → (T, C) float32 in [0, 1]
  T = len(audio) // 16. Dependencies: numpy, scipy only.
"""
import math

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, hilbert, sosfiltfilt


_BP_BW_HZ = 30.0          # ch0+ch2 bandpass half-width (narrow → low-SNR)
_TKEO_SMOOTH_MS = 8.0     # ch1: TKEO smoothing window
_MATCHED_MS = 48.0        # ch2: dit-scale integration (BW~20 Hz)
_SHARPEN_GAMMA = 35.0     # soft — preserves gradient for CWNet


def extract_envelope(audio: np.ndarray, sample_rate: int = 8000,
                     tone_freq: float = 600.0) -> np.ndarray:
    n = len(audio)
    n_out = n // 16
    audio64 = audio.astype(np.float64)

    # ±25 Hz bandpass, shared by ch0 (via Hilbert) and ch2 (autocorr)
    lo = max(tone_freq - _BP_BW_HZ, 1.0)
    hi = min(tone_freq + _BP_BW_HZ, sample_rate / 2 - 1)
    sos_bp = butter(1, [lo, hi], btype="bandpass", fs=sample_rate, output="sos")
    bp = sosfiltfilt(sos_bp, audio64)

    ch0 = _ch0_amplitude(bp, n_out)
    ch1 = _tkeo(bp, sample_rate, n_out)
    ch2 = _matched(audio64, sample_rate, tone_freq, n_out, _MATCHED_MS)

    return np.stack([ch0, ch1, ch2], axis=1).astype(np.float32)


def _ch0_amplitude(bp: np.ndarray, n_out: int) -> np.ndarray:
    mag = np.abs(hilbert(bp))
    env = _decimate(mag, 16)[:n_out]
    env = _normalize(env)
    return _sharpen(env, _SHARPEN_GAMMA)


def _tkeo(bp: np.ndarray, sample_rate: int, n_out: int) -> np.ndarray:
    # Teager-Kaiser: ψ[n] = x[n]² − x[n−1]·x[n+1]. For a sinusoid Acos(ω n + φ),
    # ψ ≈ A²·sin²(ω). Zero-delay instantaneous-energy estimator — a different
    # nonlinear failure mode from the Hilbert envelope under noise.
    psi = np.zeros_like(bp)
    psi[1:-1] = bp[1:-1] ** 2 - bp[:-2] * bp[2:]
    psi = np.maximum(psi, 0.0)
    win = max(3, int(_TKEO_SMOOTH_MS / 1000.0 * sample_rate))
    psi = uniform_filter1d(psi, size=win, mode="reflect")
    env = _decimate(psi, 16)[:n_out]
    return _normalize(env)


def _matched(audio: np.ndarray, sample_rate: int, tone_freq: float,
             n_out: int, duration_ms: float) -> np.ndarray:
    # Coherent matched filter: IQ-demodulate, integrate both arms over a
    # configurable box, then take magnitude. Box of duration T has equivalent
    # noise BW ≈ 1/T — longer box = higher SNR (wins at very_low) but slower
    # edges (hurts at fast WPM).
    t = np.arange(len(audio)) / sample_rate
    I = audio * np.cos(2.0 * np.pi * tone_freq * t)
    Q = audio * (-np.sin(2.0 * np.pi * tone_freq * t))
    win = max(3, int(duration_ms / 1000.0 * sample_rate))
    I_mf = uniform_filter1d(I, size=win, mode="reflect")
    Q_mf = uniform_filter1d(Q, size=win, mode="reflect")
    mag = np.sqrt(I_mf ** 2 + Q_mf ** 2)
    env = _decimate(mag, 16)[:n_out]
    return _normalize(env)


def _decimate(x: np.ndarray, factor: int) -> np.ndarray:
    n = len(x) // factor * factor
    return x[:n].reshape(-1, factor).mean(axis=1)


def _normalize(env: np.ndarray) -> np.ndarray:
    lo = float(np.percentile(env, 10))
    hi = float(np.percentile(env, 85))
    denom = max(hi - lo, 1e-10)
    return np.clip((env - lo) / denom, 0.0, 1.0)


def _sharpen(x: np.ndarray, gamma: float) -> np.ndarray:
    xg = x ** gamma
    return xg / (xg + (1.0 - x) ** gamma + 1e-12)
