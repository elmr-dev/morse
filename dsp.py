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
    2-channel baseline: zero-phase IQ + STFT spectral contrast.

    ch0: IQ magnitude, 15 Hz zero-phase Butterworth (sosfiltfilt).
         No group delay — edges land at the correct frame.
    ch1: STFT spectral contrast, centered 40 ms window.
         Zero effective delay (frame centered on current sample).
    """
    n_out = len(audio) // 16
    n = len(audio)

    # IQ downconversion
    t = np.arange(n) / sample_rate
    I = audio * np.cos(2 * np.pi * tone_freq * t)
    Q = audio * -np.sin(2 * np.pi * tone_freq * t)

    # ch0: zero-phase IQ envelope
    sos = butter(2, 35, btype="low", fs=sample_rate, output="sos")
    mag = np.sqrt(sosfiltfilt(sos, I) ** 2 + sosfiltfilt(sos, Q) ** 2)
    ch0 = _decimate(mag, 16)[:n_out]
    ch0 = _normalize(ch0)

    # ch1: STFT spectral contrast, centered 20 ms window (160 samples at 8 kHz)
    # 50 Hz/bin — all standard CW tone freqs (multiples of 50) land on exact bins
    # 20ms < dit at 45 WPM (27ms) → no temporal smearing for fast CW
    win = 160
    half = win // 2
    hann = np.hanning(win)
    pad = np.concatenate([np.zeros(half), audio, np.zeros(half)])
    frames = np.lib.stride_tricks.as_strided(
        pad,
        shape=(n_out, win),
        strides=(pad.strides[0] * 16, pad.strides[0]),
    ).copy()
    pwr = np.abs(np.fft.rfft(frames * hann, axis=1)) ** 2

    bin_hz = sample_rate / win  # 25 Hz/bin
    tb = int(round(tone_freq / bin_hz))
    tb = max(2, min(pwr.shape[1] - 3, tb))
    tone_pwr = pwr[:, tb - 1] + pwr[:, tb] + pwr[:, tb + 1]

    lo = list(range(max(1, tb - 16), max(1, tb - 4)))
    hi = list(range(min(tb + 5, pwr.shape[1] - 1), min(tb + 17, pwr.shape[1] - 1)))
    bg_bins = np.array(lo + hi, dtype=int)
    if len(bg_bins) == 0:
        bg_bins = np.array([max(1, tb - 5), min(pwr.shape[1] - 2, tb + 5)], dtype=int)

    bg = np.median(pwr[:, bg_bins], axis=1) + 1e-10
    # Stabilize bg: prevent momentary dips from causing false ratio spikes.
    # Running median over 500ms (250 frames at 500Hz) smooths transients.
    from scipy.ndimage import median_filter
    bg_smooth = median_filter(bg, size=250)
    bg = np.maximum(bg, bg_smooth)
    ch1 = _normalize((tone_pwr / bg) ** 0.3)

    return np.column_stack([ch0, ch1]).astype(np.float32)


def _decimate(x: np.ndarray, factor: int) -> np.ndarray:
    """Decimate by averaging blocks of `factor` samples."""
    n = len(x) // factor * factor
    return x[:n].reshape(-1, factor).mean(axis=1)


def _normalize(env: np.ndarray, noise_win_ms: float = 500.0, sr: int = 500) -> np.ndarray:
    """Normalize envelope to [0, 1] using running noise floor estimate."""
    from scipy.ndimage import minimum_filter1d

    win = max(int(noise_win_ms * sr / 1000), 1)
    kernel = np.ones(max(win // 10, 1)) / max(win // 10, 1)
    smoothed = np.convolve(env, kernel, mode="same")
    noise_floor = minimum_filter1d(smoothed, size=win)
    signal_level = np.percentile(env, 97)
    denom = max(signal_level - float(np.median(noise_floor)), 1e-10)
    return np.clip((env - noise_floor) / denom, 0.0, 1.0)
