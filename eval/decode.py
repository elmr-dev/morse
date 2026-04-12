"""
CTC decode utilities with conservative anti-hallucination gating.

Three gates applied in sequence:
  1. Entropy gate: per-frame — suppress low-confidence frames (force blank)
  2. Blank-ratio gate: per-chunk — suppress chunks with too few non-blank frames
  3. Run-length filter: require ≥2 consecutive non-blank frames per character
"""

from __future__ import annotations

import math
import torch
from dataclasses import dataclass

from model.cwnet import idx_to_char, BLANK_IDX

NUM_CLASSES = 42  # blank + 41 chars
LOG_NUM_CLASSES = math.log(NUM_CLASSES)  # max entropy denominator


@dataclass
class DecodeResult:
    text: str
    confidence: float   # mean max-class prob over non-blank frames (post-gating)
    indices: list[int]


@torch.no_grad()
def greedy_decode_with_confidence(
    log_probs: torch.Tensor,
    input_length: int | None = None,
    entropy_threshold: float = 0.3,
    blank_ratio_threshold: float = 0.96,
    min_run_length: int = 2,
) -> DecodeResult:
    """
    Conservative CTC greedy decode for a single sequence.

    log_probs: (T, C) — log probabilities for one sequence
    input_length: number of valid frames (truncate if provided)
    entropy_threshold: suppress frames where confidence < this (0=off, 0.3=default)
    blank_ratio_threshold: suppress output if blank fraction > this after entropy gate
    min_run_length: minimum consecutive non-blank frames to emit a character
    """
    if input_length is not None:
        log_probs = log_probs[:input_length]

    T, C = log_probs.shape

    # Gate 1: entropy-based per-frame confidence
    # confidence(t) = 1 - H(t) / log(C)  where H(t) is frame entropy
    if entropy_threshold > 0:
        probs = log_probs.exp()  # (T, C)
        entropy = -(probs * log_probs).sum(dim=-1)  # (T,)
        confidence_per_frame = 1.0 - entropy / LOG_NUM_CLASSES  # (T,)
        # Force blank on low-confidence frames
        suppressed = confidence_per_frame < entropy_threshold  # (T,)
        argmax = log_probs.argmax(dim=-1).clone()  # (T,)
        argmax[suppressed] = BLANK_IDX
    else:
        argmax = log_probs.argmax(dim=-1)  # (T,)

    # Gate 2: blank-ratio gate — suppress entire sequence if nearly all blanks
    non_blank_count = (argmax != BLANK_IDX).sum().item()
    if non_blank_count < 2 or (non_blank_count / T) < (1.0 - blank_ratio_threshold):
        return DecodeResult(text="", confidence=0.0, indices=[])

    # Gate 3: run-length filter + CTC collapse
    # Require ≥ min_run_length consecutive non-blank frames for any character
    raw_seq = argmax.tolist()
    max_lp = log_probs.max(dim=-1).values.tolist()

    # Build run-length filtered sequence
    filtered = []
    run_start = 0
    while run_start < len(raw_seq):
        cls = raw_seq[run_start]
        run_end = run_start + 1
        while run_end < len(raw_seq) and raw_seq[run_end] == cls:
            run_end += 1
        run_len = run_end - run_start
        # Keep non-blank runs of sufficient length; always keep blank runs
        if cls == BLANK_IDX or run_len >= min_run_length:
            filtered.extend(raw_seq[run_start:run_end])
        else:
            # Replace short non-blank runs with blanks
            filtered.extend([BLANK_IDX] * run_len)
        run_start = run_end

    # CTC collapse: deduplicate consecutive, remove blanks
    indices = []
    confidences = []
    prev = None
    for t, idx in enumerate(filtered):
        if idx != prev:
            if idx != BLANK_IDX:
                indices.append(idx)
                confidences.append(math.exp(max_lp[t]))
            prev = idx

    text = "".join(idx_to_char.get(i, "?") for i in indices)
    conf = sum(confidences) / len(confidences) if confidences else 0.0

    return DecodeResult(text=text, confidence=conf, indices=indices)


@torch.no_grad()
def decode_batch(
    model: torch.nn.Module,
    inputs: torch.Tensor,
    input_lengths: list[int] | None = None,
    device: torch.device | None = None,
    entropy_threshold: float = 0.3,
) -> list[DecodeResult]:
    """
    Run model + conservative decode on a batch.

    inputs: (B, T, 1)
    returns: list of B DecodeResults
    """
    if device is not None:
        inputs = inputs.to(device)

    log_probs = model.infer(inputs)  # (B, T//2, C)

    results = []
    for b in range(log_probs.shape[0]):
        lp = log_probs[b]
        il = input_lengths[b] if input_lengths else None
        results.append(greedy_decode_with_confidence(
            lp, il, entropy_threshold=entropy_threshold
        ))

    return results
