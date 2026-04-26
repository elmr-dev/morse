# Training Runs

Operational log of training runs. The DSP/scorer story lives in
`../cw-dsp-research/CURRENT.md`; this file is just about the model side
— what we trained, what eval said, what we learned.

All CER numbers are character error rate, lower-is-better, scored on the
1000-sample val set generated alongside training (same `snr_tiers` and
`buckets` as train, separate seed offset).

## Latest verdict

**Production DSP: 4-channel — Hilbert + TKEO + 48 ms MF + 200 ms long MF.**
Best CER 0.0909 on the v1.3.1 -16..+6 dB val set.

## Run log

| Date | Run dir | Architecture | Overall CER | Notes |
|---|---|---|---|---|
| 2026-04-16 | `20260416_171918` | 3-channel (no ch3) | 0.1115 (orig) / 0.0999 (v1.3.1 re-eval) | OLD morse-audio (~7 dB SNR-calibration error). Re-evaluated against v1.3.1 audio in `eval_v131.json`. |
| 2026-04-25 | `20260425_172212` | 4-channel + ch3 = 200 ms long MF | **0.0909** | Production. Wins decisively at very-low SNR. |
| 2026-04-25 | `20260425_190314` | 4-channel + ch3 = STFT contrast | 0.1002 | Reverted. See "STFT experiment" below. |
| 2026-04-26 | `20260426_025710` | 5-channel + ch4 = temporal cadence | 0.0927 | Reverted. See "Cadence experiment" below. |

## Multi-stream evaluation (2026-04-25)

Question: how does the production long-MF model handle 2-3 simultaneous CW
signals at different tone frequencies (a "pileup" / typical real-radio
condition)?

Built a labeled multi-stream eval set (200 samples, 440 per-stream
decodes) — see `eval/multistream_gen.py`, `eval/multistream_eval.py`,
and the full results at `eval/results/multistream_20260425_185312.json`.

### Test set design

200 samples, stratified across:
- `n_streams ∈ {1, 2, 3}` — 40 / 80 / 80 samples
- `separation_hz ∈ {100, 200}` — multi-stream cases only
- `snr_target_db ∈ {-10, -6, -3, 0, +3}` — SNR of the primary stream
- `strength_pattern ∈ {equal, weak_target}` — equal-strength vs primary 6 dB weaker than interferers
- WPM uniform ~22-30, texts from contest-style exchanges

Each sample has N labeled streams. Eval loops over each stream as the
"target", running DSP at that stream's `tone_freq` and scoring CER vs
ground-truth text. Streams are mixed in Python at controlled relative
amplitudes; AWGN added at a level that makes the primary stream's SNR hit
`snr_target_db`. (morse-audio v1.3.1's QRM generator only labels one
signal — we mix per-signal-clean WAVs ourselves to get full per-stream
labels.)

### Headline result: **multi-stream does not hurt decode quality**

| n_streams | Mean CER | Median | p90 | n decodes |
|---|---|---|---|---|
| 1 | 0.0869 | 0.0833 | 0.1875 | 40 |
| 2 | 0.0804 | 0.0769 | 0.1875 | 160 |
| 3 | 0.0769 | 0.0625 | 0.2500 | 240 |

CER is **roughly flat** across n_streams — actually slightly *better* for
n=2/3 than n=1 in aggregate. (The aggregate effect is partially explained
by the per-stream SNR distribution: weak-target samples push half the
"interferer" decodes to higher SNR.)

**Matched-SNR comparison (stream SNR ≤ -8 dB only):**
- n=1: 0.084
- n=2: 0.064
- n=3: 0.078

Even at the lowest-SNR tier, multi-stream is no worse than single-stream.

### Why this works

The current 4-channel DSP is parametric on `tone_freq` and applies a
**±25 Hz bandpass** before all four channels. A signal at `tone_freq + 100 Hz`
is ~30 dB attenuated at the bandpass output (1st-order filter, 1.3 octaves
above passband upper edge). For signals spaced ≥100 Hz apart with similar
strengths, the bandpass alone provides enough discrimination — the
time-domain channels (Hilbert, TKEO, MF, long MF) all see only the target
signal's energy, so the model's training distribution (single-signal
audio) matches the per-stream sub-problem closely.

### Performance profile (Apple M-series MPS)

