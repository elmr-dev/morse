# Phase 4b: Paired Clean/Noisy Self-Distillation

Date: 2026-04-26

Drafted as the second half of Phase 4 (the "real win" complement to
Phase 4a's gate-relaxation quick win). Should be executed only after
Phase 4a returns numbers — Phase 4a is a 1-hour fine-tune, Phase 4b is
a 4-hour-ish dataset rework + retrain.

The bet: Phase 3 is deletion-dominated at ≤-14 dB (emits 66% of target
length at -16 dB) because the model lacks dense supervision in the
regime where the noisy envelope barely encodes the Morse content. A
paired clean teacher of the same Morse content can transfer alignment
through noise. Doc reference: `GPT5.5-ideas-2026-04-26.md` Step 3.3.

## Data: paired generation

Each training sample becomes a pair: same text, same WPM, same fist,
same tone frequency, same TS-generator seed → identical Morse timing
in both members of the pair. The two differ only in the noise level
applied:

- **Noisy version**: SNR sampled from `snr_tiers` as today.
- **Clean version**: SNR fixed at +20 dB (or wherever the model is
  near-perfect — verify on Phase 3 final_eval that ≥+20dB CER is < 0.001).

Implementation in `model/data/generate.py`:

- Modify `build_configs` to emit pairs of configs sharing seed + text +
  WPM + fist + frequency, differing only in `noise.snrDb`.
- `run_ts_generator` already generates one WAV per config — paired
  configs naturally become paired WAVs.
- `_dsp_and_save_npz` saves per-pair npz with both envelopes:
  ```
  envelopes_noisy: (T, 4)
  envelopes_clean: (T, 4)
  frame_labels:    (T_out,)    # shared — same morse timing
  tone_labels:     (T_out,)    # shared
  text:            str
  wpm, snr_db_noisy, impairment, ...
  ```

The TS generator is fully deterministic per seed once you fix
`fist`/`frequency`/`text`/`wpm`/`durationSec`. The only stochastic
input is `noise` — and morse-audio's noise generation reseeds from
`prng()` derived from `config.seed`, so we need separate seeds per
pair member to get different noise instantiations. Easiest: seed
clean version with `seed * 2`, noisy with `seed * 2 + 1`, both
configs identical otherwise.

Cost: ~2x storage and ~2x generation time. With 50k pairs at the
current pace (~30 min for 50k WAVs + DSP), this is ~1hr generate.

## Training: KL distillation loss

Teacher: same model running on `envelopes_clean`. No separate teacher
checkpoint needed — the noisy student IS the teacher in the limit
where its own clean-input forward gives near-perfect logits. (Verify:
forward pass on a +20 dB val sample with current Phase 3 model should
be near-zero error.)

Loss formulation (additive on top of Phase 3's CTC + tone BCE):

```python
# In train_one_epoch_blended:
log_probs_noisy, tone_logits_noisy = model.forward_dual(envelopes_noisy)
with torch.no_grad():
    log_probs_clean, _ = model.forward_dual(envelopes_clean)

# CTC + tone BCE on noisy view (existing).
loss = ctc_w * ctc(log_probs_noisy) + tone_w * bce(tone_logits_noisy, tone_labels)

# Distillation: pull noisy logits toward clean logits.
T = distill_temperature  # e.g. 2.0
distill = F.kl_div(
    F.log_softmax(log_probs_noisy / T, dim=-1),
    F.softmax(log_probs_clean / T, dim=-1).detach(),
    reduction="batchmean",
) * (T ** 2)
loss = loss + distill_weight * distill
```

Knobs:
- `distill_weight ∈ [0.1, 0.5, 1.0]`
- `distill_temperature ∈ [1, 2, 4]`

Hypothesis: weight 0.5, temp 2 — soft enough to preserve the
noisy signal's own evidence, strong enough to anchor the alignment.

## Why this attacks deletions specifically

CTC loss on noisy data permits large alignment freedom — the model
can choose to emit blank everywhere and still score acceptably as
long as the (fewer, wrongly-deleted) characters it does emit are
correct. CE on frame_labels helps but has the same problem: blank is
itself a valid frame label.

The clean teacher knows exactly when each character should fire — at
high SNR the CTC posterior collapses to crisp peaks at character
boundaries. Distilling against that clean teacher's posterior gives
the noisy student a per-frame pressure to fire characters at the
right times, even when the noisy emission is too weak to fire on its
own.

This is the key insight: the noisy model's CTC objective doesn't
penalize deletions strongly enough; the clean teacher's posterior
does, frame by frame.

## Eval: same val set, same milestone gate

Train run produces `runs/<ts>/4090-phase4b_best.pt`. Run
`evaluate_checkpoint` against `data/val`. Compare per-tier CER vs
Phase 3.

Pass criteria:
- Overall CER ≤ 0.0959 (no regression vs Phase 3 0.0880 + tolerance)
- `≤-10dB` tier CER materially below 0.374 (target: < 0.30)
- `-14..-10dB` `len_ratio` closer to 1.0 (currently 0.836 at -14..-13)
- Deletions/char drop by ≥ 30% in `-14..-15` and `-16..-15` bins

If pass, Phase 4b becomes the new production checkpoint.

## What lands in the repo

- `data/generate.py`: pair-generation logic (~50 lines)
- `data/dataset.py`: load both envelopes, return pair (~10 lines)
- `data/dataset.py:collate_fn`: stack envelopes_clean alongside envelopes
  (~5 lines)
- `training/train.py`: KL distillation loss (~20 lines), config knobs
  (~5 lines)
- `configs/4090-phase4b.yaml`: distillation knobs + same SNR tiers
- New training run dir `runs/<ts>/`
- Updated `RUNS.md` with verdict

## Out of scope

- Cross-architecture distillation (using a bigger pre-trained teacher).
  Deferred — self-distillation is the cheap clean-version baseline.
- Onset/offset auxiliary head. Add only if Phase 4b plateaus and we
  need finer-grained supervision.
- Hard negatives + abstention. Independent direction (Phase 4 doc
  section #6); deferred to its own session.

## How to start in a fresh session

```
cd /Users/mdp/Sync/src/mdp/morse/cw-ml
# Phase 4a numbers should already be in. If those moved the needle,
# decide whether 4b is still worth doing. If 4a was flat, 4b is the
# next swing.
```
