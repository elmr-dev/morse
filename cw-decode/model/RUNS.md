# Training Runs

Operational log of training runs. The DSP/scorer story lives in
`../cw-dsp-research/CURRENT.md`; this file is just about the model side
— what we trained, what eval said, what we learned.

All CER numbers are character error rate, lower-is-better, scored on the
1000-sample val set generated alongside training (same `snr_tiers` and
`buckets` as train, separate seed offset).

## Latest verdict

**Phase 4a — 4-channel + tone head + overweighted very-low-SNR training.**
Wins ≤-10 dB tier 0.3404 vs Phase 3 0.3741. Tier-weighted overall CER drops
~6% relative when normalized to common SNR weights. `checkpoints/best.pt`
now points at Phase 4a (run `20260427_002413`).

**However**: when re-evaluated against a val set with SNR floor moved from
-16 to -14 dB, Phase 3 and Phase 4a are essentially tied (0.0858 vs 0.0856
overall). Most of Phase 4a's measured advantage came from samples in the
-16..-14 dB regime where Phase 3 was at the information limit. In the
"usable signal" regime (≥ -14 dB), the multi-head + reweighting Phase 4
direction has been a wash. See "-14 dB floor re-eval" below.

Phase 4b (paired clean/noisy KL distillation, warm-started from Phase 3)
landed slightly worse than Phase 4a — distillation gave gains at moderate
SNR (-8..-3 dB) but lost at the deep noise floor. Not promoted.

Phase 3's HSMM milestone (the original GPT5.5-doc Phase 1 goal) **did NOT
pass** — the parked `eval/hsmm.py` decoder has a real bug: it mis-classifies
element types even on textbook-clean tone emissions (verified: at WPM 15.4,
ON-run lengths 61/21/20/57 frames cleanly map to dah/dit/dit/dah = X, but
HSMM produces garbled output). Wiring (`emissions_from_tone_head` +
`--emission tone_head` flag) is in place; the decoder needs root-cause work.

## Run log

| Date | Run dir | Architecture | Overall CER | Notes |
|---|---|---|---|---|
| 2026-04-16 | `20260416_171918` | 3-channel (no ch3) | 0.1115 (orig) / 0.0999 (v1.3.1 re-eval) | OLD morse-audio (~7 dB SNR-calibration error). Re-evaluated against v1.3.1 audio in `eval_v131.json`. |
| 2026-04-25 | `20260425_172212` | 4-channel + ch3 = 200 ms long MF | 0.0909 | Previous prod baseline (long-MF). |
| 2026-04-25 | `20260425_190314` | 4-channel + ch3 = STFT contrast | 0.1002 | Reverted. See "STFT experiment" below. |
| 2026-04-26 | `20260426_025710` | 5-channel + ch4 = temporal cadence | 0.0927 | Reverted. See "Cadence experiment" below. |
| 2026-04-26 | (no new training) | offline Morse HSMM/Viterbi over `runs/20260425_172212/4090_best.pt` | n/a | Decoder-only experiment, parked. See "HSMM offline-decoder experiment" below. |
| 2026-04-26 | `20260426_185002` | 4-channel + Phase 3 auxiliary tone head, warm-started from prod | 0.0880 | First Phase 4 baseline. CTC didn't drift; tone head converged cleanly. See "Phase 3 multi-head" below. |
| 2026-04-27 | `20260427_002413` | Phase 4a — gate relax + very_low: 0.20→0.30 weight | 0.1182 (P4 weights) | Tier-weighted apples-to-apples wins by ~6%. **Current best.pt.** See "Phase 4a quick-win" below. |
| 2026-04-27 | `20260427_011354` | Phase 4b — paired clean/noisy KL distillation from P3 | 0.0866 (P3 weights) | Slightly worse than P4a. Distillation worked mechanically (loss 0.13→0.08) but didn't compound. See "Phase 4b distillation" below. |

## Phase 3 multi-head (2026-04-26, run `20260426_185002`)

Goal: train an auxiliary tone-on/off head on the same backbone as the
existing CTC head, supervised against per-frame Morse element timings.
Two motivations: (a) check whether tone supervision drags or improves
CTC, (b) produce sustained on/off envelopes the parked HSMM was waiting
on.

Setup: warm-start from prod `20260425_172212/4090_best.pt`. Skipped CE
pretrain + CE→CTC blend (CTC was already converged; rerunning those phases
would re-anchor it). Pure CTC + entropy + tone BCE for 20 epochs at
lr=1.5e-4 (0.5× prod). `tone_weight=0.3`, `tone_pos_weight=2.5`.

