# CW DSP Autoresearch: Setup & Launch Plan

## What We're Building

An autonomous DSP optimization loop using Claude Code. The agent edits `dsp.py` (the only mutable file), runs `python evaluate.py` (immutable scorer), reads the composite score + per-channel diagnostics, and iterates. Git ratchet: only improvements advance the branch.

**Starting point:** 2 channels only. The agent is free to change what those 2 channels are, add a 3rd if it can justify the composite score improvement, tune every parameter, or rewrite the extraction approach entirely.

**Scoring:** Ground truth binary envelope (tone on/off) from your TypeScript generator → compare against DSP output → Bayesian HMM post-processing → composite score.

---

## Project Layout

```
cw-dsp-research/
├── CLAUDE.md               # Agent directive (autoresearch loop instructions)
├── dsp.py                  # MUTABLE — the agent's playground
├── evaluate.py             # IMMUTABLE — scoring harness
├── hmm_scorer.py           # IMMUTABLE — 2-state Bayesian HMM
├── generate_testset.py     # IMMUTABLE — one-time synthetic data generation
├── constants.py            # IMMUTABLE — sample rates, paths, constraints
├── testdata/               # Pre-generated .npz test samples (gitignored)
├── results.tsv             # Experiment log (gitignored)
└── .gitignore
```

---

## File 1: `constants.py`

```python
"""Immutable constants. The agent must not edit this file."""

AUDIO_SR = 8000          # Input audio sample rate
ENVELOPE_SR = 500        # Output envelope sample rate
DECIMATION = AUDIO_SR // ENVELOPE_SR  # 16

# Test set
TESTDATA_DIR = "testdata"
N_TEST_SAMPLES = 24      # 6 SNR levels × 4 samples each
SNR_LEVELS = [-12, -6, -3, 0, 6, 15]  # dB, ARRL 2500 Hz ref

# Scoring weights
W_AUC = 0.25
W_F1 = 0.20
W_IOU = 0.20
W_TIMING = 0.20
W_ELEMENT = 0.15

# Time budget per evaluation
MAX_EVAL_SECONDS = 90

# DSP constraints
MAX_CHANNELS = 4          # Agent may use 1-4 channels
MIN_CHANNELS = 1
```

---

## File 2: `hmm_scorer.py`

