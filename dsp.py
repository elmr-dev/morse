"""
CW DSP envelope extraction.
This file is the ONLY mutable file in the autoresearch loop.
The agent may freely modify everything here.

Contract:
  - extract_envelope(audio, sample_rate, tone_freq) → np.ndarray of shape (T, C)
  - T = len(audio) // 16 (decimation from 8000 to 500 Hz)
  - C = number of channels (1-4, see constants.py)
  - Values must be in [0, 1]
  - tone_freq is the CW tone frequency in Hz (typically 500-800)
"""
import numpy as np
from scipy.signal import butter, sosfilt, hilbert


def extract_envelope(audio: np.ndarray, sample_rate: int = 8000,
                     tone_freq: float = 600.0) -> np.ndarray:
    """
    Extract multi-channel soft envelope from CW audio.

    Current: 2 channels
      ch0: IQ magnitude envelope (40 Hz LPF)
      ch1: Phase coherence (50 ms sliding window)
    """
    n_out = len(audio) // 16  # 500 Hz output

    # === Channel 0: IQ Envelope ===
    t = np.arange(len(audio)) / sample_rate
    I = audio * np.cos(2 * np.pi * tone_freq * t)
    Q = audio * -np.sin(2 * np.pi * tone_freq * t)

    # Lowpass at 40 Hz
    sos_lp = butter(6, 40, btype='low', fs=sample_rate, output='sos')
    I_filt = sosfilt(sos_lp, I)
    Q_filt = sosfilt(sos_lp, Q)

    mag = np.sqrt(I_filt**2 + Q_filt**2)

    # Decimate to 500 Hz via strided mean
    ch0 = _decimate(mag, 16)[:n_out]
    ch0 = _soft_normalize(ch0)

    # === Channel 1: Phase Coherence ===
    # Tighter bandpass for phase measurement
    sos_lp2 = butter(6, 60, btype='low', fs=sample_rate, output='sos')
    I2 = sosfilt(sos_lp2, I)
    Q2 = sosfilt(sos_lp2, Q)

    phase = np.arctan2(Q2, I2)

    # Circular mean resultant over 50ms window (400 samples at 8kHz)
    win = 400
    cos_phase = np.cos(phase)
    sin_phase = np.sin(phase)

    # Cumulative sum for fast sliding window
    cs_cos = np.cumsum(np.insert(cos_phase, 0, 0))
    cs_sin = np.cumsum(np.insert(sin_phase, 0, 0))

    R = np.zeros(len(phase))
    for i in range(win, len(phase)):
        mc = (cs_cos[i+1] - cs_cos[i+1-win]) / win
        ms = (cs_sin[i+1] - cs_sin[i+1-win]) / win
        R[i] = np.sqrt(mc**2 + ms**2)

    ch1 = _decimate(R, 16)[:n_out]
    ch1 = _soft_normalize(ch1)

    return np.column_stack([ch0, ch1])


def _decimate(x, factor):
    """Decimate by averaging blocks of `factor` samples."""
    n = len(x) // factor * factor
    return x[:n].reshape(-1, factor).mean(axis=1)


def _soft_normalize(env, noise_window_ms=2000, sr=500):
    """Normalize envelope to [0, 1] using noise floor and signal level."""
    win = max(int(noise_window_ms * sr / 1000), 1)

    # Smooth first
    kernel = np.ones(max(win // 10, 1)) / max(win // 10, 1)
    smoothed = np.convolve(env, kernel, mode='same')

    # Running minimum as noise floor estimate
    from scipy.ndimage import minimum_filter1d
    noise_floor = minimum_filter1d(smoothed, size=win)

    # Signal level as 90th percentile
    signal_level = np.percentile(env, 90)

    denom = max(signal_level - np.median(noise_floor), 1e-10)
    normalized = (env - noise_floor) / denom

    return np.clip(normalized, 0, 1)
