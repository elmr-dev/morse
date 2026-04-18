# CW Model — Streaming Morse Code Decoder

1-channel DSP → Causal CNN + TCN + BiGRU + CTC → streaming text output.

## Architecture

**DSP** (`data/dsp.py`): Single-channel bandpass + Hilbert envelope.
- Synced from `../cw-dsp-research/dsp.py` (autoresearch, 0.8651 composite score)
- Bandpass ±22 Hz → Hilbert magnitude → decimate 16× → 500 Hz
- Power compression (^0.69) → global percentile normalize → sigmoid sharpen (gamma=37)

**Model** (`model/cwnet.py`):
- Input: `(B, T, 1)` at 500 Hz
- Causal CNN: Conv1d(1→64→96→128, stride-2 at L1) → 250 Hz
- Causal TCN: 4 blocks, dilations 1/2/4/8, receptive field ~120ms
- Chunked BiGRU: fwd stateful (WPM context), bwd 200ms lookahead (element boundaries)
- CTC head: 42 classes (blank + A–Z + 0–9 + `.,?=/`)
- CHUNK_FRAMES=100, LOOKAHEAD_FRAMES=50 → **~275ms total latency**
- ~880k params, ~3.5 MB ONNX

**ONNX export** (`scripts/export_onnx.py`):
- Fixed-shape graph, explicit hidden state I/O
- `envelopes (1,150,1)` + `fwd_hidden (2,1,128)` → `log_probs (1,50,42)` + `fwd_hidden_next`

## Key Design Decisions

**Anti-hallucination** (vs cw-decode which hallucinated at -12/-18 dB):
- `entropy_weight=0.03` (was 0.01) — penalize confident wrong predictions
- `ce_blank_weight=0.2` (was 0.5), `ce_char_weight=3.0` (was 2.0)
- Eval decoding: entropy gate + blank-ratio gate + run-length filter

**1-channel DSP**: The research found that multi-channel fusion via min() suppresses transitions (hurts CTC edges). Single sharp IQ channel > noisy multi-channel fusion.

**Reduced SNR very-low tier** (25% vs 40%): Over-training on near-noise-floor conditions (-18 to -10 dB) teaches the model to hallucinate. Balanced distribution gives better real-world CER.

## Quick Start

```bash
# Install
uv sync  # or: pip install -e .
pnpm install  # for morse-audio (WAV generator)

# Smoke test (CPU)
uv run python main.py pipeline --config configs/debug.yaml

# Full run (RunPod)
python launch-runpod.py --config configs/base.yaml

# Decode a WAV
uv run python main.py decode --config configs/base.yaml \
    --checkpoint runs/.../base_best.pt --wav audio.wav --freq 700
```

## Training Loop

CE pre-training (5 epochs) → blend CE+CTC (3 epochs) → CTC + entropy (60 epochs).
Best checkpoint saved when val CER improves during CTC phase.

## Verification

After training:
1. `python main.py verify --config configs/debug.yaml` — smoke test
2. `python main.py evaluate --config configs/base.yaml --checkpoint runs/.../base_best.pt`
3. `python scripts/export_onnx.py --checkpoint runs/.../base_best.pt` — check ONNX shapes
