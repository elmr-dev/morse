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
