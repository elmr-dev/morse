"""
CTC decode utilities with conservative anti-hallucination gating.

Three gates applied in sequence:
  1. Entropy gate: per-frame — suppress low-confidence frames (force blank)
  2. Blank-ratio gate: per-chunk — suppress chunks with too few non-blank frames
  3. Run-length filter: require ≥2 consecutive non-blank frames per character
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np
import torch

from model.cwnet import idx_to_char, BLANK_IDX

NUM_CLASSES = 42  # blank + 41 chars
LOG_NUM_CLASSES = math.log(NUM_CLASSES)  # max entropy denominator
NEG_INF = -1e30


def _logsumexp2(a: float, b: float) -> float:
    if a == NEG_INF:
        return b
    if b == NEG_INF:
        return a
    m = a if a > b else b
    return m + math.log(math.exp(a - m) + math.exp(b - m))


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
    blank_ratio_threshold: float = 0.999,
    min_run_length: int = 1,
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


def beam_search_decode(
    log_probs: torch.Tensor,
    input_length: int | None = None,
    beam_width: int = 10,
    prune_threshold: float = math.log(0.001),
) -> DecodeResult:
    """
    CTC prefix beam search. Solves the two greedy-decode pitfalls:
      (1) collapses 'char, blank, char' (repeated letter) into single emission
      (2) single-frame char peaks lost when two peaks land in adjacent frames

    Each beam tracks two probabilities:
      p_b  — prob of prefix ending with blank at time t
      p_nb — prob of prefix ending with the last non-blank char at time t

    log_probs: (T, C) log probabilities for one sequence
    beam_width: keep top K beams after each frame
    prune_threshold: skip character extensions with log-prob below this at each frame

    Returns DecodeResult. Confidence = exp of the best beam's total log-prob
    normalised by number of emitted chars.
    """
    if input_length is not None:
        log_probs = log_probs[:input_length]

    lp = log_probs.detach().cpu().numpy() if hasattr(log_probs, "detach") else np.asarray(log_probs)
    T, C = lp.shape

    # beams: prefix (tuple) -> (log p_b, log p_nb)
    beams: dict[tuple, tuple[float, float]] = {(): (0.0, NEG_INF)}

    for t in range(T):
        new_beams: dict[tuple, tuple[float, float]] = defaultdict(lambda: (NEG_INF, NEG_INF))

        # Restrict expansion to chars with prob above prune_threshold — huge speedup
        # (only a few chars are plausible per frame with a trained model).
        char_candidates = [c for c in range(C) if lp[t, c] > prune_threshold]
        if BLANK_IDX not in char_candidates:
            char_candidates.append(BLANK_IDX)

        for prefix, (p_b, p_nb) in beams.items():
            # Total log-prob of this prefix at step t-1 (needed for extensions).
            p_total_prev = _logsumexp2(p_b, p_nb)
            last = prefix[-1] if prefix else None

            # Option A: extend with blank — prefix unchanged, sets p_b only.
            blank_lp = lp[t, BLANK_IDX]
            cur_b, cur_nb = new_beams[prefix]
            new_beams[prefix] = (_logsumexp2(cur_b, p_total_prev + blank_lp), cur_nb)

            # Option B: extend with non-blank char c.
            for c in char_candidates:
                if c == BLANK_IDX:
                    continue
                c_lp = lp[t, c]
                if c == last:
                    # Two distinct emissions of same char — only via blank gap
                    new_prefix = prefix + (c,)
                    cur_b2, cur_nb2 = new_beams[new_prefix]
                    new_beams[new_prefix] = (cur_b2, _logsumexp2(cur_nb2, p_b + c_lp))
                    # Continuation of last non-blank char — prefix unchanged
                    cur_b3, cur_nb3 = new_beams[prefix]
                    new_beams[prefix] = (cur_b3, _logsumexp2(cur_nb3, p_nb + c_lp))
                else:
                    # New char emission — can come from blank or non-blank state
                    new_prefix = prefix + (c,)
                    cur_b4, cur_nb4 = new_beams[new_prefix]
                    new_beams[new_prefix] = (cur_b4, _logsumexp2(cur_nb4, p_total_prev + c_lp))

        # Prune to top-K by total log-prob
        def _total(pb_pnb: tuple[float, float]) -> float:
            return _logsumexp2(pb_pnb[0], pb_pnb[1])

        beams = dict(sorted(new_beams.items(), key=lambda kv: -_total(kv[1]))[:beam_width])

    # Pick best beam
    best_prefix, best_pbnb = max(beams.items(), key=lambda kv: _logsumexp2(kv[1][0], kv[1][1]))
    best_total = _logsumexp2(best_pbnb[0], best_pbnb[1])

    indices = list(best_prefix)
    text = "".join(idx_to_char.get(i, "?") for i in indices)
    # Per-emission average log-prob → confidence
    conf = math.exp(best_total / max(len(indices), 1)) if indices else 0.0
    return DecodeResult(text=text, confidence=conf, indices=indices)


@torch.no_grad()
def decode_batch(
    model: torch.nn.Module,
    inputs: torch.Tensor,
    input_lengths: list[int] | None = None,
    device: torch.device | None = None,
    entropy_threshold: float = 0.3,
    beam_width: int = 0,
) -> list[DecodeResult]:
    """
    Run model + decode on a batch. beam_width=0 uses greedy decode; >0 uses beam search.

    inputs: (B, T, in_channels)
    returns: list of B DecodeResults
    """
    if device is not None:
        inputs = inputs.to(device)

    log_probs = model.infer(inputs)  # (B, T//2, C)

    results = []
    for b in range(log_probs.shape[0]):
        lp = log_probs[b]
        il = input_lengths[b] if input_lengths else None
        if beam_width > 0:
            results.append(beam_search_decode(lp, il, beam_width=beam_width))
        else:
            results.append(greedy_decode_with_confidence(
                lp, il, entropy_threshold=entropy_threshold
            ))

    return results
