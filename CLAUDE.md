# CW DSP Envelope Extraction — Autoresearch Directive

## Your Mission

You are optimizing a DSP pipeline that extracts CW (Morse code) tone presence
from noisy audio. The output is a multi-channel soft envelope (values 0–1) at
500 Hz that feeds a neural network (CWNet) for character decoding. Your job is
to maximize the composite score from `evaluate.py`.

## The Loop

LOOP FOREVER. The human might be asleep. Do not stop until told to.

1. Read the current `dsp.py` and the latest `results.tsv` (if it exists).
2. Run `python evaluate.py` to get the current baseline score.
3. Analyze the output:
   - `composite:` is the primary metric to maximize
   - `per_snr:` shows where you're weakest (very_low and low matter most)
   - `per_channel_auc:` reveals dead channels (< 0.60 = not helping)
   - `per_metric:` shows which sub-score to target next
   - `issues:` lists specific failure modes to investigate
4. Propose ONE change to `dsp.py`. Make it. Commit with a descriptive message.
5. Run `python evaluate.py` again.
6. Parse the new `composite:` score.
7. Record in `results.tsv`: `git_hash\told_score\tnew_score\tdescription`
8. If composite improved → keep the commit. Move to next experiment.
9. If composite worsened or stayed the same → `git checkout -- dsp.py` to revert.
10. Go to step 1.

If `evaluate.py` crashes (IMPORT_ERROR, DSP_ERROR, etc.), read the error,
fix `dsp.py`, and retry. After 2 failed attempts on the same idea, revert
and try something completely different.

## What You May Edit

ONLY `dsp.py`. Everything else is immutable.

## Constraints on dsp.py

- Function signature: `extract_envelope(audio, sample_rate, tone_freq) → np.ndarray`
- Output shape: `(T, C)` where `T = len(audio) // 16` and `C` is 1–4
- Output values: float32 in [0, 1]
- Dependencies: numpy, scipy only (no torch, sklearn, etc.)
- Must complete in < 5 seconds for a 10-second audio clip
- `tone_freq` may be 400–900 Hz — the pipeline must adapt to it

## The Signal

CW is a sinusoidal tone at `tone_freq` Hz, keyed on and off (OOK modulation).
- Dits: short bursts (~40–75 ms depending on WPM)
- Dahs: 3× dit duration
- Gaps: 1× (intra-char), 3× (inter-char), 7× (inter-word) dit duration
- Noise: AWGN, some samples have mild ionospheric fading (QSB)
- WPM range: 12–60 (mostly 18–40)
- SNR range: **–18 dB to +6 dB** (ARRL 2500 Hz reference bandwidth)

## What Matters for CWNet

CWNet uses a CNN + BiGRU + CTC decoder. It needs:

1. **Sharp edges at transitions** — CTC aligns characters to frame boundaries.
   A blurry onset smears the alignment lattice and hurts character accuracy.
   Target: `rise_ms` < 15 ms at 25 WPM (< half a dit duration).

2. **Low noise floor in gaps** — false energy during silence creates spurious
   blank-frame uncertainty that confuses the decoder.
   Target: `norm_timing` < 0.3 (edge error < 30% of a dit duration).

3. **Good low-SNR sensitivity** — improving very_low (< –10 dB) and low
   (–10 to –4 dB) is worth more than squeezing another 0.01 at +6 dB.
   The training dataset has 60% of samples below –4 dB.

4. **Channel complementarity** — if you use 2+ channels, they must measure
   DIFFERENT properties. IQ amplitude + phase coherence is good.
   IQ amplitude + slightly-different IQ amplitude is worthless.

## What the Metrics Mean

- `norm_timing` < 0.3 = good; > 1.0 = broken
- `auc` > 0.85 = good discrimination; < 0.70 = channel is failing
- `f1` > 0.80 = good binary detection
- `iou` > 0.75 = good overlap
- `rise_ms` < 15 ms = sharp edges; > 40 ms = too slow for fast CW
- `composite` > 0.75 = deployment-quality; 0.60–0.75 = usable; < 0.60 = broken

## CRITICAL: Never Use min() Fusion

**Do NOT use `np.minimum(ch0, ch1)` or similar to fuse channels.**

The `min()` operation suppresses the signal *during transitions* — exactly when
CTC needs a sharp edge. Benchmarking showed min() fusion caused `norm_timing`
to spike from 0.24 to 0.52 (2× worse). The composite collapsed from 0.73 to 0.58.

