"""
CW DSP envelope extraction — 3-channel orthogonal physics.

ch0: amplitude       — ±30 Hz bandpass + Hilbert + pct-norm + gentle sharpen
ch1: freq-stability  — rolling variance of inst-freq (20 ms), inverted (~16 ms rise)
ch2: matched filter  — coherent IQ box integration (40 ms) — narrow BW for low-SNR

Contract:
  extract_envelope(audio, sample_rate, tone_freq) → (T, C) float32 in [0, 1]
  T = len(audio) // 16. Dependencies: numpy, scipy only.
"""
import math

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, hilbert, sosfiltfilt


_BP_BW_HZ = 30.0          # ch0+ch2 bandpass half-width (narrow → low-SNR)
_LP_WIDE_HZ = 75.0        # ch1 baseband LPF (wide so noise stays random)
_INSTFREQ_WIN_MS = 20.0
_MATCHED_MS = 48.0
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
    ch1 = _ch1_instfreq(audio64, sample_rate, tone_freq, n_out)
    ch2 = _ch2_matched(audio64, sample_rate, tone_freq, n_out)

    return np.stack([ch0, ch1, ch2], axis=1).astype(np.float32)


def _ch0_amplitude(bp: np.ndarray, n_out: int) -> np.ndarray:
    mag = np.abs(hilbert(bp))
    env = _decimate(mag, 16)[:n_out]
    env = _normalize(env)
    return _sharpen(env, _SHARPEN_GAMMA)


def _ch1_instfreq(audio: np.ndarray, sample_rate: int, tone_freq: float,
                  n_out: int) -> np.ndarray:
    t = np.arange(len(audio)) / sample_rate
    I = audio * np.cos(2 * np.pi * tone_freq * t)
    Q = audio * (-np.sin(2 * np.pi * tone_freq * t))
    sos_lp = butter(6, _LP_WIDE_HZ, btype="low", fs=sample_rate, output="sos")
    I = sosfiltfilt(sos_lp, I)
    Q = sosfiltfilt(sos_lp, Q)

    phase = np.arctan2(Q, I)
    dphi = np.angle(np.exp(1j * np.diff(phase, prepend=phase[0])))
    win = max(3, int(_INSTFREQ_WIN_MS / 1000.0 * sample_rate))
    m1 = uniform_filter1d(dphi, size=win, mode="reflect")
    m2 = uniform_filter1d(dphi ** 2, size=win, mode="reflect")
    var_dp = np.maximum(m2 - m1 ** 2, 0.0)
    stability = np.exp(-var_dp * 2.0)

    env = _decimate(stability, 16)[:n_out]
    return _normalize(env)


def _ch2_matched(audio: np.ndarray, sample_rate: int, tone_freq: float,
                 n_out: int) -> np.ndarray:
    # Coherent matched filter: IQ-demodulate, integrate both arms over a
    # dit-duration box, then take magnitude. Box of T=40ms has equivalent
    # noise BW ≈ 1/T = 25 Hz — narrower than ch0's ±30 Hz bandpass, so this
    # channel has higher SNR (wins at very_low) but slower edges (fails at fast).
    t = np.arange(len(audio)) / sample_rate
    I = audio * np.cos(2.0 * np.pi * tone_freq * t)
    Q = audio * (-np.sin(2.0 * np.pi * tone_freq * t))
    win = max(3, int(_MATCHED_MS / 1000.0 * sample_rate))
    I_mf = uniform_filter1d(I, size=win, mode="reflect")
    Q_mf = uniform_filter1d(Q, size=win, mode="reflect")
    mag = np.sqrt(I_mf ** 2 + Q_mf ** 2)
    env = _decimate(mag, 16)[:n_out]
    return _normalize(env)


def _decimate(x: np.ndarray, factor: int) -> np.ndarray:
    n = len(x) // factor * factor
    return x[:n].reshape(-1, factor).mean(axis=1)


def _normalize(env: np.ndarray) -> np.ndarray:
    lo = float(np.percentile(env, 22))
    hi = float(np.percentile(env, 84))
    denom = max(hi - lo, 1e-10)
    return np.clip((env - lo) / denom, 0.0, 1.0)


def _sharpen(x: np.ndarray, gamma: float) -> np.ndarray:
    xg = x ** gamma
    return xg / (xg + (1.0 - x) ** gamma + 1e-12)
