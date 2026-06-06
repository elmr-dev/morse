# GPT-5.5 Ideas: Toward a World-Class Real-World Morse Decoder

Date: 2026-04-26

## Executive Read

This project is already at a strong local optimum on the current DSP-channel + CTC path. The production result documented in `model/RUNS.md` is strong: 4-channel DSP, overall CER `0.0909`, with the remaining pain concentrated in the `<= -10 dB` tier at about `0.382` CER.

The evidence says the next leap is unlikely to come from yet another hand-tuned amplitude channel. The current front end produces weak but useful evidence in parts of the `-14..-10 dB` range, but the current CTC decoder does not explicitly enforce Morse timing grammar, WPM continuity, character legality, or message priors.

The breakthrough architecture should look more like a structured radio receiver than a generic sequence model:

```text
raw audio
-> frequency tracker / complex demod
-> calibrated tone, edge, and element likelihoods
-> Morse HSMM/WFST decoder with WPM, fist, and drift latent state
-> optional domain LM reranker
-> calibrated text plus abstention
```

The highest-conviction path is to add a Morse-specific structured decoder and candidate-aligned coherent integration before spending more time on auxiliary DSP channels.

## Current Diagnosis

### What Is Working

The current production system has several hard-won strengths:

| Area | Current state |
|---|---|
| DSP | 4 channels: Hilbert amplitude, TKEO, 48 ms matched filter, 200 ms long matched filter |
| Model | Causal CNN + TCN + chunked BiGRU + CTC |
| Latency | Designed around about 275 ms streaming latency |
| Browser deployment | ONNX model already runs client-side |
| Multi-stream | Existing bandpass handles >=100 Hz separated streams well in tested conditions |
| Anti-hallucination | Entropy loss, blank-weight tuning, and conservative CTC decode are already in place |

### Where It Breaks

The low-SNR cliff is not smooth. Older local eval data shows the approximate pattern:

| SNR bin | Approx CER in older local eval |
|---|---:|
| `-11..-10 dB` | `0.181` |
| `-12..-11 dB` | `0.236` |
| `-13..-12 dB` | `0.318` |
| `-14..-13 dB` | `0.472` |
| `-15..-14 dB` | `0.534` |
| `-16..-15 dB` | `0.705` |

The DSP-only threshold characterization in `cw-dsp-research/detection_threshold.csv` shows the core failure mode:

| SNR | Element accuracy | Mean predicted elements | Mean ground truth elements |
|---:|---:|---:|---:|
| `-8 dB` | `0.8297` | `55.0` | `48.5` |
| `-9 dB` | `0.6683` | `61.8` | `48.5` |
| `-10 dB` | `0.4251` | `72.2` | `48.5` |
| `-12 dB` | `0.0539` | `101.9` | `48.5` |
| `-16 dB` | `0.0000` | `169.2` | `48.5` |

The dominant sub-10 dB failure is not merely missed tone energy. It is false insertion explosion: random noise fluctuations become plausible dits. A generic CTC decoder is not the ideal structure for suppressing those insertions because it does not explicitly know the Morse code timing machine.

### Likely Limit

For arbitrary random text, below about `-15/-16 dB`, the system may be near an information limit unless one of these is allowed:

| Lever | Why it helps |
|---|---|
| Longer context | More integration gain over characters, words, or repeated messages |
| Stronger priors | Callsigns, contest exchanges, Q-codes, and English-like text reduce ambiguity |
| Better frequency tracking | Coherent integration is fragile under frequency error |
| Abstention | Avoids hallucinated text when evidence is below copy threshold |
| Repeated-message combining | Beacons, CQ loops, and contest repeats can be integrated across repetitions |

Between `-14` and `-10 dB`, there is likely still meaningful headroom.

## Most Impactful Ideas

## 1. Neural Morse HSMM/WFST Decoder

Replace or augment generic CTC decoding with a Morse-specific structured decoder.

Current decoding in `model/eval/decode.py` is CTC greedy or prefix beam search. It knows nothing exact about Morse. It does not enforce legal dit/dah patterns, stable WPM, element spacing, inter-character gaps, or speed drift.