```python
"""
Immutable 2-state Bayesian HMM for P(tone_on) estimation.
Uses Beta emissions (proper [0,1] bounded model) with forward-backward.
The agent must not edit this file.
"""
import numpy as np
from scipy.special import logsumexp, betaln


class CWBayesianHMM:
    """
    Two-state HMM: OFF (0) and ON (1).
    
    Emissions: Beta distribution per channel per state.
    Transitions: Initialized from CW timing priors at 500 Hz.
    
    After construction, call fit() on labeled training data,
    then decode() on new envelopes to get P(tone_on).
    """
    
    def __init__(self, n_channels, env_sr=500):
        self.n_channels = n_channels
        self.sr = env_sr
        
        # Transition priors: assume ~25 WPM average
        # dit = 48ms = 24 samples at 500 Hz
        # Minimum element: ~20 samples on, ~10 samples off
        p_stay_on = 0.96    # 1 - 1/25
        p_stay_off = 0.92   # 1 - 1/12 (shorter gaps on average)
        
        self.log_trans = np.log(np.array([
            [p_stay_off, 1 - p_stay_off],   # OFF → OFF, OFF → ON
            [1 - p_stay_on, p_stay_on],      # ON → OFF, ON → ON
        ]))
        
        self.log_startprob = np.log(np.array([0.7, 0.3]))
        
        # Beta emission params: (alpha, beta) per state per channel
        # OFF state: low values → Beta(2, 8) peaked near 0.2
        # ON state: high values → Beta(8, 2) peaked near 0.8
        self.alpha = np.zeros((2, n_channels))
        self.beta_param = np.zeros((2, n_channels))
        
        for c in range(n_channels):
            self.alpha[0, c] = 2.0   # OFF
            self.beta_param[0, c] = 8.0
            self.alpha[1, c] = 8.0   # ON
            self.beta_param[1, c] = 2.0
    
    def fit(self, envelopes_list, labels_list, n_iter=10):
        """
        EM fitting on labeled data.
        envelopes_list: list of (T, C) arrays
        labels_list: list of (T,) binary arrays
        """
        # Supervised fit: just compute Beta MLE from labeled segments
        on_vals = [[] for _ in range(self.n_channels)]
        off_vals = [[] for _ in range(self.n_channels)]
        
        for env, lab in zip(envelopes_list, labels_list):
            C = min(env.shape[1], self.n_channels)
            for c in range(C):
                on_vals[c].append(env[lab == 1, c])
                off_vals[c].append(env[lab == 0, c])
        
        for c in range(self.n_channels):
            on = np.clip(np.concatenate(on_vals[c]), 0.001, 0.999)
            off = np.clip(np.concatenate(off_vals[c]), 0.001, 0.999)
            
            if len(on) > 10:
                a, b = self._beta_mle(on)
                self.alpha[1, c], self.beta_param[1, c] = a, b
            if len(off) > 10:
                a, b = self._beta_mle(off)
                self.alpha[0, c], self.beta_param[0, c] = a, b
        
        # Fit transition probs from labeled data
        n_off_off = n_off_on = n_on_off = n_on_on = 0
        for lab in labels_list:
            for t in range(1, len(lab)):
                if lab[t-1] == 0 and lab[t] == 0: n_off_off += 1
                elif lab[t-1] == 0 and lab[t] == 1: n_off_on += 1
                elif lab[t-1] == 1 and lab[t] == 0: n_on_off += 1
                else: n_on_on += 1
        
        if n_off_off + n_off_on > 0:
            p00 = n_off_off / (n_off_off + n_off_on)
            self.log_trans[0] = np.log([max(p00, 0.01), max(1-p00, 0.01)])
        if n_on_on + n_on_off > 0:
            p11 = n_on_on / (n_on_on + n_on_off)
            self.log_trans[1] = np.log([max(1-p11, 0.01), max(p11, 0.01)])
    
    def decode(self, envelope):
        """
        Forward-backward on (T, C) envelope.
        Returns P(tone_on | all observations) at each timestep.
        """
        T = envelope.shape[0]
        C = min(envelope.shape[1], self.n_channels)
        env = np.clip(envelope[:, :C], 0.001, 0.999)
        
        # Log emission probs: sum of Beta log-pdf across channels
        log_B = np.zeros((T, 2))
        for s in range(2):
            for c in range(C):
                a = self.alpha[s, c]
                b = self.beta_param[s, c]
                log_B[:, s] += (
                    (a - 1) * np.log(env[:, c]) +
                    (b - 1) * np.log(1 - env[:, c]) -
                    betaln(a, b)
                )
        
        # Forward
        log_alpha = np.zeros((T, 2))
        log_alpha[0] = self.log_startprob + log_B[0]
        for t in range(1, T):
            for j in range(2):
                log_alpha[t, j] = (
                    logsumexp(log_alpha[t-1] + self.log_trans[:, j]) +
                    log_B[t, j]
                )
        
        # Backward
        log_beta = np.zeros((T, 2))
        for t in range(T - 2, -1, -1):
            for i in range(2):
                log_beta[t, i] = logsumexp(
                    self.log_trans[i, :] + log_B[t+1] + log_beta[t+1]
                )
        
        # Posterior
        log_gamma = log_alpha + log_beta
        log_gamma -= logsumexp(log_gamma, axis=1, keepdims=True)
        
        return np.exp(log_gamma[:, 1])  # P(ON)
    
    @staticmethod
    def _beta_mle(x):
        """Method of moments Beta MLE."""
        m = np.mean(x)
        v = np.var(x)
        if v >= m * (1 - m):
            v = m * (1 - m) * 0.9  # clamp
        common = m * (1 - m) / v - 1
        return max(m * common, 0.5), max((1 - m) * common, 0.5)
```

