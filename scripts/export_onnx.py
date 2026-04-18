"""
Export CWNet streaming chunk interface to ONNX.

ONNX graph — fixed shape, no loop unrolling, explicit hidden state I/O:
  Inputs:
    envelopes   : (1, 150, 1)   float32  — CHUNK_FRAMES + LOOKAHEAD_FRAMES at 500 Hz
    fwd_hidden  : (2, 1, 128)   float32  — forward GRU hidden state (zeros on first chunk)
  Outputs:
    log_probs       : (1, 50, 42)   float32  — log-softmax output for the chunk
    fwd_hidden_next : (2, 1, 128)   float32  — updated hidden state for next chunk

This fixes the cw-decode ONNX export which unrolled the BiGRU loop and required
4000 frames minimum input. The new export processes exactly one chunk per call.

Usage:
    python scripts/export_onnx.py --checkpoint runs/.../base_best.pt --config configs/base.yaml
    python scripts/export_onnx.py --checkpoint runs/.../base_best.pt  # auto-detects config
"""

import sys
import os
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch
import torch.nn as nn
import yaml

from model.cwnet import CWNet, CHUNK_FRAMES, LOOKAHEAD_FRAMES, NUM_CLASSES


class _StreamChunkWrapper(nn.Module):
    """Thin wrapper for ONNX export of forward_chunk."""
    def __init__(self, model: CWNet):
        super().__init__()
        self.model = model

    def forward(self, envelopes: torch.Tensor, fwd_hidden: torch.Tensor):
        return self.model.forward_chunk(envelopes, fwd_hidden)


def export_onnx(checkpoint: Path, output_path: Path, cfg: dict) -> None:
    """Load checkpoint and export to ONNX."""
    device = torch.device("cpu")

    model_cfg = cfg.get("model", {})
    sd = torch.load(checkpoint, map_location=device, weights_only=True)
    first_conv_key = next(
        k for k in ("conv.0.0.conv.weight", "conv.0.conv.weight", "conv.0.weight") if k in sd
    )
    in_channels = sd[first_conv_key].shape[1]
    gru_hidden  = sd["gru_fwd.weight_ih_l0"].shape[0] // 3
    gru_layers  = model_cfg.get("gru_layers", 2)
    tcn_blocks  = model_cfg.get("tcn_blocks", 4)
    tcn_channels = model_cfg.get("tcn_channels", 128)

    model = CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=gru_hidden,
        gru_layers=gru_layers,
        dropout=0.0,
        in_channels=in_channels,
        tcn_channels=tcn_channels,
        tcn_blocks=tcn_blocks,
    )
    model.load_state_dict(sd)
    model.eval()
    print(f"Loaded checkpoint: {checkpoint}")
    print(f"  Parameters:  {model.count_parameters():,}")
    print(f"  in_channels: {in_channels}")
    print(f"  gru_hidden:  {gru_hidden}")

    wrapper = _StreamChunkWrapper(model)
    wrapper.eval()

    # LOOKAHEAD_FRAMES is in 250-Hz units (per cwnet.py) so the lookahead is 2*LOOKAHEAD_FRAMES at 500 Hz.
    total_input_frames = CHUNK_FRAMES + 2 * LOOKAHEAD_FRAMES  # 200 frames = 400ms at 500 Hz
    envelopes  = torch.zeros(1, total_input_frames, in_channels)
    fwd_hidden = torch.zeros(gru_layers, 1, gru_hidden)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        wrapper,
        (envelopes, fwd_hidden),
        str(output_path),
        input_names=["envelopes", "fwd_hidden"],
        output_names=["log_probs", "fwd_hidden_next"],
        dynamic_axes={
            "envelopes":       {0: "batch"},
            "fwd_hidden":      {1: "batch"},
            "log_probs":       {0: "batch"},
            "fwd_hidden_next": {1: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

    size_mb = output_path.stat().st_size / (1024 ** 2)
    print(f"\nExported: {output_path}  ({size_mb:.1f} MB)")
    print(f"  Input  'envelopes':       (1, {total_input_frames}, {in_channels})")
    print(f"  Input  'fwd_hidden':      ({gru_layers}, 1, {gru_hidden})")
    print(f"  Output 'log_probs':       (1, {CHUNK_FRAMES // 2}, {NUM_CLASSES})")
    print(f"  Output 'fwd_hidden_next': ({gru_layers}, 1, {gru_hidden})")

    _verify_onnx(model, output_path, in_channels, gru_layers, gru_hidden)


def _verify_onnx(model: CWNet, onnx_path: Path, in_channels: int,
                  gru_layers: int, gru_hidden: int) -> None:
    """Check PyTorch and ONNX outputs match on a random input."""
    try:
        import onnxruntime as ort
    except ImportError:
        print("\nSkipping ONNX verify: onnxruntime not installed.")
        return

    total_frames = CHUNK_FRAMES + 2 * LOOKAHEAD_FRAMES
    rng = np.random.default_rng(42)
    env_np    = rng.standard_normal((1, total_frames, in_channels)).astype(np.float32)
    hidden_np = rng.standard_normal((gru_layers, 1, gru_hidden)).astype(np.float32)

    with torch.no_grad():
        lp_pt, h_pt = model.forward_chunk(
            torch.from_numpy(env_np),
            torch.from_numpy(hidden_np),
        )
    lp_pt = lp_pt.numpy()
    h_pt  = h_pt.numpy()

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    lp_ort, h_ort = sess.run(None, {"envelopes": env_np, "fwd_hidden": hidden_np})

    tol = 1e-4
    diff_lp = float(np.abs(lp_pt - lp_ort).max())
    diff_h  = float(np.abs(h_pt  - h_ort).max())
    status_lp = "PASS" if diff_lp < tol else "FAIL"
    status_h  = "PASS" if diff_h  < tol else "FAIL"
    print(f"\nVerification (tol={tol}):")
    print(f"  log_probs   max |diff| = {diff_lp:.2e}  [{status_lp}]")
    print(f"  fwd_hidden  max |diff| = {diff_h:.2e}  [{status_h}]")
    if status_lp == "FAIL" or status_h == "FAIL":
        sys.exit(1)
    print("  OK")


def main():
    parser = argparse.ArgumentParser(description="Export CWNet to ONNX")
    parser.add_argument("--checkpoint", required=True, help="Path to .pt checkpoint")
    parser.add_argument("--config", help="Path to YAML config (auto-detected if omitted)")
    parser.add_argument("--out", default="checkpoints/cw_model.onnx", help="Output ONNX path")
    args = parser.parse_args()

    checkpoint = Path(args.checkpoint)
    output = Path(args.out)

    if args.config:
        with open(args.config) as f:
            cfg = yaml.safe_load(f)
    else:
        # Try to find config next to checkpoint
        cfg_candidates = list(checkpoint.parent.glob("*.yaml")) + list(
            Path("configs").glob("*.yaml")
        )
        cfg_candidates = [c for c in cfg_candidates if "debug" not in c.name]
        if cfg_candidates:
            with open(cfg_candidates[0]) as f:
                cfg = yaml.safe_load(f)
            print(f"Using config: {cfg_candidates[0]}")
        else:
            cfg = {}
            print("No config found — using defaults (gru_hidden=128)")

    export_onnx(checkpoint, output, cfg)
    print("\nDone.")


if __name__ == "__main__":
    main()
