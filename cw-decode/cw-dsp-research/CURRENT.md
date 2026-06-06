# CW DSP — Current State

Single source of truth for the current DSP state. Pick up here. Historical
results.tsv rows scored against the pre-v1.3.1 generator (composite 0.9016
era) are not directly comparable to anything below — the v1.3.1 release fixed
a ~7 dB SNR-calibration error.

---

## Headline

| | |
|---|---|
| **Composite (tier-weighted)** | **0.8249** |
| `flat_composite` (unweighted mean) | 0.8140 |
| `snr_weighted` | 0.8353 |
| `wpm_weighted` | 0.8144 |
| Channels | 4 |
| Eval samples | 200 |
| Eval SNR | -16 to -8 dB uniform |
| Eval WPM | 25 to 45 uniform |
| Generator | `morse-audio` v1.3.1 (AGC-calibrated SNR — fixes prior ~7 dB error) |
| Eval seed | 42 (fixed) |
| `dsp.py` head | commit `56794d1` |

---

## DSP Architecture

`extract_envelope(audio, sample_rate=8000, tone_freq) → (T, 4) float32 in [0, 1]`
where `T = len(audio) // 16` (output rate 500 Hz).

### Shared front-end

A zero-phase Butterworth bandpass is computed once and reused by ch0 and ch1:

```
sos_bp = butter(order=1, [tone_freq - 25, tone_freq + 25], 'bandpass', fs=8000)
bp     = sosfiltfilt(sos_bp, audio)
```

Order 1 + `sosfiltfilt` (forward-backward) gives effective order 2 with **zero
group delay**. Half-width 25 Hz (BW 50 Hz) — the empirical sweet spot between
SNR rejection and edge sharpness.

### ch0 — Bandpass + Hilbert envelope (the CTC envelope channel)

```
mag = |hilbert(bp)|
mag = gaussian_filter1d(mag, sigma=4)             # 0.5 ms ripple smooth
env = decimate(mag, 16)                            # 8 kHz → 500 Hz
env = global_pct_normalize(env, 17, 88)            # rescale to [0, 1]
env = clip((env - 0.05) / 0.76, 0, 1)              # soft threshold
env = sharpen(sharpen(env, gamma=8), gamma=8)      # double sigmoidal
```

**Why this shape**: the Hilbert envelope gives instantaneous magnitude with
**zero group delay** (no integration window) — it is the only ch0 candidate
that hits `rise_ms < 1`. Sharpening (effective γ ≈ 64 via composition) snaps
the soft-thresholded envelope to near-binary at the 0.5 boundary, giving the
sharp threshold crossings the timing/F1/IoU metrics need. Replacing this
with a matched filter looked attractive (higher AUC) but the centered MF has
a 12 ms onset-delay geometry that wrecks `norm_timing` for fast WPM.

### ch1 — TKEO (Teager-Kaiser energy operator)

```
psi    = bp[1:-1]**2 - bp[:-2] * bp[2:]            # ψ[n] = x[n]² - x[n-1]·x[n+1]
psi    = max(psi, 0)
psi    = uniform_filter1d(psi, size=240)           # 30 ms smoothing
env    = decimate(psi, 16)
ch1    = global_pct_normalize(env, 17, 88)
```

For a sinusoid `A·cos(ωn+φ)`, ψ ≈ A²·sin²(ω) — instantaneous energy with no
group delay. Different nonlinear failure mode under noise from Hilbert. The
30 ms smoothing window is empirically optimal: shorter loses noise rejection;
longer (50 ms tested) smears across dit boundaries and **lowers** AUC.

### ch2 — Coherent matched filter (48 ms IQ box)

```
I = audio · cos(2π·tone_freq·t)
Q = audio · -sin(2π·tone_freq·t)
I = uniform_filter1d(I, size=384)                  # 48 ms centered box
Q = uniform_filter1d(Q, size=384)                  # 48 ms centered box
mag = sqrt(I² + Q²)
env = decimate(mag, 16)
ch2 = global_pct_normalize(env, 17, 88)
```

