"""
CW Model — main CLI entry point.

Commands:
  generate   Generate training samples (WAV → DSP → .npz)
  train      Train on a pre-generated dataset
  evaluate   Evaluate a checkpoint on a dataset
  export     Export checkpoint to ONNX
  verify     Verify dataset: shapes, ranges, decode one batch
  pipeline   Full generate + train in one command

Usage:
  uv run python main.py generate --config configs/debug.yaml
  uv run python main.py train    --config configs/debug.yaml
  uv run python main.py evaluate --config configs/base.yaml --checkpoint runs/.../phase_best.pt
  uv run python main.py export   --config configs/base.yaml --checkpoint runs/.../phase_best.pt
  uv run python main.py verify   --config configs/debug.yaml
  uv run python main.py pipeline --config configs/debug.yaml
"""

from __future__ import annotations

import os
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("PYTORCH_ALLOC_CONF", "expandable_segments:True")

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import yaml


def load_config(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


# ---- Commands ----------------------------------------------------------------

def cmd_generate(args: argparse.Namespace, cfg: dict):
    from data.generate import generate_dataset

    data_cfg = cfg["data"]
    paths = cfg["paths"]

    for split, n_key, seed_offset in [
        ("train", "n_train", 0),
        ("val",   "n_val",   99999),
    ]:
        n = data_cfg[n_key]
        if n == 0:
            continue
        out_dir = Path(paths[f"{split}_dir"])
        seed = data_cfg.get("seed", 42) + seed_offset
        generate_dataset(n, out_dir, data_cfg, seed=seed)


def cmd_train(args: argparse.Namespace, cfg: dict):
    import torch
    from datetime import datetime
    from training.train import build_model, train_phase

    paths   = cfg["paths"]
    run_dir = Path(paths["run_dir"]) / datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)

    log_file = open(run_dir / "train.log", "w", buffering=1)

    class _Tee:
        def __init__(self, stream):
            self._stream = stream
        def write(self, data):
            self._stream.write(data)
            log_file.write(data)
        def flush(self):
            self._stream.flush()
            log_file.flush()
        def __getattr__(self, name):
            return getattr(self._stream, name)

    sys.stdout = _Tee(sys.stdout)
    sys.stderr = _Tee(sys.stderr)

    model = build_model(cfg)
    print(f"Model parameters: {model.count_parameters():,}")

    if args.starting_checkpoint:
        starting_ckpt = Path(args.starting_checkpoint)
    elif Path("checkpoints/base.pt").exists():
        starting_ckpt = Path("checkpoints/base.pt")
        print(f"[train] Auto-loading starting checkpoint: checkpoints/base.pt")
    else:
        starting_ckpt = None

    best_cer = train_phase(
        model=model,
        train_dir=Path(paths["train_dir"]),
        val_dir=Path(paths["val_dir"]),
        out_dir=run_dir,
        cfg=cfg,
        phase_name=cfg.get("name", "phase"),
        starting_checkpoint=starting_ckpt,
    )
    print(f"\nTraining complete. Best val CER: {best_cer:.4f}")


def cmd_evaluate(args: argparse.Namespace, cfg: dict):
    from eval.evaluate import evaluate_checkpoint

    checkpoint = Path(args.checkpoint)
    data_dir   = Path(args.data_dir) if args.data_dir else Path(cfg["paths"]["val_dir"])
    out_json   = Path(args.out_json) if args.out_json else None

    evaluate_checkpoint(checkpoint, data_dir, cfg, out_json=out_json)


def cmd_export(args: argparse.Namespace, cfg: dict):
    from scripts.export_onnx import export_onnx

    checkpoint = Path(args.checkpoint)
    out_path   = Path(args.out) if args.out else Path("checkpoints/cw_model.onnx")
    export_onnx(checkpoint, out_path, cfg)


