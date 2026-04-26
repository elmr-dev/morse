# Training Runs

Operational log of training runs. The DSP/scorer story lives in
`../cw-dsp-research/CURRENT.md`; this file is just about the model side
— what we trained, what eval said, what we learned.

All CER numbers are character error rate, lower-is-better, scored on the
1000-sample val set generated alongside training (same `snr_tiers` and
`buckets` as train, separate seed offset).

## Latest verdict

**Phase 3 multi-head model — 4-channel DSP + auxiliary tone-on/off head.**
Best CER **0.0880** on the same -16..+6 dB val set (slightly beats prod 0.0909).
The tone head trained cleanly (val BCE 0.147, AUC 0.988 vs DSP ch0); CTC was not
dragged by the dual-task loss. `checkpoints/best.pt` now points at this run.

The HSMM milestone (Phase 3 plan's stated goal) **did NOT pass** — the parked
`eval/hsmm.py` decoder has a real bug that mis-classifies element types even on
textbook-clean tone emissions (verified: at WPM 15.4, raw ON-run lengths
61/21/20/57 frames cleanly map to dah/dit/dit/dah = X, but HSMM still produces
garbled output). The wiring (`emissions_from_tone_head` + `--emission tone_head`
flag) is in place; the decoder needs root-cause work in a future session.

## Run log

| Date | Run dir | Architecture | Overall CER | Notes |
|---|---|---|---|---|
| 2026-04-16 | `20260416_171918` | 3-channel (no ch3) | 0.1115 (orig) / 0.0999 (v1.3.1 re-eval) | OLD morse-audio (~7 dB SNR-calibration error). Re-evaluated against v1.3.1 audio in `eval_v131.json`. |
| 2026-04-25 | `20260425_172212` | 4-channel + ch3 = 200 ms long MF | 0.0909 | Previous prod baseline (long-MF). |
| 2026-04-25 | `20260425_190314` | 4-channel + ch3 = STFT contrast | 0.1002 | Reverted. See "STFT experiment" below. |
| 2026-04-26 | `20260426_025710` | 5-channel + ch4 = temporal cadence | 0.0927 | Reverted. See "Cadence experiment" below. |
| 2026-04-26 | (no new training) | offline Morse HSMM/Viterbi over `runs/20260425_172212/4090_best.pt` | n/a | Decoder-only experiment, parked. See "HSMM offline-decoder experiment" below. |
| 2026-04-26 | `20260426_185002` | 4-channel + Phase 3 auxiliary tone head, warm-started from prod | **0.0880** | Current best. CTC didn't drift; tone head converged cleanly. See "Phase 3 multi-head" below. |

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

## Phase 4 plan

Phase 3 model is **deletion-dominated** at low SNR. The doc decision
tree (`GPT5.5-ideas-2026-04-26.md`) for that failure mode prescribes
two directions; Phase 4 attempts both.

**Phase 4a — quick win** (`configs/4090-phase4a.yaml`): warm-start from
Phase 3 best.pt with relaxed anti-hallucination gates and reweighted
SNR distribution:
- `entropy_weight: 0.03 → 0.01`
- `ce_blank_weight: 0.2 → 0.4`
- `snr_tiers.very_low: 0.20 → 0.30` (from `mid: 0.40 → 0.30`)
- 15 epochs (vs 20 in Phase 3 — fine-tune)

Hypothesis: gates were tuned for the older insertion failure mode that
is no longer the bottleneck. Loosening them lets the model emit more
characters where evidence exists, directly attacking deletions in the
≤-10 dB tier.

Pass: `≤-10dB` CER drops below Phase 3's 0.374, AND overall CER stays
within 0.005 of 0.088. ~1 hour training run.

**Phase 4b — paired clean/noisy distillation** (after 4a). Generate each
training sample at its sampled SNR AND at a clean reference (+20 dB or
similar) with identical seed = identical Morse timing. Add KL loss
pulling noisy-forward logits toward clean-forward logits. Per the doc,
this is the highest-conviction move for deletion-dominated failure
because it gives dense supervision exactly where CTC is weakest. Bigger
lift: data-generator change, training-loop change, longer run. Plan
sketch in `Phase4-distillation-plan-2026-04-26.md`.

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