---

## File 3: `evaluate.py`

```python
"""
Immutable scoring harness. The agent must not edit this file.

Usage: python evaluate.py
Prints composite score and diagnostics to stdout.
"""
import sys, os, time, json
import numpy as np
from pathlib import Path
from sklearn.metrics import roc_auc_score, f1_score

from constants import *
from hmm_scorer import CWBayesianHMM


def load_testset():
    """Load pre-generated test samples."""
    samples = []
    for f in sorted(Path(TESTDATA_DIR).glob("*.npz")):
        d = np.load(f, allow_pickle=True)
        samples.append({
            "audio": d["audio"],
            "gt_binary": d["gt_binary"],       # (T_500hz,) binary
            "gt_elements": json.loads(str(d["gt_elements"])),
            "snr_db": float(d["snr_db"]),
            "wpm": float(d["wpm"]),
            "tone_freq": float(d["tone_freq"]),
        })
    return samples


def compute_timing_error(gt_binary, pred_binary, sr=500):
    """Mean absolute onset/offset error in milliseconds."""
    gt_edges = np.where(np.diff(gt_binary.astype(int)) != 0)[0]
    pred_edges = np.where(np.diff(pred_binary.astype(int)) != 0)[0]
    
    if len(gt_edges) == 0 or len(pred_edges) == 0:
        return 100.0  # penalty
    
    errors = []
    for ge in gt_edges:
        if len(pred_edges) > 0:
            closest = pred_edges[np.argmin(np.abs(pred_edges - ge))]
            errors.append(abs(closest - ge) / sr * 1000)  # ms
    
    return np.mean(errors) if errors else 100.0


def compute_iou(gt, pred):
    """Intersection over union of active regions."""
    intersection = np.sum(gt * pred)
    union = np.sum(np.maximum(gt, pred))
    return intersection / max(union, 1)


def count_elements(binary, min_gap_samples=3):
    """Count distinct ON elements in a binary array."""
    in_element = False
    count = 0
    gap_counter = 0
    for v in binary:
        if v > 0.5:
            if not in_element:
                count += 1
                in_element = True
            gap_counter = 0
        else:
            gap_counter += 1
            if gap_counter >= min_gap_samples:
                in_element = False
    return count


def run_evaluation():
    t0 = time.time()
    
    # Import the mutable DSP module
    try:
        import dsp
    except Exception as e:
        print(f"IMPORT_ERROR: {e}")
        sys.exit(1)
    
    samples = load_testset()
    if not samples:
        print("ERROR: No test data. Run generate_testset.py first.")
        sys.exit(1)
    
    # Run DSP on all samples, collect envelopes
    envelopes = []
    n_channels = None
    for s in samples:
        try:
            env = dsp.extract_envelope(
                s["audio"], 
                sample_rate=AUDIO_SR,
                tone_freq=s["tone_freq"]
            )
        except Exception as e:
            print(f"DSP_ERROR: {e}")
            sys.exit(1)
        
        if n_channels is None:
            n_channels = env.shape[1]
        elif env.shape[1] != n_channels:
            print(f"CHANNEL_ERROR: Inconsistent channels {env.shape[1]} vs {n_channels}")
            sys.exit(1)
        
        if n_channels < MIN_CHANNELS or n_channels > MAX_CHANNELS:
            print(f"CHANNEL_ERROR: {n_channels} channels, must be {MIN_CHANNELS}-{MAX_CHANNELS}")
            sys.exit(1)
            
        envelopes.append(env)
    
    # Fit HMM on first 6 samples (one per SNR level), decode the rest
    fit_envs = envelopes[:6]
    fit_labels = [s["gt_binary"][:len(e)] for e, s in zip(fit_envs, samples[:6])]
    
    hmm = CWBayesianHMM(n_channels=n_channels)
    hmm.fit(fit_envs, fit_labels)
    
    # Score all samples (including fit samples — the HMM is simple enough 
    # that overfitting on 6 samples is minimal, and we want full coverage)
    results_by_snr = {}
    all_scores = []
    per_channel_auc = [[] for _ in range(n_channels)]
    
    issues = []
    
    for i, (env, s) in enumerate(zip(envelopes, samples)):
        gt = s["gt_binary"][:len(env)]
        
        # HMM posterior
        p_on = hmm.decode(env)
        pred_binary = (p_on > 0.5).astype(float)
        
        # Per-channel AUC (raw, no HMM)
        for c in range(n_channels):
            try:
                auc_c = roc_auc_score(gt, env[:, c])
            except ValueError:
                auc_c = 0.5
            per_channel_auc[c].append(auc_c)
        
        # Post-HMM metrics
        try:
            auc = roc_auc_score(gt, p_on)
        except ValueError:
            auc = 0.5
        
        # Find optimal threshold for F1
        best_f1 = 0
        for thresh in np.arange(0.3, 0.8, 0.05):
            f = f1_score(gt, (p_on > thresh).astype(int), zero_division=0)
            if f > best_f1:
                best_f1 = f
        
        iou = compute_iou(gt, pred_binary)
        timing_err = compute_timing_error(gt, pred_binary)
        
        gt_elements = count_elements(gt)
        pred_elements = count_elements(pred_binary)
        elem_ratio = min(pred_elements, gt_elements) / max(gt_elements, 1)
        
        # Composite
        timing_score = max(0, 1 - timing_err / 50)
        composite = (
            W_AUC * auc +
            W_F1 * best_f1 +
            W_IOU * iou +
            W_TIMING * timing_score +
            W_ELEMENT * elem_ratio
        )
        
        snr = s["snr_db"]
        snr_bucket = f"{snr:+.0f}dB"
        results_by_snr.setdefault(snr_bucket, []).append(composite)
        all_scores.append(composite)
        
        # Diagnose issues
        if pred_elements > gt_elements * 1.5:
            issues.append(f"sample {i} ({snr_bucket}): {pred_elements} elements detected vs {gt_elements} GT (insertions)")
        elif pred_elements < gt_elements * 0.5:
            issues.append(f"sample {i} ({snr_bucket}): {pred_elements} elements detected vs {gt_elements} GT (misses)")
        if timing_err > 15:
            issues.append(f"sample {i} ({snr_bucket}): timing error {timing_err:.1f}ms")
    
    elapsed = time.time() - t0
    
    # === STDOUT OUTPUT (parsed by agent) ===
    composite_mean = np.mean(all_scores)
    print(f"composite: {composite_mean:.4f}")
    print(f"n_channels: {n_channels}")
    print(f"eval_time_s: {elapsed:.1f}")
    print()
    
    # Per-SNR breakdown
    print("--- per_snr ---")
    for snr_bucket in sorted(results_by_snr.keys()):
        scores = results_by_snr[snr_bucket]
        print(f"  {snr_bucket}: {np.mean(scores):.4f}")
    print()
    
    # Per-channel raw AUC (no HMM)
    print("--- per_channel_auc ---")
    for c in range(n_channels):
        mean_auc = np.mean(per_channel_auc[c])
        print(f"  ch{c}: {mean_auc:.4f}")
    print()
    
    # Issues
    if issues:
        print("--- issues ---")
        for iss in issues[:10]:
            print(f"  {iss}")
    else:
        print("--- issues: none ---")


if __name__ == "__main__":
    run_evaluation()
```