Results (full `final_eval.json`):

| Metric | Phase 3 | Prod (`20260425_172212`) | Δ |
|---|---:|---:|---:|
| Overall CER (n=1000) | **0.0880** | 0.0909 | -0.0029 |
| `≤-10 dB` tier | **0.3741** | 0.3822 | -0.008 |
| `-10..-4 dB` tier | 0.0319 | 0.0357 | -0.004 |
| `-4..2 dB` tier | 0.0039 | 0.0046 | -0.001 |
| `>2 dB` tier | 0.0030 | 0.0034 | -0.000 |
| blank_ratio | 0.996 | 0.996 | 0 |
| val_tone_loss (final) | 0.147 | n/a | — |

Per-1dB-bin edit ops (showing the deletion-dominated failure mode is
still present, just slightly mitigated across the board — see
`memory/project_failure_mode.md` for the prod baseline):

| SNR bin | n | CER | ins/c | del/c | sub/c | len_ratio |
|---|---:|---:|---:|---:|---:|---:|
| -16..-15 | 33 | 0.621 | 0.016 | 0.351 | 0.311 | 0.664 |
| -14..-13 | 43 | 0.403 | 0.006 | 0.170 | 0.271 | 0.836 |
| -12..-11 | 22 | 0.176 | 0.007 | 0.044 | 0.147 | 0.963 |
| -10..-9  | 39 | 0.098 | 0.009 | 0.024 | 0.078 | 0.985 |
| -8..-7   | 32 | 0.030 | 0.002 | 0.009 | 0.024 | 0.994 |
| -4..-3   | 53 | 0.006 | 0.000 | 0.004 | 0.003 | 0.996 |
| +0..+1   | 74 | 0.002 | 0.000 | 0.000 | 0.002 | 1.000 |

**Reading:** Tone supervision was complementary — backbone features
serve both CTC and tone heads from a single BiGRU pass. Insertions
remain near zero everywhere. Deletions still dominate at ≤-14 dB
(model emits only 66% of target length at -16 dB) — the
anti-hallucination gates are still too conservative for the regime
where we want gains.

The HSMM follow-up (run on this checkpoint) failed structurally:
even given clean sustained on/off emissions from the tone head, the
parked `eval/hsmm.py` decoder mis-classifies element identities.
See "HSMM/tone_head experiment" below.

## HSMM/tone_head experiment (2026-04-26)

Wired `emissions_from_tone_head` into `decode_batch` and ran HSMM
oracle-WPM on a 100-sample stratified subset of val:

| tier | n | greedy CER | HSMM CER | delta |
|---|---:|---:|---:|---:|
| ≤-10dB  | 25 | 0.419 | 0.808 | +0.390 |
| -10..-4 | 25 | 0.029 | 0.773 | +0.744 |
| -4..2   | 25 | 0.003 | 0.780 | +0.778 |
| >2      | 25 | 0.005 | 0.786 | +0.781 |
| overall | 100 | 0.114 | 0.787 | +0.673 |

HSMM is broken across **all** tiers, not just low-SNR. Diagnostic:
visualized raw ON/off run lengths from tone_head emissions on a
known sample (text=`X888/K2/`, WPM 15.4, SNR +4.3) — runs are
textbook clean (61f/21f/20f/57f → dah/dit/dit/dah = X). Yet HSMM
produces `'TITTOEMTEEENASOEEETATFA/'` at the default char prior;
even with 16× stronger char prior it gets length ~right but mis-
identifies elements (`'Y98OD9O1/'`).

**Reading:** the parked decoder has a real bug in
duration-prior + segment-score combination, NOT an emissions
problem (emissions are great). Fix is non-trivial and parked.
The wiring is correct so the next session can pick up directly.

## Phase 4a quick-win (2026-04-27, run `20260427_002413`)

Setup: warm-start from Phase 3 best.pt. Relax anti-hallucination knobs
and overweight low-SNR training:
- `entropy_weight: 0.03 → 0.01`
- `ce_blank_weight: 0.2 → 0.4` (note: turned out to be a no-op since
  this knob only affects CE loss, and `ce_pretrain_epochs/ce_blend_epochs=0`
  meant CE loss was never used in fine-tune)
- `snr_tiers.very_low: 0.20 → 0.30` (from `mid: 0.40 → 0.30`)
- 15 epochs at lr=1.5e-4

