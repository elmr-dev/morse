"""
Fit and evaluate a lightweight character-confidence calibrator.

The raw model confidence is currently overconfident because it is derived from
frame/beam probabilities, not empirical character correctness. This script:

1. Runs the checkpoint on an NPZ dataset.
2. Extracts CTC beam-posterior features for each emitted character.
3. Aligns emitted characters to ground truth to label correctness.
4. Fits logistic calibrators for character correctness and segment reliability.
5. Reports calibration, accuracy-vs-coverage, and suspect-segment metrics.

This is deliberately post-hoc: it tells us how much useful uncertainty signal
already exists in the current model/beam lattice before we retrain anything.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import Levenshtein
import numpy as np
import torch
import yaml

from eval.decode import beam_search_with_posteriors, greedy_decode_with_confidence
from model.cwnet import CHARS, CWNet, NUM_CLASSES


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--config", default="configs/base.yaml")
    p.add_argument("--checkpoint", default="checkpoints/best.pt")
    p.add_argument("--data-dir", required=True)
    p.add_argument("--limit", type=int, default=200)
    p.add_argument("--beam-width", type=int, default=50)
    p.add_argument("--prune-prob", type=float, default=1e-4)
    p.add_argument("--train-frac", type=float, default=0.7)
    p.add_argument("--seed", type=int, default=123)
    p.add_argument("--out-json", type=Path, default=None)
    return p.parse_args()


def load_config(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def load_model(checkpoint: Path, cfg: dict, device: torch.device) -> CWNet:
    sd = torch.load(checkpoint, map_location=device, weights_only=True)
    first_conv_key = next(
        k for k in ("conv.0.conv.weight", "conv.0.0.conv.weight", "conv.0.weight") if k in sd
    )
    in_channels = sd[first_conv_key].shape[1]
    gru_hidden = sd["gru_fwd.weight_ih_l0"].shape[0] // 3
    tcn_block_ids = {k.split(".")[1] for k in sd if k.startswith("tcn.")}
    tcn_blocks = len(tcn_block_ids)
    tcn_channels = sd["tcn.0.conv1.conv.weight"].shape[0] if tcn_blocks else 128

    model_cfg = cfg.get("model", {})
    model = CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=gru_hidden,
        gru_layers=model_cfg.get("gru_layers", 2),
        dropout=0.0,
        in_channels=in_channels,
        tcn_channels=tcn_channels,
        tcn_blocks=tcn_blocks,
    ).to(device)
    model.load_state_dict(sd, strict=False)
    model.eval()
    return model


def pred_position_labels(pred: str, truth: str) -> list[int]:
    """Return one correctness label per predicted character."""
    labels = [0] * len(pred)
    for tag, i1, i2, j1, j2 in Levenshtein.opcodes(pred, truth):
        if tag == "equal":
            for i in range(i1, i2):
                labels[i] = 1
        elif tag in ("replace", "delete"):
            for i in range(i1, i2):
                labels[i] = 0
        elif tag == "insert":
            continue
    return labels


def _entropy_norm(entropy: float, n_classes: int = NUM_CLASSES) -> float:
    return entropy / math.log(n_classes)


def extract_records(
    model: CWNet,
    data_dir: Path,
    *,
    limit: int,
    beam_width: int,
    prune_prob: float,
    device: torch.device,
) -> tuple[list[dict], list[dict]]:
    files = sorted(data_dir.glob("sample_*.npz"))
    if limit > 0:
        files = files[:limit]

    rows: list[dict] = []
    segments: list[dict] = []
    with torch.no_grad():
        for sample_idx, path in enumerate(files):
            z = np.load(path, allow_pickle=True)
            env = z["envelopes"].astype(np.float32)
            truth = str(z["text"]).upper()
            x = torch.tensor(env, dtype=torch.float32).unsqueeze(0).to(device)
            log_probs = model.infer(x)[0]

            greedy = greedy_decode_with_confidence(log_probs)
            beam = beam_search_with_posteriors(
                log_probs,
                beam_width=beam_width,
                prune_threshold=math.log(prune_prob),
                top_k=10,
            )
            labels = pred_position_labels(beam.text, truth)
            seq_len = max(len(beam.text), 1)
            top_seq_post = beam.candidates[0].posterior if beam.candidates else 0.0
            second_seq_post = beam.candidates[1].posterior if len(beam.candidates) > 1 else 0.0
            pos_ps = [pp.alternatives[0][1] if pp.alternatives else 0.0 for pp in beam.positions]
            pos_margins = [
                (pp.alternatives[0][1] if pp.alternatives else 0.0)
                - (pp.alternatives[1][1] if len(pp.alternatives) > 1 else 0.0)
                for pp in beam.positions
            ]
            other_len = [pp.other_length_mass for pp in beam.positions]
            entropies = [_entropy_norm(pp.entropy) for pp in beam.positions]
            edit_distance = Levenshtein.distance(beam.text, truth)
            denom = max(len(beam.text), len(truth), 1)
            segments.append({
                "sample_idx": sample_idx,
                "sample": path.name,
                "truth": truth,
                "pred": beam.text,
                "exact": int(beam.text == truth),
                "char_accuracy": float(1.0 - edit_distance / denom),
                "edit_distance": int(edit_distance),
                "snr_db": float(z.get("snr_db", np.nan)),
                "wpm": float(z.get("wpm", np.nan)),
                "top_seq_post": float(top_seq_post),
                "seq_margin": float(top_seq_post - second_seq_post),
                "seq_len": float(seq_len),
                "greedy_conf": float(greedy.confidence),
                "min_pos_p": float(min(pos_ps)) if pos_ps else 0.0,
                "mean_pos_p": float(np.mean(pos_ps)) if pos_ps else 0.0,
                "min_pos_margin": float(min(pos_margins)) if pos_margins else 0.0,
                "mean_pos_margin": float(np.mean(pos_margins)) if pos_margins else 0.0,
                "max_other_len_mass": float(max(other_len)) if other_len else 0.0,
                "mean_other_len_mass": float(np.mean(other_len)) if other_len else 0.0,
                "max_pos_entropy_norm": float(max(entropies)) if entropies else 0.0,
                "mean_pos_entropy_norm": float(np.mean(entropies)) if entropies else 0.0,
            })

            for pos, pp in enumerate(beam.positions):
                if pos >= len(labels):
                    continue
                p1 = pp.alternatives[0][1] if pp.alternatives else 0.0
                p2 = pp.alternatives[1][1] if len(pp.alternatives) > 1 else 0.0
                rows.append({
                    "sample_idx": sample_idx,
                    "sample": path.name,
                    "truth": truth,
                    "pred": beam.text,
                    "char": pp.best_char,
                    "pos": pos,
                    "correct": labels[pos],
                    "snr_db": float(z.get("snr_db", np.nan)),
                    "wpm": float(z.get("wpm", np.nan)),
                    "raw_pos_p": float(p1),
                    "pos_margin": float(p1 - p2),
                    "other_len_mass": float(pp.other_length_mass),
                    "pos_entropy": float(pp.entropy),
                    "pos_entropy_norm": float(_entropy_norm(pp.entropy)),
                    "top_seq_post": float(top_seq_post),
                    "seq_margin": float(top_seq_post - second_seq_post),
                    "seq_len": float(seq_len),
                    "greedy_conf": float(greedy.confidence),
                })
    return rows, segments


BASE_FEATURES = [
    "raw_pos_p",
    "pos_margin",
    "other_len_mass",
    "pos_entropy_norm",
    "top_seq_post",
    "seq_margin",
    "seq_len",
    "greedy_conf",
]

CONTEXT_FEATURES = (
    [f"char={ch}" for ch in CHARS]
    + [f"prev={ch}" for ch in "^" + CHARS]
    + [f"next={ch}" for ch in CHARS + "$"]
)
FEATURES = BASE_FEATURES + CONTEXT_FEATURES
FEATURE_INDEX = {name: i for i, name in enumerate(FEATURES)}

SEGMENT_FEATURES = [
    "top_seq_post",
    "seq_margin",
    "seq_len",
    "greedy_conf",
    "min_pos_p",
    "mean_pos_p",
    "min_pos_margin",
    "mean_pos_margin",
    "max_other_len_mass",
    "mean_other_len_mass",
    "max_pos_entropy_norm",
    "mean_pos_entropy_norm",
]


def rows_to_xy(rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    x = np.zeros((len(rows), len(FEATURES)), dtype=np.float64)
    for i, r in enumerate(rows):
        for k in BASE_FEATURES:
            x[i, FEATURE_INDEX[k]] = float(r[k])
        pred = str(r["pred"])
        pos = int(r["pos"])
        ch = str(r["char"])
        prev_ch = "^" if pos == 0 else pred[pos - 1]
        next_ch = "$" if pos + 1 >= len(pred) else pred[pos + 1]
        for name in (f"char={ch}", f"prev={prev_ch}", f"next={next_ch}"):
            idx = FEATURE_INDEX.get(name)
            if idx is not None:
                x[i, idx] = 1.0
    y = np.array([int(r["correct"]) for r in rows], dtype=np.float64)
    return x, y


def segments_to_xy(rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    x = np.array([[float(r[k]) for k in SEGMENT_FEATURES] for r in rows], dtype=np.float64)
    y = np.array([int(r["exact"]) for r in rows], dtype=np.float64)
    return x, y


def fit_logistic(x: np.ndarray, y: np.ndarray, seed: int, features: list[str]) -> dict:
    rng = np.random.default_rng(seed)
    mu = x.mean(axis=0)
    sigma = x.std(axis=0)
    sigma[sigma < 1e-8] = 1.0
    xs = (x - mu) / sigma
    xs = np.concatenate([np.ones((xs.shape[0], 1)), xs], axis=1)

    w = rng.normal(0.0, 0.01, size=xs.shape[1])
    lr = 0.05
    l2 = 1e-3
    for _ in range(3000):
        logits = xs @ w
        p = 1.0 / (1.0 + np.exp(-np.clip(logits, -50, 50)))
        grad = xs.T @ (p - y) / len(y)
        grad[1:] += l2 * w[1:]
        w -= lr * grad
    return {"weights": w.tolist(), "mean": mu.tolist(), "std": sigma.tolist(), "features": features}


def predict_calibrated(model: dict, x: np.ndarray) -> np.ndarray:
    mu = np.array(model["mean"], dtype=np.float64)
    sigma = np.array(model["std"], dtype=np.float64)
    w = np.array(model["weights"], dtype=np.float64)
    xs = (x - mu) / sigma
    xs = np.concatenate([np.ones((xs.shape[0], 1)), xs], axis=1)
    logits = xs @ w
    return 1.0 / (1.0 + np.exp(-np.clip(logits, -50, 50)))


def ece(probs: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    total = len(y)
    out = 0.0
    for i in range(bins):
        lo = i / bins
        hi = (i + 1) / bins
        mask = (probs >= lo) & (probs < hi if i < bins - 1 else probs <= hi)
        if not np.any(mask):
            continue
        out += (mask.sum() / total) * abs(float(probs[mask].mean()) - float(y[mask].mean()))
    return out


def metrics(name: str, probs: np.ndarray, y: np.ndarray) -> dict:
    out = {
        "name": name,
        "n": int(len(y)),
        "accuracy": float(y.mean()) if len(y) else None,
        "mean_conf": float(probs.mean()) if len(y) else None,
        "brier": float(np.mean((probs - y) ** 2)) if len(y) else None,
        "ece_10": float(ece(probs, y, 10)) if len(y) else None,
        "coverage": {},
    }
    for th in [0.5, 0.7, 0.8, 0.9, 0.95, 0.98]:
        mask = probs >= th
        out["coverage"][f">={th:.2f}"] = {
            "coverage": float(mask.mean()) if len(y) else 0.0,
            "accuracy": float(y[mask].mean()) if np.any(mask) else None,
            "n": int(mask.sum()),
        }
    return out


def segment_metrics(name: str, probs: np.ndarray, rows: list[dict]) -> dict:
    y = np.array([int(r["exact"]) for r in rows], dtype=np.float64)
    char_acc = np.array([float(r["char_accuracy"]) for r in rows], dtype=np.float64)
    out = metrics(name, probs, y)
    out["mean_char_accuracy"] = float(char_acc.mean()) if len(rows) else None
    out["coverage"] = {}
    for th in [0.2, 0.5, 0.7, 0.8, 0.9, 0.95]:
        mask = probs >= th
        out["coverage"][f">={th:.2f}"] = {
            "coverage": float(mask.mean()) if len(rows) else 0.0,
            "exact_accuracy": float(y[mask].mean()) if np.any(mask) else None,
            "mean_char_accuracy": float(char_acc[mask].mean()) if np.any(mask) else None,
            "n": int(mask.sum()),
        }
    return out


def main() -> None:
    args = parse_args()
    cfg = load_config(args.config)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(Path(args.checkpoint), cfg, device)

    rows, segments = extract_records(
        model,
        Path(args.data_dir),
        limit=args.limit,
        beam_width=args.beam_width,
        prune_prob=args.prune_prob,
        device=device,
    )
    if not rows:
        raise SystemExit("no character records extracted")

    rng = np.random.default_rng(args.seed)
    sample_ids = sorted({r["sample_idx"] for r in rows})
    rng.shuffle(sample_ids)
    n_train_samples = max(1, int(len(sample_ids) * args.train_frac))
    train_samples = set(sample_ids[:n_train_samples])
    test_samples = set(sample_ids[n_train_samples:])
    if not test_samples:
        test_samples = train_samples

    train_rows = [r for r in rows if r["sample_idx"] in train_samples]
    test_rows = [r for r in rows if r["sample_idx"] in test_samples]
    train_segments = [r for r in segments if r["sample_idx"] in train_samples]
    test_segments = [r for r in segments if r["sample_idx"] in test_samples]
    x_train, y_train = rows_to_xy(train_rows)
    x_test, y_test = rows_to_xy(test_rows)
    calib = fit_logistic(x_train, y_train, args.seed, FEATURES)
    sx_train, sy_train = segments_to_xy(train_segments)
    sx_test, sy_test = segments_to_xy(test_segments)
    segment_calib = fit_logistic(sx_train, sy_train, args.seed + 1, SEGMENT_FEATURES)

    raw_test = x_test[:, FEATURE_INDEX["raw_pos_p"]]
    calibrated_test = predict_calibrated(calib, x_test)
    raw_segment_test = sx_test[:, SEGMENT_FEATURES.index("top_seq_post")]
    segment_test = predict_calibrated(segment_calib, sx_test)
    segment_prob_by_sample = {
        r["sample_idx"]: float(segment_test[i])
        for i, r in enumerate(test_segments)
    }
    segment_adjusted_test = calibrated_test * np.array(
        [segment_prob_by_sample.get(r["sample_idx"], 0.0) for r in test_rows],
        dtype=np.float64,
    )
    report = {
        "data_dir": str(args.data_dir),
        "checkpoint": str(args.checkpoint),
        "n_samples": len({r["sample_idx"] for r in rows}),
        "n_chars": len(rows),
        "n_train_samples": len(train_samples),
        "n_test_samples": len(test_samples),
        "n_train_chars": len(train_rows),
        "n_test_chars": len(test_rows),
        "n_train_segments": len(train_segments),
        "n_test_segments": len(test_segments),
        "features": FEATURES,
        "segment_features": SEGMENT_FEATURES,
        "calibrator": calib,
        "segment_calibrator": segment_calib,
        "raw": metrics("raw_pos_p", raw_test, y_test),
        "calibrated": metrics("calibrated", calibrated_test, y_test),
        "segment_adjusted": metrics("calibrated_x_segment_reliability", segment_adjusted_test, y_test),
        "segment_raw": segment_metrics("top_seq_post", raw_segment_test, test_segments),
        "segment_calibrated": segment_metrics("segment_reliability", segment_test, test_segments),
        "worst_high_reliability_segments": [
            {**test_segments[i], "raw_prob": float(raw_segment_test[i]), "reliability": float(segment_test[i])}
            for i in np.argsort(-(segment_test * (1 - sy_test)))[:20]
            if sy_test[i] == 0
        ],
        "worst_high_conf_raw": [
            {**test_rows[i], "raw_prob": float(raw_test[i]), "calibrated_prob": float(calibrated_test[i])}
            for i in np.argsort(-(raw_test * (1 - y_test)))[:20]
            if y_test[i] == 0
        ],
        "worst_high_conf_segment_adjusted": [
            {
                **test_rows[i],
                "raw_prob": float(raw_test[i]),
                "calibrated_prob": float(calibrated_test[i]),
                "segment_reliability": float(segment_prob_by_sample.get(test_rows[i]["sample_idx"], 0.0)),
                "adjusted_prob": float(segment_adjusted_test[i]),
            }
            for i in np.argsort(-(segment_adjusted_test * (1 - y_test)))[:20]
            if y_test[i] == 0
        ],
    }

    print(json.dumps({
        k: v
        for k, v in report.items()
        if k not in ("calibrator", "segment_calibrator")
    }, indent=2))
    if args.out_json:
        args.out_json.parent.mkdir(parents=True, exist_ok=True)
        args.out_json.write_text(json.dumps(report, indent=2))
        print(f"wrote {args.out_json}")


if __name__ == "__main__":
    main()