A Morse decoder should explicitly model:

| Latent variable | Why it matters below -10 dB |
|---|---|
| WPM / dit duration | Suppresses random noise bursts that do not fit a stable timing grid |
| Dah ratio | Allows human fist variation without accepting arbitrary durations |
| Intra-character gap | Prevents merging and splitting elements |
| Inter-character gap | Gives strong character boundary evidence |
| Inter-word gap | Allows word-level segmentation and priors |
| Speed drift | Real operators drift, but slowly |
| Tone on/off state | Enables segment likelihoods instead of frame-local decisions |
| Character grammar | Only valid Morse element sequences can emit characters |

The offline version can be a dynamic program over a weighted finite-state transducer:

| Component | Design |
|---|---|
| Acoustic input | Current 4 DSP channels, current model logits, or a new binary tone posterior |
| State graph | Exact Morse grammar: dit/dah, 1-unit gaps, 3-unit char gaps, 7-unit word gaps |
| Timing | WPM grid or continuous WPM tracked by beam state |
| Emission score | Sum frame-level log-likelihood over candidate on/off segments |
| Output | Best text plus posterior/confidence |
| Streaming | Beam search with fixed lookahead; final mode can use more lookahead |

This is the highest-conviction path because it directly attacks the false insertion failure shown in `detection_threshold.csv`.

## 2. Candidate-Aligned Coherent Integration

Move coherent integration inside the decoder, aligned to hypothesized Morse elements.

Current DSP uses fixed 48 ms and 200 ms matched filters. Those are useful but force a fixed tradeoff: short windows preserve edges, long windows improve SNR but smear timing.

A better receiver scores candidate segments directly:

| Candidate | Score |
|---|---|
| Dit from frame `a` to `b` | Coherent IQ sum over exactly `[a,b]` |
| Dah from frame `a` to `b` | Coherent IQ sum over exactly `[a,b]` |
| Gap from frame `a` to `b` | Noise/gap likelihood over `[a,b]` |
| Character `K` | Joint score of dah-gap-dit-gap-dah with plausible durations |

Implementation concept:

```text
audio -> complex demod at candidate tone frequency -> cumulative I/Q sums
segment_score(a, b) = likelihood_ratio(coherent_sum(a, b), duration=b-a, noise_estimate)
```

With cumulative sums, segment scores are O(1). The decoder can then evaluate many WPM and character hypotheses cheaply.

This preserves the SNR gain of matched filtering without committing to one fixed smoothing window.

## 3. Calibrated Likelihood Channels Instead Of Only Normalized Envelopes

Current DSP percentile-normalizes each channel to `[0,1]`. This is stable for training, but dangerous at very low SNR because noise-only clips are still stretched into a meaningful-looking dynamic range.

For sub-10 dB operation, the model and decoder should receive calibrated likelihood-ratio evidence:

```text
LLR(t) = log p(observation_t | tone present) - log p(observation_t | noise only)
```

Candidate observation models:

| Observation | Noise model | Tone model |
|---|---|---|
| Hilbert magnitude | Rayleigh | Rice / noncentral chi |
| Matched-filter magnitude | Rayleigh or Rice | Rice with estimated signal amplitude |
| Energy / TKEO | Gamma-like | shifted/scaled gamma-like |
| Coherent segment sum | complex Gaussian around zero | complex Gaussian with nonzero mean |

This gives the system a principled way to say “there is no reliable signal here” instead of hallucinating normalized peaks.

## 4. Paired Clean/Noisy Distillation

The synthetic generator can produce identical Morse timing at many SNRs. Use that.

Generate paired examples:

| Sample | Purpose |
|---|---|
| Clean or high-SNR version | Teacher produces sharp frame posteriors and alignments |
| Noisy `-16..-8 dB` version | Student must match teacher latent structure |
| Same text, same fist, same timing | Removes alignment ambiguity |

Losses:

