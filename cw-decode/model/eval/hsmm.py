"""
Morse-grammar HSMM/Viterbi decoder over per-frame tone log-likelihood-ratios.

Replaces (or augments) the model's CTC greedy/beam decoder with an
explicit-duration HSMM whose state graph is the Morse code grammar:

  text -> char1 -> [seg1 seg2 ...] -> intra-char-gap -> ... -> inter-char-gap
                                                                     |
                                                                     v
                                                                   char2 -> ...

Each segment has a Gaussian duration prior centered at the nominal
1/3-unit duration for the chosen WPM. The decoder beam-searches over
character sequences and segment durations and reports the best path.

Frame rate is 250 Hz to match `CWNet.infer()` output. The emissions input
is per-frame tone LLR (positive = tone present); see `eval/emissions.py`.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from eval.decode import DecodeResult
from model.cwnet import idx_to_char, char_to_idx, BLANK_IDX, CHARS

FRAME_RATE_HZ = 250.0


# --- Morse code table -------------------------------------------------------

_MORSE = {
    "A": ".-",     "B": "-...",   "C": "-.-.",   "D": "-..",   "E": ".",
    "F": "..-.",   "G": "--.",    "H": "....",   "I": "..",    "J": ".---",
    "K": "-.-",    "L": ".-..",   "M": "--",     "N": "-.",    "O": "---",
    "P": ".--.",   "Q": "--.-",   "R": ".-.",    "S": "...",   "T": "-",
    "U": "..-",    "V": "...-",   "W": ".--",    "X": "-..-",  "Y": "-.--",
    "Z": "--..",
    "0": "-----",  "1": ".----",  "2": "..---",  "3": "...--", "4": "....-",
    "5": ".....",  "6": "-....",  "7": "--...",  "8": "---..", "9": "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "=": "-...-", "/": "-..-.",
}


def _pattern_to_segments(pattern: str) -> list[tuple[bool, int]]:
    """Convert a dit/dah string to a list of (is_on, nominal_units) segments,
    INCLUDING the trailing 3-unit inter-character gap at the end."""
    segs: list[tuple[bool, int]] = []
    for i, sym in enumerate(pattern):
        on_units = 1 if sym == "." else 3
        segs.append((True, on_units))
        if i < len(pattern) - 1:
            segs.append((False, 1))           # intra-character gap
    segs.append((False, 3))                   # inter-character gap (trailing)
    return segs


# Character index (0=blank reserved by CTC; we use 1..41 as in cwnet.py) -> segment list.
CHAR_SEGMENTS: dict[int, list[tuple[bool, int]]] = {
    char_to_idx[c]: _pattern_to_segments(p) for c, p in _MORSE.items()
}
ACTIVE_CHAR_IDS = sorted(CHAR_SEGMENTS.keys())  # 1..41


def wpm_to_unit_frames(wpm: float, frame_rate_hz: float = FRAME_RATE_HZ) -> float:
    """Standard PARIS definition: 1 WPM = 50 dot-units per minute.
    dot_seconds = 1.2 / wpm; unit_frames = frame_rate * 1.2 / wpm.
    """
    return frame_rate_hz * 1.2 / wpm


# --- Hypothesis -------------------------------------------------------------

@dataclass(order=True)
class _Hypo:
    # First field is the heap key (negative score for max-heap via heapq min-heap).
    neg_score: float
    t: int = field(compare=False)              # frame index where the next segment begins
    in_char: bool = field(compare=False)       # True if currently inside a character (between its segments)
    char_idx: int = field(compare=False)       # which character (1..41); only meaningful if in_char
    seg_idx: int = field(compare=False)        # next segment index within current character's pattern
    text: tuple = field(compare=False)         # tuple of completed character indices

    @property
    def score(self) -> float:
        return -self.neg_score


# --- Decoder ----------------------------------------------------------------

_DEFAULT_CHAR_LOG_PRIOR = -math.log(len(_MORSE))  # uniform over the 41-char alphabet


def hsmm_decode(
    emissions: np.ndarray,
    wpm: Optional[float] = None,
    wpm_grid: tuple[float, float, float] = (12.0, 60.0, 1.0),
    wpm_search: str = "coarse-fine",
    duration_sigma_frac: float = 0.30,
    duration_options: int = 5,
    inter_gap_sigma_frac: float = 0.50,
    char_log_prior: float = _DEFAULT_CHAR_LOG_PRIOR,
    beam_width: int = 50,
    end_slack_frames: int = 30,
    frame_rate_hz: float = FRAME_RATE_HZ,
) -> DecodeResult:
    """Decode a per-frame tone-LLR sequence into Morse text.

    emissions: (T,) tone LLR at frame_rate_hz. Positive = tone present.
    wpm: oracle WPM if known (debug upper bound). If None, search wpm_grid.
    wpm_grid: (start, stop_inclusive, step) WPM values to search.
    duration_sigma_frac: σ as fraction of nominal duration (for dit/dah/intra-gap).
        Wide priors absorb modest fist drift.
    duration_options: number of duration values per segment (centered around nominal).
    inter_gap_sigma_frac: σ fraction for inter-char gap (humans pause variably).
    beam_width: beam pruning width per (frame, in_char) bucket.
    end_slack_frames: tolerance at end of clip for a hypothesis to be considered terminal.

    Returns DecodeResult with text, mean per-frame log-likelihood as confidence,
    and indices.
    """
    if emissions.ndim != 1:
        emissions = emissions.reshape(-1)
    T = int(emissions.shape[0])
    if T == 0:
        return DecodeResult(text="", confidence=0.0, indices=[])

    # Cumulative sum over emissions for O(1) segment scoring.
    cum = np.concatenate(([0.0], np.cumsum(emissions.astype(np.float64))))

    def run_one(w: float) -> Optional[tuple[float, list[int]]]:
        return _decode_one_wpm(
            cum=cum, T=T,
            unit_frames=wpm_to_unit_frames(w, frame_rate_hz),
            duration_sigma_frac=duration_sigma_frac,
            duration_options=duration_options,
            inter_gap_sigma_frac=inter_gap_sigma_frac,
            char_log_prior=char_log_prior,
            beam_width=beam_width,
            end_slack_frames=end_slack_frames,
        )

    best_overall: Optional[tuple[float, list[int]]] = None  # (score, text_indices)

    if wpm is not None:
        # Oracle mode: single fixed WPM.
        result = run_one(float(wpm))
        if result is not None:
            best_overall = result
    elif wpm_search == "coarse-fine":
        # Two-pass: coarse 4-WPM grid finds best, fine 1-WPM grid refines ±2.
        start, stop, _ = wpm_grid
        coarse = [start + i * 4.0 for i in range(int((stop - start) / 4.0) + 1)]
        if coarse[-1] < stop:
            coarse.append(stop)
        coarse_results: list[tuple[float, float]] = []  # (wpm, score)
        for w in coarse:
            r = run_one(w)
            if r is not None:
                coarse_results.append((w, r[0]))
                if best_overall is None or r[0] > best_overall[0]:
                    best_overall = r
        if coarse_results:
            best_w = max(coarse_results, key=lambda x: x[1])[0]
            fine_lo = max(start, best_w - 2.0)
            fine_hi = min(stop, best_w + 2.0)
            n_fine = int(round(fine_hi - fine_lo)) + 1
            fine = [fine_lo + i for i in range(n_fine)]
            for w in fine:
                if any(abs(w - cw) < 0.01 for cw in coarse):
                    continue  # already tried in coarse pass
                r = run_one(w)
                if r is not None and (best_overall is None or r[0] > best_overall[0]):
                    best_overall = r
    else:
        # Plain grid: every step from start to stop.
        start, stop, step = wpm_grid
        n = int(round((stop - start) / step)) + 1
        for i in range(n):
            w = start + i * step
            r = run_one(w)
            if r is not None and (best_overall is None or r[0] > best_overall[0]):
                best_overall = r

    if best_overall is None:
        return DecodeResult(text="", confidence=0.0, indices=[])

    score, indices = best_overall
    text = "".join(idx_to_char.get(i, "?") for i in indices)
    # Confidence = mean per-frame log-likelihood (higher = better evidence).
    conf = math.exp(min(0.0, score / max(T, 1)))
    return DecodeResult(text=text, confidence=conf, indices=list(indices))


# --- WPM-conditional Viterbi -----------------------------------------------

def _decode_one_wpm(
    cum: np.ndarray,
    T: int,
    unit_frames: float,
    duration_sigma_frac: float,
    duration_options: int,
    inter_gap_sigma_frac: float,
    char_log_prior: float,
    beam_width: int,
    end_slack_frames: int,
) -> Optional[tuple[float, list[int]]]:
    """Frame-synchronized beam search for the best Morse decoding at fixed WPM.

    Single global beam per frame — at frame t, take top-K hypotheses (mix of
    idle and in-char) and expand each by one segment commitment.
    """
    grids = _build_duration_grids(
        unit_frames=unit_frames,
        duration_sigma_frac=duration_sigma_frac,
        duration_options=duration_options,
        inter_gap_sigma_frac=inter_gap_sigma_frac,
    )

    # beams[t] is a list of _Hypo landing exactly at frame t. Mixed idle and
    # in-char states. Pruned to beam_width on entry.
    beams: dict[int, list[_Hypo]] = {0: [_Hypo(
        neg_score=0.0, t=0, in_char=False, char_idx=0, seg_idx=0, text=()
    )]}
    # Track frames that have content.
    pending: list[int] = [0]

    finished: list[_Hypo] = []

    while pending:
        t = heapq.heappop(pending)
        if t > T:
            continue
        bucket = beams.pop(t, None)
        if bucket is None:
            continue
        # Global beam prune at this frame.
        if len(bucket) > beam_width:
            bucket.sort(key=lambda h: h.neg_score)  # ascending neg = descending score
            del bucket[beam_width:]

        for h in bucket:
            if not h.in_char:
                # Termination: idle anywhere is a valid terminal state — the
                # remaining frames are absorbed as background silence at no
                # text cost. We pick the best terminal-score among all idle
                # hypotheses across all frames.
                rem = T - t
                tail_silence_score = -(cum[T] - cum[t])  # off-segment over remaining
                terminal_score = h.score + float(tail_silence_score)
                finished.append(_Hypo(
                    neg_score=-terminal_score, t=T,
                    in_char=False, char_idx=0, seg_idx=0,
                    text=h.text,
                ))
                if t >= T:
                    continue
                # Idle can advance by an off-segment of any length k frames at
                # no character cost. We expose a small grid of jump lengths so
                # the decoder can skip over silence between/before characters
                # without enumerating every single frame.
                for k in (1, 4, 16, 64):
                    new_t = t + k
                    if new_t > T:
                        continue
                    skip_score = h.score - float(cum[new_t] - cum[t])
                    nh = _Hypo(
                        neg_score=-skip_score, t=new_t,
                        in_char=False, char_idx=0, seg_idx=0, text=h.text,
                    )
                    _push(beams, pending, nh, beam_width)
                # Start each candidate character — emit its first segment.
                for c_idx in ACTIVE_CHAR_IDS:
                    segs = CHAR_SEGMENTS[c_idx]
                    is_on, units = segs[0]
                    for d, lp in grids[(is_on, units)]:
                        new_t = t + d
                        if new_t > T:
                            continue
                        seg_s = (cum[new_t] - cum[t]) if is_on else -(cum[new_t] - cum[t])
                        new_score = h.score + float(seg_s) + lp
                        nh = _Hypo(
                            neg_score=-new_score, t=new_t,
                            in_char=True, char_idx=c_idx, seg_idx=1,
                            text=h.text,
                        )
                        _push(beams, pending, nh, beam_width)
            else:
                # In-char: emit next segment.
                segs = CHAR_SEGMENTS[h.char_idx]
                is_on, units = segs[h.seg_idx]
                is_last = (h.seg_idx + 1 == len(segs))
                for d, lp in grids[(is_on, units)]:
                    new_t = t + d
                    if new_t > T:
                        continue
                    seg_s = (cum[new_t] - cum[t]) if is_on else -(cum[new_t] - cum[t])
                    new_score = h.score + float(seg_s) + lp
                    if is_last:
                        nh = _Hypo(
                            neg_score=-(new_score + char_log_prior), t=new_t,
                            in_char=False, char_idx=0, seg_idx=0,
                            text=h.text + (h.char_idx,),
                        )
                    else:
                        nh = _Hypo(
                            neg_score=-new_score, t=new_t,
                            in_char=True, char_idx=h.char_idx, seg_idx=h.seg_idx + 1,
                            text=h.text,
                        )
                    _push(beams, pending, nh, beam_width)

    if not finished:
        return None
    finished.sort(key=lambda h: -h.score)
    best = finished[0]
    return (best.score, list(best.text))


def _push(beams: dict, pending: list, h: _Hypo, beam_width: int):
    bucket = beams.get(h.t)
    if bucket is None:
        bucket = []
        beams[h.t] = bucket
        heapq.heappush(pending, h.t)
    bucket.append(h)
    # Light per-frame cap to avoid unbounded growth before the beam-prune
    # at frame entry. 4x beam_width is plenty of headroom.
    if len(bucket) > beam_width * 4:
        bucket.sort(key=lambda x: x.neg_score)
        del bucket[beam_width:]


def _build_duration_grids(
    unit_frames: float,
    duration_sigma_frac: float,
    duration_options: int,
    inter_gap_sigma_frac: float,
) -> dict:
    """Pre-compute duration choice grids and log-priors for each segment kind.

    Segment kinds:
      ('on', 1)   -- dit
      ('on', 3)   -- dah
      ('off', 1)  -- intra-character gap
      ('off', 3)  -- inter-character gap (trailing)
    """
    grids: dict[tuple[bool, int], list[tuple[int, float]]] = {}
    for is_on, units in [(True, 1), (True, 3), (False, 1), (False, 3)]:
        nominal = units * unit_frames
        # σ depends on whether this is the inter-char gap.
        if (not is_on) and units == 3:
            sigma = max(inter_gap_sigma_frac * nominal, 1.0)
        else:
            sigma = max(duration_sigma_frac * nominal, 1.0)

        # Discrete duration options spaced symmetrically across ±2σ.
        if duration_options <= 1:
            offsets = [0.0]
        else:
            offsets = np.linspace(-2.0, 2.0, duration_options)
        durations = []
        for k in offsets:
            d_float = nominal + k * sigma
            d = max(1, int(round(d_float)))
            # log-prior of Gaussian, ignoring constant terms (constant across
            # candidates so doesn't affect argmax for the same segment).
            log_prior = -0.5 * ((d - nominal) / sigma) ** 2
            durations.append((d, log_prior))
        # Deduplicate by integer duration, keep best log_prior.
        dedup: dict[int, float] = {}
        for d, lp in durations:
            if d not in dedup or lp > dedup[d]:
                dedup[d] = lp
        grids[(is_on, units)] = sorted(dedup.items())
    return grids


def _segment_score(cum: np.ndarray, t0: int, t1: int, is_on: bool) -> float:
    """Sum of LLRs in [t0, t1) is the on-segment score; negate for off.

    LLR is positive when tone is present, so on-segment likes positive sums,
    off-segment likes negative sums.
    """
    s = float(cum[t1] - cum[t0])
    return s if is_on else -s




# --- Convenience: synthesize a noiseless emissions sequence for testing -----

def synthesize_emissions_for_text(
    text: str,
    wpm: float,
    snr_llr: float = 8.0,
    frame_rate_hz: float = FRAME_RATE_HZ,
    pre_silence_frames: int = 0,
    post_silence_frames: int = 0,
) -> np.ndarray:
    """Build a clean LLR trace for `text` at WPM. Used by the smoke test.

    +snr_llr in tone segments, -snr_llr in gaps, no noise.
    """
    unit = wpm_to_unit_frames(wpm, frame_rate_hz)
    e: list[float] = []
    e.extend([-snr_llr] * pre_silence_frames)
    chars = [c for c in text.upper() if c in _MORSE]
    for ci, c in enumerate(chars):
        for i, sym in enumerate(_MORSE[c]):
            on_units = 1 if sym == "." else 3
            d = max(1, int(round(on_units * unit)))
            e.extend([snr_llr] * d)
            if i < len(_MORSE[c]) - 1:
                d_g = max(1, int(round(unit)))
                e.extend([-snr_llr] * d_g)
        # Inter-char gap; final char also gets a trailing gap.
        d_inter = max(1, int(round(3 * unit)))
        e.extend([-snr_llr] * d_inter)
    e.extend([-snr_llr] * post_silence_frames)
    return np.array(e, dtype=np.float32)