---

## File 4: `dsp.py` (Starting Point)

This is the **only file the agent edits**. Start with 2 simple channels — IQ envelope and phase coherence — so the agent has a clear baseline to improve from.

```python
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
```

---

## File 5: `generate_testset.py`

```python
"""
Generate fixed synthetic test data. Run once.
Uses your existing TypeScript morse-generate CLI.

Adjust MORSE_GEN_CMD to point to your generator.
"""
import subprocess, json, tempfile, os
import numpy as np
import soundfile as sf
from pathlib import Path
from constants import *


# Path to your morse-generate CLI
MORSE_GEN_CMD = "npx morse-generate"  # Adjust this

# Fixed test configurations
TEST_CONFIGS = []
for snr in SNR_LEVELS:
    for i in range(4):
        wpm = [18, 24, 30, 36][i]
        tone_freq = [550, 600, 650, 700][i]
        text = [
            "CQ CQ DE W1ABC",
            "W1ABC 599 GA", 
            "QTH ATLANTA NAME MARK",
            "5NN 14025",
        ][i]
        TEST_CONFIGS.append({
            "text": text,
            "wpm": wpm,
            "snr_db": snr,
            "tone_freq": tone_freq,
            "impairment": "clean" if snr > 0 else "qsb_mild",
        })


def generate_sample(config, output_path):
    """Generate one test sample via your TS generator + DSP."""
    # This is a stub — adapt to your actual generator interface.
    # The key contract: produce an 8kHz WAV and ground truth timing.
    
    # Option A: Call your TypeScript generator
    # Option B: Pure Python synthetic generation (below)
    
    audio, gt_binary, gt_elements = _synth_cw_python(
        config["text"], config["wpm"], config["snr_db"],
        config["tone_freq"], AUDIO_SR
    )
    
    n_env = len(audio) // DECIMATION
    gt_500 = _decimate_binary(gt_binary, DECIMATION, n_env)
    
    np.savez_compressed(
        output_path,
        audio=audio.astype(np.float32),
        gt_binary=gt_500.astype(np.float32),
        gt_elements=json.dumps(gt_elements),
        snr_db=config["snr_db"],
        wpm=config["wpm"],
        tone_freq=config["tone_freq"],
    )


def _synth_cw_python(text, wpm, snr_db, tone_freq, sr):
    """Pure Python CW synth for bootstrap. Replace with your TS generator."""
    dit_s = 1.2 / wpm
    dah_s = 3 * dit_s
    ele_gap = dit_s
    char_gap = 3 * dit_s
    word_gap = 7 * dit_s
    
    MORSE = {
        'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 
        'F': '..-.', 'G': '--.', 'H': '....', 'I': '..', 'J': '.---',
        'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---',
        'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-',
        'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--',
        'Z': '--..', '0': '-----', '1': '.----', '2': '..---',
        '3': '...--', '4': '....-', '5': '.....', '6': '-....',
        '7': '--...', '8': '---..', '9': '----.', '/': '-..-.',
        '?': '..--..', '.': '.-.-.-', ',': '--..--', '=': '-...-',
    }
    
    segments = []  # (start_s, end_s, type)
    t = 0.5  # lead silence
    
    elements = []
    
    for ci, char in enumerate(text.upper()):
        if char == ' ':
            t += word_gap - char_gap  # already added char_gap after prev char
            continue
        code = MORSE.get(char)
        if not code:
            continue
        
        for ei, symbol in enumerate(code):
            dur = dit_s if symbol == '.' else dah_s
            segments.append((t, t + dur))
            elements.append({
                "char": char, "type": "dit" if symbol == '.' else "dah",
                "start_s": t, "end_s": t + dur
            })
            t += dur
            if ei < len(code) - 1:
                t += ele_gap
        
        t += char_gap
    
    t += 0.5  # tail silence
    total_samples = int(t * sr)
    
    # Generate clean signal
    signal = np.zeros(total_samples)
    gt_binary = np.zeros(total_samples)
    for start, end in segments:
        s, e = int(start * sr), min(int(end * sr), total_samples)
        tt = np.arange(s, e) / sr
        # Raised cosine edges (5ms)
        edge = int(0.005 * sr)
        tone = np.sin(2 * np.pi * tone_freq * tt)
        # Apply edges
        if edge > 0 and len(tone) > 2 * edge:
            ramp = 0.5 * (1 - np.cos(np.pi * np.arange(edge) / edge))
            tone[:edge] *= ramp
            tone[-edge:] *= ramp[::-1]
        signal[s:e] = tone
        gt_binary[s:e] = 1.0
    
    # Signal power (during active elements only)
    active = signal[gt_binary > 0.5]
    if len(active) > 0:
        sig_power = np.mean(active**2)
    else:
        sig_power = np.mean(signal**2) + 1e-10
    
    # Add noise at specified SNR
    snr_linear = 10**(snr_db / 10)
    noise_power = sig_power / snr_linear
    noise = np.sqrt(noise_power) * np.random.randn(total_samples)
    audio = signal + noise
    
    return audio.astype(np.float32), gt_binary.astype(np.float32), elements


def _decimate_binary(gt, factor, n_out):
    """Decimate binary ground truth: majority vote per block."""
    n = min(len(gt), n_out * factor)
    gt_trim = gt[:n]
    blocks = gt_trim[:n_out * factor].reshape(n_out, factor)
    return (blocks.mean(axis=1) > 0.5).astype(np.float32)


if __name__ == "__main__":
    os.makedirs(TESTDATA_DIR, exist_ok=True)
    np.random.seed(42)  # FIXED SEED — never change
    
    for i, config in enumerate(TEST_CONFIGS):
        path = os.path.join(TESTDATA_DIR, f"sample_{i:03d}.npz")
        generate_sample(config, path)
        print(f"Generated {path}: {config['text'][:20]}... SNR={config['snr_db']}dB WPM={config['wpm']}")
    
    print(f"\nDone: {len(TEST_CONFIGS)} samples in {TESTDATA_DIR}/")
```