| Loss | Effect |
|---|---|
| CTC on text | Preserve end-task decoding |
| KL noisy-student vs clean-teacher logits | Transfers alignment through noise |
| Binary tone mask loss | Stabilizes tone detection |
| Edge/onset loss | Preserves transitions |
| Element/gap auxiliary loss | Teaches Morse structure before character decoding |

This should be more useful than more CTC epochs because it gives dense supervision exactly where CTC is weakest.

## 5. Multi-Head Acoustic Model

The model should not only predict characters. It should factor the problem into interpretable Morse components:

| Head | Target |
|---|---|
| `tone_on` | keyed / unkeyed frame |
| `onset` / `offset` | transition frames |
| `element_type` | dit / dah / none |
| `gap_type` | intra-character / inter-character / inter-word / none |
| `wpm` | local speed estimate |
| `char_ctc` | current text target |

The structured decoder can consume tone, edge, element, and WPM likelihoods. This gives a better internal factorization than asking CTC to discover everything from text labels.

## 6. Hard Negatives And Abstention

Entropy regularization is useful but blunt. The model needs explicit “do not copy” training.

Hard negatives:

| Negative type | Why it matters |
|---|---|
| Pure band-limited noise | Prevent normalized noise from decoding as text |
| Wrong-frequency CW nearby | Handles mistuned decode and pileup |
| Carrier or drone with no keying | Tone presence is not Morse |
| QRM, chirps, RTTY, voice fragments | Real HF garbage |
| AGC pumping noise | Real receiver artifact |
| Empty channel with target frequency specified | Forces abstention |

Train a confidence head or sequence-level abstention criterion. A world-best decoder should sometimes say “not enough evidence” rather than hallucinating text.

## 7. Frequency As A Tracked Latent Variable

The current DSP assumes the correct `tone_freq`. Real radio has tuning error, oscillator drift, Doppler-like ionospheric effects, and nearby CW streams. Long coherent integration is fragile under frequency error.

Track:

| Latent | Method |
|---|---|
| Tone frequency | multi-hypothesis Goertzel, PLL, or Kalman tracker |
| Frequency drift | slow random walk |
| Competing tones | multiple frequency beams |
| Confidence per frequency | posterior over tracks |

Eventually decode over `(frequency, WPM, text)` jointly or with a coarse-to-fine beam.

## 8. Two-Pass Human-Like Decoding

Humans copy weak CW by forming a hypothesis, locking onto rhythm, then reinterpreting ambiguous sounds. The decoder can do the same.

| Pass | Role |
|---|---|
| Pass 1 | Conservative rough decode; estimate WPM, fist, frequency, and SNR |
| Pass 2 | Re-score audio with WPM-adaptive candidate-aligned coherent integration |
| Pass 3 | Optional domain-specific LM rerank with confidence constraints |

Streaming mode can stay low-latency. Final mode can refine text after a delay.

## 9. Optional Domain Priors

Keep raw-copy mode, but add explicit operating modes:

| Mode | Prior |
|---|---|
| Raw copy | Morse timing grammar only |
| Callsign | callsign WFST |
| Contest | exchange grammar |
| QSO | word/abbreviation LM from CW corpora |
| Beacon | repeated-message or fixed-format decoder |

At sub-10 dB, prior information can be the difference between impossible and copyable. It must be explicit, user-selectable, and confidence-aware to avoid hallucination.

## 10. Specialist Models And Ensembles

For “best in the world,” a single compact model may not be enough. Train specialists:

| Expert | Specialization |
|---|---|
| High SNR | fast, low-latency, minimal prior |
| `-10..-13 dB` | acoustic plus timing prior |
| `-13..-16 dB` | aggressive structure, high abstention |
| Fast WPM | edge preservation |
| Slow WPM | long integration |

A gating model can select or blend experts based on estimated SNR, WPM, and confidence. A distilled browser model can follow later.

## Implementation Plan

The plan below prioritizes experiments that can produce step-function improvements in the `-14..-10 dB` region while preserving the current production system as the baseline.

## Phase 0: Benchmark Lock And Diagnostics

