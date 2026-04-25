"""
CW DSP envelope extraction — 4-channel orthogonal physics.

Synced from cw-ml/cw-dsp-research/dsp.py (autoresearch composite 0.8249,
v1.3.1 morse-audio AGC-calibrated SNR, eval -16 to -8 dB).

ch0: amplitude       — ±25 Hz bandpass + Hilbert + pct-norm + double sharpen
ch1: TKEO            — Teager-Kaiser energy on bandpassed signal (zero-delay)
ch2: matched filter  — 48 ms coherent IQ box — narrow BW for low-SNR
ch3: long MF         — 200 ms coherent IQ box — character-scale confidence prior

Contract:
  extract_envelope(audio, sample_rate, tone_freq) → (T, 4) float32 in [0, 1]
  T = len(audio) // 16. Dependencies: numpy, scipy only.

process_wav(wav_path, tone_freq_hz) → np.ndarray (T, 4)
  Convenience wrapper: reads WAV, runs extract_envelope.
"""
import numpy as np
import soundfile as sf
from scipy.ndimage import gaussian_filter1d, uniform_filter1d
from scipy.signal import butter, hilbert, sosfiltfilt

DSP_SAMPLE_RATE = 8000
ENVELOPE_SR = 500
DECIMATION = 16

_BP_BW_HZ = 25.0          # ch0 bandpass half-width (narrow → low-SNR)
_BP_ORDER = 1             # lowest order → shortest impulse response → sharpest edges
_TKEO_SMOOTH_MS = 30.0    # ch1: TKEO smoothing window
_MATCHED_MS = 48.0        # ch2: dit-scale IQ integration (BW~21 Hz)
_LONG_MATCHED_MS = 200.0  # ch3: character-scale IQ integration (BW~5 Hz)
_SHARPEN_GAMMA = 8.0      # applied twice (effective γ≈64 via composition)


def extract_envelope(audio: np.ndarray, sample_rate: int = DSP_SAMPLE_RATE,
                     tone_freq: float = 600.0) -> np.ndarray:
    n = len(audio)
    n_out = n // DECIMATION
    audio64 = audio.astype(np.float64)

    lo = max(tone_freq - _BP_BW_HZ, 1.0)
    hi = min(tone_freq + _BP_BW_HZ, sample_rate / 2 - 1)
    sos_bp = butter(_BP_ORDER, [lo, hi], btype="bandpass", fs=sample_rate, output="sos")
    bp = sosfiltfilt(sos_bp, audio64)

    ch0 = _ch0_amplitude(bp, n_out)
    ch1 = _tkeo(bp, sample_rate, n_out)
    ch2 = _matched(audio64, sample_rate, tone_freq, n_out, _MATCHED_MS)
    ch3 = _matched(audio64, sample_rate, tone_freq, n_out, _LONG_MATCHED_MS)

    return np.stack([ch0, ch1, ch2, ch3], axis=1).astype(np.float32)


def process_wav(wav_path: str, tone_freq_hz: float,
                sample_rate: int = DSP_SAMPLE_RATE) -> np.ndarray:
    """Read a WAV file and return the 4-channel DSP envelope (T, 4)."""
    audio, sr = sf.read(wav_path, dtype="float32")
    if sr != sample_rate:
        raise ValueError(f"Expected {sample_rate} Hz, got {sr} in {wav_path}")
    if audio.ndim > 1:
        audio = audio[:, 0]
    return extract_envelope(audio, sample_rate, tone_freq_hz)


def _ch0_amplitude(bp: np.ndarray, n_out: int) -> np.ndarray:
    mag = np.abs(hilbert(bp))
    mag = gaussian_filter1d(mag, sigma=4.0, mode="reflect")
    env = _decimate(mag, DECIMATION)[:n_out]
    env = _normalize(env)
    env = np.clip((env - 0.05) / 0.76, 0.0, 1.0)
    env = _sharpen(env, _SHARPEN_GAMMA)
    return _sharpen(env, _SHARPEN_GAMMA)


def _tkeo(bp: np.ndarray, sample_rate: int, n_out: int) -> np.ndarray:
    psi = np.zeros_like(bp)
    psi[1:-1] = bp[1:-1] ** 2 - bp[:-2] * bp[2:]
    psi = np.maximum(psi, 0.0)
    win = max(3, int(_TKEO_SMOOTH_MS / 1000.0 * sample_rate))
    psi = uniform_filter1d(psi, size=win, mode="reflect")
    env = _decimate(psi, DECIMATION)[:n_out]
    return _normalize(env)


def _matched(audio: np.ndarray, sample_rate: int, tone_freq: float,
             n_out: int, duration_ms: float) -> np.ndarray:
    t = np.arange(len(audio)) / sample_rate
    I = audio * np.cos(2.0 * np.pi * tone_freq * t)
    Q = audio * (-np.sin(2.0 * np.pi * tone_freq * t))
    win = max(3, int(duration_ms / 1000.0 * sample_rate))
    I_mf = uniform_filter1d(I, size=win, mode="reflect")
    Q_mf = uniform_filter1d(Q, size=win, mode="reflect")
    mag = np.sqrt(I_mf ** 2 + Q_mf ** 2)
    env = _decimate(mag, DECIMATION)[:n_out]
    return _normalize(env)


def _decimate(x: np.ndarray, factor: int) -> np.ndarray:
    n = len(x) // factor * factor
    return x[:n].reshape(-1, factor).mean(axis=1)


def _normalize(env: np.ndarray, lo_pct: float = 17.0, hi_pct: float = 88.0) -> np.ndarray:
    lo = float(np.percentile(env, lo_pct))
    hi = float(np.percentile(env, hi_pct))
    denom = max(hi - lo, 1e-10)
    return np.clip((env - lo) / denom, 0.0, 1.0)


def _sharpen(x: np.ndarray, gamma: float) -> np.ndarray:
    xg = x ** gamma
    return xg / (xg + (1.0 - x) ** gamma + 1e-12)
