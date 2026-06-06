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
     (composite = envelope_score(ch0) + 0.15 × info_gain)
   - `envelope_score:` ch0-only tone-presence quality (timing, rise, F1, IoU, AUC)
   - `info_gain:` how much independent tone-presence info the aux channels add,
     measured as `probe_auc − ch0_auc` via a global logistic probe (clipped ≥0)
   - `per_snr:` weakest SNR tier (very_low and low matter most)
   - `per_wpm:` weakest speed tier (slow/mid/fast are the targets)
   - `per_channel_auc:` per-channel AUC — ch0 should be strong; aux channels
     can be weaker but must add info (check `info_gain`)
   - `per_metric:` sub-scores + probe weights (diagnoses dead aux channels)
   - `issues:` specific failure modes to investigate
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

`dsp.py` is the primary file you modify in the research loop.

`evaluate.py` is only mutable for scorer / reporting changes explicitly
approved by the human. Do not change it as part of routine experimentation.

`hmm_scorer.py`, `constants.py`, and `generate_testset.py` are immutable.

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

4. **WPM coverage: 15–45 WPM is the primary target** — slow (< 20 WPM) is
   easy and will score well naturally. vfast (45–60 WPM) is trained on but
   low operational priority. Focus improvements on mid (20–35) and fast
   (35–45) tiers. Note: norm_timing and rise_ms are normalized by dit
   duration so they are directly comparable across speeds.

5. **Channel complementarity** — if you use 2+ channels, they must measure
   DIFFERENT properties. IQ amplitude + phase coherence is good.
   IQ amplitude + slightly-different IQ amplitude is worthless.

   The scorer enforces this: ch0 is scored on its own as the tone-presence
   envelope (timing, rise, F1, IoU, AUC). Aux channels earn an info-gain
   bonus equal to `probe_auc − ch0_auc` (clipped ≥0), where `probe` is a
   logistic regression fit globally on (all channels → ground truth). An
   aux channel that duplicates ch0 gets zero bonus; one that carries
   independent tone-presence info (e.g. phase coherence fails differently
   from amplitude under QSB) gets a meaningful bonus.

## What the Metrics Mean

- `norm_timing` < 0.3 = good; > 1.0 = broken
- `auc` > 0.85 = good discrimination; < 0.70 = channel is failing
- `f1` > 0.80 = good binary detection
- `iou` > 0.75 = good overlap
- `rise_ms` < 15 ms = sharp edges; > 40 ms = too slow for fast CW
- `composite` > 0.75 = deployment-quality; 0.60–0.75 = usable; < 0.60 = broken

## Do Not Fuse Channels Inside `dsp.py`

The downstream consumer is CWNet (CNN+BiGRU+CTC). It wants soft,
gradient-bearing channels — it will learn its own fusion.

- **Emit channels unfused.** ch0 is the tone-presence envelope. Aux channels
  are independent measurements (phase coherence, spectral statistics, etc.).
  Do not `mean()` / `min()` / `max()` them together before returning.
- **The scorer does not fuse either.** It evaluates ch0 on envelope metrics
  and grants aux channels an info-gain bonus via a linear probe (see §4 above).
- **Historical note:** earlier experiments used `np.minimum(ch0, ch1)` as an
  "agreement filter." It suppressed signal during transitions and pushed
  `norm_timing` from 0.24 to 0.52. Do not reintroduce it.

## Exploration Agenda

### Level 0 — Add a Complementary Aux Channel (highest leverage)

Single-channel tuning has diminished to ~+0.001 per experiment. The scorer
now rewards aux channels that add linearly-independent tone-presence
information via an info-gain bonus. Prefer this before more ch0 tweaks.

The canonical first move: keep ch0 as the current bandpass+Hilbert envelope,
add **ch1 = phase coherence** — short-time circular variance of instantaneous
phase `arctan2(Q,I)`, inverted and normalized to [0,1]. Amplitude-invariant,
so it fails differently from ch0 under QSB fading. Preserve soft values;
do not binarize.

Other aux-channel candidates (pick one, measure info_gain):
- TKEO (very fast response, no group delay)
- Sliding Goertzel at tone_freq (narrow-bin power)
- Spectral kurtosis (Gaussian noise ≈3, tone >3)
- Wavelet (Morlet) envelope at carrier

Reject the channel if info_gain stays ≤0.005 after 2 variants of parameters.

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

### Level 6 — (removed) Channel Fusion

Do not fuse channels inside `dsp.py`. See "Do Not Fuse Channels" above.
CWNet learns its own fusion; emit raw soft channels.

## DSP Reference

At –18 dB SNR (noise power 63× signal power):
- Bandpass + IQ demodulation: ~19 dB processing gain
- Matched filter (dit-duration integration): ~12–18 dB additional gain
- Total: ~30 dB processing gain makes +12 dB effective SNR → detection feasible

At 0 dB SNR, BER for OOK in AWGN: ~Q(√SNR_post) after matched filtering.

FT8 achieves –26 dB decoding via 6.25 Hz bins + 15-second integration.
CW is harder (variable timing) but benefits from the same narrow-bandwidth insight.

## Do Not

- Do not modify `hmm_scorer.py`, `constants.py`, or `generate_testset.py`
- Do not modify `evaluate.py` as part of routine experimentation (only on
  explicit human-approved scorer/reporting changes)
- Do not hardcode anything that assumes specific test samples
- Do not use ML libraries (torch, sklearn, tensorflow) in `dsp.py`
- Do not exceed 4 output channels
- Do not make the pipeline slower than 5 seconds per 10-second clip
- Do not fuse channels inside `dsp.py` (`mean`, `min`, `max`, geometric mean,
  weighted sums, etc.) — emit soft raw channels for CWNet to fuse