| | mean | median | p90 |
|---|---|---|---|
| DSP per call | **5.3 ms** | 5.3 | 5.8 |
| Model per call | **882 ms** | 868 | 915 |
| Per-sample sequential (sum over streams) | 1952 ms | — | 2641 ms |

- Real-time factor (sequential, 8-sec audio): **0.244** — decoding 3
  streams sequentially takes ~25% of the audio's wall-clock duration.
  Plenty of headroom for live multi-stream UX without parallelization.
- Peak RSS: **391 MB**
- Model dominates compute (~99% of decode time); DSP is negligible.

### Caveats

- All test signals are **machine-perfect timing** (no fist jitter), no
  ionospheric fading, AWGN-only noise. Real contest audio has more
  variation.
- Tested **only ≥100 Hz separation** (out-of-scope: closer-spaced signals,
  per the user's call).
- Per-stream decodes are full-sequence inference on the entire 8-sec
  audio. A streaming/chunked variant (`forward_chunk()` exists in Python,
  not exported to ONNX) would have lower per-chunk latency at the cost of
  more total compute.

### Decision

**Existing model is sufficient for multi-stream decode** under the tested
conditions. No retraining needed. The earlier outcome-1 case from the
plan is the right read.

This **strengthens** the earlier reservation about adding STFT for
pileup-readiness — at the spacing humans care about (≥100 Hz), the
bandpass already does the work. STFT becomes load-bearing only for
sub-100 Hz separation, which is out of scope.

## Cadence experiment (2026-04-26, reverted)

Goal: add a 5th DSP channel that measures CW's regular dit-rate fingerprint
in the envelope spectrum (sliding 512 ms FFT on the Hilbert envelope, ratio
of CW dit-rate band power ~6-21 Hz to off-cadence reference band ~25-50 Hz).
The bet: cadence is the only **temporal-structure** feature category we
hadn't given the model — autocorrelation is a quadratic operation the
CNN+TCN can't learn cheaply, especially at -16 dB SNR with weak gradients,
so pre-computing it might unlock signal the BiGRU couldn't extract.

Trained on RunPod with the 5-channel DSP, identical config and data
(4090.yaml, 50k train samples, -16 dB SNR floor, 68 epochs). Same
training time (~183 min). No OOM (memory bump was negligible as
predicted — first conv is the only thing that scales with `in_channels`).

### Result

**Single-stream val (1000 samples):**

| Tier | Long-MF (4ch) | Cadence (5ch) | Δ |
|---|---|---|---|
| **Overall CER** | **0.0909** | 0.0927 | +0.0019 |
| ≤-10 dB | **0.382** | 0.393 | **+0.010** |
| -10 to -4 | 0.036 | 0.032 | -0.004 |
| -4 to 2 | 0.005 | 0.005 | ±0 |
| > 2 | 0.003 | 0.004 | +0.001 |
| 12-25 WPM | 0.053 | 0.057 | +0.004 |
| 25-40 WPM | 0.089 | 0.085 | -0.004 |
| 40-60 WPM | 0.147 | 0.155 | +0.008 |

**Multi-stream val (200 samples, 440 per-stream decodes):**

| n_streams | Long-MF | Cadence | Δ |
|---|---|---|---|
| 1 | 0.0869 | 0.0892 | +0.002 |
| 2 | 0.0804 | 0.0785 | -0.002 |
| 3 | 0.0769 | 0.0767 | ±0 |

All multi-stream deltas are within noise. The headline single-stream
regression is +0.0019 absolute, driven by a slight degradation in the
dominant ≤-10 dB tier (+0.010) — the most important tier, since that's
the gray area the model exists to cover.

### Reading

The "BiGRU might already be learning cadence implicitly through the
existing 4 amplitude channels" hypothesis (raised in the
multi-stream-design discussion) is empirically confirmed:

- The cadence channel itself works as designed — pearson_r vs GT binary
  is consistently 0.26-0.45 across SNRs; not nothing.
- But the model's TCN (~120 ms RF) + BiGRU (200 ms backward lookahead)
  has enough temporal context to discover this signal from the
  amplitude channels on its own.
- Pre-computing it provides no new information AND slightly dilutes the
  input distribution, costing ~0.01 CER in the dominant tier.

### Lessons applicable to future channel proposals

1. **Channels that the model can already infer from existing channels +
   temporal context don't help.** This includes most "structural"
   features that follow deterministically from amplitude over a
   ~200 ms window.