---

## File 6: `CLAUDE.md`

This is the agent directive — the equivalent of Karpathy's `program.md`. Place it in the project root.

```markdown
# CW DSP Envelope Extraction — Autoresearch Directive

## Your Mission

You are optimizing a DSP pipeline that extracts CW (Morse code) tone presence
from noisy audio. The output is a multi-channel soft envelope (values 0-1) at
500 Hz that will later feed a neural network for character decoding. Your job is
to maximize the composite score from evaluate.py.

## The Loop

LOOP FOREVER. The human might be asleep. Do not stop until told to.

1. Read the current `dsp.py` and the latest `results.tsv` (if it exists).
2. Run `python evaluate.py` to get the current baseline score.
3. Analyze the output:
   - `composite:` is the primary metric to maximize
   - `per_snr:` shows where you're weak (low SNR scores matter most)
   - `per_channel_auc:` shows which channels are carrying weight
   - `issues:` lists specific failure modes to fix
4. Propose ONE change to `dsp.py`. Commit it with a descriptive message.
5. Run `python evaluate.py` again.
6. Parse the new `composite:` score.
7. Record in results.tsv: `git_hash\told_score\tnew_score\tdescription`
8. If composite improved → keep the commit. Move to next experiment.
9. If composite worsened or stayed same → `git checkout -- dsp.py` to revert.
10. Go to step 1.

If evaluate.py crashes (IMPORT_ERROR, DSP_ERROR, etc.), read the error,
fix dsp.py, and retry. If an idea is fundamentally broken after 2 attempts,
revert and try something else.

## What You May Edit

ONLY `dsp.py`. Everything else is immutable.

## Constraints on dsp.py

- Function signature: `extract_envelope(audio, sample_rate, tone_freq) → np.ndarray`
- Output shape: `(T, C)` where `T = len(audio) // 16` and `C` is 1-4
- Output values: float32 in [0, 1]
- Dependencies: numpy, scipy only (must work without torch, sklearn, etc.)
- Must complete in < 5 seconds for a 10-second audio clip
- tone_freq may be 400-900 Hz — the pipeline must adapt

