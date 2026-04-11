"""
CWNet-focused DSP scoring harness. The agent must not edit this file.

Loads real validation WAVs from VALIDATIONS_DIR, runs dsp.extract_envelope(),
and scores using CWNet-relevant metrics: timing accuracy, AUC, F1, IoU, rise_ms.

Usage: python evaluate.py
Prints composite score and diagnostics to stdout.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from constants import (
    AUDIO_SR, DECIMATION, MAX_CHANNELS, MAX_EVAL_SAMPLES, MIN_CHANNELS,
    SNR_TIERS, WPM_TIERS, VALIDATIONS_DIR, W_AUC, W_F1, W_IOU, W_RISE, W_TIMING,
)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_samples():
    val_dir = Path(VALIDATIONS_DIR)
    configs_path = val_dir / "_configs.json"
    if not configs_path.exists():
        print(f"ERROR: {configs_path} not found")
        sys.exit(1)

    with open(configs_path) as f:
        configs = json.load(f)

    samples = []
    for i in range(min(MAX_EVAL_SAMPLES, len(configs))):
        wav_path = val_dir / f"wav_{i:06d}.wav"
        npz_path = val_dir / "_npz" / f"sample_{i:06d}.npz"
        if not wav_path.exists() or not npz_path.exists():
            continue

        sr, audio_int = wavfile.read(str(wav_path))
        audio = audio_int.astype(np.float32) / 32768.0

        d = np.load(npz_path, allow_pickle=True)
        samples.append({
            "audio": audio,
            "gt_250": (d["frame_labels"] > 0).astype(np.float32),
            "snr_db": float(d["snr_db"]),
            "wpm": float(d["wpm"]),
            "tone_freq": float(configs[i]["frequency"]),
        })

    return samples


# ---------------------------------------------------------------------------
# Metrics (self-contained, numpy/scipy only)
# ---------------------------------------------------------------------------

def _auc(soft, gt):
    """Trapezoidal AUC via sorted thresholds."""
    gt_bool = gt.astype(bool)
    n_pos = np.sum(gt_bool)
    n_neg = np.sum(~gt_bool)
    if n_pos == 0 or n_neg == 0:
        return 0.5

    thresholds = np.sort(np.unique(soft))[::-1]
    tprs = []
    fprs = []
    for t in thresholds:
        pred = soft >= t
        tprs.append(np.sum(pred & gt_bool) / n_pos)
        fprs.append(np.sum(pred & ~gt_bool) / n_neg)

    tprs = np.array(tprs)
    fprs = np.array(fprs)
    # Sort by fpr ascending for trapz
    order = np.argsort(fprs)
    return float(np.trapezoid(tprs[order], fprs[order]))


def _norm_rms_timing(soft_250, gt_250, wpm):
    """RMS edge timing error normalized by dit duration. Lower is better."""
    gt_edges = np.where(np.diff(gt_250.astype(int)) != 0)[0]
    pred_edges = np.where(np.diff((soft_250 > 0.5).astype(int)) != 0)[0]

    if len(gt_edges) == 0 or len(pred_edges) == 0:
        return 2.0  # heavy penalty

    errors_ms = []
    for ge in gt_edges:
        closest = pred_edges[np.argmin(np.abs(pred_edges - ge))]
        errors_ms.append(abs(int(closest) - int(ge)) / 250.0 * 1000.0)

    rms_ms = float(np.sqrt(np.mean(np.array(errors_ms) ** 2)))
    dit_ms = 1200.0 / wpm
    return rms_ms / dit_ms


def _f1(soft_250, gt_250):
    """F1 at threshold 0.5."""
    pred = (soft_250 > 0.5).astype(np.float32)
    gt = gt_250.astype(np.float32)
    tp = float(np.sum(pred * gt))
    fp = float(np.sum(pred * (1.0 - gt)))
    fn = float(np.sum((1.0 - pred) * gt))
    denom = tp + 0.5 * (fp + fn)
    return tp / max(denom, 1e-9)


def _iou(soft_250, gt_250):
    """Intersection over union of ON regions."""
    pred = soft_250 > 0.5
    gt = gt_250.astype(bool)
    intersection = float(np.sum(pred & gt))
    union = float(np.sum(pred | gt))
    return intersection / max(union, 1.0)


def _rise_ms(soft_250, gt_250, sr=250):
    """Mean 10→90% rise time at tone onsets (ms). Lower = sharper = better."""
    onsets = np.where(np.diff(gt_250.astype(int)) > 0)[0]
    times = []
    window = int(0.15 * sr)  # 150ms search window
    for e in onsets:
        seg = soft_250[e: e + window]
        if len(seg) < 5:
            continue
        above_10 = np.where(seg >= 0.1)[0]
        above_90 = np.where(seg >= 0.9)[0]
        if len(above_10) and len(above_90):
            times.append((above_90[0] - above_10[0]) / sr * 1000.0)
    return float(np.mean(times)) if times else 999.0


def _composite(norm_timing, auc, f1, iou, rise_ms_val, wpm):
    dit_ms = 1200.0 / wpm
    timing_score = max(0.0, 1.0 - norm_timing)
    rise_score = max(0.0, 1.0 - rise_ms_val / (0.5 * dit_ms))
    return (
        W_TIMING * timing_score
        + W_AUC * auc
        + W_F1 * f1
        + W_IOU * iou
        + W_RISE * rise_score
    )


def _snr_tier(snr_db):
    for name, (lo, hi) in SNR_TIERS.items():
        if lo <= snr_db < hi:
            return name
    return "high"


def _wpm_tier(wpm):
    for name, (lo, hi) in WPM_TIERS.items():
        if lo <= wpm < hi:
            return name
    return "vfast"


# ---------------------------------------------------------------------------
# Main evaluation
# ---------------------------------------------------------------------------

def run_evaluation():
    t0 = time.time()

    try:
        import dsp
    except Exception as e:
        print(f"IMPORT_ERROR: {e}")
        sys.exit(1)

    samples = load_samples()
    if not samples:
        print(f"ERROR: No samples found in {VALIDATIONS_DIR}")
        sys.exit(1)

    n_channels = None
    results_by_snr = {tier: [] for tier in SNR_TIERS}
    results_by_wpm = {tier: [] for tier in WPM_TIERS}
    all_composites = []
    all_norm_timing = []
    all_auc = []
    all_f1 = []
    all_iou = []
    all_rise = []
    per_channel_auc = None
    issues = []

    for i, s in enumerate(samples):
        try:
            env_500 = dsp.extract_envelope(
                s["audio"], sample_rate=AUDIO_SR, tone_freq=s["tone_freq"]
            )
        except Exception as e:
            print(f"DSP_ERROR on sample {i}: {e}")
            sys.exit(1)

        if env_500.ndim == 1:
            env_500 = env_500[:, np.newaxis]

        if n_channels is None:
            n_channels = env_500.shape[1]
            per_channel_auc = [[] for _ in range(n_channels)]
            if n_channels < MIN_CHANNELS or n_channels > MAX_CHANNELS:
                print(f"CHANNEL_ERROR: {n_channels} channels, must be {MIN_CHANNELS}-{MAX_CHANNELS}")
                sys.exit(1)
        elif env_500.shape[1] != n_channels:
            print(f"CHANNEL_ERROR: inconsistent channels {env_500.shape[1]} vs {n_channels}")
            sys.exit(1)

        # Channel-mean fusion, then decimate 500→250 Hz
        fused_500 = env_500.mean(axis=1)
        T_500 = len(fused_500)
        T_trim = (T_500 // 2) * 2
        fused_250 = fused_500[:T_trim].reshape(-1, 2).mean(axis=1)

        # Align with GT
        gt_250 = s["gt_250"]
        min_T = min(len(fused_250), len(gt_250))
        fused_250 = fused_250[:min_T]
        gt_250 = gt_250[:min_T]

        # Per-channel AUC (decimate each channel to 250 Hz)
        for c in range(n_channels):
            ch_500 = env_500[:, c]
            T_c = (len(ch_500) // 2) * 2
            ch_250 = ch_500[:T_c].reshape(-1, 2).mean(axis=1)
            ch_250 = ch_250[:min_T]
            try:
                per_channel_auc[c].append(_auc(ch_250, gt_250))
            except Exception:
                per_channel_auc[c].append(0.5)

        # Compute metrics
        wpm = s["wpm"]
        norm_timing = _norm_rms_timing(fused_250, gt_250, wpm)
        auc = _auc(fused_250, gt_250)
        f1 = _f1(fused_250, gt_250)
        iou = _iou(fused_250, gt_250)
        rise_ms_val = _rise_ms(fused_250, gt_250)
        comp = _composite(norm_timing, auc, f1, iou, rise_ms_val, wpm)

        tier = _snr_tier(s["snr_db"])
        if tier in results_by_snr:
            results_by_snr[tier].append(comp)

        wtier = _wpm_tier(s["wpm"])
        if wtier in results_by_wpm:
            results_by_wpm[wtier].append(comp)

        all_composites.append(comp)
        all_norm_timing.append(norm_timing)
        all_auc.append(auc)
        all_f1.append(f1)
        all_iou.append(iou)
        all_rise.append(rise_ms_val)

        # Flag obvious failures
        if norm_timing > 1.5:
            issues.append(f"sample {i} (snr={s['snr_db']:+.0f}dB): norm_timing={norm_timing:.2f} (very poor)")
        if rise_ms_val > 50.0:
            issues.append(f"sample {i} (snr={s['snr_db']:+.0f}dB): rise_ms={rise_ms_val:.0f} (very slow)")

    elapsed = time.time() - t0

    # === STDOUT OUTPUT (parsed by agent) ===
    print(f"composite: {np.mean(all_composites):.4f}")
    print(f"n_channels: {n_channels}")
    print(f"eval_time_s: {elapsed:.1f}")
    print()

    print("--- per_snr ---")
    for tier in SNR_TIERS:
        scores = results_by_snr[tier]
        if scores:
            print(f"  {tier}: {np.mean(scores):.4f}  (n={len(scores)})")
        else:
            print(f"  {tier}: n/a")
    print()

    print("--- per_wpm ---")
    for tier in WPM_TIERS:
        scores = results_by_wpm[tier]
        lo, hi = WPM_TIERS[tier]
        label = f"{tier}({lo}-{hi}wpm)"
        if scores:
            print(f"  {label}: {np.mean(scores):.4f}  (n={len(scores)})")
        else:
            print(f"  {label}: n/a")
    print()

    print("--- per_channel_auc ---")
    for c in range(n_channels):
        mean_auc = np.mean(per_channel_auc[c]) if per_channel_auc[c] else 0.0
        print(f"  ch{c}: {mean_auc:.4f}")
    print()

    print("--- per_metric ---")
    print(f"  norm_timing: {np.mean(all_norm_timing):.3f}")
    print(f"  auc: {np.mean(all_auc):.3f}")
    print(f"  f1: {np.mean(all_f1):.3f}")
    print(f"  iou: {np.mean(all_iou):.3f}")
    print(f"  rise_ms: {np.mean(all_rise):.1f}")
    print()

    if issues:
        print("--- issues ---")
        for iss in issues[:10]:
            print(f"  {iss}")
    else:
        print("--- issues: none ---")


if __name__ == "__main__":
    run_evaluation()
