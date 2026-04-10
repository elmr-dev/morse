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
from scipy.signal import butter, sosfiltfilt


def extract_envelope(audio: np.ndarray, sample_rate: int = 8000,
                     tone_freq: float = 600.0) -> np.ndarray:
    """
    Extract multi-channel soft envelope from CW audio.

    ch0: IQ magnitude, N2/fc=20 Hz — zero-phase (sosfiltfilt).
         Zero group delay + ~16 Hz effective BW (vs ~30 Hz causal).
         Offline-only; non-causal forward-backward filter.
    ch1: STFT spectral contrast, centered 25 ms window.
         Zero effective delay (frame centered on current sample).
         Both channels: zero delay → timing errors approach zero for high SNR.
    """
    n_out = len(audio) // 16
    n = len(audio)

    t = np.arange(n) / sample_rate
    I = audio * np.cos(2 * np.pi * tone_freq * t)
    Q = audio * -np.sin(2 * np.pi * tone_freq * t)

    sos_lp = butter(2, 15, btype='low', fs=sample_rate, output='sos')
    I_filt = sosfiltfilt(sos_lp, I)   # zero-phase: no group delay, ~16 Hz eff. BW
    Q_filt = sosfiltfilt(sos_lp, Q)

    # === Channel 0: IQ Envelope (Butterworth, good timing) ===
    mag = np.sqrt(I_filt**2 + Q_filt**2)
    ch0 = _decimate(mag, 16)[:n_out]
    ch0 = _soft_normalize(ch0, noise_window_ms=750)

    # === Channel 1: STFT Spectral Contrast (centered 25 ms window) ===
    # Centered framing: frame k uses audio[k*16-100 : k*16+100], zero delay.
    win_stft = 320  # 40 ms at 8 kHz; bin_hz = 25 Hz; 550,600,650,700 Hz all on exact bins
    half_win = win_stft // 2  # 160
    hann = np.hanning(win_stft)
    audio_pad = np.concatenate([np.zeros(half_win), audio, np.zeros(half_win)])
    frames = np.lib.stride_tricks.as_strided(
        audio_pad,
        shape=(n_out, win_stft),
        strides=(audio_pad.strides[0] * 16, audio_pad.strides[0])
    ).copy()
    pwr = np.abs(np.fft.rfft(frames * hann, axis=1)) ** 2

    bin_hz = sample_rate / win_stft  # 40 Hz/bin
    tone_bin = int(round(tone_freq / bin_hz))
    tone_bin = max(2, min(pwr.shape[1] - 3, tone_bin))
    tone_power = pwr[:, tone_bin - 1] + pwr[:, tone_bin] + pwr[:, tone_bin + 1]

    lo = list(range(max(1, tone_bin - 12), max(1, tone_bin - 4)))
    hi = list(range(min(tone_bin + 5, pwr.shape[1] - 1),
                    min(tone_bin + 13, pwr.shape[1] - 1)))
    bg_bins = np.array(lo + hi, dtype=int)
    if len(bg_bins) == 0:
        bg_bins = np.array([max(1, tone_bin - 5),
                            min(pwr.shape[1] - 2, tone_bin + 5)], dtype=int)

    bg_power = np.median(pwr[:, bg_bins], axis=1) + 1e-10
    ch1 = _soft_normalize(((tone_power / bg_power) ** (1/3))[:n_out])

    # Compute 48ms box-filter IQ (used for ch2 and ch3).
    N_dit = int(round(0.048 * sample_rate))  # 384 at 8kHz
    if N_dit % 2 == 0:
        N_dit += 1  # odd for centered convolution
    box = np.ones(N_dit) / N_dit
    I_box = np.convolve(I, box, mode='same')
    Q_box = np.convolve(Q, box, mode='same')
    mag_box = np.sqrt(I_box**2 + Q_box**2)
    ch_box = _decimate(mag_box, 16)[:n_out]
    ch_box = _soft_normalize(ch_box, noise_window_ms=750)

    # ch2: min(Butterworth, STFT) — spectral+IQ agreement
    ch2 = np.minimum(ch0, ch1)
    # ch3: min(Butterworth, Box) — IQ persistence (burst filter)
    ch3 = np.minimum(ch0, ch_box)

    return np.column_stack([ch0, ch1, ch2, ch3])


def _decimate(x, factor):
    """Decimate by averaging blocks of `factor` samples."""
    n = len(x) // factor * factor
    return x[:n].reshape(-1, factor).mean(axis=1)


def _soft_normalize(env, noise_window_ms=500, sr=500):
    """Normalize envelope to [0, 1] using noise floor and signal level."""
    win = max(int(noise_window_ms * sr / 1000), 1)

    kernel = np.ones(max(win // 10, 1)) / max(win // 10, 1)
    smoothed = np.convolve(env, kernel, mode='same')

    from scipy.ndimage import minimum_filter1d
    noise_floor = minimum_filter1d(smoothed, size=win)

    signal_level = np.percentile(env, 95)
    denom = max(signal_level - np.median(noise_floor), 1e-10)
    normalized = (env - noise_floor) / denom

    return np.clip(normalized, 0, 1)
