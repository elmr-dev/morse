"""
Training loop for CWNet.

Two-phase training to avoid blank collapse:
  1. CE pre-training (ce_pretrain_epochs): CrossEntropy on per-frame labels
     with blank weight=0.2, char weight=3.0 to strongly push signal/silence distinction
  2. CTC fine-tuning (remaining): standard CTC + entropy regularizer (weight=0.03)
     to prevent hallucination at low SNR
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Sampler
from tqdm import tqdm

from data.dataset import CWDataset, collate_fn
from model.cwnet import CWNet, NUM_CLASSES
from training.metrics import greedy_decode, compute_cer, blank_ratio, BucketTracker


def build_model(cfg: dict) -> CWNet:
    model_cfg = cfg.get("model", {})
    return CWNet(
        num_classes=NUM_CLASSES,
        gru_hidden=model_cfg.get("gru_hidden", 128),
        gru_layers=model_cfg.get("gru_layers", 2),
        dropout=model_cfg.get("dropout", 0.2),
        in_channels=model_cfg.get("in_channels", 1),
    )


def _entropy_loss(log_probs: torch.Tensor) -> torch.Tensor:
    """Negative mean entropy — minimizing pushes toward uniform (prevents blank collapse)."""
    probs = log_probs.exp()  # (B, T, C)
    entropy = -(probs * log_probs).sum(dim=-1)  # (B, T)
    return -entropy.mean()   # negated — minimize this = maximize entropy


def _build_ce_weights(num_classes: int, device: torch.device,
                      blank_weight: float = 0.2, char_weight: float = 3.0) -> torch.Tensor:
    """
    Class weights for frame CE.

    Blank weight is low (0.2) and char weight is high (3.0) to push the model
    to strongly distinguish signal frames from silence frames during pre-training.
    This is the primary mechanism that reduces hallucination at low SNR.
    """
    weights = torch.ones(num_classes, device=device) * char_weight
    weights[0] = blank_weight  # blank class
    return weights


def train_one_epoch_blended(
    model: nn.Module,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    ctc_loss_fn: nn.CTCLoss,
    device: torch.device,
    ce_weight: float,
    ctc_weight: float,
    ce_blank_weight: float = 0.2,
    ce_char_weight: float = 3.0,
    scheduler: torch.optim.lr_scheduler.LRScheduler | None = None,
    entropy_weight: float = 0.0,
    phase_tag: str = "train",
) -> dict:
    """Blended CE+CTC epoch. ce_weight + ctc_weight should sum to 1.0."""
    model.train()
    total_loss = 0.0
    n_batches = 0

    ce_weights = _build_ce_weights(NUM_CLASSES, device, ce_blank_weight, ce_char_weight)
    ce_loss_fn = nn.CrossEntropyLoss(weight=ce_weights, ignore_index=-1)

    pbar = tqdm(loader, desc=f"  {phase_tag}", leave=False, dynamic_ncols=True)
    for inputs, targets, input_lengths, target_lengths, frame_labels, _meta in pbar:
        inputs = inputs.to(device)
        targets = targets.to(device)
        input_lengths = input_lengths.to(device)
        target_lengths = target_lengths.to(device)
        frame_labels = frame_labels.to(device)   # (B, T_out)

        optimizer.zero_grad()

        log_probs = model(inputs, input_lengths)   # (B, T_out, C)

        loss = torch.tensor(0.0, device=device)

        if ce_weight > 0:
            B, T_out, C = log_probs.shape
            ce_loss = ce_loss_fn(log_probs.reshape(B * T_out, C), frame_labels.reshape(B * T_out))
            loss = loss + ce_weight * ce_loss

        if ctc_weight > 0:
            log_probs_ctc = log_probs.transpose(0, 1)   # (T_out, B, C)
            ctc_loss = ctc_loss_fn(log_probs_ctc, targets, input_lengths, target_lengths)
            loss = loss + ctc_weight * ctc_loss
            if entropy_weight > 0:
                loss = loss + entropy_weight * _entropy_loss(log_probs)

        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        if scheduler is not None:
            scheduler.step()

        total_loss += loss.item()
        n_batches += 1
        br = blank_ratio(log_probs.detach())
        pbar.set_postfix(loss=f"{loss.item():.4f}", blank=f"{br:.2f}")

    return {"loss": total_loss / max(n_batches, 1)}


@torch.no_grad()
def evaluate(
    model: nn.Module,
    loader: DataLoader,
    ctc_loss: nn.CTCLoss,
    device: torch.device,
) -> dict:
    model.eval()
    total_loss = 0.0
    n_batches = 0
    tracker = BucketTracker()
    blank_ratios = []

    for inputs, targets, input_lengths, target_lengths, _frame_labels, meta in loader:
        inputs = inputs.to(device)
        targets_dev = targets.to(device)
        input_lengths = input_lengths.to(device)
        target_lengths = target_lengths.to(device)

        log_probs = model(inputs, input_lengths)           # (B, T//2, C)
        log_probs_ctc = log_probs.transpose(0, 1)         # (T//2, B, C)

        loss = ctc_loss(log_probs_ctc, targets_dev, input_lengths, target_lengths)
        total_loss += loss.item()
        n_batches += 1

        decoded_batch = greedy_decode(log_probs_ctc)
        blank_ratios.append(blank_ratio(log_probs))

        tgt_list = targets.tolist()
        tgt_lens  = target_lengths.tolist()
        pos = 0
        for b_idx, tgt_len in enumerate(tgt_lens):
            tgt_indices = tgt_list[pos: pos + tgt_len]
            pos += tgt_len
            cer = compute_cer(decoded_batch[b_idx], tgt_indices)
            tracker.add(
                cer,
                snr_db=meta["snr_db"][b_idx],
                wpm=meta["wpm"][b_idx],
                impairment=meta["impairment"][b_idx],
            )

    summary = tracker.summary()
    summary["loss"] = total_loss / max(n_batches, 1)
    summary["blank_ratio"] = sum(blank_ratios) / max(len(blank_ratios), 1)
    return summary


def _get_blend_weights(epoch: int, ce_pretrain_epochs: int, ce_blend_epochs: int) -> tuple[float, float]:
    """
    Returns (ce_weight, ctc_weight) for a given epoch.
    Epochs 1..ce_pretrain_epochs: pure CE (1.0, 0.0)
    Next ce_blend_epochs:         linear ramp from CE to CTC
    After that:                   pure CTC (0.0, 1.0)
    """
    if ce_pretrain_epochs == 0:
        return 0.0, 1.0
    if epoch <= ce_pretrain_epochs:
        return 1.0, 0.0
    blend = epoch - ce_pretrain_epochs
    if blend >= ce_blend_epochs:
        return 0.0, 1.0
    ctc_w = blend / ce_blend_epochs
    return 1.0 - ctc_w, ctc_w


class BucketSampler(Sampler):
    """Groups samples of similar length into batches to minimise padding."""
    def __init__(self, dataset: CWDataset, batch_size: int, shuffle: bool = True):
        self.batch_size = batch_size
        self.shuffle    = shuffle
        import os
        sizes = np.array([os.path.getsize(f) for f in dataset.files])
        self.sorted_indices = np.argsort(sizes).tolist()

    def __iter__(self):
        indices = self.sorted_indices.copy()
        batches = [indices[i:i + self.batch_size] for i in range(0, len(indices), self.batch_size)]
        if self.shuffle:
            np.random.shuffle(batches)
        for batch in batches:
            yield from batch

    def __len__(self):
        return len(self.sorted_indices)


def train_phase(
    model: nn.Module,
    train_dir: Path,
    val_dir: Path,
    out_dir: Path,
    cfg: dict,
    phase_name: str = "phase",
    starting_checkpoint: Path | None = None,
) -> float:
    """
    Train for one phase. Returns best val CER achieved.

    Loss schedule:
      epochs 1..ce_pretrain_epochs      — pure frame-level CE (weighted blank/char)
      next ce_blend_epochs              — linear blend CE→CTC
      remaining epochs                  — pure CTC + entropy regularizer (0.03)
    """
    device = _get_device(cfg)
    train_cfg = cfg.get("training", {})

    epochs = train_cfg.get("epochs", 60)
    ce_pretrain_epochs = train_cfg.get("ce_pretrain_epochs", 5)
    ce_blend_epochs = train_cfg.get("ce_blend_epochs", 3)
    batch_size = train_cfg.get("batch_size", 96)
    lr = train_cfg.get("lr", 2e-4)
    warmup_epochs = train_cfg.get("warmup_epochs", 3)
    num_workers = train_cfg.get("num_workers", 2)
    entropy_weight = train_cfg.get("entropy_weight", 0.03)
    ce_blank_weight = train_cfg.get("ce_blank_weight", 0.2)
    ce_char_weight = train_cfg.get("ce_char_weight", 3.0)

    train_ds = CWDataset(str(train_dir), augment=True)
    val_ds = CWDataset(str(val_dir), augment=False)

    pin = device.type == "cuda"
    train_loader = DataLoader(
        train_ds, batch_size=batch_size,
        sampler=BucketSampler(train_ds, batch_size, shuffle=True),
        collate_fn=collate_fn, num_workers=num_workers, pin_memory=pin,
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False,
        collate_fn=collate_fn, num_workers=num_workers, pin_memory=pin,
    )

    model = model.to(device)

    if starting_checkpoint is not None:
        state = torch.load(starting_checkpoint, map_location=device, weights_only=True)
        ckpt_in_ch = state["conv.0.weight"].shape[1]
        model_in_ch = model.conv[0].weight.shape[1]
        if ckpt_in_ch != model_in_ch:
            print(f"WARNING: checkpoint has {ckpt_in_ch} input channels, "
                  f"model has {model_in_ch} — skipping checkpoint, training from scratch")
        else:
            missing, unexpected = model.load_state_dict(state, strict=False)
            print(f"Loaded starting checkpoint: {starting_checkpoint}")
            if missing:
                print(f"  Missing keys: {missing}")
            if unexpected:
                print(f"  Unexpected keys (ignored): {unexpected}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)

    total_epochs = ce_pretrain_epochs + ce_blend_epochs + epochs
    total_steps = total_epochs * len(train_loader)
    warmup_steps = warmup_epochs * len(train_loader)
    scheduler = _warmup_cosine_scheduler(optimizer, warmup_steps, total_steps)

    ctc_loss = nn.CTCLoss(blank=0, reduction="mean", zero_infinity=True)

    out_dir.mkdir(parents=True, exist_ok=True)
    best_cer = float("inf")
    log = []

    total = ce_pretrain_epochs + ce_blend_epochs + epochs
    for epoch in range(1, total + 1):
        ce_w, ctc_w = _get_blend_weights(epoch, ce_pretrain_epochs, ce_blend_epochs)
        ew = entropy_weight if ctc_w > 0 else 0.0

        if ce_w == 1.0:
            phase_tag = "CE"
        elif ctc_w == 1.0:
            phase_tag = "CTC"
        else:
            phase_tag = f"{ce_w:.0%}CE"

        t0 = time.time()
        train_stats = train_one_epoch_blended(
            model, train_loader, optimizer, ctc_loss, device,
            ce_weight=ce_w, ctc_weight=ctc_w,
            ce_blank_weight=ce_blank_weight, ce_char_weight=ce_char_weight,
            scheduler=scheduler, entropy_weight=ew,
            phase_tag=phase_tag,
        )
        val_stats = evaluate(model, val_loader, ctc_loss, device)

        elapsed = time.time() - t0
        val_cer = val_stats["overall"]
        lr_now = optimizer.param_groups[0]["lr"]

        row = {
            "epoch": epoch,
            "ce_weight": round(ce_w, 2),
            "ctc_weight": round(ctc_w, 2),
            "train_loss": round(train_stats["loss"], 4),
            "val_loss": round(val_stats["loss"], 4),
            "val_cer": round(val_cer, 4),
            "blank_ratio": round(val_stats["blank_ratio"], 3),
            "lr": round(lr_now, 6),
            "elapsed_s": round(elapsed, 1),
        }
        log.append(row)

        print(
            f"[{phase_name}] {phase_tag} {epoch:3d}/{total}  "
            f"loss={row['train_loss']:.4f}  "
            f"val_loss={row['val_loss']:.4f}  "
            f"val_cer={val_cer:.4f}  "
            f"blank={row['blank_ratio']:.3f}  "
            f"lr={lr_now:.2e}  "
            f"({elapsed:.0f}s)"
        )

        torch.save(model.state_dict(), out_dir / f"{phase_name}_last.pt")

        if ctc_w > 0 and val_cer < best_cer:
            best_cer = val_cer
            torch.save(model.state_dict(), out_dir / f"{phase_name}_best.pt")
            print(f"  new best CER={best_cer:.4f} — checkpoint saved")

        with open(out_dir / f"{phase_name}_log.json", "w") as f:
            json.dump(log, f, indent=2)

    return best_cer


def _get_device(cfg: dict) -> torch.device:
    import os
    pref = cfg.get("device", "auto")
    if pref == "auto":
        if torch.backends.mps.is_available():
            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
            return torch.device("mps")
        elif torch.cuda.is_available():
            return torch.device("cuda")
        else:
            return torch.device("cpu")
    return torch.device(pref)


def _warmup_cosine_scheduler(
    optimizer: torch.optim.Optimizer,
    warmup_steps: int,
    total_steps: int,
) -> torch.optim.lr_scheduler.LambdaLR:
    import math

    def lr_lambda(step: int) -> float:
        if step < warmup_steps:
            return float(step + 1) / max(warmup_steps, 1)
        progress = (step - warmup_steps) / max(total_steps - warmup_steps, 1)
        return max(0.05, 0.5 * (1 + math.cos(math.pi * progress)))

    return torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
