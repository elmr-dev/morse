# Phase 3: Multi-Head Retraining for Tone-On/Off Posteriors

Date: 2026-04-26

Drafted as a follow-up to today's parked HSMM offline-decoder experiment (see `model/RUNS.md` "HSMM offline-decoder experiment"). The HSMM/Viterbi code in `model/eval/hsmm.py` is correct but starves on the wrong-shape emissions — the trained CTC model commits each character on ~1 frame at the on-segment peak, with blank everywhere else, while a segment-scoring HSMM expects sustained on/off envelopes. Phase 3's bet: train an auxiliary tone-on/off head alongside CTC on the same backbone, with sustained per-frame supervision derived from the morse-audio character timings. The auxiliary head produces the right-shape emissions for the parked HSMM to consume; CTC stays for live preview.

This is a single training run, not a research arc — the milestone is well-defined.

## Data labels: derive tone-on/off at 250 Hz from morse-audio metadata

The TS generator already emits `characters` with `startMs`/`endMs` (character extent including intra-character gaps). `data/generate.py:build_frame_labels` already maps that into per-frame character class indices at 250 Hz, so the timing infra exists. What's missing is per-element timing within each character: dits and dahs versus intra-character gaps.

Two ways to get this:

**Option A: extend morse-audio metadata** (cleaner; one-time TS change)
Add per-element start/end times to each character object in the generator's output. Requires touching the sibling repo and bumping its API surface for downstream consumers. Cleanest long-term.

**Option B: reconstruct in Python** (no TS change; recommended first cut)
Each character has known WPM (per-clip), known startMs, and a fixed dit/dah pattern (lookup table mirroring `model/eval/hsmm.py:_MORSE`). Walk the pattern: at WPM `w`, dot duration is `1.2 / w` seconds, dits last `dot_dur`, dahs last `3 * dot_dur`, intra-gaps last `dot_dur`. Compute element on/off intervals for each character. Mark per-frame at 250 Hz.

Implementation:

- New helper `model/data/generate.py:build_tone_labels(characters, total_samples, wpm, sample_rate, downsample) -> np.ndarray[bool]`. Returns a `(T_out,)` boolean array, True where tone is keyed.
- Modify `_dsp_and_save_npz` to also save `tone_labels` (uint8 to save space) alongside `frame_labels`.
- Modify `data/dataset.py:CWDataset.__getitem__` to return `tone_labels` and `collate_fn` to pad it like `frame_labels`.

Verification:
- Run `main.py verify` and confirm `tone_labels` shape and frequency. Mean fraction ON should match Morse code's ~50% on/off ratio when the character is keyed (~30% when including inter-character gaps).
- AUC of DSP ch0 vs `tone_labels` should be substantially higher than vs `frame_labels != 0` (currently 0.69 → expected ~0.85 at high SNR).

Cost: ~50 lines of code. No retraining yet.

## Model: add an auxiliary tone-on/off head

Architecture choice: shared backbone (CNN + TCN + chunked BiGRU), two heads off the BiGRU output:

- `ctc_head` (existing): `Linear(256 → 42) → log_softmax` for character emission
- `tone_head` (new): `Linear(256 → 1) → sigmoid` for tone-on/off posterior

Both heads see the same per-frame BiGRU features. The tone head adds ~256 params on top of the existing ~880k — negligible.

Implementation in `model/model/cwnet.py`:

```python
self.tone_head = nn.Linear(gru_hidden * 2, 1)
nn.init.zeros_(self.tone_head.bias)
nn.init.uniform_(self.tone_head.weight, -0.01, 0.01)
```

Forward returns both heads:

```python
return char_logits.log_softmax(-1), tone_logits  # (B, T, 42), (B, T, 1)
```

Streaming `forward_chunk` likewise returns both. ONNX export needs a small change to expose the second output.

## Training: dual-task loss