Box of duration T has equivalent noise BW ≈ 1/T → 48 ms gives ~21 Hz noise BW,
much narrower than ch0's bandpass. Costs: peak-vs-edge ambiguity for
variable-duration tones (dit peak < dah peak because the box never fully fills
with a 33 ms dit), and 48 ms intrinsic ramp makes per-channel `rise_ms` ≈ 37 ms
— but the scorer treats `rise_ms` as a diagnostic for aux channels (only ch0
is in `envelope_score`).

### ch3 — Long-context matched filter (200 ms IQ box)

Same code path as ch2, called with `duration_ms=200`. ~5 Hz noise BW, ~10 dB
narrower than ch2. **Useless for individual element edges** (per-channel
`rise_ms = 31 ms`, `norm_timing = 3.49`) because at 30 ms dit length the
window only fills ~15% during a single dit, so per-element peaks are flattened.

The value: a **smooth character-scale tone-presence prior** the neural model
(CNN+TCN+BiGRU) can fuse non-linearly. The DSP linear probe weights it +2.18
(`marginal_info_gain` = +0.048 vs ch0-alone, `info_gain` rose 0.068 → 0.075
when added) — and a non-linear model should extract more than the linear
probe sees. Particularly intended to help the -14 to -8 dB regime where
single-element SNR is at the limit but character-scale SNR is well above.

### Helpers

```python
def global_pct_normalize(env, lo_pct=17, hi_pct=88):
    lo, hi = np.percentile(env, [lo_pct, hi_pct])
    return clip((env - lo) / max(hi - lo, 1e-10), 0, 1)

def sharpen(x, gamma):
    xg = x ** gamma
    return xg / (xg + (1 - x) ** gamma + 1e-12)
```

---

## Per-Channel Benchmarks

Measured on the 200-sample v1.3.1 eval set:

| Channel | AUC | rise_ms | fall_ms | norm_timing | Probe weight | Marginal info_gain |
|---|---|---|---|---|---|---|
| **ch0** Hilbert + sharpen | 0.881 | **0.3** | **0.3** | **0.241** | +0.70 | — (anchor) |
| **ch1** TKEO 30 ms       | 0.948 | 36.8    | 23.8    | 0.774       | +4.40 | +0.067 |
| **ch2** MF 48 ms         | 0.935 | 36.6    | 32.0    | 0.564       | +1.62 | +0.059 |
| **ch3** MF 200 ms        | 0.851 | 31.1    | 62.1    | 3.494       | +2.18 | +0.048 |

Bias `b = -4.38`. **`info_gain = 0.0747`** — three aux channels each carrying
meaningful linearly-extractable information beyond ch0 alone.