Results (final_eval.json scored at the new very_low=0.30 weights, so
overall is NOT directly comparable to Phase 3's 0.0880 without
renormalization):

| metric | Phase 3 | Phase 4a | Δ |
|---|---:|---:|---:|
| Overall (P4 weights) | 0.1204 (computed) | **0.1182** | -0.0022 |
| Overall (P3 weights) | 0.0834 (= P3 native) | **0.0782** | -0.0052 |
| ≤-10 dB tier | 0.3741 | **0.3404** | -0.034 |
| -10..-4 dB | 0.0319 | 0.0361 | +0.004 |
| -4..2 dB | 0.0039 | 0.0052 | +0.001 |
| >2 dB | 0.0030 | 0.0041 | +0.001 |

Tier-weighted apples-to-apples Phase 4a wins ~6% relative.

**Mechanism wasn't the gate-relaxation hypothesis.** `del/c` at
-16..-15 actually went UP slightly (+6.7%) and `len_ratio` got worse
(0.664 → 0.629) — the opposite of "more willing to emit". The win came
from substitution drops in the -15..-12 bins (~10-15% relative each)
because the SNR-tier reweight gave the model better feature extraction
at low SNR. Same blank_ratio (0.996), same anti-hallucination behavior
in greedy decode — just better encoder features.

Promoted to `checkpoints/best.pt`.

## Phase 4b distillation (2026-04-27, run `20260427_011354`)

Setup: warm-start from Phase 3 (NOT Phase 4a — launched before 4a
finished). Paired clean/noisy data generation: each train sample is
emitted twice with same seed/text/wpm/fist/freq, snr=sampled vs
snr=+30dB (clean teacher input). morse-audio's prng is deterministic
per seed so the underlying signal is bit-identical between members;
only noise scale differs. Silence augmentation runs against a
sample-index-derived rng seed so both members get frame-aligned
augmentation.

Loss: existing CTC + entropy + tone BCE plus
`distill_weight * T² * KL(student_logits_noisy || teacher_logits_clean)`
at temperature 2.0, weight 0.5. Teacher forward is `model(inputs_clean)`
under no_grad — self-distillation, no separate teacher checkpoint.

Cost: 2x WAV gen, 1.5x training wallclock. batch_size 48→40 for the
extra teacher forward.

Results (raw, val regenerated with Phase 3-era SNR weights):

| metric | Phase 3 (warm-start) | Phase 4b | Δ |
|---|---:|---:|---:|
| Overall | 0.0880 | 0.0866 | -0.001 |
| ≤-10 dB tier | 0.3741 | 0.3668 | -0.007 |
| -10..-4 dB | 0.0319 | **0.0287** | -0.003 |
| -4..2 dB | 0.0039 | 0.0056 | +0.002 |
| >2 dB | 0.0030 | 0.0046 | +0.002 |