Goal: make sure every experiment is measured against the right baseline and exposes the right failure mode.

### Step 0.1: Retrieve And Verify Production 4-Channel Checkpoint

Current repo note: `model/RUNS.md` references the production 4-channel run at `/tmp/cw-runs/long-mf/4090_best.pt`, but the committed `model/checkpoints/best.pt` metadata is 3-channel.

Actions:

1. Pull or locate the production 4-channel checkpoint referenced in `model/RUNS.md`.
2. Run `uv run python main.py evaluate --config configs/4090.yaml --checkpoint /tmp/cw-runs/long-mf/4090_best.pt`.
3. Confirm expected overall CER about `0.0909`.
4. Save the full result JSON as the immutable baseline.

Success criteria:

| Metric | Target |
|---|---|
| Overall CER | about `0.0909` |
| `<= -10 dB` CER | about `0.382` |
| Reproducibility | same checkpoint and eval data can be reused by every experiment |

Next step if pass: proceed to diagnostics.

Next step if fail: resolve checkpoint/data/config mismatch before any research.

### Step 0.2: Add Error Diagnostics

Actions:

1. Add evaluation reporting for insertions, deletions, and substitutions separately.
2. Add predicted length vs target length by SNR bin.
3. Add confidence vs CER calibration curves.
4. Add blank ratio and nonblank-frame ratio by SNR bin.
5. Add WPM x SNR cross-tabs for insertion/deletion mix.

Why this matters:

The DSP threshold data suggests false insertions dominate below `-10 dB`, but model-level diagnostics should confirm whether the production model fails by insertions, deletions, substitutions, or a changing mixture.

Success criteria:

| Output | Required |
|---|---|
| `eval_diagnostics.json` | per-sample edit operation counts |
| Summary table | CER split into insertion/deletion/substitution by SNR |
| Calibration plot/table | confidence buckets vs mean CER |

Next step if insertions dominate: prioritize HSMM/WFST and hard negatives.

Next step if deletions dominate: prioritize lower entropy gate, tone posterior calibration, and distillation.

Next step if substitutions dominate: prioritize character-level LM/beam reranking and element/gap heads.

Parallelizable: yes, this can run alongside Phase 1 decoder prototyping after baseline is fixed.

## Phase 1: Structured Decoder Without Retraining

Goal: prove that Morse timing grammar improves low-SNR decoding before changing the neural model.

This is the most important phase.

### Step 1.1: Build A Frame-Likelihood Source

Start simple. Convert existing model outputs or DSP envelopes into a binary tone likelihood.

Options:

| Option | Implementation | Pros | Cons |
|---|---|---|---|
| DSP ch0/ch1/ch2/ch3 logistic probe | Fit simple calibration on val/train envelopes to tone-on labels | Fast, interpretable | Needs labels and calibration split |
| Model nonblank probability | `1 - p(blank)` from CTC logits | No new training | Character logits are not pure tone likelihoods |
| Auxiliary quick model | small binary classifier over current envelopes | Better emissions | Requires training |

Recommended first path: use existing model `1 - p(blank)` and current DSP ch0 as two baselines.

Success criteria:

| Metric | Target |
|---|---|
| Can produce per-frame tone LLR | yes |
| Monotonic relation with ground truth tone labels | visible in AUC/calibration |
| Runs over eval set | yes |

Next step if `1 - p(blank)` is best: use model emissions for HSMM prototype.

Next step if DSP ch0/ch1 probe is best: use calibrated DSP emissions.

Parallelizable: yes, can test multiple likelihood sources independently.

### Step 1.2: Implement Offline Morse HSMM Viterbi Prototype

Build a decoder that searches legal Morse strings under timing constraints.

Initial simplifications:

| Simplification | Reason |
|---|---|
| Known WPM grid | Start with grid over 12-60 WPM rather than continuous tracking |
| No language model | Isolate Morse timing benefit |
| Max chars from current eval | Keep dynamic program bounded |
| Raw alphanumeric charset | Match current training/eval text |

State graph:

```text
character -> element sequence -> on/off durations -> next character
```

