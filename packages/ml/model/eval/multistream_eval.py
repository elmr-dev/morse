"""
Evaluate the production CWNet on the multi-stream eval set.

For each NPZ in eval/multistream_data/, loop over each stream as the
"target": run DSP at the stream's tone_freq, run model inference, greedy
CTC decode, score CER vs ground-truth text. Track per-stream-context
(n_streams, separation, snr, strength_pattern, is_primary) and per-call
wall time + peak memory.

Output: per-(n_streams, snr_tier, separation, ...) CER tables + perf
profile, both printed and saved as JSON.

Usage:
    uv run python eval/multistream_eval.py \\
        --checkpoint /tmp/cw-runs/long-mf/4090_best.pt \\
        --out-json eval/results/multistream_$(date +%Y%m%d_%H%M%S).json
    # quick sanity:
    uv run python eval/multistream_eval.py --checkpoint ... --limit 5 --verbose
"""
from __future__ import annotations

import argparse
import json
import resource
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

# Make `model.cwnet`, `data.dsp`, etc. importable when run from packages/ml/model/
sys.path.insert(0, str(Path(__file__).parent.parent))

from data.dsp import extract_envelope                   # 4-channel DSP
from eval.decode import decode_batch
from model.cwnet import CWNet, NUM_CLASSES, char_to_idx, idx_to_char
from training.metrics import compute_cer


# ============================================================================
# Helpers
# ============================================================================

def _get_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _load_model(checkpoint_path: Path, device: torch.device) -> CWNet:
    sd = torch.load(checkpoint_path, map_location=device, weights_only=True)
    # Same auto-detection block as eval/evaluate.py — works regardless of config.
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
        gru_layers=2,
        dropout=0.0,
        in_channels=in_channels,
        tcn_channels=tcn_channels,
        tcn_blocks=tcn_blocks,
    )
    model.load_state_dict(sd)
    model = model.to(device).eval()
    print(f"  Loaded {checkpoint_path.name}: in_channels={in_channels}, "
          f"tcn={tcn_blocks}×{tcn_channels}, gru={gru_hidden}, "
          f"params={sum(p.numel() for p in model.parameters()):,}")
    return model


def _text_to_indices(text: str) -> list[int]:
    return [char_to_idx[c] for c in text.upper() if c in char_to_idx]


def _peak_rss_mb() -> float:
    # On macOS getrusage returns bytes; on Linux returns kbytes. Detect via magnitude.
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss / (1024 * 1024) if rss > 1_000_000 else rss / 1024


def _bin_snr(snr: float) -> str:
    if snr <= -8:   return "≤-8dB"
    if snr <= -4:   return "-8..-4dB"
    if snr <= 0:    return "-4..0dB"
    if snr <= 4:    return "0..4dB"
    return ">4dB"


