"""Immutable constants. The agent must not edit this file."""

AUDIO_SR = 8000          # Input audio sample rate
ENVELOPE_SR = 500        # Output envelope sample rate
DECIMATION = AUDIO_SR // ENVELOPE_SR  # 16

# Test set
TESTDATA_DIR = "testdata"
N_TEST_SAMPLES = 24      # 6 SNR levels × 4 samples each
SNR_LEVELS = [-18, -12, -6, -3, 0, 6]  # dB, ARRL 2500 Hz ref

# Scoring weights
W_AUC = 0.25
W_F1 = 0.20
W_IOU = 0.20
W_TIMING = 0.20
W_ELEMENT = 0.15

# Time budget per evaluation
MAX_EVAL_SECONDS = 90

# DSP constraints
MAX_CHANNELS = 4          # Agent may use 1-4 channels
MIN_CHANNELS = 1
