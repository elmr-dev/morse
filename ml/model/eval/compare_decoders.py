"""
Compare two or more eval JSONs side-by-side.

Reads `runs/*.json` produced by evaluate_checkpoint, prints per-SNR-1dB-bin
deltas in CER, ins/char, del/char, sub/char, and length-ratio between a
named baseline and one or more candidates.

Usage:
    uv run python -m eval.compare_decoders \
        --baseline runs/baseline_4ch_local.json \
        --candidate runs/hsmm_model_blank_oracle.json \
        --candidate runs/hsmm_dsp_ch0_oracle.json \
        --label-baseline greedy \
        --label-candidate hsmm-model-oracle \
        --label-candidate hsmm-dsp-oracle
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


def load(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def per_snr_1db(samples: list[dict]) -> dict:
    """Aggregate per-1dB-SNR-bin metrics from a samples list."""
    bins: dict[int, dict] = {}
    for s in samples:
        if "snr_db" not in s:
            continue
        k = int(math.floor(float(s["snr_db"])))
        b = bins.setdefault(k, {"n": 0, "cer_sum": 0.0,
                                "n_ins": 0, "n_del": 0, "n_sub": 0,
                                "target_len": 0, "pred_len": 0})
        b["n"] += 1
        b["cer_sum"] += float(s.get("cer", 0.0))
        for k_op in ("n_ins", "n_del", "n_sub", "target_len", "pred_len"):
            if k_op in s:
                b[k_op] += int(s[k_op])
    out: dict[int, dict] = {}
    for k, b in bins.items():
        if b["n"] == 0:
            continue
        tl = max(b["target_len"], 1)
        out[k] = {
            "n": b["n"],
            "mean_cer": b["cer_sum"] / b["n"],
            "ins_per_char": b["n_ins"] / tl,
            "del_per_char": b["n_del"] / tl,
            "sub_per_char": b["n_sub"] / tl,
            "len_ratio": b["pred_len"] / tl,
            "target_len_total": b["target_len"],
        }
    return out


def overall_low_snr(samples: list[dict], snr_max: float = -10.0) -> dict:
    """Aggregate metrics for the SNR <= snr_max tier."""
    n = 0
    cer_sum = 0.0
    n_ins = n_del = n_sub = target_len = pred_len = 0
    for s in samples:
        if float(s.get("snr_db", 99)) > snr_max:
            continue
        n += 1
        cer_sum += float(s.get("cer", 0.0))
        n_ins += int(s.get("n_ins", 0))
        n_del += int(s.get("n_del", 0))
        n_sub += int(s.get("n_sub", 0))
        target_len += int(s.get("target_len", 0))
        pred_len += int(s.get("pred_len", 0))
    if n == 0:
        return {"n": 0}
    tl = max(target_len, 1)
    return {
        "n": n, "mean_cer": cer_sum / n,
        "ins_per_char": n_ins / tl,
        "del_per_char": n_del / tl,
        "sub_per_char": n_sub / tl,
        "len_ratio": pred_len / tl,
        "n_ins": n_ins, "n_del": n_del, "n_sub": n_sub,
    }


def fmt(v: float, n: int = 4) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "—".rjust(n + 3)
    return f"{v:.{n}f}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", required=True, type=Path)
    ap.add_argument("--candidate", action="append", default=[], type=Path,
                    help="One or more candidate JSONs (repeatable)")
    ap.add_argument("--label-baseline", default="baseline")
    ap.add_argument("--label-candidate", action="append", default=[],
                    help="Display labels (one per --candidate)")
    args = ap.parse_args(argv)

    base = load(args.baseline)
    base_samples = base.get("samples", [])
    base_per_snr = per_snr_1db(base_samples)
    base_low = overall_low_snr(base_samples)

    cands = []
    for i, p in enumerate(args.candidate):
        d = load(p)
        label = args.label_candidate[i] if i < len(args.label_candidate) else p.stem
        cands.append((label, d))

    # Header + overall summary
    print(f"{'Run':<28} {'Overall':>10} {'≤-10dB':>10} {'ins/c≤-10':>12} {'del/c≤-10':>12} {'sub/c≤-10':>12} {'lenR≤-10':>11}")
    print("-" * 100)
    print(f"{args.label_baseline:<28} "
          f"{fmt(base.get('overall', float('nan'))):>10} "
          f"{fmt(base_low.get('mean_cer', float('nan'))):>10} "
          f"{fmt(base_low.get('ins_per_char', float('nan'))):>12} "
          f"{fmt(base_low.get('del_per_char', float('nan'))):>12} "
          f"{fmt(base_low.get('sub_per_char', float('nan'))):>12} "
          f"{fmt(base_low.get('len_ratio', float('nan'))):>11}")
    for label, d in cands:
        cs = d.get("samples", [])
        c_low = overall_low_snr(cs)
        print(f"{label:<28} "
              f"{fmt(d.get('overall', float('nan'))):>10} "
              f"{fmt(c_low.get('mean_cer', float('nan'))):>10} "
              f"{fmt(c_low.get('ins_per_char', float('nan'))):>12} "
              f"{fmt(c_low.get('del_per_char', float('nan'))):>12} "
              f"{fmt(c_low.get('sub_per_char', float('nan'))):>12} "
              f"{fmt(c_low.get('len_ratio', float('nan'))):>11}")

    # Per-1dB-bin CER comparison
    print()
    print("Per-1dB-bin mean CER (Δ from baseline; negative = candidate better):")
    print(f"{'SNR bin':>10} {'n':>5} {args.label_baseline:>12} ", end="")
    for label, _ in cands:
        print(f"{label:>14} {'Δ':>8}", end="")
    print()
    for k in sorted(base_per_snr.keys()):
        b = base_per_snr[k]
        print(f"{k:+d}..{k+1:+d}dB ".rjust(10) + f"{b['n']:>5d} {b['mean_cer']:>12.4f} ", end="")
        for label, d in cands:
            cs_per = per_snr_1db(d.get("samples", []))
            c = cs_per.get(k)
            if c is None:
                print(f"{'—':>14} {'—':>8}", end="")
            else:
                delta = c['mean_cer'] - b['mean_cer']
                print(f"{c['mean_cer']:>14.4f} {delta:+8.4f}", end="")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
