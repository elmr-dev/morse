"""Run bench200 with beam search, compare to greedy."""
import json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import torch
from torch.utils.data import DataLoader

from data.dataset import CWDataset, collate_fn
from model.cwnet import CWNet, NUM_CLASSES
from training.metrics import compute_cer, BucketTracker
from eval.decode import greedy_decode_with_confidence, beam_search_decode
from eval.evaluate import fine_grained_breakdown

CKPT = "runs/20260415_061240/4090_best.pt"
DATA = "data/bench200/val"
BEAM = 10

device = torch.device("mps" if torch.backends.mps.is_available()
                     else "cuda" if torch.cuda.is_available() else "cpu")

sd = torch.load(CKPT, map_location=device, weights_only=True)
tb = len({k.split(".")[1] for k in sd if k.startswith("tcn.")})
tc = sd["tcn.0.conv1.conv.weight"].shape[0] if tb else 128
m = CWNet(num_classes=NUM_CLASSES, gru_hidden=128, gru_layers=2,
          dropout=0.0, in_channels=3, tcn_channels=tc, tcn_blocks=tb).to(device).eval()
m.load_state_dict(sd)

ds = CWDataset(DATA, augment=False)
loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_fn, num_workers=0)

rows_greedy, rows_beam = [], []
diffs = []
t_start = time.time()
n_done = 0

with torch.no_grad():
    for inputs, targets, input_lengths, target_lengths, _, meta in loader:
        inputs = inputs.to(device)
        lp = m.infer(inputs)
        tgt_list, tgt_lens = targets.tolist(), target_lengths.tolist()
        pos = 0
        for b, tlen in enumerate(tgt_lens):
            tgt_idx = tgt_list[pos:pos+tlen]; pos += tlen
            L = int(input_lengths[b])

            g = greedy_decode_with_confidence(lp[b], L, entropy_threshold=0.3, min_run_length=1)
            be = beam_search_decode(lp[b], L, beam_width=BEAM)

            cer_g = compute_cer(g.indices, tgt_idx)
            cer_b = compute_cer(be.indices, tgt_idx)

            rec = dict(wpm=meta["wpm"][b], snr_db=meta["snr_db"][b],
                       impairment=meta["impairment"][b], text=meta["text"][b])
            rows_greedy.append({**rec, "pred": g.text, "cer": round(cer_g, 4),
                                "confidence": round(g.confidence, 4)})
            rows_beam.append({**rec, "pred": be.text, "cer": round(cer_b, 4),
                              "confidence": round(be.confidence, 4)})

            if g.text != be.text:
                diffs.append((rec["text"], g.text, be.text, cer_g, cer_b))
        n_done += len(tgt_lens)
        print(f"  {n_done}/200  ({time.time()-t_start:.1f}s)")

def summarise(rows, label):
    t = BucketTracker()
    for s in rows:
        t.add(s["cer"], s["snr_db"], s["wpm"], s["impairment"])
    summ = t.summary()
    summ["fine_breakdown"] = fine_grained_breakdown(rows)
    summ["samples"] = rows
    Path(f"runs/20260415_061240/bench200_{label}.json").write_text(json.dumps(summ, indent=2))
    return summ

s_g = summarise(rows_greedy, "greedy")
s_b = summarise(rows_beam,   f"beam{BEAM}")

print(f"\n=== Head-to-head (n={s_g['n']}) ===")
print(f"greedy:  overall={s_g['overall']:.4f}")
print(f"beam{BEAM}: overall={s_b['overall']:.4f}  Δ={s_b['overall']-s_g['overall']:+.4f}")
print(f"\nBy SNR:")
for k in sorted(s_g["snr"]):
    print(f"  {k:12s} greedy={s_g['snr'][k]:.4f}  beam={s_b['snr'][k]:.4f}  Δ={s_b['snr'][k]-s_g['snr'][k]:+.4f}")
print(f"\nBy WPM:")
for k in sorted(s_g["wpm"]):
    print(f"  {k:8s} greedy={s_g['wpm'][k]:.4f}  beam={s_b['wpm'][k]:.4f}  Δ={s_b['wpm'][k]-s_g['wpm'][k]:+.4f}")

# Target regime: 12-45 WPM, SNR >= -4 dB
tg = [(g, b) for g, b in zip(rows_greedy, rows_beam) if 12 <= g["wpm"] < 45 and g["snr_db"] >= -4]
perf_g = sum(1 for g, _ in tg if g["cer"] == 0)
perf_b = sum(1 for _, b in tg if b["cer"] == 0)
mean_g = sum(g["cer"] for g, _ in tg) / len(tg)
mean_b = sum(b["cer"] for _, b in tg) / len(tg)
print(f"\nTarget regime (12-45 WPM, SNR>=-4): n={len(tg)}")
print(f"  greedy: {perf_g}/{len(tg)} perfect, mean CER={mean_g:.4f}")
print(f"  beam:   {perf_b}/{len(tg)} perfect, mean CER={mean_b:.4f}")

# Show differences
print(f"\nSamples where beam differs from greedy ({len(diffs)} total):")
for truth, g, b, cg, cb in diffs[:25]:
    verdict = "WIN" if cb < cg else ("LOSS" if cb > cg else "tie")
    print(f"  [{verdict:4s}] truth={truth!r:22s} greedy({cg:.3f})={g!r:22s} beam({cb:.3f})={b!r}")