Duration model:

| Unit | Nominal duration |
|---|---|
| dit | `1 * unit` |
| dah | `3 * unit` |
| intra-character gap | `1 * unit` |
| inter-character gap | `3 * unit` |
| word gap | `7 * unit`, optional later |

Allow Gaussian or Laplace duration penalties around nominal values.

Success criteria:

| Metric | Target |
|---|---|
| Runs on one sample | yes |
| Runs on full eval set | yes |
| `<= -10 dB` CER | improves over greedy CTC baseline |
| Predicted length explosion | reduced in `-14..-10 dB` bins |

Next step if CER improves: tune duration priors and add beam pruning.

Next step if CER does not improve but length is fixed: emissions are too weak; proceed to candidate-aligned coherent scoring.

Next step if decoder is too slow: reduce WPM grid, cache character templates, add beam pruning.

Parallelizable: partially. One person can build decoder graph while another works on emissions.

### Step 1.3: Tune Timing Priors And WPM Tracking

Experiments:

| Experiment | Purpose |
|---|---|
| WPM known oracle | Upper bound timing decoder benefit |
| WPM grid search | Practical offline decoder |
| WPM beam with slow drift | Realistic human fist support |
| Wide vs narrow duration penalties | Insertion/deletion tradeoff |
| Dah ratio variation | Robustness to human timing |

Success criteria:

| Metric | Target |
|---|---|
| Oracle-WPM gain | meaningful gain in low SNR |
| Grid-WPM close to oracle | within a small CER gap |
| Fast WPM degradation | not worse than baseline |

Next step if oracle helps but grid does not: improve WPM estimation.

Next step if narrow priors help synthetic but hurt real clips: add fist variability and drift.

Parallelizable: yes, run sweeps over WPM priors independently after decoder exists.

## Phase 2: Candidate-Aligned Coherent Integration

Goal: improve acoustic evidence for the structured decoder using segment-level coherent sums.

### Step 2.1: Precompute Complex Demod Cumulative Sums

Actions:

1. Demod audio at `tone_freq` to complex baseband.
2. Optionally lowpass or bandpass before demod.
3. Compute cumulative sums of complex samples.
4. Score any segment `[a,b]` in O(1): `abs(cumsum[b] - cumsum[a])`.
5. Normalize by duration and estimated noise.

Segment score candidates:

```text
coherent_power = abs(sum_complex(a,b))^2 / duration
llr = coherent_power / noise_variance - duration_penalty
```

Success criteria:

| Metric | Target |
|---|---|
| Segment score separates true on vs gap segments | yes |
| Improves HSMM emissions over frame envelope sums | yes |
| Runtime acceptable for offline eval | yes |

Next step if better: integrate into HSMM as primary on-segment score.

Next step if worse: inspect frequency error and window leakage; try small frequency grid.

Parallelizable: yes, can develop independently of multi-head model.

### Step 2.2: Add Frequency Micro-Grid

Long coherent sums are frequency-sensitive. Score a small frequency grid around the nominal tone.

Experiments:

| Grid | Purpose |
|---|---|
| `tone_freq + {-5, 0, +5}` Hz | cheap mismatch robustness |
| `+-10 Hz` in `2 Hz` steps | stronger offline mode |
| drift model | real receiver support |

Success criteria:

| Metric | Target |
|---|---|
| Low-SNR CER | improves vs fixed frequency |
| Runtime | still acceptable for offline final decode |
| Real-audio robustness | fewer mistuned failures |

Next step if micro-grid helps: add frequency as latent in the decoder.

Next step if no gain on synthetic: keep for real-world eval only.

Parallelizable: yes, after segment scorer exists.

## Phase 3: Better Acoustic Supervision

Goal: train the neural model to emit the likelihoods the structured decoder needs.

### Step 3.1: Generate Paired Clean/Noisy Dataset

Modify data generation so each sample can produce:

| Version | Same fields |
|---|---|
| Clean/high-SNR | text, WPM, tone frequency, fist timing, character timings |
| Noisy low-SNR | exact same latent Morse sequence |

