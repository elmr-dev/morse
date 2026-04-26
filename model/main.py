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
    elif Path("checkpoints/best.pt").exists():
        starting_ckpt = Path("checkpoints/best.pt")
        print(f"[train] Auto-loading starting checkpoint: checkpoints/best.pt")
    elif Path("checkpoints/base.pt").exists():
        starting_ckpt = Path("checkpoints/base.pt")
        print(f"[train] Auto-loading starting checkpoint: checkpoints/base.pt")
    else:
        starting_ckpt = None

    phase_name = cfg.get("name", "phase")
    best_cer = train_phase(
        model=model,
        train_dir=Path(paths["train_dir"]),
        val_dir=Path(paths["val_dir"]),
        out_dir=run_dir,
        cfg=cfg,
        phase_name=phase_name,
        starting_checkpoint=starting_ckpt,
    )
    print(f"\nTraining complete. Best val CER: {best_cer:.4f}")

    # Final granular eval on full val set with best checkpoint. Saved JSON
    # lands under run_dir and is picked up by the runpod S3 upload trap.
    best_ckpt = run_dir / f"{phase_name}_best.pt"
    if best_ckpt.exists():
        print(f"\n=== FINAL EVAL: {best_ckpt.name} on full val set ===")
        from eval.evaluate import evaluate_checkpoint
        evaluate_checkpoint(
            best_ckpt,
            Path(paths["val_dir"]),
            cfg,
            out_json=run_dir / "final_eval.json",
        )
    else:
        print(f"[final-eval] skipped — no best checkpoint at {best_ckpt}")


def cmd_evaluate(args: argparse.Namespace, cfg: dict):
    from eval.evaluate import evaluate_checkpoint
    import json

    checkpoint = Path(args.checkpoint)
    data_dir   = Path(args.data_dir) if args.data_dir else Path(cfg["paths"]["val_dir"])
    out_json   = Path(args.out_json) if args.out_json else None

    dsp_calib = None
    if args.dsp_calib:
        dsp_calib = json.load(open(args.dsp_calib))

    evaluate_checkpoint(
        checkpoint, data_dir, cfg, out_json=out_json,
        decoder=args.decoder,
        emission=args.emission,
        wpm_mode=args.wpm_mode,
        dsp_calib=dsp_calib,
    )


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
    inputs, targets, input_lengths, target_lengths, frame_labels, tone_labels, meta = next(iter(loader))

    device = _auto_device()
    print(f"\nDevice: {device}")

    model_cfg = cfg.get("model", {})
    model = CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=model_cfg.get("gru_hidden", 128),
        gru_layers=model_cfg.get("gru_layers", 2),
        dropout=0.0,
        in_channels=model_cfg.get("in_channels", 3),
        tcn_channels=model_cfg.get("tcn_channels", 128),
        tcn_blocks=model_cfg.get("tcn_blocks", 4),
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
    first_conv_key = next(
        k for k in ("conv.0.conv.weight", "conv.0.0.conv.weight", "conv.0.weight") if k in sd
    )
    in_channels = sd[first_conv_key].shape[1]
    gru_hidden = sd["gru_fwd.weight_ih_l0"].shape[0] // 3
    tcn_blocks = len({k.split(".")[1] for k in sd if k.startswith("tcn.")})
    tcn_channels = sd["tcn.0.conv1.conv.weight"].shape[0] if tcn_blocks else 128
    model = CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=gru_hidden,
        gru_layers=model_cfg.get("gru_layers", 2),
        dropout=0.0,
        in_channels=in_channels,
        tcn_channels=tcn_channels,
        tcn_blocks=tcn_blocks,
    ).to(device)
    model.load_state_dict(sd, strict=False)   # pre-Phase-3 checkpoints lack tone_head
    model.eval()
    print(f"Checkpoint: {checkpoint}  ({in_channels}-channel, {model.count_parameters():,} params)")

    x = torch.tensor(env, dtype=torch.float32).unsqueeze(0).to(device)
    log_probs = model.infer(x)[0]

    result = greedy_decode_with_confidence(log_probs)
    print(f"\nDecoded:    {result.text!r}")
    print(f"Confidence: {result.confidence:.3f}")