2. **Truly orthogonal physics matters more than nominal
   non-redundancy.** Long-MF (which IS another amplitude detector but
   at a different time scale) helped because it provides a signal at a
   time scale beyond the receptive field. Cadence didn't help because
   the receptive field already covers it.
3. **The remaining unexplored axes** that might still help: anything
   genuinely outside the model's RF (e.g., 1-second aggregate stats),
   or anything that captures non-amplitude information that the model
   really can't infer (e.g., tone-frequency drift, key-click-broadband
   energy at tone_freq harmonics).

### Why we still reverted

Pure CER-minimization picks the simpler (4-channel) model when the
addition is at-best-tied and slightly negative on the most-important
tier. The cadence channel is documented here for completeness; the
production DSP returns to 4 channels.

## STFT experiment (2026-04-25, reverted)

Goal: replace ch3 (200 ms long matched filter) with an **STFT spectral-contrast**
channel — same channel slot, different physics. STFT operates in the
frequency domain (3-bin tone power vs 24-bin local-bin background median),
giving the model freq-discrimination evidence the time-domain channels can't
supply. Was selected partly with future CW-pileup work in mind.

Trained the parallel run on RunPod with identical config (4090.yaml, 50k
train samples, -16 dB SNR floor, 68 epochs).

### Result

| Tier | Long-MF | STFT | Δ (STFT − long-MF) |
|---|---|---|---|
| **Overall CER** | **0.0909** | 0.1002 | **+0.0093** (worse) |
| ≤ -10 dB | 0.382 | 0.428 | +0.046 (much worse) |
| -10 to -4 | 0.036 | **0.034** | -0.002 (slightly better) |
| -4 to 2 | 0.005 | 0.005 | ±0 |
| > 2 dB | 0.003 | 0.003 | ±0 |
| 12-25 WPM | 0.053 | 0.066 | +0.013 |
| 25-40 WPM | 0.089 | 0.093 | +0.004 |
| 40-60 WPM | 0.147 | 0.162 | +0.015 |
| clean | 0.095 | 0.105 | +0.010 |
| qsb | 0.084 | 0.091 | +0.007 |

### Reading

Two complementary observations:

1. **Long-MF wins at very-low SNR (≤ -10 dB) by a wide margin (-0.046 absolute).**
   Coherent 200 ms integration buys ~6 dB of post-detection SNR that STFT's
   40 ms window can't match. Since ≤ -10 dB is the largest tier in the val
   distribution, this dominates the overall result.
2. **STFT is fractionally better at moderate SNR (-10 to -4 dB).** Tiny but
   consistent with the cw-dsp-research observation that raw STFT contrast
   AUC (0.890) exceeds Hilbert ch0 AUC (0.881). When SNR is adequate, the
   model picks up freq-domain contrast info; when it isn't, freq
   discrimination doesn't help if the signal isn't above noise to begin with.

The two channels are **complementary, not competing** — the head-to-head
experiment forced a false choice.

### Why we still reverted

Long-MF wins overall by 0.0093 absolute (~9% relative) and dominates where
performance matters most (low SNR is the gray-area zone the model exists to
cover). Pure CER-minimization → keep long-MF.

### Why STFT will probably come back

When we add **CW pileup** training data, freq-discrimination becomes
load-bearing. The current 4-channel architecture has zero ability to natively
distinguish "the signal at tone_freq" from "an interferer at tone_freq + 200 Hz"
— all four channels see total energy in the bandpass region. STFT's
local-bin-background-median *is* that distinguishing machinery.

The natural next step then is **5 channels**: keep long-MF for low-SNR coherent
integration, add STFT for freq-domain pileup discrimination. The
`MAX_CHANNELS=4` constraint in `cw-dsp-research/constants.py` is a research-loop
guard, not a model architecture limit — easy to bump.

## How to verify the production model

```bash
cd cw-ml/model
# expects /tmp/cw-runs/long-mf/4090_best.pt — pull from S3 if absent:
#   aws --endpoint-url=$S3_ENDPOINT_URL s3 sync \
#     s3://$S3_BUCKET/cw-model/runs/20260425_172212/ /tmp/cw-runs/long-mf/
uv run python main.py evaluate --config configs/4090.yaml \
    --checkpoint /tmp/cw-runs/long-mf/4090_best.pt
# Expect: Overall CER 0.0909
```