Safe fusion strategies: `mean()`, geometric mean, weighted mean, max().

## Exploration Agenda

Work through these levels in order. Skip ahead if a level is clearly exhausted.

### Level 1 — IQ Lowpass Bandwidth (highest leverage)

The zero-phase Butterworth cutoff directly controls the tradeoff between noise
rejection and edge sharpness.

- Try: 8, 10, 12, 15, 18, 20, 25, 30 Hz cutoffs
- Prediction: narrower helps low-SNR; too narrow smears dit edges (bad rise_ms)
- Also try: order 1 vs 2 vs 3 (higher order = sharper rolloff)

### Level 2 — Matched Filter

A box filter matched to the dit duration is theoretically optimal for OOK in
AWGN. Since WPM is unknown at inference time, try a few fixed durations.

- Try box filter durations: 20, 30, 40, 48, 60 ms (centered convolution)
- Try raised cosine (smoother than box — may give cleaner edges)
- Compare: replace ch0's Butterworth with matched filter, or add as ch1

### Level 3 — STFT Window Size

Bin width determines how well the tone falls on a bin center.

- Try: 128 (16 ms, 62.5 Hz/bin), 256 (32 ms, 31.3 Hz/bin), 320 (40 ms, 25 Hz/bin),
       512 (64 ms, 15.6 Hz/bin)
- Also try: spectral contrast exponent (currently 0.5) — range 0.3–0.9

### Level 4 — Novel Channels

Try adding ONE new channel at a time. Keep it only if composite improves.

**TKEO (Teager-Kaiser Energy Operator)** — instantaneous energy:
```python
# For signal x: TKEO[n] = x[n]^2 - x[n-1]*x[n+1]
tkeo = x[1:-1]**2 - x[:-2]*x[2:]
```
Very fast response, no group delay. Excellent for onset detection.

**Sliding Goertzel** — efficient single-frequency power:
```python
# Single-frequency DFT at tone_freq, computed over sliding windows.
# O(N×W) but can be optimized to O(N) with recursive update.
```

**Phase coherence** — running circular variance of instantaneous phase:
```python
# Instantaneous phase via arctan2(Q_filt, I_filt)
# Short-time circular variance: low = coherent tone, high = noise
```
Amplitude-independent — survives QSB fades.

**Spectral kurtosis** — Gaussian noise kurtosis≈3, deterministic tone > 3:
```python
# Over short windows: kurtosis of STFT magnitude distribution
```

**Wavelet envelope at carrier** — Morlet wavelet centered at tone_freq:
```python
# scipy.signal.morlet2 at tone_freq
```
Multi-scale; may improve low-SNR edge detection.

### Level 5 — Normalization

- Try different `noise_win_ms` values: 250, 500, 750, 1000 ms
- Try adaptive AGC: divide by running RMS (tracks QSB fading)
- Try sigmoid normalization: `1 / (1 + exp(-k*(x - x_median)))` after noise sub

### Level 6 — Channel Fusion (only with 2+ good channels)

- `mean()` — current default, safe
- `geometric_mean = sqrt(ch0 * ch1)` — favors agreement, less noise
- `max()` — aggressive, try at mid/high SNR
- Weighted: `0.6*ch0 + 0.4*ch1` if per-channel AUC shows one dominates

## DSP Reference

At –18 dB SNR (noise power 63× signal power):
- Bandpass + IQ demodulation: ~19 dB processing gain
- Matched filter (dit-duration integration): ~12–18 dB additional gain
- Total: ~30 dB processing gain makes +12 dB effective SNR → detection feasible

At 0 dB SNR, BER for OOK in AWGN: ~Q(√SNR_post) after matched filtering.

FT8 achieves –26 dB decoding via 6.25 Hz bins + 15-second integration.
CW is harder (variable timing) but benefits from the same narrow-bandwidth insight.

## Do Not

- Do not modify `evaluate.py`, `hmm_scorer.py`, `constants.py`, or `generate_testset.py`
- Do not hardcode anything that assumes specific test samples
- Do not use ML libraries (torch, sklearn, tensorflow) in `dsp.py`
- Do not exceed 4 output channels
- Do not make the pipeline slower than 5 seconds per 10-second clip
- Do not use `np.minimum()` or `np.min()` for channel fusion (see CRITICAL above)
