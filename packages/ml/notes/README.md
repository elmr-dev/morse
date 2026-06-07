# morse

Streaming Morse code (CW) decoder: 4-channel DSP envelope → causal CNN + TCN +
BiGRU + CTC → live text. ~880k params, 3.8 MB ONNX. Runs in the browser via
`onnxruntime-web`.

## Layout

This package (`packages/ml/`) holds the research and training code. The web app
that ships the model lives at the repo root (`apps/web/`).

| Path                | What it is                                                 |
| ------------------- | ---------------------------------------------------------- |
| `cw-dsp-research/`  | Autoresearch loop that tunes the DSP envelope (numpy/scipy). Composite score 0.87 on the held-out test set. |
| `model/`            | PyTorch training (CWNet), ONNX export, eval harness. Run on RunPod 4090 or local M-series. |
| `../../apps/web/`   | React + Vite frontend (`morse-web`) that runs the model client-side. Two pages: live decode + a "beat the bot" head-to-head. |

The DSP code is synced from `cw-dsp-research/dsp.py` to `model/data/dsp.py` —
the research repo finds the envelope, the training repo trains the decoder on
top of it.

## Active Experiment Tracks

- [Confidence Reliability Experiment](confidence-reliability-experiment-2026-06-05.md) — Beat-the-Bot `-9..-12 dB` single-character misses, calibration/fusion first, retraining only if evidence is absent.

## Quick start

### Demo (browser)

From the repo root (Bun workspace):

```bash
bun install
bunx turbo dev --filter=morse-web   # Vite dev server (http://localhost:5173)
```

The bundled model lives at `apps/web/public/model/cw_model_full.onnx` (3.8 MB).

### Train

```bash
cd model
uv sync                                                       # Python deps (uv)
bun install                                                   # for morse-audio (WAV gen), from repo root
uv run python main.py pipeline --config configs/debug.yaml    # CPU smoke test
uv run python launch-runpod.py --config configs/4090.yaml     # full run on RunPod
```

The current best checkpoint is committed at `model/checkpoints/best.pt`
(matching config: `model/checkpoints/best.yaml`).

### Re-export ONNX from the stable checkpoint

From the repo root this is wired into Turbo as `bun run model:export` (export +
copy into `apps/web`). The underlying steps:

```bash
cd model
uv run python scripts/export_full_onnx.py \
    --checkpoint checkpoints/best.pt \
    --config     checkpoints/best.yaml \
    --out        checkpoints/cw_model_full.onnx
cp checkpoints/cw_model_full.onnx ../../apps/web/public/model/cw_model_full.onnx
```

Note: re-exporting from an unchanged checkpoint can still rewrite a single
`producer_version` byte in the ONNX header (torch is bounded `<3` but not pinned
exactly, so the stamped version can drift). The weights stay byte-identical. If
`best.pt` did not change, discard the diff rather than committing a no-op 3.8 MB
binary churn: `git checkout -- apps/web/public/model/cw_model_full.onnx`.

### DSP research loop

```bash
cd cw-dsp-research
uv sync
uv run python generate_eval.py   # regenerate evaldata/ (~58 MB, gitignored)
uv run python evaluate.py        # composite score for current dsp.py
```

## Architecture

```
audio (8 kHz)
  │
  ▼
DSP envelope  ── 4 orthogonal channels @ 500 Hz (decimate 16×):
                 ch0 amplitude (±25 Hz bandpass → Hilbert), ch1 TKEO,
                 ch2 dit-scale matched filter, ch3 char-scale matched filter
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

The model is causal with a 100 ms right-context lookahead (~275 ms algorithmic
latency) and can run as a streaming chunk graph (`scripts/export_onnx.py`). The
**web app ships the fixed-length full-sequence graph** (`scripts/export_full_onnx.py`,
input `(1, 8000, 4)` → output `(1, 4000, 42)`): it pads the clip, runs once, and
trims. See `model/CLAUDE.md` for design notes (anti-hallucination loss tuning,
4-channel DSP rationale, SNR tier balance).

## What's gitignored

Training data (`*.wav`, `*.npz`, `runs/`, `data/{train,val,debug}/`), Python
caches, node_modules, virtualenvs, and all `*.pt` / `*.onnx` files **except**
the whitelisted stable model artifacts:

- `model/checkpoints/best.pt` + `best.yaml`
- `apps/web/public/model/cw_model_full.onnx`