In `training/train.py`, augment the existing CTC + entropy loss with BCE on the tone head:

```python
loss = (ctc_w * ctc_loss
        + ce_w * ce_loss
        + entropy_w * entropy_loss
        + tone_w * F.binary_cross_entropy_with_logits(
            tone_logits.squeeze(-1), tone_labels.float(),
        ))
```

Sweep tone_w over `[0.0, 0.1, 0.3, 1.0]` to find the value that matches CTC CER while learning a clean tone posterior. Hypothesis: 0.3 gives strong tone supervision without dragging CTC.

Other knobs to consider:
- Class balance: tone-on is ~30% of frames at typical SNR. Use `pos_weight=2.5` in BCE or focal loss to compensate.
- Optionally add an onset/offset head (3-class CE: onset / offset / neither) to learn edge transitions explicitly. Defer until tone head alone is shown to help.

Training time: same as production (50k train samples × 60 epochs ≈ 3 hr on RunPod 4090). The auxiliary head adds <1% to forward time.

## Eval: HSMM consumes the auxiliary head

Once the multi-head model is trained, `eval/emissions.py` gains a third source:

```python
def emissions_from_tone_head(tone_logits: Tensor) -> np.ndarray:
    # tone_logits is (T, 1) raw logits — already in LLR form (logit = log-odds = LLR
    # under a logistic model). Just return it.
    return tone_logits.detach().cpu().float().numpy().squeeze(-1)
```

Wire `--emission tone_head` into `decode_batch`. Reuse the parked HSMM as-is.

Expected AUC of `tone_head` LLR vs `tone_labels` ground truth: high SNR ≥ 0.95, ≤-10 dB ≥ 0.80, ≤-15 dB ≥ 0.65 (estimate — depends on training dynamics). The HSMM segment scoring should now have meaningful evidence to find characters greedy missed.

## Verification: the actual milestone test

The same test from today's parked attempt: HSMM oracle/tone_head must beat greedy CTC at ≤-10 dB CER on the regenerated `data/val` set.

Expected outcome path:
1. Train multi-head model (3 hr)
2. Eval greedy CTC on the new model — overall CER should match production (~0.09) within noise
3. Eval HSMM/oracle/tone_head — gates ≤-10 dB CER < 0.385

If the new greedy CTC drifts up by more than ~0.005 absolute, lower `tone_w` (ce_w/ctc_w/entropy_w/tone_w trade off explicitly).

## What lands in the repo

- `data/generate.py`: +50 lines for `build_tone_labels` and integration
- `data/dataset.py`: +5 lines for `tone_labels` plumbing through collate
- `model/cwnet.py`: +10 lines for `tone_head` and dual-output forward
- `training/train.py`: +20 lines for dual-task loss + sweep knobs
- `eval/emissions.py`: +20 lines for `emissions_from_tone_head`
- `eval/decode.py`, `main.py`: +10 lines to wire `--emission tone_head` flag
- New training run dir under `model/runs/<timestamp>/`
- Updated `model/RUNS.md` with verdict

## Out of scope

- Coherent integration over candidate segments (doc Phase 2). Worth pursuing only after the multi-head HSMM milestone passes — Phase 2 buys 3-6 dB at low SNR but only if segment hypotheses come from somewhere.
- Frequency micro-grid / drift tracking. Same gating: defer until Phase 3 milestone.
- Onset/offset head, element-type head, WPM head, hard negatives, abstention head. Defer; one head at a time.
- Real-audio eval set. Different milestone (Phase 5).
- Browser deployment / ONNX export of the auxiliary head. After the milestone passes.

## How to start in a fresh session

```
cd /Users/mdp/Sync/src/mdp/morse
# Plan mode: ask Claude to read this file and implement the data labels first,
# verify on a small generation, then move to model/training in a separate
# milestone gate.
```

The data-label change is the smallest unit of risk and lands without retraining. Verify with `main.py verify` before touching the model.
