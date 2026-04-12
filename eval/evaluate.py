"""
Offline evaluation: load a checkpoint, run on val/test set, report CER by bucket.
"""

from __future__ import annotations

import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from data.dataset import CWDataset, collate_fn
from eval.decode import decode_batch
from model.cwnet import CWNet, NUM_CLASSES
from training.metrics import compute_cer, BucketTracker


def evaluate_checkpoint(
    checkpoint: Path,
    data_dir: Path,
    cfg: dict,
    out_json: Path | None = None,
) -> dict:
    """
    Evaluate a saved checkpoint on a dataset directory.
    Returns full bucket summary.
    """
    device = _get_device(cfg)

    model_cfg = cfg.get("model", {})
    sd = torch.load(checkpoint, map_location=device, weights_only=True)
    # Auto-detect in_channels from checkpoint
    in_channels = sd["conv.0.weight"].shape[1]
    model = CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=model_cfg.get("gru_hidden", 128),
        gru_layers=model_cfg.get("gru_layers", 2),
        dropout=0.0,
        in_channels=in_channels,
    )
    model.load_state_dict(sd)
    model = model.to(device)
    model.eval()

    ds = CWDataset(str(data_dir), augment=False)
    loader = DataLoader(
        ds,
        batch_size=cfg.get("training", {}).get("batch_size", 32),
        shuffle=False,
        collate_fn=collate_fn,
        num_workers=cfg.get("training", {}).get("num_workers", 2),
    )

    tracker = BucketTracker()
    sample_results = []

    with torch.no_grad():
        for inputs, targets, input_lengths, target_lengths, _frame_labels, meta in loader:
            results = decode_batch(model, inputs, input_lengths.tolist(), device)

            tgt_list  = targets.tolist()
            tgt_lens  = target_lengths.tolist()
            pos = 0
            for b_idx, tgt_len in enumerate(tgt_lens):
                tgt_indices = tgt_list[pos: pos + tgt_len]
                pos += tgt_len

                pred = results[b_idx]
                cer = compute_cer(pred.indices, tgt_indices)
                tracker.add(
                    cer,
                    snr_db=meta["snr_db"][b_idx],
                    wpm=meta["wpm"][b_idx],
                    impairment=meta["impairment"][b_idx],
                )
                sample_results.append({
                    "text": meta["text"][b_idx],
                    "pred": pred.text,
                    "cer": round(cer, 4),
                    "confidence": round(pred.confidence, 4),
                    "wpm": meta["wpm"][b_idx],
                    "snr_db": meta["snr_db"][b_idx],
                    "impairment": meta["impairment"][b_idx],
                })

    summary = tracker.summary()
    summary["samples"] = sample_results

    if out_json is not None:
        out_json.parent.mkdir(parents=True, exist_ok=True)
        with open(out_json, "w") as f:
            json.dump(summary, f, indent=2)
        print(f"Saved evaluation results → {out_json}")

    _print_summary(summary)
    return summary


def _print_summary(s: dict):
    print(f"\n=== Evaluation Results ===")
    print(f"Overall CER: {s['overall']:.4f}  (n={s['n']})")
    print("\nBy SNR:")
    for k, v in s.get("snr", {}).items():
        print(f"  {k:12s}: {v:.4f}")
    print("\nBy WPM:")
    for k, v in s.get("wpm", {}).items():
        print(f"  {k:8s}: {v:.4f}")
    print("\nBy Impairment:")
    for k, v in s.get("impairment", {}).items():
        print(f"  {k:14s}: {v:.4f}")


def _get_device(cfg: dict) -> torch.device:
    pref = cfg.get("device", "auto")
    if pref == "auto":
        if torch.backends.mps.is_available():
            return torch.device("mps")
        elif torch.cuda.is_available():
            return torch.device("cuda")
        else:
            return torch.device("cpu")
    return torch.device(pref)