**Reading the numbers**: ch1 has the highest individual AUC and dominates the
probe. ch0's job is sharp tone-presence for CTC alignment — it sacrifices raw
discrimination (0.881) for `rise_ms = 0.3` (vs ch1/ch2's ~37 ms). ch3 has
*lower* individual AUC than ch2 but a larger probe weight than ch2 in the
4-channel fit — its long-context info is less correlated with ch0+ch1 than
ch2 is.

### Per-tier composite (the headline)

| SNR tier | Mean composite | n | | WPM tier | Mean composite | n |
|---|---|---|---|---|---|---|
| very_low (-16 to -10) | **0.7863** | 149 | | mid (20–35 WPM) | 0.8439 | 91 |
| low (-10 to -8)       | **0.8911** | 51  | | fast (35–45 WPM) | **0.7872** | 109 |

`very_low` and `fast` are the bottlenecks. They co-occur in many of the
hardest samples (-14 dB at 42 WPM is the hardest case in the set).

### Per-metric decomposition of `envelope_score(ch0) = 0.8028`

| Metric | Value | Weight | Contribution |
|---|---|---|---|
| `timing_score = 1 - norm_timing` | 0.759 | 0.30 | 0.228 |
| AUC | 0.881 | 0.25 | 0.220 |
| F1 (threshold 0.5) | 0.787 | 0.20 | 0.157 |
| IoU (threshold 0.5) | 0.661 | 0.15 | 0.099 |
| `rise_score = max(0, 1 - rise_ms / (0.5·dit_ms))` | ≈1.00 | 0.10 | 0.100 |
| **Sum** | | | **0.804** |

`rise_score` is already saturated (rise_ms = 0.3 ms is 50× past the "good"
threshold). The marginal-improvement leverage is in F1, IoU, AUC — and those
trade against `norm_timing` through the BP bandwidth and sharpen γ.

---

## Scoring Mechanism (`evaluate.py`)

All scoring is at 500 Hz (the DSP output rate).

### Per-sample composite

```
envelope_score(ch0) = 0.30 · timing_score
                    + 0.25 · AUC
                    + 0.20 · F1
                    + 0.15 · IoU
                    + 0.10 · rise_score

composite_per_sample = envelope_score(ch0) + 0.15 · info_gain
```

Where:
- `timing_score = max(0, 1 - norm_timing)`,
  `norm_timing = RMS_edge_error_ms / dit_ms` (so it's WPM-comparable)
- `rise_score = max(0, 1 - rise_ms / (0.5 · dit_ms))`
- `AUC` is rank-based (Mann-Whitney U) — stable on long stacked arrays
- `info_gain = max(0, AUC(probe) - AUC(ch0))`

### The probe

A logistic regression `p = σ(env @ w + b)` is fit **globally** on stacked
`(env, gt)` across all samples, then evaluated per-sample. Single-channel
case: probe is monotonic in ch0 → `info_gain = 0` exactly (sanity check).
Multi-channel case: probe rewards aux channels only for **linearly-extractable
tone-presence info beyond ch0**. A redundant aux channel earns 0.

There's also a 2-column **marginal probe** per aux channel for diagnostics —
`AUC(probe over [ch0, chk]) - AUC(ch0)` — to catch cases where the global
probe hides a dead aux behind a strong neighbor.

### Headline composite (tier-weighted)

```
comp_snr_w = weighted mean over SNR tiers, weights renormalized over tiers present
comp_wpm_w = weighted mean over WPM tiers, ditto
composite  = 0.5 · (comp_snr_w + comp_wpm_w)
```

| SNR tier weights | WPM tier weights |
|---|---|
| very_low: 0.35 | slow:  0.15 |
| low:      0.30 | mid:   0.30 |
| mid:      0.20 | fast:  0.35 |
| high:     0.15 | vfast: 0.20 |

The current eval populates only `very_low` + `low` and `mid` + `fast` — the
absent tiers are dropped from the renormalization.

### Issue flags

`norm_timing > 1.5` or `rise_ms > 50` print a per-sample issue line. The
current state produces no flagged issues.

---

## DSP Detection Floor (threshold-only decode)

How well does the DSP do **alone**, with no model — just `ch0 > 0.5` →
extract ON segments → classify each as dit or dah by duration vs `2 · dit_ms`?

Generated 276 fresh AWGN-only samples (no QSB fading, no fist jitter,
machine-perfect timing) across SNR -22 to 0 dB in 1 dB steps × 12 trials each
(WPMs 20/25/30/40 × tone freqs 500/600/700). Scored each via Levenshtein on
the dit/dah string vs ground truth.

| SNR | Element accuracy | |
|---|---|---|
|  0 to -5 dB | 98.4% | Plateau — ceiling of "simple threshold + duration classifier" |
| -7 dB | **91.2%** | ← **90% threshold crossing** |
| -8 dB | 83.0% | |
| -9 dB | 66.8% | |
| -10 dB | 42.5% | |
| -11 dB | 27.8% | DSP starts breaking down (noise insertions explode) |
| -13 dB and below | <2% | Pred string is 200+ noise-spike "dits" vs 48 true elements |

Full data: `detection_threshold.csv`. Re-run via:

```
uv run python detection_threshold.py
```

### Implications for ML training

| Region | DSP alone | Model role |
|---|---|---|
| ≥ -7 dB | reliable (>90%) | small refinement (+~2% from CTC context) |
| -7 to -9 dB | partial (50–90%) | meaningful gains from context |
| **-9 to -16 dB** | **broken (<50%)** | **the gray area — model is doing real work** |
| < -16 dB | intractable | mostly language-prior memorization |

The ML training distribution should be weighted heavily in **-9 to -16 dB**,
where there is real signal still extractable but a simple threshold cannot.

---

## Eval Set Definition (`generate_eval.py`)

| Property | Value |
|---|---|
| Total samples | 200 |
| SNR distribution | uniform in [-16, -8] dB |
| WPM distribution | uniform in [25, 45] |
| Tone freqs | round-robin over {500, 550, 600, 650, 700, 750, 800} Hz (all multiples of 25 Hz, fall on STFT bin centers) |
| QSB fading | 30% of `very_low`, 20% of `low` (≈ 25% overall) |
| Fist jitter | none (machine-perfect) |
| Duration | 8 s per sample |
| Audio SR | 8000 Hz |
| Generator | `morse-audio` v1.3.1 (`packages/morse-audio/src/ml-training/generate-cli.ts`) |
| Generator seed | 1000 + idx (sample-specific, deterministic) |
| Config seed | 42 (fixed — controls SNR/WPM/text/fading assignment) |

Tier mapping under `constants.SNR_TIERS`:
- `very_low` (-16 ≤ snr < -10): ~149 samples (75%)
- `low` (-10 ≤ snr < -8): ~51 samples (25%)
- `mid`, `high`: empty by construction; scorer renormalizes weights

Output: 200 × `evaldata/sample_NNN.npz` containing `audio` (8000 Hz),
`gt_binary` (500 Hz), `snr_db`, `wpm`, `tone_freq`, `tier`.

Eval data is gitignored (~58 MB). Regenerate with:

```
uv run python generate_eval.py    # ~3 minutes
```

**Re-running invalidates all `results.tsv` rows** — the scorer's per-sample
seeds are baked into the audio.

---

## Pick-Up Commands

From `cw-ml/cw-dsp-research/`:

```bash
# First time setup
uv sync

# Verify baseline (assumes evaldata/ exists)
uv run python evaluate.py
# Expect: composite ≈ 0.8249, n_channels = 4

# Re-measure DSP detection floor
uv run python detection_threshold.py

# If evaldata/ is missing (it's gitignored)
uv run python generate_eval.py    # ~3 min, requires morse-audio v1.3.1 in ../../morse-audio
```

Sister repos this depends on:
- `../../morse-audio` (must be at `v1.3.1` / commit `f7ee231` or later)

---

## Recent Experiments — What Was Tried, What Stuck

The session against the v1.3.1 baseline ran 14 experiments. **One stuck**
(ch3 = long-context MF, +0.0009). The rest were reverted — the parameter-
tuning surface around the original 3-channel architecture is a strong local
optimum.

The keeper:

| Experiment | Δ composite | Notes |
|---|---|---|
| **Add ch3 = MF 200 ms** | **+0.0009** | info_gain 0.068→0.075. Probe weight ch3=+2.18. Adds real long-context info beyond ch0/ch1/ch2. Designed for the ML model to fuse non-linearly in the -14 to -8 dB regime. |

Reverted parameter tweaks (full log: `results.tsv`):

| Experiment | Δ composite | Why it failed |
|---|---|---|
| ch0 BP ±25 → ±20 Hz | -0.005 | AUC up, timing degraded too much |
| ch0 = sharpened MF (replace Hilbert) | -0.075 | MF centered window has 12 ms onset-delay geometry |
| ch0 8 ms uniform pre-smooth | -0.003 | Edge smear cost > noise gain |
| ch0 single sharpen (vs double γ=8) | -0.009 | Lost F1/IoU |
| TKEO smooth 30 → 50 ms | -0.0002 | Smearing across dit boundaries — TKEO sweet spot is 30 ms |
| Add ch3 = phase coherence (50 ms) | 0 | Probe found redundant with ch1/ch2 (amplitude detectors all fail similarly under heavy noise) |
| ch0 adaptive normalize (running min/max, 1 s) | -0.073 | Noise spikes hijack local max in pure-noise periods |
| ch0 BP ±25 → ±30 Hz | -0.003 | Timing improved, AUC dropped more |
| Median pre-smooth (size 9) vs Gaussian σ=4 | 0 | At ~1 ms width they're equivalent |
| ch2 = max(MF_33ms, MF_48ms) | -0.0001 | Multi-scale max gave near-zero AUC bump |
| `_normalize` hi_pct 88 → 92 | -0.0001 | ch0 AUC up 0.881→0.891 (real lift!), but timing offset it |
| ch0 = sharpened STFT contrast | -0.036 | Sharpening destroys STFT's ranking info (creates ties at 0/1) |
| Add ch3 = STFT contrast (raw) | 0 | Probe weight -0.10 — physics too redundant with ch1/ch2 |

### Diagnostic findings worth remembering

- **Raw unsharpened STFT contrast**: ch0 AUC = **0.890** (vs Hilbert ch0 = 0.881).
  STFT is genuinely a stronger discriminator, but its 25 ms rise time tanks
  envelope_score. There is a real ~0.01 AUC gain locked behind the ch0
  sharpening pipeline.
- **`_normalize` hi_pct 92** lifts ch0 AUC by +0.010 but pays back through
  worse timing — single-axis search can't unlock it; would need joint sweep
  with sharpen γ and soft-threshold band.
- **All "spectral concentration" aux channels are mutually redundant** under
  AWGN at -16 dB (TKEO, MF, STFT, phase coherence all measure variants of
  "energy is concentrated at tone_freq"). Adding more of them is wasted
  channels. To raise `info_gain` further, the next aux channel must measure
  something genuinely different — e.g., a *temporal-structure* prior (gap
  pattern), not amplitude.

### Promising directions not yet tried

1. **Train the ML model on the new 4-channel DSP** and measure where the
   biggest gains land. If the -14 to -8 dB tier improves notably, channels
   are the right lever and we can add a second new aux. If not, model is
   capacity-bound and DSP work is wasted.
2. **Temporal-structure aux channel** — autocorrelation of the envelope at
   plausible CW dit-cadence lags. Held off on this pending #1's outcome —
   the BiGRU may already be capturing this for free.
3. **Joint multi-axis sweep** of `(hi_pct, soft_threshold_lower, sharpen_γ)`
   on ch0 to chase the 0.01 AUC headroom that single-axis tweaks can't reach.
4. **Rewriting `evaluate.py`** (requires explicit human approval per
   `CLAUDE.md`) — `rise_score` is saturated at the current rise_ms; that
   10% weight could be redirected to AUC or to `info_gain` to steer the
   loop toward unused leverage.
5. **Wavelet (Morlet at carrier)** — multi-scale, never tested.

### What is decisively NOT worth retrying

- More variations of phase coherence (already redundant)
- Narrower / wider BP without a counter-tweak (single-axis: net regression)
- Single-sharpen variants (lost F1/IoU)
- Replacing ch0 with anything that has a non-zero centered-window delay (MF,
  STFT) — sharpening can't recover threshold-crossing alignment when the
  underlying signal centroid ≠ tone-on edge.

---

## Source Layout

```
cw-dsp-research/
├── dsp.py                  # the DSP under test (autoresearch edits this)
├── evaluate.py             # scorer (immutable except by explicit approval)
├── constants.py            # immutable: SR, tier defs, weights
├── hmm_scorer.py           # legacy HMM scorer (not in current path)
├── generate_eval.py        # builds evaldata/ from morse-audio v1.3.1
├── detection_threshold.py  # SNR floor characterization
├── detection_threshold.csv # per-SNR threshold-decode accuracy
├── results.tsv             # autoresearch experiment log (gitignored)
├── CURRENT.md              # this file — pickup doc
├── CLAUDE.md               # autoresearch directive
└── NOTES.md                # free-form notes
```
