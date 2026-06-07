"""Tabulate HSMM-vs-greedy results at the milestone-gate level."""
import json, math, os
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RUNS = REPO / "runs"

def load(p):
    p = Path(p)
    if not p.exists():
        return None
    with open(p) as f:
        return json.load(f)

def low_snr_summary(samples, snr_max=-10.0):
    n = ins = del_ = sub = tlen = plen = 0
    cer = 0.0
    for s in samples:
        if float(s.get("snr_db", 99)) > snr_max: continue
        n += 1
        cer += float(s.get("cer", 0))
        ins += int(s.get("n_ins", 0))
        del_ += int(s.get("n_del", 0))
        sub += int(s.get("n_sub", 0))
        tlen += int(s.get("target_len", 0))
        plen += int(s.get("pred_len", 0))
    if n == 0: return None
    return {
        "n": n, "mean_cer": cer/n,
        "ins_per_char": ins/max(tlen,1),
        "del_per_char": del_/max(tlen,1),
        "sub_per_char": sub/max(tlen,1),
        "len_ratio": plen/max(tlen,1),
        "n_ins": ins, "n_del": del_, "n_sub": sub,
    }

variants = [
    ("greedy CTC (local)",      "baseline_4ch_local.json"),
    ("HSMM oracle/model_blank", "hsmm_model_blank_oracle.json"),
    ("HSMM oracle/dsp_ch0",     "hsmm_dsp_ch0_oracle.json"),
    ("HSMM grid/model_blank",   "hsmm_model_blank_grid.json"),
    ("HSMM grid/dsp_ch0",       "hsmm_dsp_ch0_grid.json"),
]

print(f"{'Variant':<28} {'Overall':>9} {'≤-10dB':>9} {'ins/c':>8} {'del/c':>8} {'sub/c':>8} {'lenR':>7}")
print("-"*92)
base_cer_overall = base_cer_low = None
for label, f in variants:
    d = load(RUNS / f)
    if d is None: continue
    overall = d.get("overall", float("nan"))
    low = low_snr_summary(d.get("samples", []))
    if low is None:
        print(f"{label:<28} {overall:>9.4f}")
        continue
    if base_cer_overall is None:
        base_cer_overall = overall
        base_cer_low = low["mean_cer"]
    print(f"{label:<28} {overall:>9.4f} {low['mean_cer']:>9.4f} "
          f"{low['ins_per_char']:>8.4f} {low['del_per_char']:>8.4f} "
          f"{low['sub_per_char']:>8.4f} {low['len_ratio']:>7.3f}")

# Milestone gate
print()
print("Milestone gate: HSMM beats greedy CTC at <= -10dB CER.")
hsmm_oracle = load(RUNS / "hsmm_dsp_ch0_oracle.json") or load(RUNS / "hsmm_model_blank_oracle.json")
if hsmm_oracle is not None and base_cer_low is not None:
    h_low = low_snr_summary(hsmm_oracle.get("samples", []))
    if h_low:
        delta = h_low["mean_cer"] - base_cer_low
        verdict = "PASSES" if delta < 0 else "FAILS"
        print(f"  greedy <= -10dB CER: {base_cer_low:.4f}")
        print(f"  HSMM   <= -10dB CER: {h_low['mean_cer']:.4f}")
        print(f"  Δ = {delta:+.4f}  →  {verdict}")
