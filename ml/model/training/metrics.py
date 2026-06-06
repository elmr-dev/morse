"""
CER computation, greedy decode, and per-bucket tracking.
"""

from __future__ import annotations

from collections import defaultdict

import torch
import Levenshtein

from model.cwnet import idx_to_char, BLANK_IDX


def greedy_decode(log_probs: torch.Tensor) -> list[list[int]]:
    """
    CTC greedy decode.

    log_probs: (T, B, C) or (B, T, C)
    returns: list of B decoded sequences (each a list of class indices)
    """
    if log_probs.dim() == 3 and log_probs.shape[0] != log_probs.shape[1]:
        # assume (T, B, C)
        argmax = log_probs.argmax(dim=-1)  # (T, B)
    else:
        # (B, T, C) — transpose
        argmax = log_probs.argmax(dim=-1).T  # (T, B)

    decoded = []
    for b in range(argmax.shape[1]):
        seq = argmax[:, b].tolist()
        collapsed = []
        prev = None
        for s in seq:
            if s != prev:
                if s != BLANK_IDX:
                    collapsed.append(s)
                prev = s
        decoded.append(collapsed)
    return decoded


def indices_to_str(indices: list[int]) -> str:
    return "".join(idx_to_char.get(i, "?") for i in indices)


def compute_cer(predicted: list[int], target: list[int]) -> float:
    pred_str = indices_to_str(predicted)
    tgt_str = indices_to_str(target)
    if len(tgt_str) == 0:
        return 0.0 if len(pred_str) == 0 else 1.0
    return Levenshtein.distance(pred_str, tgt_str) / len(tgt_str)


def compute_edit_breakdown(pred_str: str, tgt_str: str) -> dict:
    """Per-operation edit-distance breakdown.

    HSMM milestone diagnostic: the DSP threshold characterization predicts
    insertions dominate at <= -10 dB. This breakdown lets us confirm that
    on the model output before/after structured decoding.

    Returns: cer, n_ins, n_del, n_sub, target_len, pred_len.
    """
    if len(tgt_str) == 0:
        n_ins = len(pred_str)
        return {"cer": 0.0 if n_ins == 0 else 1.0, "n_ins": n_ins,
                "n_del": 0, "n_sub": 0, "target_len": 0, "pred_len": n_ins}
    ops = Levenshtein.editops(tgt_str, pred_str)
    n_ins = sum(1 for op in ops if op[0] == "insert")
    n_del = sum(1 for op in ops if op[0] == "delete")
    n_sub = sum(1 for op in ops if op[0] == "replace")
    return {
        "cer": (n_ins + n_del + n_sub) / len(tgt_str),
        "n_ins": n_ins,
        "n_del": n_del,
        "n_sub": n_sub,
        "target_len": len(tgt_str),
        "pred_len": len(pred_str),
    }


def blank_ratio(log_probs: torch.Tensor) -> float:
    """Fraction of output frames where blank is the argmax. Should be ~0.93-0.97."""
    argmax = log_probs.argmax(dim=-1)
    return (argmax == BLANK_IDX).float().mean().item()


class BucketTracker:
    """Accumulate per-sample CER and group by SNR/WPM/impairment buckets."""

    def __init__(self):
        self._snr: dict[str, list[float]] = defaultdict(list)
        self._wpm: dict[str, list[float]] = defaultdict(list)
        self._imp: dict[str, list[float]] = defaultdict(list)
        self._all: list[float] = []

    def add(self, cer: float, snr_db: float, wpm: float, impairment: str):
        self._all.append(cer)
        self._snr[_snr_bucket(snr_db)].append(cer)
        self._wpm[_wpm_bucket(wpm)].append(cer)
        self._imp[impairment].append(cer)

    def summary(self) -> dict:
        def mean(lst): return sum(lst) / len(lst) if lst else float("nan")
        return {
            "overall": mean(self._all),
            "n": len(self._all),
            "snr": {k: mean(v) for k, v in sorted(self._snr.items())},
            "wpm": {k: mean(v) for k, v in sorted(self._wpm.items())},
            "impairment": {k: mean(v) for k, v in sorted(self._imp.items())},
        }


def _snr_bucket(snr: float) -> str:
    if snr <= -10:  return "≤-10dB"
    elif snr <= -4: return "-10--4dB"
    elif snr <= 2:  return "-4-2dB"
    else:           return ">2dB"


def _wpm_bucket(wpm: float) -> str:
    if wpm < 25:   return "12-25"
    elif wpm < 40: return "25-40"
    else:          return "40-60"