## The Signal

CW is a sinusoidal tone at `tone_freq` Hz, keyed on and off (OOK modulation).
- Dits: short bursts (40-75ms depending on WPM)
- Dahs: 3× dit duration
- Gaps: 1× (intra-char), 3× (inter-char), 7× (inter-word) dit duration
- Noise: AWGN at various SNR levels, some samples have QSB (ionospheric fading)
- The test set spans -12 dB to +15 dB SNR (ARRL 2500 Hz reference)

## What Matters Most

1. **Low-SNR performance** — improving the -12dB and -6dB scores is worth more
   than squeezing another 0.01 out of +15dB. The HMM scorer amplifies the
   difference between "barely detectable" and "undetectable."
2. **Clean on/off transitions** — timing error directly affects Morse decoding.
   The Bayesian HMM helps with this, but feeding it a cleaner envelope helps more.
3. **Few false elements** — insertions (detecting tone when none exists) are worse
   than misses. A conservative, precise envelope beats an aggressive noisy one.
4. **Channel complementarity** — if you use 2 channels, they should measure
   DIFFERENT properties of the signal. IQ amplitude + phase coherence is good.
   IQ amplitude + slightly-different IQ amplitude is worthless.

## Ideas to Explore (in roughly priority order)

### Signal extraction fundamentals
- Matched filter at dit duration (theoretically optimal for OOK in AWGN)
- Coherent integration time vs bandwidth tradeoff
- Sliding Goertzel algorithm (efficient single-frequency DFT)
- Windowed autocorrelation at carrier lag
- STFT spectral contrast (on-tone vs off-tone power ratio)

