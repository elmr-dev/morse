# Confidence Reliability Experiment

Date: 2026-06-05

## Decision

Before changing DSP or running a broad retrain, focus on character-level reliability for Beat the Bot.

The target failure is not general low-SNR decoding. It is the recoverable band where a `-9..-12 dB` repeated callsign often has only one missed or substituted character. `-13` and `-14 dB` misses are expected; the question is whether the model already contains enough uncertainty signal to select the correct character when one send, one beam candidate, or one calibrated feature has it.

## Why This Track

Prior model diagnostics showed:

- Insertions are tiny in the production CTC decoder.
- Substitutions dominate around `-10..-13 dB`.
- Deletions dominate below `-14 dB`.
- Existing sample-level confidence is useful for abstention, but Beat the Bot needs character-level confidence for fusion.

That makes generic DSP tuning the wrong first move. If a single character is wrong at `-9 dB`, the next useful question is:

> Was the correct character present somewhere in the evidence, and did our confidence/fusion logic choose the wrong one?

If yes, improve calibration and fusion. If no, then retraining or new heads are justified.

## Hypotheses

1. **Fusion-selection failure**
   - If the correct character appears in one repeated send but the fused output picks the other send, calibrated character reliability should improve the final Beat the Bot score without retraining.

2. **Beam-alternative failure**
   - If the correct character appears in CTC beam alternatives but greedy decode drops it, beam posterior features plus a small calibrator can recover some misses.

3. **True acoustic/model miss**
   - If neither repeated send nor beam alternatives contain the correct character, current emissions lack the evidence. That points to retraining, auxiliary heads, or changed data distribution.

4. **Split/DSP artifact**
   - If misses correlate with bad inter-callsign split, envelope dropout, or tone-frequency sensitivity, fix the split/DSP path before retraining.

## Experiment Artifacts

Keep generated artifacts out of Git unless explicitly promoted.

Suggested local layout:

```text
ml/model/experiments/confidence-reliability/
  README.md
  beatbot-val/
    manifest.jsonl
    misses/
      sample_0007.wav
      sample_0007.json
  reports/
    baseline.json
    calibration.json
    fusion-ablation.json
```

The manifest should include at least:

- `sample_id`
- `seed`
- `truth`
- `sent_text`
- `wpm`
- `snr_db`
- `region`
- `wav_path`
- `first_half`
- `second_half`
- `fused`
- `cer_first`
- `cer_second`
- `cer_fused`
- `edit_ops`
- `split_frame`

## Track

### Step 1: Build The Beat-the-Bot Validation Slice

Status: pending

Generate a deterministic validation slice that matches the demo:

- callsigns only
- callsign sent twice with a word gap
- `20..30 WPM`
- `-9..-12 dB`
- tone `700 Hz`
- same `morse-audio` generation path as the demo

Start small with 20 samples for manual inspection, then scale to 200-1000 once the loop is trusted.

Success criteria:

- Every sample has reproducible seed metadata.
- Missed samples save their WAV and diagnostic JSON.
- The loop reports first-half, second-half, and fused CER separately.

### Step 2: Classify Misses

Status: pending

For each fused miss, classify it as one of:

- correct character present in one half but fusion chose wrong
- correct character present in beam alternatives but greedy/fusion lost it
- correct character absent from both halves and beam alternatives
- bad split or DSP artifact

Success criteria:

- At least 20 misses classified, or the sample count is increased until there are enough misses.
- We know whether calibration/fusion can plausibly recover the common failure mode.

### Step 3: Post-Hoc Calibration Before Retraining

Status: pending

Run the existing calibrator against this slice or a matching generated validation set:

```bash
cd ml/model
uv run python -m eval.calibrate_confidence \
  --config configs/4060-phase5a.yaml \
  --checkpoint checkpoints/best.pt \
  --data-dir data/val_beatbot_confidence \
  --limit 1000 \
  --beam-width 50 \
  --out-json experiments/confidence-reliability/reports/calibration.json
```

If the existing model has useful uncertainty signal, port the small logistic calibrator to TypeScript and use it in Beat the Bot fusion.

Success criteria:

- Character-level ECE improves over raw posterior confidence.
- Accuracy-at-coverage improves in the `-9..-12 dB` slice.
- Fusion ablation shows lower fused CER than current heuristic fusion.

### Step 4: Fusion Ablation

Status: pending

Compare:

- current greedy + heuristic dual fusion
- calibrated character fusion
- beam alternative calibrated fusion
- oracle upper bound: choose correct character if present in either half or beam alternatives

Success criteria:

- If calibrated fusion approaches oracle, implement browser-side calibrator.
- If oracle is low, move to retraining.

### Step 5: Training Run Only If Needed

Status: pending

Use `configs/4060-phase5a.yaml` as the starting point.

Training intent:

- warm-start from `checkpoints/best.pt`
- focus on recoverable `-14..-10` and `-10..-4` bands
- improve calibrated character reliability
- avoid simply making the model more confident

Initial command:

```bash
cd ml/model
CW_QUIET=1 uv run python main.py pipeline \
  --config configs/4060-phase5a.yaml \
  --starting-checkpoint checkpoints/best.pt
```

Post-run checks:

```bash
uv run python main.py evaluate \
  --config configs/4060-phase5a.yaml \
  --checkpoint runs/<RUN_ID>/4060-phase5a_best.pt \
  --data-dir data/val \
  --out-json experiments/confidence-reliability/reports/phase5a-eval.json

uv run python -m eval.calibrate_confidence \
  --config configs/4060-phase5a.yaml \
  --checkpoint runs/<RUN_ID>/4060-phase5a_best.pt \
  --data-dir data/val_beatbot_confidence \
  --limit 1000 \
  --beam-width 50 \
  --out-json experiments/confidence-reliability/reports/phase5a-calibration.json
```

Success criteria:

- No overall CER regression on standard validation.
- Lower fused CER on the Beat-the-Bot `-9..-12 dB` slice.
- Better character calibration, not just higher confidence.

## Current Next Action

Implement Step 1 as a deterministic local evaluation loop:

1. Generate 20 Beat-the-Bot-style samples at `-9..-12 dB`.
2. Decode each sample as first half, second half, and fused output.
3. Save WAV + JSON for any fused miss.
4. Summarize miss type and CER.

Do not change DSP or train until this loop tells us whether the recoverable misses are calibration/fusion failures or true acoustic/model misses.
