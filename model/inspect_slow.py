"""Inspect what the model actually outputs on a slow-WPM sample."""
import torch
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from data.dataset import CWDataset, collate_fn
from model.cwnet import CWNet, NUM_CLASSES, BLANK_IDX, idx_to_char
from torch.utils.data import DataLoader
from itertools import groupby

sd = torch.load('runs/20260414_222714/4090_best.pt', map_location='cpu', weights_only=True)
tcn_blocks = len({k.split('.')[1] for k in sd if k.startswith('tcn.')})
model = CWNet(num_classes=NUM_CLASSES, gru_hidden=128, gru_layers=2, dropout=0.0,
              in_channels=3, tcn_channels=128, tcn_blocks=tcn_blocks)
model.load_state_dict(sd); model.eval()

ds = CWDataset('data/bench200/val', augment=False)
# Pick a slow-WPM sample with decent SNR
for i in range(len(ds)):
    s = ds[i]
    if 12 <= s['wpm'] <= 20 and s['snr_db'] >= -2 and len(s['text']) >= 6:
        idx = i; break

print(f"Sample {idx}: wpm={s['wpm']:.1f} snr={s['snr_db']:.1f}dB text={s['text']!r}")

loader = DataLoader([s], batch_size=1, collate_fn=collate_fn)
inp, _, il, _, _, _, _ = next(iter(loader))
with torch.no_grad():
    lp = model.infer(inp)[0]
arg = lp.argmax(dim=-1).tolist()
T = len(arg)

dit_ms = 1200 / s['wpm']
out_frame_ms = 4  # 250 Hz output
print(f"  T_out frames: {T} ({T*out_frame_ms}ms)")
print(f"  dit @ {s['wpm']:.1f}wpm = {dit_ms:.0f}ms = {dit_ms/out_frame_ms:.1f} out frames")
print(f"  dah                = {dit_ms*3:.0f}ms = {dit_ms*3/out_frame_ms:.1f} out frames")

# Show all runs
runs = [(k, len(list(g))) for k, g in groupby(arg)]
nb_runs = [(idx_to_char.get(k, '?'), n) for k, n in runs if k != BLANK_IDX]
print(f"\n  non-blank emissions ({len(nb_runs)} chars vs truth {len(s['text'])}):")
for c, n in nb_runs:
    bar = '█' * min(n, 30)
    print(f"    {c!r:4s} {n:>3d}f ({n*out_frame_ms:>4d}ms)  {bar}")

# Confidence on each non-blank
probs = lp.exp()
nb_indices = [t for t, a in enumerate(arg) if a != BLANK_IDX]
if nb_indices:
    nb_probs = [probs[t, arg[t]].item() for t in nb_indices]
    print(f"\n  non-blank max-class prob: min={min(nb_probs):.3f} mean={sum(nb_probs)/len(nb_probs):.3f} max={max(nb_probs):.3f}")
