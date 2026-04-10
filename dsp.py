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
from scipy.signal import butter, sosfilt


def extract_envelope(audio: np.ndarray, sample_rate: int = 8000,
                     tone_freq: float = 600.0) -> np.ndarray:
    """
    Extract multi-channel soft envelope from CW audio.

    ch0: IQ magnitude, 4th-order Butterworth 20 Hz (absolute amplitude)
    ch1: Phase coherence, 50 ms window (phase stability)
    ch2: STFT spectral contrast — power at tone_freq bin vs adjacent background.
         Measures energy *concentration* at tone_freq; complementary to ch0/ch1.
    """
    n_out = len(audio) // 16  # 500 Hz output

    # IQ downconversion
    t = np.arange(len(audio)) / sample_rate
    I = audio * np.cos(2 * np.pi * tone_freq * t)
    Q = audio * -np.sin(2 * np.pi * tone_freq * t)

    # === Channel 0: IQ Envelope — 4th-order Butterworth at 20 Hz ===
    sos_lp = butter(4, 20, btype='low', fs=sample_rate, output='sos')
    I_filt = sosfilt(sos_lp, I)
    Q_filt = sosfilt(sos_lp, Q)
    mag = np.sqrt(I_filt**2 + Q_filt**2)

    ch0 = _decimate(mag, 16)[:n_out]
    ch0 = _soft_normalize(ch0)

    n = len(audio)

    # === Channel 1: Phase Coherence (50 ms, vectorized) ===
    sos_lp2 = butter(6, 60, btype='low', fs=sample_rate, output='sos')
    I2 = sosfilt(sos_lp2, I)
    Q2 = sosfilt(sos_lp2, Q)
    phase = np.arctan2(Q2, I2)

    win_pc = 400  # 50 ms at 8 kHz
    cs_cos = np.concatenate([[0.0], np.cumsum(np.cos(phase))])
    cs_sin = np.concatenate([[0.0], np.cumsum(np.sin(phase))])
    R = np.zeros(n)
    idx_pc = np.arange(win_pc, n)
    mc = (cs_cos[idx_pc + 1] - cs_cos[idx_pc + 1 - win_pc]) / win_pc
    ms = (cs_sin[idx_pc + 1] - cs_sin[idx_pc + 1 - win_pc]) / win_pc
    R[idx_pc] = np.sqrt(mc**2 + ms**2)

    ch1 = _decimate(R, 16)[:n_out]
    ch1 = _soft_normalize(ch1)

    # === Channel 2: STFT Spectral Contrast ===
    # Causal 50 ms window, 2 ms hop → one output sample per 16 audio samples.
    # Measures power in the tone-frequency bin relative to nearby background bins.
    # Tone-present: concentrated peak → high contrast ratio.
    # Noise-only: flat spectrum → contrast ≈ 1.
    win_stft = 400  # 50 ms at 8 kHz
    hann = np.hanning(win_stft)
    # Zero-pad win_stft at start for causal alignment
    audio_pad = np.concatenate([np.zeros(win_stft), audio])

    frames = np.lib.stride_tricks.as_strided(
        audio_pad,
        shape=(n_out, win_stft),
        strides=(audio_pad.strides[0] * 16, audio_pad.strides[0])
    ).copy()  # copy so fft doesn't modify the strided view

    pwr = np.abs(np.fft.rfft(frames * hann, axis=1)) ** 2  # (n_out, 201)

    # Tone bin index (bin width = 20 Hz for win=400 at 8 kHz)
    bin_hz = sample_rate / win_stft  # 20 Hz/bin
    tone_bin = int(round(tone_freq / bin_hz))
    tone_bin = max(3, min(pwr.shape[1] - 4, tone_bin))

    # Aggregate ±1 bin around tone (±20 Hz) to catch slight misalignment
    tone_power = pwr[:, tone_bin - 1] + pwr[:, tone_bin] + pwr[:, tone_bin + 1]

    # Background: bins 5–12 away from tone on each side (~100–240 Hz away)
    lo = list(range(max(1, tone_bin - 12), max(1, tone_bin - 4)))
    hi = list(range(min(tone_bin + 5, pwr.shape[1] - 1),
                    min(tone_bin + 13, pwr.shape[1] - 1)))
    bg_bins = np.array(lo + hi, dtype=int)
    if len(bg_bins) == 0:
        bg_bins = np.array([max(1, tone_bin - 5), min(pwr.shape[1] - 2, tone_bin + 5)],
                           dtype=int)

    bg_power = pwr[:, bg_bins].mean(axis=1) + 1e-10
    contrast = tone_power / bg_power  # higher = more concentrated at tone_freq

    ch2 = _soft_normalize(contrast[:n_out])

    return np.column_stack([ch0, ch1, ch2])


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
