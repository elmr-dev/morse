# cw-ml

Streaming Morse code (CW) decoder: 1-channel DSP envelope → causal CNN + TCN +
BiGRU + CTC → live text. ~880k params, 3.8 MB ONNX, ~275 ms latency. Runs in
the browser via `onnxruntime-web`.

## Layout

| Path                | What it is                                                 |
| ------------------- | ---------------------------------------------------------- |
| `cw-dsp-research/`  | Autoresearch loop that tunes the DSP envelope (numpy/scipy). Composite score 0.87 on the held-out test set. |
| `model/`            | PyTorch training (CWNet), ONNX export, eval harness. Run on RunPod 4090 or local M-series. |
| `../cw-decode/apps/` | React + Vite frontend that runs the model client-side. Two pages: live decode + a "beat the bot" head-to-head. |

The DSP code is synced from `cw-dsp-research/dsp.py` to `model/data/dsp.py` —
the research repo finds the envelope, the training repo trains the decoder on
top of it.

## Active Experiment Tracks

- [Confidence Reliability Experiment](confidence-reliability-experiment-2026-06-05.md) — Beat-the-Bot `-9..-12 dB` single-character misses, calibration/fusion first, retraining only if evidence is absent.

## Quick start

### Demo (browser)

```bash
cd ../cw-decode/apps
pnpm install
pnpm dev      # http://localhost:5173
```

The bundled model lives at `../cw-decode/apps/public/model/cw_model_full.onnx` (3.8 MB).

### Train

```bash
cd model
uv sync
pnpm install                                      # for morse-audio (WAV gen)
uv run python main.py pipeline --config configs/debug.yaml   # CPU smoke test
python launch-runpod.py --config configs/4090.yaml           # full run on RunPod
```

The current best checkpoint is committed at `model/checkpoints/best.pt`
(matching config: `model/checkpoints/best.yaml`).

### Re-export ONNX from the stable checkpoint

```bash
cd model
uv run python scripts/export_full_onnx.py \
    --checkpoint checkpoints/best.pt \
    --config     checkpoints/best.yaml \
    --out        checkpoints/cw_model_full.onnx
cp checkpoints/cw_model_full.onnx ../../cw-decode/apps/public/model/cw_model_full.onnx
```

### DSP research loop

```bash
cd cw-dsp-research
uv sync
python generate_eval.py       # regenerate evaldata/ (~58 MB, gitignored)
python evaluate.py            # composite score for current dsp.py
```

## Architecture

```
audio (8 kHz)
  │
  ▼
DSP envelope  ── bandpass ±22 Hz → Hilbert → decimate 16× → 500 Hz, 3 channels
  │
  ▼
Causal CNN    ── stride-2 → 250 Hz feature stream
  │
  ▼
TCN           ── 5 dilated blocks, ~120 ms receptive field
  │
  ▼
Chunked BiGRU ── fwd stateful (long context), bwd 200 ms lookahead
  │
  ▼
CTC head      ── 42 classes (blank + A–Z + 0–9 + .,?=/)
```

Streaming graph processes 200 ms chunks with 100 ms right-context lookahead →
~275 ms end-to-end latency. See `model/CLAUDE.md` for design notes
(anti-hallucination loss tuning, 1-channel rationale, SNR tier balance).

## What's gitignored

Training data (`*.wav`, `*.npz`, `runs/`, `data/{train,val,debug}/`), Python
caches, node_modules, virtualenvs, and all `*.pt` / `*.onnx` files **except**
the whitelisted stable model artifacts:

- `model/checkpoints/best.pt` + `best.yaml`
- `../cw-decode/apps/public/model/cw_model_full.onnx`