def _sanity_check_split(split: str, out_dir: Path, expected_n: int):
    """Thorough sanity-check of a generated split. Prints stats, returns nothing.

    Purpose: catch bad data before training wastes GPU hours.
    Looks for: missing files, empty/short envelopes, degenerate value distributions,
               label/envelope length mismatches, missing classes, text anomalies.
    """
    import numpy as np

    print(f"\n--- SANITY CHECK: {split} ({out_dir}) ---")

    files = sorted(out_dir.glob("sample_*.npz"))
    print(f"  Files found: {len(files)}  (expected {expected_n})")
    if len(files) == 0:
        print(f"  [FATAL] No .npz files in {out_dir}")
        return
    if len(files) < expected_n:
        print(f"  [WARN] Missing {expected_n - len(files)} sample(s) — silent DSP failures?")

    # Per-sample accumulators
    env_frames, env_min, env_max, env_mean, env_std = [], [], [], [], []
    env_nonzero_frac = []
    lbl_frames, lbl_nonzero_frac = [], []
    lbl_unique_union = set()
    env_lbl_ratio = []
    text_lens, wpms, snrs, impairments = [], [], [], []
    text_chars_union = set()
    zero_env_count = 0
    flat_env_count = 0
    empty_text_count = 0
    mismatch_len_count = 0
    errors = []

    for f in files:
        try:
            z = np.load(f, allow_pickle=True)
            env = z["envelopes"]
            lbl = z["frame_labels"]
            txt = str(z["text"])
            wpm = float(z["wpm"])
            snr = float(z["snr_db"])
            imp = str(z["impairment"]) if "impairment" in z.files else "?"
        except Exception as e:
            errors.append((f.name, str(e)))
            continue

        # Envelope shape/stats
        if env.ndim != 2 or env.shape[1] < 1:
            errors.append((f.name, f"unexpected envelope shape {env.shape}"))
            continue
        env0 = env[:, 0]
        env_frames.append(env.shape[0])
        env_min.append(float(env0.min()))
        env_max.append(float(env0.max()))
        env_mean.append(float(env0.mean()))
        env_std.append(float(env0.std()))
        env_nonzero_frac.append(float((env0 > 0.5).mean()))
        if env0.max() == 0.0:
            zero_env_count += 1
        if env0.std() < 1e-6:
            flat_env_count += 1

        # Label shape/stats
        lbl_frames.append(lbl.shape[0])
        lbl_nonzero_frac.append(float((lbl != 0).mean()))
        lbl_unique_union.update(lbl.tolist())

        # Cross-field: envelope frames should be 2× label frames (CNN stride-2)
        ratio = env.shape[0] / max(lbl.shape[0], 1)
        env_lbl_ratio.append(ratio)
        if abs(ratio - 2.0) > 0.01:
            mismatch_len_count += 1

        # Text / cfg
        text_lens.append(len(txt))
        text_chars_union.update(txt)
        if len(txt) == 0:
            empty_text_count += 1
        wpms.append(wpm)
        snrs.append(snr)
        impairments.append(imp)

    n_valid = len(env_frames)
    if n_valid == 0:
        print(f"  [FATAL] All {len(files)} files failed to load/parse")
        for fn, err in errors[:5]:
            print(f"    {fn}: {err}")
        return

    def stat(xs, unit=""):
        xs = np.array(xs, dtype=np.float64)
        return (f"min={xs.min():.3f}{unit}  p50={np.median(xs):.3f}{unit}  "
                f"mean={xs.mean():.3f}{unit}  max={xs.max():.3f}{unit}  std={xs.std():.3f}{unit}")

    # --- Envelope shape ---
    ef = np.array(env_frames)
    durs = ef / 500.0
    print(f"\n  [ENVELOPE SHAPE] (expect ~500 Hz, max_clip_s in config)")
    print(f"    frames : {stat(ef)}")
    print(f"    dur (s): {stat(durs, 's')}")
    # Histogram of durations
    bins = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20]
    hist, _ = np.histogram(durs, bins=bins)
    print(f"    dur histogram (s):")
    for i in range(len(hist)):
        bar = "█" * int(40 * hist[i] / max(hist.max(), 1))
        print(f"      [{bins[i]:>2}-{bins[i+1]:>2}]  {hist[i]:>6d}  {bar}")

    # --- Envelope values ---
    print(f"\n  [ENVELOPE VALUES] (expect min≈0, max≈1, mean~0.4-0.6 after sharpen)")
    print(f"    min  : {stat(env_min)}")
    print(f"    max  : {stat(env_max)}")
    print(f"    mean : {stat(env_mean)}")
    print(f"    std  : {stat(env_std)}")
    print(f"    frac(env>0.5): {stat(env_nonzero_frac)}")
    if zero_env_count:
        print(f"    [WARN] {zero_env_count} samples have all-zero envelopes")
    if flat_env_count:
        print(f"    [WARN] {flat_env_count} samples have ~zero-variance envelopes (flat)")

    # --- Labels ---
    print(f"\n  [FRAME LABELS] (expect ~250 Hz = env/2)")
    print(f"    frames         : {stat(lbl_frames)}")
    print(f"    env/lbl ratio  : {stat(env_lbl_ratio)}  (expect 2.0)")
    if mismatch_len_count:
        print(f"    [WARN] {mismatch_len_count} samples with ratio != 2.0")
    print(f"    nonzero frac   : {stat(lbl_nonzero_frac)}")
    print(f"    unique values  : {sorted(lbl_unique_union)[:20]}{'...' if len(lbl_unique_union)>20 else ''}")
    print(f"    n_unique       : {len(lbl_unique_union)}  (blank=0, chars 1-41)")

    # --- Text / metadata ---
    print(f"\n  [METADATA]")
    print(f"    text len       : {stat(text_lens)}")
    print(f"    unique chars   : {''.join(sorted(text_chars_union))}")
    if empty_text_count:
        print(f"    [WARN] {empty_text_count} samples with empty text")
    print(f"    WPM            : {stat(wpms)}")
    print(f"    SNR (dB)       : {stat(snrs)}")
    from collections import Counter
    imp_counts = Counter(impairments)
    print(f"    impairments    : {dict(imp_counts)}")

    # --- Errors ---
    if errors:
        print(f"\n  [LOAD ERRORS] {len(errors)}")
        for fn, err in errors[:5]:
            print(f"    {fn}: {err}")
        if len(errors) > 5:
            print(f"    ... and {len(errors)-5} more")

    # --- A few raw sample dumps: shortest, median, longest ---
    print(f"\n  [RAW DUMPS]")
    order = np.argsort(ef)
    pick_idx = [int(order[0]), int(order[len(order)//2]), int(order[-1])]
    for tag, i in zip(["shortest", "median  ", "longest "], pick_idx):
        f = files[i]
        z = np.load(f, allow_pickle=True)
        env = z["envelopes"][:, 0]
        lbl = z["frame_labels"]
        txt = str(z["text"])
        wpm = float(z["wpm"])
        snr = float(z["snr_db"])
        # 5-percentile bars of envelope
        bins = 20
        bsize = max(1, len(env) // bins)
        binned = env[:bsize*bins].reshape(bins, -1).max(axis=1) if len(env) >= bins else env
        bars = "".join("█" if v > 0.5 else ("▄" if v > 0.1 else ".") for v in binned)
        print(f"    {tag} ({f.name}): text={txt!r} wpm={wpm:.1f} snr={snr:.1f}dB "
              f"env_len={len(env)} lbl_len={len(lbl)}")
        print(f"      env silhouette: [{bars}]")


def cmd_pipeline(args: argparse.Namespace, cfg: dict):
    """Generate + train in one step."""
    print("=== GENERATE ===")
    cmd_generate(args, cfg)

    print("\n=== SANITY CHECK ===")
    data_cfg = cfg["data"]
    paths = cfg["paths"]
    for split, n_key in [("train", "n_train"), ("val", "n_val")]:
        n = data_cfg[n_key]
        if n == 0:
            continue
        _sanity_check_split(split, Path(paths[f"{split}_dir"]), n)

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
    parser.add_argument("--decoder", choices=["greedy", "beam", "hsmm"],
                        default="greedy", help="Eval decoder (default: greedy CTC)")
    parser.add_argument("--emission", choices=["model_blank", "dsp_ch0", "tone_head"],
                        default="model_blank", help="HSMM emission source")
    parser.add_argument("--wpm-mode", choices=["oracle", "grid"],
                        default="oracle", help="HSMM WPM strategy")
    parser.add_argument("--dsp-calib", help="Path to JSON with DSP ch0 logistic calibration")

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
