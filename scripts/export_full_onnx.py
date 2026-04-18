"""
Export CWNet as a fixed-length full-sequence graph for the web demo.

Unlike export_onnx.py (per-chunk streaming, requires CNN state carry-over to be
correct), this exports model.infer() at a fixed max input length. Clients pad
shorter audio with zeros and trim the output to the real audio length.

Graph:
  envelopes : (1, MAX_T, 3)   float32  — envelope at 500 Hz, zero-padded if shorter
  -->
  log_probs : (1, MAX_T/2, 42) float32 — log-softmax at 250 Hz
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch
import torch.nn as nn
import yaml

from model.cwnet import CWNet, NUM_CLASSES


class _FullWrapper(nn.Module):
    """Wrapper calling model.infer() which prepends warmup + appends tail internally."""
    def __init__(self, model: CWNet):
        super().__init__()
        self.model = model

    def forward(self, envelopes: torch.Tensor) -> torch.Tensor:
        return self.model.infer(envelopes)


def export(checkpoint: Path, output_path: Path, cfg: dict, max_frames: int) -> None:
    device = torch.device("cpu")
    model_cfg = cfg.get("model", {})
    sd = torch.load(checkpoint, map_location=device, weights_only=True)

    first_conv_key = next(
        k for k in ("conv.0.0.conv.weight", "conv.0.conv.weight", "conv.0.weight") if k in sd
    )
    in_channels = sd[first_conv_key].shape[1]
    gru_hidden = sd["gru_fwd.weight_ih_l0"].shape[0] // 3
    gru_layers = model_cfg.get("gru_layers", 2)
    tcn_blocks = model_cfg.get("tcn_blocks", 4)
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

    wrapper = _FullWrapper(model)
    wrapper.eval()

    envelopes = torch.zeros(1, max_frames, in_channels)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        wrapper,
        (envelopes,),
        str(output_path),
        input_names=["envelopes"],
        output_names=["log_probs"],
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

    size_mb = output_path.stat().st_size / (1024 ** 2)
    print(f"Exported: {output_path}  ({size_mb:.1f} MB)")
    print(f"  Input  'envelopes': (1, {max_frames}, {in_channels})")
    print(f"  Output 'log_probs': (1, {max_frames // 2}, {NUM_CLASSES})")

    # Verify with random noise
    try:
        import onnxruntime as ort
    except ImportError:
        return
    rng = np.random.default_rng(42)
    x = rng.standard_normal((1, max_frames, in_channels)).astype(np.float32)
    with torch.no_grad():
        y_pt = wrapper(torch.from_numpy(x)).numpy()
    sess = ort.InferenceSession(str(output_path), providers=["CPUExecutionProvider"])
    y_ort = sess.run(None, {"envelopes": x})[0]
    diff = float(np.abs(y_pt - y_ort).max())
    status = "PASS" if diff < 1e-3 else "FAIL"
    print(f"Verification: max |pt - onnx| = {diff:.2e}  [{status}]")
    if status == "FAIL":
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--max-frames", type=int, default=8000,
                    help="Maximum envelope length at 500 Hz (default 8000 = 16s)")
    ap.add_argument("--out", default="checkpoints/cw_model_full.onnx")
    args = ap.parse_args()

    with open(args.config) as f:
        cfg = yaml.safe_load(f)
    export(Path(args.checkpoint), Path(args.out), cfg, args.max_frames)


if __name__ == "__main__":
    main()
