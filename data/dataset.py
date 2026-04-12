"""
PyTorch Dataset for CW decoder training.

Each .npz sample contains:
  envelopes: float32 (T, 1) at 500 Hz — single IQ magnitude channel
  frame_labels: int64 (T_out,) — per-frame character class for CE pre-training
  text: str — ground truth text
  wpm: float — for eval bucketing only
  snr_db: float — for eval bucketing only
  impairment: str — for eval bucketing only

Clips are variable length. collate_fn pads each batch to its longest sample.
"""

from __future__ import annotations

import os
import numpy as np
import torch
from torch.utils.data import Dataset

from model.cwnet import char_to_idx, BLANK_IDX
from data.augmentations import apply_augmentations

CNN_DOWNSAMPLE = 2     # must match model architecture (stride-2 at layer 1)
MAX_CLIP_SAMPLES = int(22.0 * 500)   # hard cap: 22s at 500 Hz


class CWDataset(Dataset):
    def __init__(self, data_dir: str, augment: bool = False):
        self.data_dir = data_dir
        self.augment = augment
        self.files = sorted([
            os.path.join(data_dir, f)
            for f in os.listdir(data_dir)
            if f.endswith(".npz")
        ])
        if not self.files:
            raise ValueError(f"No .npz files found in {data_dir}")

    def __len__(self) -> int:
        return len(self.files)

    def __getitem__(self, idx: int) -> dict:
        data = np.load(self.files[idx], allow_pickle=True)
        envelopes = data["envelopes"].astype(np.float32)   # (T, 1)
        if self.augment:
            envelopes = apply_augmentations(envelopes, {
                "amplitude_scale":   True,
                "additive_noise":    True,
                "noise_sigma":       0.05,
                "time_mask":         True,
                "time_mask_frac":    0.30,
                "time_mask_n":       1,
                "time_shift":        True,
            })
        text = str(data["text"])
        wpm = float(data.get("wpm", 20.0))
        snr_db = float(data.get("snr_db", 10.0))
        impairment = str(data.get("impairment", "clean"))

        # Hard cap — shouldn't normally trigger with well-formed data
        if envelopes.shape[0] > MAX_CLIP_SAMPLES:
            envelopes = envelopes[:MAX_CLIP_SAMPLES]

        T = envelopes.shape[0]
        T_out = T // CNN_DOWNSAMPLE

        if "frame_labels" in data.files:
            frame_labels = data["frame_labels"].astype(np.int64)   # (T_out,)
            frame_labels = frame_labels[:T_out]
        else:
            frame_labels = np.zeros(T_out, dtype=np.int64)

        # Encode text to class indices, skip unknown chars
        targets = [char_to_idx[c] for c in text.upper() if c in char_to_idx]

        return {
            "input": torch.tensor(envelopes, dtype=torch.float32),   # (T, 1)
            "target": torch.tensor(targets, dtype=torch.long),
            "frame_labels": torch.tensor(frame_labels, dtype=torch.long),  # (T_out,)
            "input_length": T,
            "target_length": len(targets),
            "wpm": wpm,
            "snr_db": snr_db,
            "impairment": impairment,
            "text": text,
        }


def collate_fn(batch: list[dict]) -> tuple:
    """
    Collate variable-length samples. Pads each batch to its longest sample.
    Returns: (inputs, targets, input_lengths, target_lengths, frame_labels, metadata)
    """
    max_T = max(b["input"].shape[0] for b in batch)
    max_T_out = max_T // CNN_DOWNSAMPLE

    B = len(batch)
    n_channels = batch[0]["input"].shape[1]
    inputs = torch.zeros(B, max_T, n_channels)
    frame_labels = torch.zeros(B, max_T_out, dtype=torch.long)

    for i, b in enumerate(batch):
        T = b["input"].shape[0]
        inputs[i, :T] = b["input"]
        Tf = b["frame_labels"].shape[0]
        frame_labels[i, :Tf] = b["frame_labels"]

    targets = torch.cat([b["target"] for b in batch])   # CTC needs flat
    input_lengths = torch.tensor(
        [b["input_length"] // CNN_DOWNSAMPLE for b in batch], dtype=torch.long
    )
    target_lengths = torch.tensor(
        [b["target_length"] for b in batch], dtype=torch.long
    )
    meta = {
        "wpm": [b["wpm"] for b in batch],
        "snr_db": [b["snr_db"] for b in batch],
        "impairment": [b["impairment"] for b in batch],
        "text": [b["text"] for b in batch],
    }
    return inputs, targets, input_lengths, target_lengths, frame_labels, meta