### Noise suppression
- Spectral subtraction using noise-only estimates from silent gaps
- Minimum statistics noise tracking (Martin 2001)
- Adaptive notch filter to remove tonal interference
- Wiener filter on the baseband signal

### Normalization and calibration
- Running median vs running minimum for noise floor
- Adaptive gain control that tracks QSB fading envelope
- Per-channel z-score normalization with exponential moving average

### Novel channels
- Instantaneous frequency stability (low variance = tone present)
- Cyclostationary features exploiting CW's periodic keying
- Wavelet-based multiscale envelope (Morlet at carrier frequency)
- Spectral kurtosis (Gaussian noise vs deterministic tone)

### Architecture changes
- Try 1 channel (just the absolute best single extraction)
- Try 3-4 channels if the composite clearly benefits
- Fuse channels before output (e.g., geometric mean, learned weights)

## DSP Reference Knowledge

At 0 dB SNR in 300 Hz bandwidth:
- Bandpass → IQ downconversion gives ~19 dB processing gain
- Matched filter (dit-duration integration) adds ~12-18 dB
- Total processing gain of ~30 dB makes binary detection trivial at 0 dB

The theoretical BER for OOK in AWGN: BER = 0.5 × erfc(√(SNR/2))
At post-processing SNR of 20 dB: BER ≈ 4×10⁻⁶

The cochlea does 50-80 Hz bandpass → envelope detection → pattern matching.
FT8/WSJT-X achieves -26 dB decoding through coherent integration (6.25 Hz bins).

## Do Not

- Do not modify evaluate.py, hmm_scorer.py, constants.py, or generate_testset.py
- Do not hardcode assumptions about specific test samples
- Do not use ML libraries (torch, sklearn, tensorflow) inside dsp.py
- Do not exceed 4 output channels
- Do not make the pipeline slower than 5 seconds per 10-second clip
```

---

## File 7: `.gitignore`

```
testdata/
results.tsv
__pycache__/
*.pyc
```

---

## Launch Sequence

### 1. Setup (5 minutes)

```bash
mkdir cw-dsp-research && cd cw-dsp-research
git init

# Create all files from above (or copy from your project)
# ... create constants.py, hmm_scorer.py, evaluate.py, dsp.py, 
#     generate_testset.py, CLAUDE.md, .gitignore

pip install numpy scipy scikit-learn soundfile

# Generate test data (fixed seed, never regenerate)
python generate_testset.py

# Verify baseline
python evaluate.py

