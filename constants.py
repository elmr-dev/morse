"""Immutable constants. The agent must not edit this file."""

AUDIO_SR = 8000
ENVELOPE_SR = 500
DECIMATION = AUDIO_SR // ENVELOPE_SR  # 16

# Validation data (relative to cw-dsp-research/)
VALIDATIONS_DIR = "../cw-decode/samples/validations"
MAX_EVAL_SAMPLES = 200        # use first 200 of 1000 for speed

# SNR tier boundaries (dB) — match training config
SNR_TIERS = {
    "very_low": (-99, -10),
    "low":      (-10,  -4),
    "mid":      (-4,    2),
    "high":     (2,    99),
}

# CWNet-focused composite weights (timing matters most for CTC)
W_TIMING = 0.30   # norm_rms_timing: RMS edge error / dit_duration
W_AUC    = 0.25   # AUC under ROC curve
W_F1     = 0.20   # F1 at threshold 0.5
W_IOU    = 0.15   # intersection-over-union of ON regions
W_RISE   = 0.10   # 10→90% onset rise time (lower = sharper = better)

# Time budget
MAX_EVAL_SECONDS = 120

# DSP constraints
MAX_CHANNELS = 4
MIN_CHANNELS = 1