Actions:

1. Add config option for paired SNRs.
2. Ensure identical seed, text, WPM, frequency, fist, and timings.
3. Store clean envelope/logits path or clean teacher outputs with noisy sample.
4. Store binary tone labels, edge labels, element labels, and gap labels.

Success criteria:

| Metric | Target |
|---|---|
| Paired timing identity | exact or near-exact |
| Dataset loader supports pairs | yes |
| Noisy and clean examples align frame-by-frame | yes |

Next step if timing identity is hard with current TS generator: generate once clean with full metadata, then add noise/fading in Python so the keyed waveform is shared.

Parallelizable: yes, can run while Phase 1/2 decoder work proceeds.

### Step 3.2: Train A Binary Tone/Edge/Element Teacher

Before changing the full CTC model, train or derive a high-SNR teacher.

Teacher outputs:

| Output | Use |
|---|---|
| tone posterior | HSMM emission |
| onset/offset posterior | edge scoring |
| element posterior | dit/dah priors |
| WPM estimate | decoder initialization |

Success criteria:

| Metric | Target |
|---|---|
| High-SNR tone AUC | near ceiling |
| Edge timing | stable across WPM |
| Teacher output calibration | usable as soft target |

Next step if teacher is strong: distill to noisy student.

Next step if teacher is weak: labels are probably enough; use direct supervised heads.

Parallelizable: yes, after paired labels exist.

### Step 3.3: Train Multi-Head Noisy Student

Model heads:

| Head | Loss |
|---|---|
| CTC chars | current CTC loss |
| tone_on | BCE or focal loss |
| onset/offset | BCE with class balancing |
| element type | CE |
| gap type | CE |
| WPM | L1/Huber or bucket CE |
| clean-teacher distillation | KL |

Important experiment knobs:

| Knob | Sweep |
|---|---|
| Auxiliary loss weight | `0.1`, `0.3`, `1.0` |
| Distillation temperature | `1`, `2`, `4` |
| Very-low SNR weight | current `0.20`, then `0.30`, `0.40` with abstention |
| Entropy weight | current `0.03`, tune downward if emissions become calibrated |

Success criteria:

| Metric | Target |
|---|---|
| Greedy CTC CER | no worse overall |
| HSMM CER using neural emissions | improves `<= -10 dB` |
| Insertion rate | lower in `-14..-10 dB` |
| Calibration | confidence tracks CER |

Next step if CTC worsens but HSMM improves: keep model as structured-decoder acoustic model.

Next step if both improve: promote to production candidate.

Next step if both worsen: reduce auxiliary weights and verify labels.

Parallelizable: training sweeps can run in parallel on multiple GPUs once dataset exists.

## Phase 4: Hard Negatives And Abstention

Goal: make the decoder trustworthy in real no-signal and wrong-signal conditions.

### Step 4.1: Generate Negative Dataset

Negative classes:

| Class | Generation |
|---|---|
| pure noise | AWGN, band-limited noise, colored noise |
| wrong-frequency CW | CW offset from target by 30-300 Hz |
| carrier | steady tone at or near target frequency |
| QRM | multiple CW streams, chirps, RTTY-like tones |
| AGC pumping | amplitude-modulated noise floor |
| empty channel | silence plus receiver noise |

Success criteria:

| Metric | Target |
|---|---|
| False decode rate | near zero on negatives |
| No major deletion penalty | positive samples remain decoded |

Next step if false decode remains high: add sequence-level abstention threshold and hard-negative mining.

Parallelizable: yes, can start after diagnostics confirm hallucination modes.

### Step 4.2: Add Sequence-Level Confidence And Abstention

Confidence signals:

| Signal | Source |
|---|---|
| mean segment LLR | HSMM decoder |
| posterior margin | best path vs second-best path |
| WPM stability | decoder latent path |
| frequency stability | frequency tracker |
| CTC entropy | current neural model |
| negative-class posterior | hard-negative classifier |

Success criteria:

