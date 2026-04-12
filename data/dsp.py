"""
CW DSP envelope extraction — 1-channel IQ magnitude pipeline.

Ported from cw-ml/cw-dsp-research/dsp.py (the autoresearch-validated pipeline).

Contract:
  extract_envelope(audio, sample_rate, tone_freq) → np.ndarray shape (T, 1)
  T = len(audio) // 16  (decimation: 8000 Hz → 500 Hz)
  Values in [0, 1], dtype float32

process_wav(wav_path, tone_freq_hz) → np.ndarray (T, 1)
  Convenience wrapper: reads WAV, runs extract_envelope.
"""
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

DSP_SAMPLE_RATE = 8000
ENVELOPE_SR = 500
DECIMATION = 16


def extract_envelope(audio: np.ndarray, sample_rate: int = 8000,
                     tone_freq: float = 600.0) -> np.ndarray:
    """
    Single-channel IQ magnitude envelope.

    ch0: IQ magnitude, 21 Hz zero-phase Butterworth (sosfiltfilt).
         No group delay — edges land at the correct frame.
         Sigmoid-sharpened (gamma=37) to push values toward 0/1 for clean CTC edges.
    """
    n_out = len(audio) // 16
    n = len(audio)

    # IQ downconversion
    t = np.arange(n) / sample_rate
    I = audio * np.cos(2 * np.pi * tone_freq * t)
    Q = audio * -np.sin(2 * np.pi * tone_freq * t)

    # ch0: zero-phase IQ envelope, 1st-order 21Hz Butterworth
    sos = butter(1, 21, btype="low", fs=sample_rate, output="sos")
    mag = np.sqrt(sosfiltfilt(sos, I) ** 2 + sosfiltfilt(sos, Q) ** 2)
    ch0 = _decimate(mag, 16)[:n_out]
    ch0 = _normalize(ch0, noise_win_ms=750)
    # Sigmoid sharpening: push values toward 0/1 for sharper CTC edges.
    # gamma=37 is empirically optimal (cw-dsp-research autoresearch, Apr 2026).
    ch0 = _sharpen(ch0, gamma=37.0)

    return ch0[:, np.newaxis].astype(np.float32)


def process_wav(wav_path: str, tone_freq_hz: float,
                sample_rate: int = DSP_SAMPLE_RATE) -> np.ndarray:
    """Read a WAV file and return the 1-channel DSP envelope (T, 1)."""
    audio, sr = sf.read(wav_path, dtype="float32")
    if sr != sample_rate:
        raise ValueError(f"Expected {sample_rate} Hz, got {sr} in {wav_path}")
    if audio.ndim > 1:
        audio = audio[:, 0]  # mono
    return extract_envelope(audio, sample_rate, tone_freq_hz)


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
    kernel = np.ones(max(win // 23, 1)) / max(win // 23, 1)
    smoothed = np.convolve(env, kernel, mode="same")
    noise_floor = minimum_filter1d(smoothed, size=win)
    signal_level = np.percentile(env, 82)
    denom = max(signal_level - float(np.median(noise_floor)), 1e-10)
    return np.clip((env - noise_floor) / denom, 0.0, 1.0)
