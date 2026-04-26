"""
CW DSP envelope extraction — 5-channel orthogonal physics.

ch0..ch3 are time-domain amplitude/energy detectors at tone_freq with
different time constants. ch4 is the new "go nuts" experimental channel:
a temporal-cadence detector that measures CW's regular dit-rate
fingerprint in the envelope spectrum. AWGN's envelope spectrum is flat;
CW's has a fundamental peak in the 6-20 Hz band (corresponds to
W/2.4 Hz dit-rate across 15-50 WPM).

ch0: amplitude       — ±25 Hz bandpass + Hilbert + pct-norm + double sharpen
ch1: TKEO            — Teager-Kaiser energy on bandpassed signal (zero-delay)
ch2: matched filter  — 48 ms coherent IQ box — narrow BW for low-SNR
ch3: long MF         — 200 ms coherent IQ box — character-scale confidence prior
ch4: cadence         — sliding-FFT contrast of envelope at CW dit-rate band
                       vs adjacent off-cadence reference band — orthogonal
                       physics from the four amplitude channels (autocorr-like
                       quadratic op the BiGRU would otherwise have to learn
                       implicitly under weak gradients at low SNR)

Contract:
  extract_envelope(audio, sample_rate, tone_freq) → (T, 5) float32 in [0, 1]
  T = len(audio) // 16. Dependencies: numpy, scipy only.

process_wav(wav_path, tone_freq_hz) → np.ndarray (T, 5)
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
_CADENCE_WIN = 256        # ch4: 512 ms sliding-FFT window at 500 Hz envelope rate
_CADENCE_SIG_BINS = (3, 11)   # ~5.9 to 21.5 Hz: CW dit-rate band (15-50 WPM)
_CADENCE_REF_BINS = (13, 26)  # ~25.4 to 50.8 Hz: off-cadence noise reference
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
    ch4 = _cadence(bp, n_out)

    return np.stack([ch0, ch1, ch2, ch3, ch4], axis=1).astype(np.float32)


def process_wav(wav_path: str, tone_freq_hz: float,
                sample_rate: int = DSP_SAMPLE_RATE) -> np.ndarray:
    """Read a WAV file and return the 5-channel DSP envelope (T, 5)."""
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


def _cadence(bp: np.ndarray, n_out: int) -> np.ndarray:
    # Temporal-cadence detector — measures the regular dit-rate
    # fingerprint in the envelope spectrum. CW envelope at W WPM has a
    # fundamental at ~W/2.4 Hz (10.4 Hz @ 25 WPM, 16.7 Hz @ 40 WPM); AWGN
    # envelope spectrum is flat. We compute a sliding 512 ms FFT on the
    # Hilbert envelope and take the ratio of CW dit-rate band power
    # (~6-21 Hz, bins 3-10) to off-cadence reference band power
    # (~25-51 Hz, bins 13-25). Pre-computing this autocorr-like quadratic
    # feature gives the model evidence the BiGRU would otherwise have to
    # learn under weak gradients at low SNR.
    mag = np.abs(hilbert(bp))
    mag = gaussian_filter1d(mag, sigma=4.0, mode="reflect")
    env = _decimate(mag, DECIMATION)[:n_out]
    env_zm = env - env.mean()                       # remove DC for spectral analysis
    half = _CADENCE_WIN // 2
    window = np.hanning(_CADENCE_WIN)
    env_pad = np.pad(env_zm, (half, half), mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(
        env_pad, _CADENCE_WIN
    )[:n_out]                                       # (n_out, _CADENCE_WIN)
    frames = frames * window                        # broadcast Hann
    powers = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    sig = powers[:, _CADENCE_SIG_BINS[0]:_CADENCE_SIG_BINS[1]].sum(axis=1)
    ref = powers[:, _CADENCE_REF_BINS[0]:_CADENCE_REF_BINS[1]].sum(axis=1) + 1e-12
    contrast = np.sqrt(sig / ref)                   # compress dynamic range
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