| Metric | Target |
|---|---|
| Rejects undecodable clips | yes |
| Retains decodable low-SNR clips | yes |
| Calibration | confidence bucket predicts CER/usefulness |

Next step if abstention is too aggressive: expose a user-adjustable copy aggressiveness slider.

Parallelizable: yes, with hard-negative model training.

## Phase 5: Real-World Robustness

Goal: stop optimizing only for synthetic AWGN/QSB.

### Step 5.1: Build A Real-Audio Eval Set

Collect or curate clips with:

| Condition | Why |
|---|---|
| weak signals | target use case |
| AGC artifacts | common receiver behavior |
| drifting tones | breaks coherent integration |
| pileups | real contest conditions |
| key clicks | broadband transients |
| adjacent-channel interference | common HF issue |
| varying filters | different receiver bandwidths |

Labels can be approximate at first, but a small carefully labeled set is more valuable than a large synthetic-only set.

Success criteria:

| Metric | Target |
|---|---|
| Real-audio CER tracked separately | yes |
| Synthetic gains transfer | yes |
| Failure examples archived | yes |

Next step if synthetic gains do not transfer: improve generator impairments and frequency tracker before architecture changes.

Parallelizable: yes, independent data task.

### Step 5.2: Add Receiver/Channel Augmentations

Synthetic impairments to add:

| Impairment | Reason |
|---|---|
| AGC compression/pumping | real radios normalize gain dynamically |
| bandpass filter variation | receiver filters differ |
| oscillator drift | coherent integration sensitivity |
| key clicks | broadband transients |
| colored noise | HF noise is not white |
| impulsive noise | real bands have crashes/clicks |
| close-frequency QRM | pileups and adjacent CW |

Success criteria:

| Metric | Target |
|---|---|
| Real eval improves | yes |
| Synthetic eval does not collapse | yes |

Next step if real improves but synthetic worsens slightly: prefer real if product goal is real-world decoding.

Parallelizable: yes, can run independently of decoder work.

## Phase 6: Optional Priors And Product Modes

Goal: use prior information honestly when the user wants it.

### Step 6.1: Raw Morse Grammar Mode

No text language model. Only Morse timing legality.

This should be the default scientific benchmark mode.

Success criteria:

| Metric | Target |
|---|---|
| Better than CTC in low SNR | yes |
| Does not invent language-specific text | yes |

### Step 6.2: Callsign And Contest Modes

Add optional WFST/LM priors:

| Mode | Prior |
|---|---|
| Callsign | legal callsign-like patterns |
| Contest | `599`, serials, zones, common exchange formats |
| QSO | CW abbreviations, Q-codes, names, locations |

Success criteria:

| Metric | Target |
|---|---|
| Improves mode-specific eval | yes |
| Raw mode unchanged | yes |
| UI clearly marks prior-assisted output | yes |

Next step if prior helps dramatically: expose multiple decode candidates with prior labels.

Parallelizable: yes, after HSMM/WFST infrastructure exists.

## Experiment Dependency Graph

Serial prerequisites:

```text
verify production checkpoint
-> add diagnostics
-> build baseline emission source
-> implement HSMM/WFST prototype
-> integrate coherent segment scorer
-> train multi-head acoustic model
-> add abstention and real-world robustness
```

Can run in parallel after baseline verification:

| Workstream | Dependencies | Output |
|---|---|---|
| Diagnostics | baseline checkpoint | insertion/deletion/substitution breakdown |
| HSMM decoder skeleton | none after benchmark decision | structured decode prototype |
| Emission calibration | ground-truth tone labels | tone LLR source |
| Coherent segment scoring | access to raw audio/tone freq | segment likelihood engine |
| Paired data generation | generator control | clean/noisy training pairs |
| Hard negatives | generator/control scripts | abstention dataset |
| Real eval set | manual/data work | transfer benchmark |

Can run in parallel after HSMM exists:

| Experiment | Output |
|---|---|
| WPM oracle vs estimated WPM | upper bound on timing model benefit |
| Duration-prior sweep | insertion/deletion tradeoff |
| Emission source comparison | best acoustic likelihood input |
| Beam width/runtime tuning | practical offline and streaming modes |
| Character prior off/on | raw mode vs prior-assisted mode |

