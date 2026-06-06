"""
Runtime augmentations applied to DSP envelopes at 500 Hz.

Applied stochastically during training — not during eval/test.
All augmentations operate on the numpy array (T, C) after loading.
"""

from __future__ import annotations

import numpy as np


def amplitude_scale(envelopes: np.ndarray, scale_range: tuple = (0.8, 1.2)) -> np.ndarray:
    """Multiply all channels by a random scalar."""
    scale = np.random.uniform(*scale_range)
    return np.clip(envelopes * scale, 0.0, 1.0)


def additive_noise(envelopes: np.ndarray, sigma: float = 0.02) -> np.ndarray:
    """Add small Gaussian noise to simulate DSP residual variance."""
    noise = np.random.normal(0, sigma, envelopes.shape).astype(np.float32)
    return np.clip(envelopes + noise, 0.0, 1.0)


def time_mask(envelopes: np.ndarray, max_mask_frac: float = 0.30, n_masks: int = 1) -> np.ndarray:
    """
    Zero out n_masks random contiguous segments (SpecAugment-style).

    Each mask spans up to max_mask_frac of the sequence length.
    Simulates deep fades / signal dropout at low SNR.
    """
    T = envelopes.shape[0]
    envelopes = envelopes.copy()
    for _ in range(n_masks):
        max_len = max(1, int(T * max_mask_frac))
        mask_len = np.random.randint(1, max_len + 1)
        start = np.random.randint(0, T - mask_len + 1)
        envelopes[start:start + mask_len] = 0.0
    return envelopes


def time_shift(envelopes: np.ndarray, max_shift_frac: float = 0.05) -> np.ndarray:
    """Shift the sequence by a small random amount, zero-padding the gap."""
    T = envelopes.shape[0]
    max_shift = int(T * max_shift_frac)
    if max_shift < 1:
        return envelopes
    shift = np.random.randint(-max_shift, max_shift + 1)
    if shift == 0:
        return envelopes
    result = np.zeros_like(envelopes)
    if shift > 0:
        result[shift:] = envelopes[:-shift]
    else:
        result[:shift] = envelopes[-shift:]
    return result


def apply_augmentations(envelopes: np.ndarray, cfg: dict) -> np.ndarray:
    """Apply configured augmentations stochastically."""
    if cfg.get("amplitude_scale", False):
        envelopes = amplitude_scale(envelopes)
    if cfg.get("additive_noise", False):
        envelopes = additive_noise(envelopes, sigma=cfg.get("noise_sigma", 0.02))
    if cfg.get("time_mask", False):
        envelopes = time_mask(envelopes,
                              max_mask_frac=cfg.get("time_mask_frac", 0.30),
                              n_masks=cfg.get("time_mask_n", 1))
    if cfg.get("time_shift", False):
        envelopes = time_shift(envelopes)
    return envelopes
