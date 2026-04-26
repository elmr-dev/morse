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
from training.metrics import compute_cer, compute_edit_breakdown, BucketTracker


def evaluate_checkpoint(
    checkpoint: Path,
    data_dir: Path,
    cfg: dict,
    out_json: Path | None = None,
    decoder: str = "greedy",
    emission: str = "model_blank",
    wpm_mode: str = "oracle",
    dsp_calib: dict | None = None,
    wpm_grid: tuple[float, float, float] = (12.0, 60.0, 2.0),
) -> dict:
    """
    Evaluate a saved checkpoint on a dataset directory.

    decoder/emission/wpm_mode are the HSMM-comparison knobs:
      decoder    : "greedy" | "beam" | "hsmm"
      emission   : "model_blank" | "dsp_ch0"   (only matters for hsmm)
      wpm_mode   : "oracle" | "grid"           (only matters for hsmm)
      dsp_calib  : {"a": float, "b": float} from eval.emissions, required when
                   emission == "dsp_ch0".
      wpm_grid   : (start, stop, step) for HSMM grid search.

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
        for inputs, targets, input_lengths, target_lengths, _frame_labels, _tone_labels, meta in loader:
            wpms = list(meta["wpm"]) if (decoder == "hsmm" and wpm_mode == "oracle") else None
            results = decode_batch(
                model, inputs, input_lengths.tolist(), device,
                decoder=decoder,
                emission=emission,
                dsp_calib=dsp_calib,
                wpms=wpms,
                wpm_grid=wpm_grid,
            )

            tgt_list  = targets.tolist()
            tgt_lens  = target_lengths.tolist()
            pos = 0
            for b_idx, tgt_len in enumerate(tgt_lens):
                tgt_indices = tgt_list[pos: pos + tgt_len]
                pos += tgt_len

                pred = results[b_idx]
                breakdown = compute_edit_breakdown(pred.text, meta["text"][b_idx])
                cer = breakdown["cer"]
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
                    "n_ins": breakdown["n_ins"],
                    "n_del": breakdown["n_del"],
                    "n_sub": breakdown["n_sub"],
                    "target_len": breakdown["target_len"],
                    "pred_len": breakdown["pred_len"],
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

    Produces:
      - snr_1db:                1 dB SNR bins
      - snr_1db_edit_ops:       per-SNR ins/del/sub sums and pred_len/target_len ratio
      - wpm_2wpm:               2 WPM bins
      - snr_x_wpm:              3 dB × 5 WPM cross-tab
      - confidence_calibration: confidence quantile bins → mean CER
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
    snr_ops: dict[int, dict] = defaultdict(lambda: {"n_ins": 0, "n_del": 0, "n_sub": 0,
                                                     "target_len": 0, "pred_len": 0, "n": 0})

    for s in samples:
        cer, snr, wpm = s["cer"], float(s["snr_db"]), float(s["wpm"])
        snr_1db[floor_bin(snr, 1)].append(cer)
        wpm_2[floor_bin(wpm, 2)].append(cer)
        cross[(floor_bin(snr, 3), floor_bin(wpm, 5))].append(cer)
        if "n_ins" in s:
            b = snr_ops[floor_bin(snr, 1)]
            b["n_ins"] += s["n_ins"]
            b["n_del"] += s["n_del"]
            b["n_sub"] += s["n_sub"]
            b["target_len"] += s["target_len"]
            b["pred_len"] += s["pred_len"]
            b["n"] += 1

    snr_1db_edit_ops = {}
    for k in sorted(snr_ops):
        b = snr_ops[k]
        tlen = max(b["target_len"], 1)
        snr_1db_edit_ops[f"{k:+d}..{k+1:+d}dB"] = {
            "n": b["n"],
            "n_ins": b["n_ins"],
            "n_del": b["n_del"],
            "n_sub": b["n_sub"],
            "target_len_total": b["target_len"],
            "pred_len_total": b["pred_len"],
            "ins_per_target_char": round(b["n_ins"] / tlen, 4),
            "del_per_target_char": round(b["n_del"] / tlen, 4),
            "sub_per_target_char": round(b["n_sub"] / tlen, 4),
            "len_ratio": round(b["pred_len"] / tlen, 4),
        }

    return {
        "snr_1db": {
            f"{k:+d}..{k+1:+d}dB": stats(v) for k, v in sorted(snr_1db.items())
        },
        "snr_1db_edit_ops": snr_1db_edit_ops,
        "wpm_2wpm": {
            f"{k}-{k+2}wpm": stats(v) for k, v in sorted(wpm_2.items())
        },
        "snr_x_wpm": {
            f"snr={snr:+d}..{snr+3:+d}dB,wpm={wpm}-{wpm+5}": stats(v)
            for (snr, wpm), v in sorted(cross.items())
        },
        "confidence_calibration": confidence_calibration(samples),
    }


def confidence_calibration(samples: list[dict], n_bins: int = 10) -> dict:
    """Bucket samples by confidence quantile, report mean CER per bucket.

    Confidence is well-calibrated when bin order matches CER order (low
    confidence → high CER). Mis-calibration (uniform CER across bins) means
    the confidence head has no signal value for abstention.
    """
    if not samples or "confidence" not in samples[0]:
        return {}
    pairs = sorted(((float(s["confidence"]), float(s["cer"])) for s in samples),
                   key=lambda p: p[0])
    n = len(pairs)
    out = {}
    for i in range(n_bins):
        lo = (i * n) // n_bins
        hi = ((i + 1) * n) // n_bins
        if lo >= hi:
            continue
        slc = pairs[lo:hi]
        confs = [p[0] for p in slc]
        cers = [p[1] for p in slc]
        out[f"q{i+1:02d}"] = {
            "n": len(slc),
            "conf_lo": round(confs[0], 4),
            "conf_hi": round(confs[-1], 4),
            "mean_conf": round(sum(confs) / len(confs), 4),
            "mean_cer": round(sum(cers) / len(cers), 4),
        }
    return out


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
