"""
CW DSP envelope extraction — 4-channel orthogonal physics.

Diverges from cw-ml/cw-dsp-research/dsp.py: this build swaps the long-MF
ch3 for an STFT spectral-contrast ch3, to give the neural model
frequency-domain evidence the time-domain channels can't supply (and to
set up the next milestone — CW pileups, where freq-domain discrimination
is decisive). Trained against morse-audio v1.3.1 (AGC-calibrated SNR).

ch0: amplitude       — ±25 Hz bandpass + Hilbert + pct-norm + double sharpen
ch1: TKEO            — Teager-Kaiser energy on bandpassed signal (zero-delay)
ch2: matched filter  — 48 ms coherent IQ box — narrow BW for low-SNR
ch3: STFT contrast   — 40 ms Hann FFT, 3-bin tone-power vs 24-bin local
                       background median (pileup-aware: parametric on
                       tone_freq, local-bin background)

Contract:
  extract_envelope(audio, sample_rate, tone_freq) → (T, 4) float32 in [0, 1]
  T = len(audio) // 16. Dependencies: numpy, scipy only.

process_wav(wav_path, tone_freq_hz) → np.ndarray (T, 4)
  Convenience wrapper: reads WAV, runs extract_envelope.
"""
import numpy as np
import soundfile as sf
from scipy.ndimage import gaussian_filter1d, median_filter, uniform_filter1d
from scipy.signal import butter, hilbert, sosfiltfilt

DSP_SAMPLE_RATE = 8000
ENVELOPE_SR = 500
DECIMATION = 16

_BP_BW_HZ = 25.0          # ch0 bandpass half-width (narrow → low-SNR)
_BP_ORDER = 1             # lowest order → shortest impulse response → sharpest edges
_TKEO_SMOOTH_MS = 30.0    # ch1: TKEO smoothing window
_MATCHED_MS = 48.0        # ch2: dit-scale IQ integration (BW~21 Hz)
_STFT_WIN = 320           # ch3: 40 ms @ 8 kHz, 25 Hz/bin (test tones on bin centers)
_STFT_EXP = 0.79          # ch3: spectral-contrast compression exponent
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
    ch3 = _stft_contrast(audio64, sample_rate, tone_freq, n_out)

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


def _stft_contrast(audio: np.ndarray, sample_rate: int, tone_freq: float,
                   n_out: int) -> np.ndarray:
    # Frequency-domain tone-vs-background contrast — independent physics from
    # the time-domain amplitude detectors (ch0/ch1/ch2). Centered Hann (zero
    # group delay).
    #
    # Pileup-aware design (read this before tuning for QRM):
    #   - Tone-bin selection is parametric on `tone_freq` — switching the
    #     decoder to a different signal in a pileup is a single arg change.
    #   - Background = local-bin median over 24 bins (12 each side, gap ±4
    #     to ±16 from tone_bin = ±100 to ±400 Hz at 25 Hz/bin). Local —
    #     global noise level does NOT contaminate the estimate. Median is
    #     robust to 1-2 nearby interferers in the background range. For
    #     heavier pileup, this could be tightened to a 25th-percentile
    #     estimator without changing anything else.
    #   - 500 ms running-median floor prevents per-frame bg dips from
    #     spiking contrast in quiet noise periods.
    win_samples = _STFT_WIN
    bin_hz = sample_rate / win_samples
    tone_bin = int(round(tone_freq / bin_hz))
    window = np.hanning(win_samples)
    half_win = win_samples // 2

    audio_pad = np.pad(audio, (half_win, half_win), mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(
        audio_pad, win_samples
    )[:n_out * DECIMATION:DECIMATION]
    frames = frames * window
    powers = np.abs(np.fft.rfft(frames, axis=1)) ** 2

    tone_power = (
        powers[:, tone_bin - 1] + powers[:, tone_bin] + powers[:, tone_bin + 1]
    )
    bg_idx = np.r_[tone_bin - 16:tone_bin - 4, tone_bin + 5:tone_bin + 17]
    bg_power = np.median(powers[:, bg_idx], axis=1)
    bg_floor = median_filter(bg_power, size=250, mode="reflect")
    bg_power = np.maximum(bg_power, bg_floor)

    contrast = (tone_power / np.maximum(bg_power, 1e-12)) ** _STFT_EXP
    return _normalize(contrast)


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
