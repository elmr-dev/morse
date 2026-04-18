"""
Offline evaluation: load a checkpoint, run on val/test set, report CER by bucket.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
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
    # Auto-detect in_channels from the first conv layer's weight (shape: out_ch, in_ch, k).
    # _CausalConv1d wraps nn.Conv1d, so the stored key is "conv.0.conv.weight"; older
    # layouts used "conv.0.weight".
    # Auto-detect architecture dims from the checkpoint so eval works regardless
    # of the config passed in.
    first_conv_key = next(
        k for k in ("conv.0.conv.weight", "conv.0.0.conv.weight", "conv.0.weight") if k in sd
    )
    in_channels = sd[first_conv_key].shape[1]
    gru_hidden = sd["gru_fwd.weight_ih_l0"].shape[0] // 3
    tcn_block_ids = {k.split(".")[1] for k in sd if k.startswith("tcn.")}
    tcn_blocks = len(tcn_block_ids)
    tcn_channels = sd["tcn.0.conv1.conv.weight"].shape[0] if tcn_blocks else 128
    model = CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=gru_hidden,
        gru_layers=model_cfg.get("gru_layers", 2),
        dropout=0.0,
        in_channels=in_channels,
        tcn_channels=tcn_channels,
        tcn_blocks=tcn_blocks,
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
    summary["fine_breakdown"] = fine_grained_breakdown(sample_results)
    summary["samples"] = sample_results

    if out_json is not None:
        out_json.parent.mkdir(parents=True, exist_ok=True)
        with open(out_json, "w") as f:
            json.dump(summary, f, indent=2)
        print(f"Saved evaluation results → {out_json}")

    _print_summary(summary)
    return summary


def fine_grained_breakdown(samples: list[dict]) -> dict:
    """Granular SNR/WPM breakdown from per-sample CERs.

    Produces three views:
      - snr_1db:    1 dB SNR bins (where does it break down across SNR?)
      - wpm_2wpm:   2 WPM WPM bins (where does it break down across WPM?)
      - snr_x_wpm:  3 dB × 5 WPM cross-tab (joint degradation surface)
    """
    def floor_bin(val: float, width: float) -> int:
        return int(math.floor(val / width) * width)

    def stats(vals: list[float]) -> dict:
        if not vals:
            return {"n": 0, "mean_cer": None, "median_cer": None, "p90_cer": None}
        s = sorted(vals)
        n = len(s)
        return {
            "n": n,
            "mean_cer": round(sum(s) / n, 4),
            "median_cer": round(s[n // 2], 4),
            "p90_cer": round(s[min(n - 1, int(0.9 * n))], 4),
        }

    snr_1db: dict[int, list[float]] = defaultdict(list)
    wpm_2: dict[int, list[float]] = defaultdict(list)
    cross: dict[tuple[int, int], list[float]] = defaultdict(list)

    for s in samples:
        cer, snr, wpm = s["cer"], float(s["snr_db"]), float(s["wpm"])
        snr_1db[floor_bin(snr, 1)].append(cer)
        wpm_2[floor_bin(wpm, 2)].append(cer)
        cross[(floor_bin(snr, 3), floor_bin(wpm, 5))].append(cer)

    return {
        "snr_1db": {
            f"{k:+d}..{k+1:+d}dB": stats(v) for k, v in sorted(snr_1db.items())
        },
        "wpm_2wpm": {
            f"{k}-{k+2}wpm": stats(v) for k, v in sorted(wpm_2.items())
        },
        "snr_x_wpm": {
            f"snr={snr:+d}..{snr+3:+d}dB,wpm={wpm}-{wpm+5}": stats(v)
            for (snr, wpm), v in sorted(cross.items())
        },
    }


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
