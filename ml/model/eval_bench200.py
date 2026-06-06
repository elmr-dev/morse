"""Re-eval bench200 with min_run_length=1 (model emits single-frame chars)."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import torch
from torch.utils.data import DataLoader

from data.dataset import CWDataset, collate_fn
from model.cwnet import CWNet, NUM_CLASSES
from training.metrics import compute_cer, BucketTracker
from eval.decode import greedy_decode_with_confidence

CKPT = "runs/20260414_022609/4090_best.pt"
DATA = "data/bench200/val"
OUT  = "runs/20260414_022609/bench200_results_minrun1.json"

device = torch.device("mps" if torch.backends.mps.is_available()
                     else "cuda" if torch.cuda.is_available() else "cpu")

sd = torch.load(CKPT, map_location=device, weights_only=True)
in_ch = sd[next(k for k in ("conv.0.conv.weight", "conv.0.weight") if k in sd)].shape[1]
model = CWNet(num_classes=NUM_CLASSES, gru_hidden=128, gru_layers=2,
              dropout=0.0, in_channels=in_ch).to(device).eval()
model.load_state_dict(sd)

ds = CWDataset(DATA, augment=False)
loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_fn, num_workers=0)

tracker = BucketTracker()
samples = []
with torch.no_grad():
    for inputs, _, targets, input_lengths, target_lengths, _, _, meta in loader:
        inputs = inputs.to(device)
        log_probs = model.infer(inputs)
        tgt_list, tgt_lens = targets.tolist(), target_lengths.tolist()
        pos = 0
        for b, tlen in enumerate(tgt_lens):
            tgt_idx = tgt_list[pos:pos+tlen]; pos += tlen
            res = greedy_decode_with_confidence(
                log_probs[b], int(input_lengths[b]),
                entropy_threshold=0.3,
                blank_ratio_threshold=0.999,
                min_run_length=1,
            )
            cer = compute_cer(res.indices, tgt_idx)
            tracker.add(cer, snr_db=meta["snr_db"][b], wpm=meta["wpm"][b],
                        impairment=meta["impairment"][b])
            samples.append({
                "text": meta["text"][b], "pred": res.text,
                "cer": round(cer, 4), "confidence": round(res.confidence, 4),
                "wpm": meta["wpm"][b], "snr_db": meta["snr_db"][b],
                "impairment": meta["impairment"][b],
            })

summary = tracker.summary()
summary["samples"] = samples
Path(OUT).parent.mkdir(parents=True, exist_ok=True)
json.dump(summary, open(OUT, "w"), indent=2)

print(f"\n=== Bench200 (min_run_length=1) ===")
print(f"Overall CER: {summary['overall']:.4f}  (n={summary['n']})")
print("\nBy SNR:")
for k, v in summary.get("snr", {}).items(): print(f"  {k:12s}: {v:.4f}")
print("\nBy WPM:")
for k, v in summary.get("wpm", {}).items(): print(f"  {k:8s}: {v:.4f}")
print("\nBy Impairment:")
for k, v in summary.get("impairment", {}).items(): print(f"  {k:14s}: {v:.4f}")
print(f"\nSaved → {OUT}")