def _stats(vals: list[float]) -> dict:
    if not vals:
        return {"n": 0}
    s = sorted(vals)
    n = len(s)
    return {
        "n": n,
        "mean": round(sum(s) / n, 4),
        "median": round(s[n // 2], 4),
        "p90": round(s[min(n - 1, int(0.9 * n))], 4),
    }


# ============================================================================
# Per-sample, per-stream decode
# ============================================================================

@torch.no_grad()
def _decode_one_stream(model, audio_8k: np.ndarray, tone_freq: float,
                       device: torch.device) -> tuple[str, float, float]:
    """Run DSP + inference + greedy decode on a single (audio, tone_freq)
    pair. Returns (decoded_text, dsp_ms, model_ms)."""
    # DSP
    t0 = time.perf_counter()
    env = extract_envelope(audio_8k, sample_rate=8000, tone_freq=float(tone_freq))
    dsp_ms = (time.perf_counter() - t0) * 1000.0

    # Inference (batch of 1)
    t1 = time.perf_counter()
    x = torch.from_numpy(env).unsqueeze(0).to(device)   # (1, T, C)
    results = decode_batch(model, x, input_lengths=[env.shape[0]], device=device)
    if device.type == "mps":
        torch.mps.synchronize()
    elif device.type == "cuda":
        torch.cuda.synchronize()
    model_ms = (time.perf_counter() - t1) * 1000.0

    return results[0].text, dsp_ms, model_ms


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--data-dir", type=Path,
                        default=Path(__file__).parent / "multistream_data")
    parser.add_argument("--out-json", type=Path, default=None)
    parser.add_argument("--limit", type=int, default=None,
                        help="Decode only the first N samples (sanity check)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    device = _get_device()
    print(f"Device: {device}")
    model = _load_model(args.checkpoint, device)

    sample_paths = sorted(args.data_dir.glob("sample_*.npz"))
    if args.limit:
        sample_paths = sample_paths[:args.limit]
    print(f"Decoding {len(sample_paths)} samples\n")

    # Per-(target-stream) records
    rows: list[dict] = []
    dsp_times: list[float] = []
    model_times: list[float] = []
    sample_total_times: list[float] = []     # sequential sum across streams in one sample

    t_start_total = time.perf_counter()

    for p in sample_paths:
        d = np.load(p, allow_pickle=True)
        audio = d["audio"].astype(np.float32)
        n_streams = int(d["n_streams"])
        sep = int(d["separation_hz"])
        snr_target = float(d["snr_target_db"])
        strength = str(d["strength_pattern"])

        sample_total = 0.0
        for k in range(n_streams):
            tone_freq = float(d["stream_tone_freq"][k])
            gt_text = str(d["stream_text"][k]).upper()
            stream_snr = float(d["stream_snr_db"][k])
            is_primary = bool(d["stream_is_primary"][k])
            rel_amp = float(d["stream_rel_amp_db"][k])

            pred_text, dsp_ms, model_ms = _decode_one_stream(
                model, audio, tone_freq, device,
            )
            cer = compute_cer(_text_to_indices(pred_text), _text_to_indices(gt_text))

            dsp_times.append(dsp_ms)
            model_times.append(model_ms)
            sample_total += dsp_ms + model_ms

            rows.append({
                "sample_idx": int(p.stem.split("_")[-1]),
                "n_streams": n_streams,
                "separation_hz": sep,
                "snr_target_db": snr_target,
                "strength_pattern": strength,
                "stream_idx": k,
                "is_primary": is_primary,
                "tone_freq": tone_freq,
                "rel_amp_db": rel_amp,
                "stream_snr_db": round(stream_snr, 2),
                "snr_tier": _bin_snr(stream_snr),
                "gt_text": gt_text,
                "pred_text": pred_text,
                "cer": round(cer, 4),
                "dsp_ms": round(dsp_ms, 2),
                "model_ms": round(model_ms, 2),
            })

            if args.verbose:
                marker = "★" if is_primary else " "
                print(f"  {p.stem} stream[{k}]{marker} freq={tone_freq:>5.0f} "
                      f"snr={stream_snr:+5.1f}dB cer={cer:.3f}  "
                      f"dsp={dsp_ms:5.1f}ms model={model_ms:5.1f}ms")
                print(f"    gt:   {gt_text!r}")
                print(f"    pred: {pred_text!r}")

        sample_total_times.append(sample_total)

    wall_total = time.perf_counter() - t_start_total

    # ------------------------------------------------------------------
    # Aggregations
    # ------------------------------------------------------------------
    by_n: dict[int, list[float]] = defaultdict(list)
    by_n_x_snr: dict[tuple[int, str], list[float]] = defaultdict(list)
    by_n_x_sep: dict[tuple[int, int], list[float]] = defaultdict(list)
    by_n_x_strength: dict[tuple[int, str], list[float]] = defaultdict(list)
    by_primary: dict[tuple[int, bool], list[float]] = defaultdict(list)
    by_n_x_strength_x_primary: dict[tuple[int, str, bool], list[float]] = defaultdict(list)

    for r in rows:
        n = r["n_streams"]
        by_n[n].append(r["cer"])
        by_n_x_snr[(n, r["snr_tier"])].append(r["cer"])
        by_n_x_sep[(n, r["separation_hz"])].append(r["cer"])
        by_n_x_strength[(n, r["strength_pattern"])].append(r["cer"])
        by_primary[(n, r["is_primary"])].append(r["cer"])
        by_n_x_strength_x_primary[(n, r["strength_pattern"], r["is_primary"])].append(r["cer"])

    summary = {
        "checkpoint": str(args.checkpoint),
        "n_samples_decoded": len(sample_paths),
        "n_stream_decodes": len(rows),
        "wall_clock_s": round(wall_total, 2),
        "peak_rss_mb": round(_peak_rss_mb(), 1),
        "by_n_streams": {n: _stats(v) for n, v in sorted(by_n.items())},
        "by_n_x_snr_tier": {
            f"n={n} {tier}": _stats(v)
            for (n, tier), v in sorted(by_n_x_snr.items())
        },
        "by_n_x_separation": {
            f"n={n} sep={sep}Hz": _stats(v)
            for (n, sep), v in sorted(by_n_x_sep.items())
        },
        "by_n_x_strength": {
            f"n={n} {strength}": _stats(v)
            for (n, strength), v in sorted(by_n_x_strength.items())
        },
        "by_n_x_primary": {
            f"n={n} primary={is_p}": _stats(v)
            for (n, is_p), v in sorted(by_primary.items())
        },
        "weak_target_breakdown": {
            f"n={n} {strength} primary={is_p}": _stats(v)
            for (n, strength, is_p), v in sorted(by_n_x_strength_x_primary.items())
        },
        "perf": {
            "dsp_ms":   _stats(dsp_times),
            "model_ms": _stats(model_times),
            "per_sample_total_ms_sequential": _stats(sample_total_times),
            "real_time_factor_sequential": round(
                statistics.mean(sample_total_times) / 8000.0, 4
            ),  # avg_total_ms / audio_duration_ms (8 sec → 8000 ms)
        },
        "sample_rows": rows if len(rows) <= 1000 else None,   # full per-decode log if small
    }

    # ------------------------------------------------------------------
    # Print
    # ------------------------------------------------------------------
    print()
    print("=" * 70)
    print(f"Decoded {len(sample_paths)} samples → {len(rows)} per-stream decodes "
          f"in {wall_total:.1f}s; peak RSS {summary['peak_rss_mb']:.0f} MB")
    print("=" * 70)

    print("\n--- CER by n_streams ---")
    for n, st in summary["by_n_streams"].items():
        print(f"  n={n}: mean={st['mean']:.4f}  median={st['median']:.4f}  "
              f"p90={st['p90']:.4f}  (n={st['n']} decodes)")

    print("\n--- CER by n_streams × per-stream SNR tier ---")
    for k, st in summary["by_n_x_snr_tier"].items():
        print(f"  {k:24s}: mean={st['mean']:.4f}  (n={st['n']})")

    print("\n--- CER by n_streams × separation ---")
    for k, st in summary["by_n_x_separation"].items():
        print(f"  {k:18s}: mean={st['mean']:.4f}  (n={st['n']})")

    print("\n--- CER by n_streams × strength_pattern ---")
    for k, st in summary["by_n_x_strength"].items():
        print(f"  {k:22s}: mean={st['mean']:.4f}  (n={st['n']})")

    print("\n--- CER weak_target breakdown (primary = the weak one) ---")
    for k, st in summary["weak_target_breakdown"].items():
        if "weak_target" in k:
            print(f"  {k:42s}: mean={st['mean']:.4f}  (n={st['n']})")

    print("\n--- Performance ---")
    print(f"  DSP   ms: mean={summary['perf']['dsp_ms']['mean']:.1f}  "
          f"median={summary['perf']['dsp_ms']['median']:.1f}  "
          f"p90={summary['perf']['dsp_ms']['p90']:.1f}")
    print(f"  Model ms: mean={summary['perf']['model_ms']['mean']:.1f}  "
          f"median={summary['perf']['model_ms']['median']:.1f}  "
          f"p90={summary['perf']['model_ms']['p90']:.1f}")
    print(f"  Per-sample (sequential, sum over streams):")
    print(f"           mean={summary['perf']['per_sample_total_ms_sequential']['mean']:.1f}ms  "
          f"p90={summary['perf']['per_sample_total_ms_sequential']['p90']:.1f}ms")
    print(f"  Real-time factor (sequential): "
          f"{summary['perf']['real_time_factor_sequential']:.4f}  "
          f"(< 1.0 = decodes faster than wall-clock audio duration)")

    if args.out_json:
        args.out_json.parent.mkdir(parents=True, exist_ok=True)
        with open(args.out_json, "w") as f:
            json.dump(summary, f, indent=2)
        print(f"\nWrote {args.out_json}")


if __name__ == "__main__":
    main()