Can run in parallel after paired data exists:

| Training experiment | Output |
|---|---|
| Tone/edge auxiliary heads | better emissions |
| Clean/noisy distillation | low-SNR alignment transfer |
| Very-low SNR reweighting | low-SNR specialist |
| Hard-negative training | lower false decode rate |
| Specialist models | ensemble candidates |

## Decision Tree After Each Major Experiment

### If HSMM/WFST Improves `<= -10 dB` CER

Do next:

1. Add candidate-aligned coherent integration.
2. Tune WPM/duration priors.
3. Add streaming beam version.
4. Train multi-head emissions specifically for the decoder.

Do not spend time on more DSP aux channels yet.

### If HSMM/WFST Reduces Insertions But CER Does Not Improve

Interpretation: timing grammar helps, but acoustic emissions are too weak or too deletion-prone.

Do next:

1. Add coherent segment scoring.
2. Relax duration priors.
3. Train tone/edge auxiliary heads.
4. Check whether deletions increased.

### If HSMM/WFST Does Not Improve Anything

Interpretation: either emissions are wrong, WPM search is bad, or the eval text is too random for timing grammar alone to help.

Do next:

1. Run oracle WPM.
2. Run oracle tone labels to test decoder correctness.
3. Compare DSP ch0, DSP logistic probe, and `1 - p(blank)` as emissions.
4. If oracle tests fail, fix decoder. If oracle tests pass, improve emissions.

### If Candidate-Aligned Coherent Integration Helps

Do next:

1. Add frequency micro-grid.
2. Add frequency drift model.
3. Use segment LLR as decoder confidence.
4. Consider a high-accuracy offline mode distinct from live mode.

### If Candidate-Aligned Coherent Integration Does Not Help

Do next:

1. Check tone frequency mismatch.
2. Check phase continuity and demod convention.
3. Try shorter max segments and WPM oracle.
4. Fall back to neural/DSP emissions if synthetic exact-frequency data still shows no gain.

### If Multi-Head Training Helps HSMM But Not CTC

Do next:

1. Treat the model as an acoustic model, not a standalone CTC decoder.
2. Export both acoustic heads and CTC head if browser budget allows.
3. Keep CTC for fast live preview and HSMM for final/refined decode.

### If Hard Negatives Reduce Hallucination But Increase Deletions

Do next:

1. Add a user-adjustable aggressiveness/confidence threshold.
2. Separate “raw copy” from “safe copy” modes.
3. Tune sequence-level abstention instead of frame-level suppression only.

## Recommended First Concrete Milestone

The first milestone should be small but decisive:

```text
Milestone: Offline Morse HSMM decoder beats current greedy CTC in <= -10 dB CER on the production 4-channel eval set, without retraining.
```

Minimum implementation:

1. Verify the production 4-channel checkpoint and baseline eval.
2. Add insertion/deletion/substitution diagnostics.
3. Produce frame tone likelihoods from `1 - p(blank)` and DSP ch0.
4. Implement a WPM-grid Morse HSMM/Viterbi decoder.
5. Compare against current greedy CTC by SNR bin.

Expected outcome if the thesis is correct:

| Metric | Direction |
|---|---|
| `<= -10 dB` CER | down |
| `-14..-10 dB` predicted length | closer to truth |
| insertion rate | down materially |
| high-SNR CER | roughly unchanged or slightly worse initially |

If this milestone fails even with oracle WPM and good emissions, then the project is closer to a true information limit than expected. If it succeeds, it opens a clear path to a receiver-grade decoder that can plausibly be best-in-class.

## Final Bet

The project has probably exhausted most of the easy DSP-channel gains. The next world-class jump should come from making the decoder understand Morse as a physical and grammatical process:

```text
not “which character is this frame?”
but “which legal Morse-generating process most likely produced this noisy waveform?”
```

That shift is the best shot at breaking through the sub-10 dB wall while staying honest about hallucination and real-world reliability.
