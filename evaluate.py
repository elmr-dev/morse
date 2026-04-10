"""
Immutable scoring harness. The agent must not edit this file.

Usage: python evaluate.py
Prints composite score and diagnostics to stdout.
"""
import sys, os, time, json
import numpy as np
from pathlib import Path
from sklearn.metrics import roc_auc_score, f1_score

from constants import *
from hmm_scorer import CWBayesianHMM


def load_testset():
    """Load pre-generated test samples."""
    samples = []
    for f in sorted(Path(TESTDATA_DIR).glob("*.npz")):
        d = np.load(f, allow_pickle=True)
        samples.append({
            "audio": d["audio"],
            "gt_binary": d["gt_binary"],       # (T_500hz,) binary
            "gt_elements": json.loads(str(d["gt_elements"])),
            "snr_db": float(d["snr_db"]),
            "wpm": float(d["wpm"]),
            "tone_freq": float(d["tone_freq"]),
        })
    return samples


def compute_timing_error(gt_binary, pred_binary, sr=500):
    """Mean absolute onset/offset error in milliseconds."""
    gt_edges = np.where(np.diff(gt_binary.astype(int)) != 0)[0]
    pred_edges = np.where(np.diff(pred_binary.astype(int)) != 0)[0]

    if len(gt_edges) == 0 or len(pred_edges) == 0:
        return 100.0  # penalty

    errors = []
    for ge in gt_edges:
        if len(pred_edges) > 0:
            closest = pred_edges[np.argmin(np.abs(pred_edges - ge))]
            errors.append(abs(closest - ge) / sr * 1000)  # ms

    return np.mean(errors) if errors else 100.0


def compute_iou(gt, pred):
    """Intersection over union of active regions."""
    intersection = np.sum(gt * pred)
    union = np.sum(np.maximum(gt, pred))
    return intersection / max(union, 1)


def count_elements(binary, min_gap_samples=3):
    """Count distinct ON elements in a binary array."""
    in_element = False
    count = 0
    gap_counter = 0
    for v in binary:
        if v > 0.5:
            if not in_element:
                count += 1
                in_element = True
            gap_counter = 0
        else:
            gap_counter += 1
            if gap_counter >= min_gap_samples:
                in_element = False
    return count


def run_evaluation():
    t0 = time.time()

    # Import the mutable DSP module
    try:
        import dsp
    except Exception as e:
        print(f"IMPORT_ERROR: {e}")
        sys.exit(1)

    samples = load_testset()
    if not samples:
        print("ERROR: No test data. Run generate_testset.py first.")
        sys.exit(1)

    # Run DSP on all samples, collect envelopes
    envelopes = []
    n_channels = None
    for s in samples:
        try:
            env = dsp.extract_envelope(
                s["audio"],
                sample_rate=AUDIO_SR,
                tone_freq=s["tone_freq"]
            )
        except Exception as e:
            print(f"DSP_ERROR: {e}")
            sys.exit(1)

        if n_channels is None:
            n_channels = env.shape[1]
        elif env.shape[1] != n_channels:
            print(f"CHANNEL_ERROR: Inconsistent channels {env.shape[1]} vs {n_channels}")
            sys.exit(1)

        if n_channels < MIN_CHANNELS or n_channels > MAX_CHANNELS:
            print(f"CHANNEL_ERROR: {n_channels} channels, must be {MIN_CHANNELS}-{MAX_CHANNELS}")
            sys.exit(1)

        envelopes.append(env)

    # Fit HMM on first 6 samples (one per SNR level), decode the rest
    fit_envs = envelopes[:6]
    fit_labels = [s["gt_binary"][:len(e)] for e, s in zip(fit_envs, samples[:6])]

    hmm = CWBayesianHMM(n_channels=n_channels)
    hmm.fit(fit_envs, fit_labels)

    # Score all samples (including fit samples — the HMM is simple enough
    # that overfitting on 6 samples is minimal, and we want full coverage)
    results_by_snr = {}
    all_scores = []
    per_channel_auc = [[] for _ in range(n_channels)]

    issues = []

    for i, (env, s) in enumerate(zip(envelopes, samples)):
        gt = s["gt_binary"][:len(env)]

        # HMM posterior
        p_on = hmm.decode(env)
        pred_binary = (p_on > 0.5).astype(float)

        # Per-channel AUC (raw, no HMM)
        for c in range(n_channels):
            try:
                auc_c = roc_auc_score(gt, env[:, c])
            except ValueError:
                auc_c = 0.5
            per_channel_auc[c].append(auc_c)

        # Post-HMM metrics
        try:
            auc = roc_auc_score(gt, p_on)
        except ValueError:
            auc = 0.5

        # Find optimal threshold for F1
        best_f1 = 0
        for thresh in np.arange(0.3, 0.8, 0.05):
            f = f1_score(gt, (p_on > thresh).astype(int), zero_division=0)
            if f > best_f1:
                best_f1 = f

        iou = compute_iou(gt, pred_binary)
        timing_err = compute_timing_error(gt, pred_binary)

        gt_elements = count_elements(gt)
        pred_elements = count_elements(pred_binary)
        elem_ratio = min(pred_elements, gt_elements) / max(gt_elements, 1)

        # Composite
        timing_score = max(0, 1 - timing_err / 50)
        composite = (
            W_AUC * auc +
            W_F1 * best_f1 +
            W_IOU * iou +
            W_TIMING * timing_score +
            W_ELEMENT * elem_ratio
        )

        snr = s["snr_db"]
        snr_bucket = f"{snr:+.0f}dB"
        results_by_snr.setdefault(snr_bucket, []).append(composite)
        all_scores.append(composite)

        # Diagnose issues
        if pred_elements > gt_elements * 1.5:
            issues.append(f"sample {i} ({snr_bucket}): {pred_elements} elements detected vs {gt_elements} GT (insertions)")
        elif pred_elements < gt_elements * 0.5:
            issues.append(f"sample {i} ({snr_bucket}): {pred_elements} elements detected vs {gt_elements} GT (misses)")
        if timing_err > 15:
            issues.append(f"sample {i} ({snr_bucket}): timing error {timing_err:.1f}ms")

    elapsed = time.time() - t0

    # === STDOUT OUTPUT (parsed by agent) ===
    composite_mean = np.mean(all_scores)
    print(f"composite: {composite_mean:.4f}")
    print(f"n_channels: {n_channels}")
    print(f"eval_time_s: {elapsed:.1f}")
    print()

    # Per-SNR breakdown
    print("--- per_snr ---")
    for snr_bucket in sorted(results_by_snr.keys()):
        scores = results_by_snr[snr_bucket]
        print(f"  {snr_bucket}: {np.mean(scores):.4f}")
    print()

    # Per-channel raw AUC (no HMM)
    print("--- per_channel_auc ---")
    for c in range(n_channels):
        mean_auc = np.mean(per_channel_auc[c])
        print(f"  ch{c}: {mean_auc:.4f}")
    print()

    # Issues
    if issues:
        print("--- issues ---")
        for iss in issues[:10]:
            print(f"  {iss}")
    else:
        print("--- issues: none ---")


if __name__ == "__main__":
    run_evaluation()
