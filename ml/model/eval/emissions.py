"""
Frame-level tone-on/off log-likelihood-ratio sources for the HSMM decoder.

Three emission sources, all at 250 Hz (the model's output rate after the
stride-2 CNN):

  - model_blank: log p(non-blank) - log p(blank) per frame from the trained
    CTC model's log_softmax output. Note: spiky 1-frame-per-character peaks,
    not sustained envelopes — segment-scoring HSMM expects sustained on/off,
    so this source historically gave catastrophic CER. Kept for reference.

  - dsp_ch0: log P(tone-on | DSP ch0) - log P(tone-off | DSP ch0), where
    P(.|env) is fit from a held-out slice of the val set. Bypasses the
    trained model entirely. Right shape but mediocre AUC at very low SNR.

  - tone_head: raw logits from the auxiliary tone head trained alongside
    CTC (Phase 3). Sustained on/off envelopes that match the HSMM's
    segment-scoring expectation. logit = log-odds = LLR under sigmoid,
    so the raw logit IS the per-frame tone LLR — no calibration needed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import torch

from model.cwnet import BLANK_IDX


@dataclass
class DspCalibration:
    """1D logistic fit: P(tone-on | env_t) = sigmoid(a * env_t + b).

    LLR(t) = a * env_t + b   (the logit equals the log-odds, which equals the
    LLR of the logistic model at env_t).
    """
    a: float
    b: float

    def to_json(self) -> dict:
        return {"a": float(self.a), "b": float(self.b)}

    @classmethod
    def from_json(cls, d: dict) -> "DspCalibration":
        return cls(a=float(d["a"]), b=float(d["b"]))


def emissions_from_logits(log_probs: torch.Tensor | np.ndarray) -> np.ndarray:
    """Per-frame tone LLR from CTC log-probabilities.

    log_probs: (T, C) log-softmax — typically from CWNet.infer().

    Returns (T,) numpy array of LLR values where positive = tone present.

    Computation: `log p_nonblank - log p_blank`. The non-blank mass is the
    logsumexp of all character classes (everything except BLANK_IDX).
    """
    if isinstance(log_probs, torch.Tensor):
        lp = log_probs.detach().cpu().float().numpy()
    else:
        lp = np.asarray(log_probs, dtype=np.float32)

    log_p_blank = lp[:, BLANK_IDX]
    # Mask blank column to -inf, then logsumexp over remaining classes.
    masked = lp.copy()
    masked[:, BLANK_IDX] = -np.inf
    m = masked.max(axis=-1, keepdims=True)
    log_p_nonblank = (m.squeeze(-1)
                      + np.log(np.exp(masked - m).sum(axis=-1)))
    return (log_p_nonblank - log_p_blank).astype(np.float32)


def fit_dsp_ch0_calibration(
    envelopes_500hz: list[np.ndarray],
    frame_labels_250hz: list[np.ndarray],
    max_frames: int = 2_000_000,
) -> DspCalibration:
    """Fit logistic P(tone-on | env_t) on val data.

    envelopes_500hz: list of (T, n_ch) arrays at 500 Hz; ch0 is used.
    frame_labels_250hz: list of (T_out,) arrays; 0 = blank, !=0 = char.

    Downsamples env from 500 Hz → 250 Hz by averaging consecutive pairs to
    align with the label rate. Pools across all samples, caps at max_frames
    for tractable optimization.

    Returns DspCalibration with logit parameters (a, b).
    """
    from scipy.optimize import minimize

    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    total = 0
    for env, lbl in zip(envelopes_500hz, frame_labels_250hz):
        ch0 = env[:, 0] if env.ndim == 2 else env
        # 500 Hz -> 250 Hz via mean of consecutive pairs
        T = (ch0.shape[0] // 2) * 2
        ch0_250 = ch0[:T].reshape(-1, 2).mean(axis=-1)
        n = min(ch0_250.shape[0], lbl.shape[0])
        xs.append(ch0_250[:n].astype(np.float64))
        ys.append((lbl[:n] != BLANK_IDX).astype(np.float64))
        total += n
        if total >= max_frames:
            break
    x = np.concatenate(xs)
    y = np.concatenate(ys)
    if total > max_frames:
        idx = np.random.default_rng(0).choice(total, size=max_frames, replace=False)
        x = x[idx]
        y = y[idx]

    # Negative log-likelihood for logistic regression with parameters [a, b].
    # logit = a*x + b; p = sigmoid(logit); loss = -[y*logp + (1-y)*log(1-p)].
    # Use the numerically stable form: log(1+exp(-z)) when y=1, log(1+exp(z))
    # when y=0  →  softplus(-z)*y + softplus(z)*(1-y).
    def softplus(z):
        # Stable softplus for large |z|.
        return np.where(z > 0, z + np.log1p(np.exp(-z)), np.log1p(np.exp(z)))

    def neg_log_lik(params):
        a, b = params
        z = a * x + b
        return float((softplus(-z) * y + softplus(z) * (1 - y)).mean())

    def grad(params):
        a, b = params
        z = a * x + b
        # dL/dz = sigmoid(z) - y; mean over samples.
        sig = 1.0 / (1.0 + np.exp(-z))
        dz = sig - y
        return np.array([(dz * x).mean(), dz.mean()])

    res = minimize(neg_log_lik, x0=np.array([4.0, -2.0]), jac=grad, method="L-BFGS-B")
    a, b = float(res.x[0]), float(res.x[1])
    return DspCalibration(a=a, b=b)


def emissions_from_tone_head(tone_logits: torch.Tensor | np.ndarray) -> np.ndarray:
    """Per-frame tone LLR from the auxiliary tone head.

    tone_logits: (T,) raw logits from CWNet.tone_head — typically
    `model.infer_dual(x)[1][b]` for sample `b`.

    Returns (T,) numpy array. The raw logit equals the log-odds of
    P(tone-on | features) under the sigmoid head's logistic model, which
    is exactly the per-frame tone LLR the HSMM expects.
    """
    if isinstance(tone_logits, torch.Tensor):
        return tone_logits.detach().cpu().float().numpy()
    return np.asarray(tone_logits, dtype=np.float32)


def emissions_from_dsp(
    inputs: torch.Tensor | np.ndarray,
    calib: DspCalibration,
) -> np.ndarray:
    """Per-frame tone LLR from DSP ch0 envelope.

    inputs: (T, n_ch) at 500 Hz, channel 0 is the Hilbert amplitude envelope.
    calib: logistic parameters from fit_dsp_ch0_calibration.

    Returns (T_250,) numpy array of LLR values at 250 Hz, aligned with the
    model's logit output rate.
    """
    if isinstance(inputs, torch.Tensor):
        x = inputs.detach().cpu().float().numpy()
    else:
        x = np.asarray(inputs, dtype=np.float32)
    ch0 = x[:, 0] if x.ndim == 2 else x
    T = (ch0.shape[0] // 2) * 2
    ch0_250 = ch0[:T].reshape(-1, 2).mean(axis=-1)
    return (calib.a * ch0_250 + calib.b).astype(np.float32)


def emission_auc(emissions: np.ndarray, frame_labels: np.ndarray) -> float:
    """ROC-AUC of LLR vs binary tone labels, no sklearn dependency.

    Uses the rank-sum identity: AUC = (sum_pos_ranks - n_pos*(n_pos+1)/2) /
    (n_pos * n_neg).
    """
    y = (frame_labels != BLANK_IDX).astype(np.int8)
    n = y.shape[0]
    n_pos = int(y.sum())
    n_neg = n - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    n_emit = min(emissions.shape[0], n)
    e = emissions[:n_emit]
    y = y[:n_emit]
    order = np.argsort(e, kind="stable")
    ranks = np.empty(n_emit, dtype=np.float64)
    ranks[order] = np.arange(1, n_emit + 1, dtype=np.float64)
    # Tie-correction: average ranks within equal-emission groups.
    e_sorted = e[order]
    i = 0
    while i < n_emit:
        j = i
        while j + 1 < n_emit and e_sorted[j + 1] == e_sorted[i]:
            j += 1
        if j > i:
            avg = ranks[order[i:j+1]].mean()
            ranks[order[i:j+1]] = avg
        i = j + 1
    sum_pos_ranks = float(ranks[y == 1].sum())
    return (sum_pos_ranks - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