Distillation worked mechanically — `train_distill_loss` 0.128 → 0.078
over 20 epochs, val_tone_loss 0.143 (vs Phase 3's 0.147). The student
tracked the teacher.

**But Phase 4b loses to Phase 4a** under common-weighted comparison:
`P3 weights: P4a 0.0782 < P4b 0.0822`,
`P4 weights: P4a 0.1117 < P4b 0.1184`.
Distillation gave gains in the moderate-SNR -10..-4 dB tier (where the
clean teacher's posterior was useful) but lost at the deep noise floor
where the noisy student has no evidence to fire on, regardless of what
the teacher says. **Not promoted.**

## -14 dB floor re-eval (2026-04-27)

Re-evaluated Phase 3, Phase 4a, and Phase 4b on a single fresh val set
generated with `very_low: [-14, -10]` (was `[-16, -10]`) to focus on
the regime where decoder choices still matter (below -14 the model is
near an information limit). Config: `configs/eval-snr14.yaml`.

| metric | Phase 3 | Phase 4a | Phase 4b |
|---|---:|---:|---:|
| Overall CER | 0.0858 | **0.0856** | 0.0874 |
| ≤-10 dB tier | 0.2429 | **0.2404** | 0.2463 |
| -10..-4 | **0.0306** | 0.0328 | 0.0307 |
| -4..2 | **0.0044** | 0.0055 | 0.0052 |
| >2 | 0.0042 | **0.0031** | 0.0052 |

**Headline finding:** Phase 3 and Phase 4a are essentially tied on the
"usable signal" floor. Most of Phase 4a's apparent advantage at the
-16-dB floor came from samples in -16..-14 dB where Phase 3 was at
the information limit. In the regime where humans can copy CW, the
multi-head + reweighting Phase 4 direction has been a wash.

Phase 4b is dominated under both floors.

Per-1dB-bin (where each model wins):
- -14..-13: P4a wins (0.383 vs P3 0.396, P4b 0.406)
- -13..-12: P3 wins (0.275 vs P4a 0.288, P4b 0.285)
- -12..-11: P4a wins (0.173 vs P3 0.191, P4b 0.184)
- -11..-10: P3 wins (0.115 vs P4a 0.126, P4b 0.116)
- -10..-9: P3 wins (0.077 vs P4a 0.086, P4b 0.080)
- -8..-3: P4b wins (distillation surfaced moderate-SNR gains)
- ≥0 dB: ties / P4b slightly ahead

Reading: P4a's wins concentrate at the very-low SNR (-14..-12) where
its training distribution overweighted. P3 wins everywhere else in
the noise regime. P4b's distillation produced a "cleaner-decisions"
model that helps at moderate SNR but hurts where signal evidence is
weak.

## Where Phase 4 leaves us

- `checkpoints/best.pt` is Phase 4a. Strict improvement over Phase 3 at
  -16..-14 dB; tie/slight edge at -14..-10 dB; slight regression at
  higher SNR.
- The actual ≤-10 dB tier did move (0.3741 → 0.3404 = ~9% relative).
  But that gain mostly comes from samples below -14 dB where it's
  essentially noise-floor performance.
- Distillation (4b) is not the path forward in this configuration —
  it's a moderate-SNR specialist when you want a low-SNR specialist.
- Possible Phase 4c: combine the wins (warm-start from P4a + paired
  distillation + keep very_low=0.30 weight). Not run yet.
- The HSMM milestone remains unmet. Decoder bug in `eval/hsmm.py` is
  the blocker, not the supervision target. Could be a productive
  future session.

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

## HSMM offline-decoder experiment (2026-04-26, pivoted)

Goal: validate the GPT5.5-ideas-2026-04-26.md "Recommended First Concrete
Milestone" — an offline Morse HSMM/Viterbi decoder beating greedy CTC at
≤-10 dB CER on the production 4-channel val set, no retraining.

Pivoted before completing the full eval based on hand-tested samples and a
structural finding about model emissions. The diagnostic infrastructure
landed and is permanent; the HSMM decoder code is parked.

### Diagnostic (kept): per-1dB-bin edit-op breakdown

Extended `training/metrics.py:compute_edit_breakdown` and
`eval/evaluate.py:fine_grained_breakdown` to report per-SNR-bin
insertions/deletions/substitutions and predicted-length-vs-target plus a
confidence calibration table. Output now lands in every `final_eval.json`
under `fine_breakdown.snr_1db_edit_ops` and `fine_breakdown.confidence_calibration`.

The doc had assumed the low-SNR failure was "false-insertion explosion"
(citing the DSP-only `cw-dsp-research/detection_threshold.csv`). The
trained-CTC + anti-hallucination gates actually fail differently:

| SNR bin | ins/char | del/char | sub/char | pred_len/tgt_len |
|---|---:|---:|---:|---:|
| -10..-9  | 0.012 | 0.022 | **0.083** | 0.99 |
| -12..-11 | 0.020 | 0.050 | **0.150** | 0.97 |
| -14..-13 | 0.018 | **0.174** | **0.274** | 0.84 |
| -16..-15 | 0.004 | **0.410** | 0.295 | **0.59** |

Insertions are tiny everywhere (<0.02/char). Substitutions dominate
-10..-13 dB. Deletions take over below -14 dB — at -16 dB the model emits
only 60% of target length. The entropy/blank-ratio/run-length gates kill
the insertion explosion DSP-alone shows; they're conservative to the point
of dropping characters. Confidence calibration is excellent (q01:
mean_conf=0.564 → mean_cer=0.603; q05: mean_conf=0.993 → mean_cer=0.005).

**Implication**: any future "reduce hallucination" work that targets
insertions is solving a non-problem on this codebase. The right
interventions for the dominant failure modes:
- substitutions → element-legality grammar and possibly a character LM
- deletions → un-gated emissions + structured decoding that searches for
  character evidence the entropy gate suppressed; or relax the gates

### Implementation (parked, not deleted)

- `model/eval/hsmm.py` — explicit-duration HSMM/Viterbi over Morse
  grammar (dit/dah, intra/inter-character gaps), Gaussian duration priors
  with σ=0.30 of nominal (drift tolerance), per-char log prior = -log(41),
  idle state with off-segment silence absorption.
- `model/eval/emissions.py` — frame-LLR sources: (a) `1 - p(blank)` from
  CTC logits, (b) DSP ch0 envelope with logistic calibration on val
  `frame_labels != BLANK`.
- `model/eval/compare_decoders.py` and `model/eval/milestone_summary.py` —
  comparison tooling.
- Plumbing: `--decoder hsmm`, `--emission {model_blank,dsp_ch0}`,
  `--wpm-mode {oracle,grid}`, `--dsp-calib` flags wired through
  `main.py:cmd_evaluate` → `eval.evaluate` → `eval.decode.decode_batch`.

Synthetic smoke: at oracle WPM with clean ±8 LLR over sustained on/off
segments, all five test texts (PARIS, HELLO, CQ, KK4ABC, TEST) decode
correctly across 12-60 WPM. The decoder works as designed — it's the
emissions on real data that don't cooperate.

### Why we pivoted: model emissions are the wrong shape for the segment HSMM

Inspected sample[0] (text='0FJ/W?CS482/', wpm=21.2, snr=-10): the model
emits each character on **exactly 1 frame** at the peak of its on-segment
(12 isolated 1-frame `p_nonblank > 0.1` runs for 12 ground-truth
characters in a 3398-frame clip). Expected dit width at 21 WPM is 14
frames. Production blank ratio is 0.996.

A segment-scoring HSMM expects sustained on-segments — the segment score
is `sum(LLR over [a,b])`. Feeding spiky character-commit posteriors gave
**CER 2.95** (output collapsed to long runs of "EEEE…", the all-dits
character).

DSP ch0 has the right structural property (it's the real Hilbert
amplitude envelope, sustained on/off) but mediocre AUC vs `frame_labels != 0`
labels:

| SNR bin | DSP ch0 LLR AUC |
|---|---:|
| -16..-15 | 0.57 |
| -12..-11 | 0.68 |
| ≥ -4     | 0.69 |

Hand-tested oracle/dsp_ch0 with leading/trailing silence absorption on
the first 5 val samples: greedy CTC gets all 5 perfect (CER=0.000 each,
including the -10 dB sample); HSMM gets 4 of 5 wrong by 4-15 character
edits. At low-mid SNR where greedy already wins, DSP ch0 noise floor
introduces character substitutions HSMM can't filter out with timing
grammar alone.

**Reading**: it's a category error to feed character-commit posteriors to
a per-frame segment HSMM. They encode "where to commit a character" not
"is tone on now." DSP ch0 has the right shape but its AUC at low SNR
(0.57-0.62) doesn't have the discrimination needed to find characters
greedy missed without adding wrong characters of its own.

### Next bets

1. **Phase 3 multi-head retraining** (highest conviction). Train an
   auxiliary tone-on/off head alongside CTC on the same backbone. The
   auxiliary head produces sustained per-frame tone posteriors — the right
   shape for segment HSMM. CTC stays for live preview; HSMM consumes the
   auxiliary head for offline / final-pass decode. The TS generator
   already has character timings, so true tone-on/off labels at 250 Hz are
   derivable without changing morse-audio.

2. **CTC-aware grammar rescoring** (cheap alternative). A character-level
   beam search over the CTC posterior with Morse-element-legality
   transitions (rejecting impossible character sequences). Works WITH the
   model's character-peak structure rather than against it. Probably won't
   help deletions but might reduce substitutions in the -10..-13 dB
   range.

3. **Relax the entropy/blank-ratio gates** (single-knob test). The
   confidence calibration is already excellent — at q01 the mean_cer is
   0.60, so abstention via confidence works. Loosening the gate from
   `entropy_threshold=0.3` (current) to e.g. 0.15 might recover deletions
   at the very-low SNR tier without significantly hurting overall CER. No
   retraining needed; one-line change in `eval/decode.py`.

(2) and (3) are preludes that don't replace (1) — they're cheap experiments
that should run before committing to a retrain.

## How to verify the production model

```bash
cd cw-ml/model
# Production checkpoint at runs/20260425_172212/4090_best.pt (synced from
# /tmp/cw-runs/long-mf/, the local mirror of
# s3://$S3_BUCKET/cw-model/runs/20260425_172212/).
uv run python main.py evaluate --config configs/4090.yaml \
    --checkpoint runs/20260425_172212/4090_best.pt
# Expect: Overall CER 0.0909  (local val regen: 0.0913 — within 0.5% relative)
```