git add -A
git commit -m "Initial baseline: 2-channel IQ + phase coherence"
```

### 2. Optional: Install ARIS Skills

If you want the cross-model review (Codex MCP reviews Claude's DSP changes):

```bash
git clone https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep.git /tmp/aris
mkdir -p ~/.claude/skills/
cp -r /tmp/aris/skills/* ~/.claude/skills/

# Optional: Codex MCP for cross-model review
npm install -g @openai/codex
codex setup
claude mcp add codex -s user -- codex mcp-server
```

The ARIS `/experiment-bridge` skill gives you auto-debug on failures (retries up
to 3× before giving up) and optional cross-model code review. But the core loop
works fine with just Claude Code and the CLAUDE.md directive.

### 3. Launch the Autonomous Loop

**Option A: Claude Code headless (simplest)**

```bash
git checkout -b autoresearch/dsp-v1

claude -p "Read CLAUDE.md and begin the DSP optimization loop. Start by running 
python evaluate.py to get the baseline, then iterate on dsp.py to maximize 
composite score. NEVER STOP." \
  --allowedTools "Read,Write,Edit,Bash" \
  --max-turns 500
```

**Option B: Claude Code with /loop (session-bound)**

```bash
claude
# Then inside Claude Code:
> Read CLAUDE.md, run evaluate.py for baseline, then /loop "Read CLAUDE.md 
  step 1-10. Run one experiment cycle: analyze → edit dsp.py → evaluate → 
  keep/revert → record in results.tsv" --count 200
```

**Option C: With ARIS experiment-bridge**

```bash
claude
> /experiment-bridge
# When prompted for research direction:
"Optimize CW Morse code DSP envelope extraction. Read CLAUDE.md for the full 
loop spec. The goal is maximizing composite score from evaluate.py. The only 
editable file is dsp.py. Start with python evaluate.py for baseline."
```

### 4. Monitor

In another terminal:
```bash
# Watch scores
tail -f results.tsv

# Check git log for improvements only
git log --oneline autoresearch/dsp-v1

# See what the agent changed
git diff HEAD~1 -- dsp.py
```

---

## Expected Trajectory

Based on autoresearch results across domains (~3-5% of trials yield improvements):

| Phase | Trials | Expected Improvements | What Gets Found |
|-------|--------|----------------------|-----------------|
| 0-20 | Quick wins | 3-5 | Filter order tuning, window sizes, normalization bugs |
| 20-60 | Architecture | 2-4 | New channel types, better matched filtering |
| 60-150 | Refinement | 3-6 | Low-SNR specific tweaks, edge sharpening |
| 150-300 | Diminishing | 1-3 | Exotic approaches, spectral kurtosis, wavelets |

At ~20 seconds per trial (DSP is fast), 300 trials = ~2 hours. An overnight 
8-hour run produces ~1400 trials.

**Key thing to watch for:** If the agent gets stuck on parameter tweaking and 
never tries architectural changes (new channel types, different extraction 
methods), add a nudge to CLAUDE.md: "You have been tuning parameters for 20 
trials. Try a fundamentally different extraction approach."

---

## Adapting to Your Real Generator

The `generate_testset.py` above uses a pure Python CW synth. For better results,
swap it to call your TypeScript `morse-generate` CLI:

```python
# In generate_testset.py, replace _synth_cw_python with:
result = subprocess.run(
    ["npx", "morse-generate", "--config", json.dumps(config)],
    capture_output=True
)
# Parse WAV output + timing JSON from your generator
```

The key requirement: the test set must be **generated once with a fixed seed and 
never regenerated**. The agent must not be able to game the scorer by influencing 
test data.

---

## What About the Bayesian Trellis Decoder?

The HMM in `hmm_scorer.py` is deliberately simple — it's a scoring tool, not a 
decoder. Once the DSP optimization converges, the natural next step is:

1. Take the best `dsp.py` and wire it into your main `cw-decode` pipeline
2. Replace your existing 5-channel DSP with whatever the agent found
3. Feed the optimized envelopes into your CNN+BiGRU+CTC model
4. Optionally add a Bayesian trellis decoder as a post-CTC refinement step

The autoresearch loop optimizes the part that matters most: getting clean signal 
out of noise. Everything downstream benefits.