def cmd_verify(args: argparse.Namespace, cfg: dict):
    """Quick sanity check: load data, forward pass, compute CTC loss."""
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader

    from data.dataset import CWDataset, collate_fn
    from model.cwnet import CWNet, NUM_CLASSES
    from training.metrics import greedy_decode, indices_to_str

    paths   = cfg["paths"]
    train_dir = Path(paths["train_dir"])

    if not train_dir.exists():
        print(f"No data at {train_dir} — run 'generate' first")
        sys.exit(1)

    ds = CWDataset(str(train_dir))
    print(f"Dataset: {len(ds)} samples")

    sample = ds[0]
    print(f"  Input shape:   {tuple(sample['input'].shape)}")
    print(f"  Target length: {sample['target_length']}")
    print(f"  Text:          '{sample['text']}'")
    print(f"  WPM:           {sample['wpm']:.1f}")
    print(f"  SNR:           {sample['snr_db']:.1f} dB")
    print(f"  Envelope min/max: {sample['input'].min():.3f} / {sample['input'].max():.3f}")

    loader = DataLoader(ds, batch_size=4, collate_fn=collate_fn, num_workers=0)
    inputs, targets, input_lengths, target_lengths, frame_labels, meta = next(iter(loader))

    device = _auto_device()
    print(f"\nDevice: {device}")

    model_cfg = cfg.get("model", {})
    model = CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=model_cfg.get("gru_hidden", 128),
        gru_layers=model_cfg.get("gru_layers", 2),
        dropout=0.0,
        in_channels=model_cfg.get("in_channels", 1),
    ).to(device)
    print(f"Parameters: {model.count_parameters():,}")

    inputs = inputs.to(device)
    with torch.no_grad():
        log_probs = model(inputs)

    print(f"\nForward pass OK")
    print(f"  Input shape:  {tuple(inputs.shape)}")
    print(f"  Output shape: {tuple(log_probs.shape)}")

    log_probs_ctc = log_probs.transpose(0, 1).cpu()
    ctc = nn.CTCLoss(blank=0, zero_infinity=False)
    loss = ctc(log_probs_ctc, targets, input_lengths, target_lengths)
    print(f"  CTC loss:     {loss.item():.4f}")

    decoded = greedy_decode(log_probs_ctc)
    print(f"\nGreedy decode (untrained):")
    for i, (dec, txt) in enumerate(zip(decoded, meta["text"])):
        print(f"  [{i}] target='{txt}'  pred='{indices_to_str(dec)}'")

    # Verify streaming forward_chunk shape
    from model.cwnet import CHUNK_FRAMES, LOOKAHEAD_FRAMES
    in_ch = model_cfg.get("in_channels", 1)
    gru_h = model_cfg.get("gru_hidden", 128)
    gru_l = model_cfg.get("gru_layers", 2)
    chunk_input = torch.zeros(1, CHUNK_FRAMES + LOOKAHEAD_FRAMES, in_ch, device=device)
    hidden = torch.zeros(gru_l, 1, gru_h, device=device)
    with torch.no_grad():
        lp, h_new = model.forward_chunk(chunk_input, hidden)
    print(f"\nforward_chunk OK")
    print(f"  Input:      (1, {CHUNK_FRAMES + LOOKAHEAD_FRAMES}, {in_ch})")
    print(f"  log_probs:  {tuple(lp.shape)}")
    print(f"  fwd_hidden: {tuple(h_new.shape)}")

    print("\n✓ Verify complete — pipeline is functional")


def cmd_decode(args: argparse.Namespace, cfg: dict):
    """Decode a WAV file with a trained checkpoint."""
    import torch
    import numpy as np

    from data.dsp import process_wav
    from model.cwnet import CWNet, NUM_CLASSES
    from eval.decode import greedy_decode_with_confidence

    wav_path   = Path(args.wav)
    checkpoint = Path(args.checkpoint)
    freq       = args.freq

    if not wav_path.exists():
        print(f"ERROR: WAV file not found: {wav_path}", file=sys.stderr)
        sys.exit(1)
    if not checkpoint.exists():
        print(f"ERROR: Checkpoint not found: {checkpoint}", file=sys.stderr)
        sys.exit(1)

    print(f"WAV:        {wav_path}")
    print(f"Tone freq:  {freq} Hz")
    env = process_wav(str(wav_path), float(freq))
    print(f"Envelope:   {env.shape}  ({env.shape[0]/500:.1f}s at 500 Hz)")

    device = _auto_device()
    model_cfg = cfg.get("model", {})
    sd = torch.load(checkpoint, map_location=device, weights_only=True)
    in_channels = sd["conv.0.weight"].shape[1]
    model = CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=model_cfg.get("gru_hidden", 128),
        gru_layers=model_cfg.get("gru_layers", 2),
        dropout=0.0,
        in_channels=in_channels,
    ).to(device)
    model.load_state_dict(sd)
    model.eval()
    print(f"Checkpoint: {checkpoint}  ({in_channels}-channel, {model.count_parameters():,} params)")

    x = torch.tensor(env, dtype=torch.float32).unsqueeze(0).to(device)
    log_probs = model.infer(x)[0]

    result = greedy_decode_with_confidence(log_probs)
    print(f"\nDecoded:    {result.text!r}")
    print(f"Confidence: {result.confidence:.3f}")


def cmd_pipeline(args: argparse.Namespace, cfg: dict):
    """Generate + train in one step."""
    print("=== GENERATE ===")
    cmd_generate(args, cfg)
    print("\n=== TRAIN ===")
    cmd_train(args, cfg)


def _auto_device():
    import torch
    if torch.backends.mps.is_available():
        return torch.device("mps")
    elif torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


# ---- Argument parsing --------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="CW Model training pipeline")
    parser.add_argument("command", choices=["generate", "train", "evaluate",
                                             "export", "verify", "pipeline", "decode"])
    parser.add_argument("--config", required=True, help="Path to YAML config")
    parser.add_argument("--checkpoint", help="Checkpoint .pt file")
    parser.add_argument("--starting-checkpoint", help="Warm-start training from this checkpoint")
    parser.add_argument("--data-dir",  help="Override val/test data dir")
    parser.add_argument("--out-json",  help="Save eval results to JSON")
    parser.add_argument("--wav",  help="WAV file to decode")
    parser.add_argument("--freq", type=float, default=600.0,
                        help="CW tone frequency in Hz (default: 600)")
    parser.add_argument("--out", help="Output path for ONNX model")

    args = parser.parse_args()
    cfg  = load_config(args.config)

    commands = {
        "generate": cmd_generate,
        "train":    cmd_train,
        "evaluate": cmd_evaluate,
        "export":   cmd_export,
        "verify":   cmd_verify,
        "pipeline": cmd_pipeline,
        "decode":   cmd_decode,
    }
    commands[args.command](args, cfg)


if __name__ == "__main__":
    main()
