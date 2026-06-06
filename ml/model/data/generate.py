"""
Generate training samples: WAV via TypeScript generator → 1-channel DSP → .npz

Usage:
    uv run python main.py generate --config configs/debug.yaml
    uv run python main.py generate --config configs/base.yaml

Each .npz contains:
    envelopes:    float32 (T, 1) at 500 Hz — IQ magnitude, sigmoid-sharpened
    frame_labels: int64  (T_out,)          — per-frame char labels for CE pre-training
    text:         str                      — ground truth text
    wpm:          float
    snr_db:       float
    impairment:   str
"""

from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf
from tqdm import tqdm

from data.dsp import process_wav, DSP_SAMPLE_RATE, ENVELOPE_SR

DOWNSAMPLE_FACTOR = DSP_SAMPLE_RATE // ENVELOPE_SR  # 16  (8000 → 500 Hz)
CNN_DOWNSAMPLE = 2  # 500 Hz → 250 Hz model output


# -- morse-generate discovery --

_MORSE_GENERATE_FALLBACKS = [
    Path(__file__).parent.parent.parent / "morse-audio" / "packages" / "morse-audio" / "node_modules" / ".bin" / "morse-generate",
    Path(__file__).parent.parent.parent.parent / "morse-audio" / "packages" / "morse-audio" / "node_modules" / ".bin" / "morse-generate",
]

def _morse_generate_cmd() -> list[str]:
    """Return command list for morse-generate, resolving fallback paths if needed."""
    if shutil.which("morse-generate"):
        return ["morse-generate"]
    for fb in _MORSE_GENERATE_FALLBACKS:
        if fb.exists():
            return [str(fb)]
    cli_js = Path(__file__).parent.parent.parent.parent / "morse-audio" / "packages" / "morse-audio" / "dist" / "generate-cli.js"
    if cli_js.exists():
        return ["node", str(cli_js)]
    cli_ts = Path(__file__).parent.parent.parent.parent / "morse-audio" / "packages" / "morse-audio" / "src" / "ml-training" / "generate-cli.ts"
    if cli_ts.exists() and shutil.which("npx"):
        return ["npx", "tsx", str(cli_ts)]
    raise FileNotFoundError(
        "morse-generate not found. Run 'pnpm install' in the morse-audio workspace."
    )


# -- Text corpus --

ALPHANUM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
SPECIAL_CHARS  = "?/"


def sample_text(rng: random.Random, max_chars: int) -> str:
    """Random alphanumeric text (~95%) with occasional special chars (~5%)."""
    n = rng.randint(max(4, max_chars - 4), max_chars)
    chars = []
    for _ in range(n):
        if rng.random() < 0.05:
            chars.append(rng.choice(SPECIAL_CHARS))
        else:
            chars.append(rng.choice(ALPHANUM_CHARS))
    return ''.join(chars)


def estimate_duration_sec(text: str, wpm: float, tail_sec: float = 0.5, max_sec: float = 15.0) -> float:
    """Estimate upper-bound clip duration for given text and WPM."""
    dit_sec = 60.0 / (50.0 * wpm)
    char_budget = 16 * dit_sec
    spaces = text.count(" ")
    duration = len(text) * char_budget + spaces * 4 * dit_sec + tail_sec
    return round(min(duration, max_sec), 2)


def _sample_snr(rng: random.Random, snr_tiers: dict) -> float:
    """Sample SNR from a tiered distribution."""
    roll = rng.random()
    cumulative = 0.0
    for tier in snr_tiers.values():
        cumulative += tier["weight"]
        if roll < cumulative:
            return round(rng.uniform(*tier["range"]), 1)
    last = list(snr_tiers.values())[-1]
    return round(rng.uniform(*last["range"]), 1)


def _sample_bucket(rng: random.Random, buckets: dict) -> tuple[str, dict]:
    """Pick a bucket by weight, return (name, bucket_cfg)."""
    roll = rng.random()
    cumulative = 0.0
    for name, bucket in buckets.items():
        cumulative += bucket["weight"]
        if roll < cumulative:
            return name, bucket
    last_name = list(buckets.keys())[-1]
    return last_name, buckets[last_name]


def _build_fist_options(rng: random.Random, fist_cfg: dict) -> dict:
    """Build FistOptions dict from a bucket's fist config."""
    def rr(key: str) -> float:
        lo, hi = fist_cfg[key]
        return round(rng.uniform(lo, hi), 4)
    return {
        "jitter":               rr("jitter_pct"),
        "dahBias":              rr("dah_bias"),
        "speedDriftWpmPerSec":  rr("speed_drift"),
        "charGapStretchFraction": rr("char_gap_stretch_frac"),
        "charGapStretchRange":  [
            round(fist_cfg["char_gap_stretch"][0], 2),
            round(fist_cfg["char_gap_stretch"][1], 2),
        ],
    }


def _add_impairments(sample_cfg: dict, imp: str, rng: random.Random,
                     snr_db: float = 0.0, snr_floor: float = -18.0) -> None:
    """Mutate sample_cfg in-place to add impairment-specific fields."""
    if imp == "qsb":
        headroom = snr_db - snr_floor
        if headroom <= 0:
            return
        max_depth = min(0.50, headroom / 20.0)
        max_depth = max(max_depth, 0.10)
        depth = round(rng.uniform(0.10, max_depth), 2)
        sample_cfg["ionosphericFading"] = {
            "depth": depth,
            "rate":  round(rng.uniform(0.3,  2.0),  2),
            "components": 3,
        }


def build_configs(
    n: int, cfg: dict, seed: int = 42,
    *, paired_clean_snr_db: float | None = None,
) -> list[dict]:
    """Build n sample configs from a data config dict.

    paired_clean_snr_db: if set, returns 2n configs interleaved (noisy_i,
    clean_i, noisy_{i+1}, clean_{i+1}, ...) — each pair shares text/wpm/
    fist/freq/seed and differs only in `noise.snrDb`. The clean variant is
    used by Phase 4b distillation as a teacher input. morse-audio's prng
    is deterministic per seed, so the underlying signal + noise pattern
    are bit-identical between variants; only the noise scale differs.
    """
    rng = random.Random(seed)
    max_chars = cfg.get("max_chars", 20)
    max_clip_s = cfg.get("max_clip_s", 15.0)

    use_buckets = "buckets" in cfg and "snr_tiers" in cfg

    configs = []
    for i in range(n):
        seed_i = seed * 10000 + i

        if use_buckets:
            snr = _sample_snr(rng, cfg["snr_tiers"])
            bucket_name, bucket = _sample_bucket(rng, cfg["buckets"])
            wpm = round(rng.uniform(*bucket["wpm"]), 1)
            imp = bucket.get("impairment", "clean")
            if isinstance(imp, dict):
                roll = rng.random()
                cum = 0.0
                for name, w in imp.items():
                    cum += w
                    if roll < cum:
                        imp = name
                        break
            fist_opts = _build_fist_options(rng, bucket["fist"])
        else:
            wpm_range = cfg.get("wpm_range", [16, 40])
            snr_range = cfg.get("snr_range", [0, 10])
            imp = "clean"
            wpm = round(rng.uniform(*wpm_range), 1)
            snr = round(rng.uniform(*snr_range), 1)
            jitter = rng.uniform(0.01, 0.15)
            fist_opts = {"jitter": round(jitter, 3)}
            bucket_name = "legacy"

        # Randomize tone frequency — model must work across 400–900 Hz range
        freq = rng.randint(400, 900)

        dit_sec = 60.0 / (50.0 * wpm)
        content_budget = max_clip_s - 2.0 - 1.5
        wpm_max_chars = int(content_budget / (16.0 * dit_sec))
        effective_max_chars = min(max_chars, max(4, wpm_max_chars))
        text = sample_text(rng, effective_max_chars)
        clip_dur = estimate_duration_sec(text, wpm, tail_sec=2.0, max_sec=max_clip_s)

        sample_cfg: dict = {
            "text": text,
            "wpm": wpm,
            "frequency": freq,
            "sampleRate": DSP_SAMPLE_RATE,
            "durationSec": clip_dur,
            "seed": seed_i,
            "noise": {"snrDb": snr},
            "fist": fist_opts,
            "_impairment": imp,
            "_snr": snr,
            "_wpm": wpm,
            "_bucket": bucket_name,
        }

        if use_buckets:
            snr_floor = min(t["range"][0] for t in cfg["snr_tiers"].values())
        else:
            snr_floor = cfg.get("snr_range", [0, 10])[0]
        _add_impairments(sample_cfg, imp, rng, snr_db=snr, snr_floor=snr_floor)

        configs.append(sample_cfg)

        if paired_clean_snr_db is not None:
            # Clean variant: identical seed/text/wpm/fist/freq, snrDb bumped
            # high so noise contribution is negligible. Used as teacher input
            # for KL distillation in training.
            clean_cfg = {
                **sample_cfg,
                "noise": {"snrDb": float(paired_clean_snr_db)},
                "_clean_pair": True,
            }
            # Strip impairments from the clean variant — we want the teacher
            # to see the cleanest possible signal.
            clean_cfg.pop("ionosphericFading", None)
            configs.append(clean_cfg)

    return configs


def run_ts_generator(configs: list[dict], out_dir: Path, gen_workers: int = 1) -> list[dict]:
    """Write JSONL and call the TypeScript batch generator."""
    out_dir.mkdir(parents=True, exist_ok=True)
    abs_out_dir = out_dir.resolve()

    n = len(configs)
    workers = min(gen_workers, n)
    chunk_size = math.ceil(n / workers)
    chunks = [configs[i:i + chunk_size] for i in range(0, n, chunk_size)]

    jsonl_paths: list[Path] = []
    meta_paths: list[Path] = []
    global_offset = 0
    for chunk_idx, chunk in enumerate(chunks):
        lines = []
        for local_i, cfg in enumerate(chunk):
            i = global_offset + local_i
            c = {k: v for k, v in cfg.items() if not k.startswith("_")}
            c["outputPath"] = str(abs_out_dir / f"wav_{i:06d}.wav")
            lines.append(json.dumps(c))

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=f"_{chunk_idx}.jsonl", delete=False, dir=abs_out_dir
        ) as f:
            jsonl_path = Path(f.name)
            f.write("\n".join(lines) + "\n")

        jsonl_paths.append(jsonl_path)
        meta_paths.append(abs_out_dir / f"_ts_metadata_{chunk_idx}.json")
        global_offset += len(chunk)

    print(f"Calling TS generator: {workers} worker(s) ({n} samples)")
    procs = []
    for jsonl_path, meta_path in zip(jsonl_paths, meta_paths):
        procs.append(subprocess.Popen(
            _morse_generate_cmd() + ["--from-jsonl", str(jsonl_path), "--output", str(meta_path)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ))

    failed = []
    for i, proc in enumerate(procs):
        rc = proc.wait()
        if rc != 0:
            failed.append(i)

    for p in jsonl_paths:
        p.unlink(missing_ok=True)

    if failed:
        print(f"ERROR: TS generator workers {failed} failed", file=sys.stderr)
        sys.exit(1)

    all_meta: list[dict] = []
    for meta_path in meta_paths:
        with open(meta_path) as f:
            chunk_meta = json.load(f)
        if not isinstance(chunk_meta, list):
            chunk_meta = [chunk_meta]
        for m in chunk_meta:
            # Strip down to only what _dsp_and_save_npz reads, and compact
            # `elements` from list-of-dicts to list-of-tuples. This keeps
            # per-task pickle payload small enough for ProcessPoolExecutor's
            # 64KB call-queue pipe — without this, 50k tasks deadlock.
            all_meta.append({
                "outputPath": m.get("outputPath", ""),
                "characters": m.get("characters", []),
                "elements":   _compact_elements(m.get("elements") or []),
            })
        meta_path.unlink(missing_ok=True)

    return all_meta


def build_frame_labels(
    characters: list[dict],
    total_samples: int,
    sample_rate: int = ENVELOPE_SR,
    downsample: int = CNN_DOWNSAMPLE,
) -> np.ndarray:
    """Build per-frame character labels from TS character timing."""
    from model.cwnet import char_to_idx

    T_out = total_samples // downsample
    labels = np.zeros(T_out, dtype=np.int64)

    for ch in characters:
        char = ch.get("char", "").upper()
        if char not in char_to_idx:
            continue
        label = char_to_idx[char]
        start_frame = int(ch["startMs"] / 1000.0 * sample_rate / downsample)
        end_frame   = int(ch["endMs"]   / 1000.0 * sample_rate / downsample)
        start_frame = max(0, min(start_frame, T_out - 1))
        end_frame   = max(0, min(end_frame,   T_out))
        labels[start_frame:end_frame] = label

    return labels


def _compact_elements(elements: list[dict]) -> list[tuple]:
    """Compact morse-audio element dicts to (startMs, endMs, is_on) tuples.

    The dict form (5+ string keys per element, ~150 bytes Python overhead per
    element after pickling) blows up ProcessPoolExecutor's IPC pipe at scale —
    50k tasks × 500 elements × dict-of-dicts deadlocks the call queue. Tuples
    drop ~50% of payload and pickle roughly an order of magnitude faster.
    """
    return [(float(e["startMs"]),
             float(e["endMs"]),
             e["elementType"] in ("dit", "dah"))
            for e in (elements or [])]


def build_tone_labels(
    elements: list[tuple],
    total_samples: int,
    sample_rate: int = ENVELOPE_SR,
    downsample: int = CNN_DOWNSAMPLE,
) -> np.ndarray:
    """Per-frame tone-on/off mask at the model output rate (250 Hz default).

    elements: list of (startMs, endMs, is_on) tuples — see `_compact_elements`.
    Marks frames inside any on-segment as 1; gap segments stay 0.
    """
    T_out = total_samples // downsample
    labels = np.zeros(T_out, dtype=np.uint8)
    for start_ms, end_ms, is_on in elements:
        if not is_on:
            continue
        start_frame = int(start_ms / 1000.0 * sample_rate / downsample)
        end_frame   = int(end_ms   / 1000.0 * sample_rate / downsample)
        start_frame = max(0, min(start_frame, T_out - 1))
        end_frame   = max(0, min(end_frame,   T_out))
        labels[start_frame:end_frame] = 1
    return labels


def _shift_chars(items: list[dict], offset_ms: float) -> list[dict]:
    """Return a copy of character dicts with startMs/endMs shifted by offset_ms."""
    return [{**it,
             "startMs": it["startMs"] + offset_ms,
             "endMs":   it["endMs"]   + offset_ms}
            for it in items]


def _shift_elements(elements: list[tuple], offset_ms: float) -> list[tuple]:
    """Return tuple list with start/end shifted by offset_ms."""
    return [(s + offset_ms, e + offset_ms, on) for (s, e, on) in elements]


def _augment_silence(
    env: np.ndarray, characters: list[dict], elements: list[tuple],
    rng_seed: int,
) -> tuple[np.ndarray, list[dict], list[tuple], str]:
    """Apply lead/tail/mid silence augmentation deterministically given rng_seed.

    Returns (augmented env, augmented characters, augmented elements,
    augmented text). The rng_seed is the only stochastic input — calling
    this with the same seed on a paired clean/noisy envelope pair (same
    underlying length and timing) produces identical augmentation, keeping
    the pair frame-aligned for distillation.
    """
    text = "".join(c["char"] for c in characters)
    if not characters:
        return env, characters, elements, text

    rng = np.random.default_rng(rng_seed)
    lead_ms = float(rng.uniform(0, 750))
    tail_ms = float(rng.uniform(0, 750))

    if rng.random() < 0.30:
        gap_ms  = float(rng.uniform(500, 2000))
        gap_pos = rng.choice(["lead", "tail", "mid"])
    else:
        gap_ms  = 0.0
        gap_pos = None

    if gap_pos == "lead":
        lead_ms += gap_ms
    elif gap_pos == "tail":
        tail_ms += gap_ms

    last_end_ms = max(c["endMs"] for c in characters)
    trim_samples = int((last_end_ms + tail_ms) * ENVELOPE_SR / 1000)
    env = env[:trim_samples]

    env_ms = len(env) * 1000.0 / ENVELOPE_SR
    characters = [c for c in characters if c["endMs"] <= env_ms]
    elements   = [(s, e, on) for (s, e, on) in elements if e <= env_ms]
    text = "".join(c["char"] for c in characters)

    lead_samples = int(lead_ms * ENVELOPE_SR / 1000)
    if lead_samples:
        env = np.concatenate([np.zeros((lead_samples, env.shape[1]), dtype=np.float32), env])
    lead_ms_actual = lead_samples * 1000.0 / ENVELOPE_SR
    characters = _shift_chars(characters, lead_ms_actual)
    elements   = _shift_elements(elements, lead_ms_actual)

    if gap_pos == "mid" and len(characters) >= 2:
        split_idx = int(rng.integers(1, len(characters)))
        insert_after_ms = characters[split_idx - 1]["endMs"]
        insert_samples  = int(gap_ms * ENVELOPE_SR / 1000)
        split_frame     = int(insert_after_ms * ENVELOPE_SR / 1000)
        split_frame     = min(split_frame, len(env))
        silence         = np.zeros((insert_samples, env.shape[1]), dtype=np.float32)
        env = np.concatenate([env[:split_frame], silence, env[split_frame:]])
        characters = [
            c if c["endMs"] <= insert_after_ms else
            {**c, "startMs": c["startMs"] + gap_ms, "endMs": c["endMs"] + gap_ms}
            for c in characters
        ]
        elements = [
            (s, e, on) if e <= insert_after_ms else (s + gap_ms, e + gap_ms, on)
            for (s, e, on) in elements
        ]

    return env, characters, elements, text


def _dsp_and_save_npz(
    i: int, cfg: dict, meta: dict, npz_dir: Path,
    *, meta_clean: dict | None = None,
) -> None:
    """Run DSP on one WAV (or a paired clean/noisy pair) and write sample_{i:06d}.npz.

    When meta_clean is provided, the NPZ also stores `envelopes_clean` —
    a frame-aligned high-SNR variant of the same Morse content for use as
    a distillation teacher input (Phase 4b).
    """
    freq = cfg["frequency"]
    wav_path = meta.get("outputPath", "")
    env = process_wav(wav_path, float(freq))  # (T, 1) at 500 Hz
    env_clean = (process_wav(meta_clean.get("outputPath", ""), float(freq))
                 if meta_clean is not None else None)

    characters = meta.get("characters", [])
    # elements arrive in compact tuple form (start_ms, end_ms, is_on) — see
    # _compact_elements() and run_ts_generator(). Dict form bloats pickle and
    # deadlocks ProcessPoolExecutor's call-queue pipe at scale.
    elements   = meta.get("elements") or []

    # rng seed derived from sample index + path. For paired pair members we
    # call _augment_silence with the SAME seed → identical augmentation →
    # frame-aligned envelopes_clean and envelopes.
    rng_seed = abs(hash((i, wav_path))) % (2**31)

    env, characters, elements, text = _augment_silence(
        env, characters, elements, rng_seed=rng_seed,
    )
    if env_clean is not None:
        # Re-run with the same seed; outputs except env are identical to
        # the noisy pass since the inputs (characters, elements) are the
        # same and rng is reseeded. We discard the duplicate metadata.
        env_clean, _, _, _ = _augment_silence(
            env_clean, meta.get("characters", []), meta.get("elements") or [],
            rng_seed=rng_seed,
        )

    frame_labels = build_frame_labels(characters, len(env), sample_rate=ENVELOPE_SR)
    tone_labels  = build_tone_labels(elements, len(env), sample_rate=ENVELOPE_SR)

    save_kwargs = dict(
        envelopes=env,
        frame_labels=frame_labels,
        tone_labels=tone_labels,
        text=np.array(text),
        wpm=np.array(cfg["_wpm"], dtype=np.float32),
        snr_db=np.array(cfg["_snr"], dtype=np.float32),
        impairment=np.array(cfg["_impairment"]),
    )
    if env_clean is not None:
        save_kwargs["envelopes_clean"] = env_clean
    np.savez_compressed(npz_dir / f"sample_{i:06d}.npz", **save_kwargs)


def _dsp_work(args: tuple) -> tuple[int, str | None]:
    """Picklable worker for ProcessPoolExecutor.

    args is one of:
      5-tuple:  (i, cfg, meta, npz_dir_str, keep_wav)               — single
      6-tuple:  (i, cfg, meta, meta_clean, npz_dir_str, keep_wav)   — paired
    """
    if len(args) == 5:
        i, cfg, meta, npz_dir_str, keep_wav = args
        meta_clean = None
    else:
        i, cfg, meta, meta_clean, npz_dir_str, keep_wav = args
    wav_path = meta.get("outputPath", "")
    wav_path_clean = meta_clean.get("outputPath", "") if meta_clean is not None else ""
    try:
        _dsp_and_save_npz(i, cfg, meta, Path(npz_dir_str), meta_clean=meta_clean)
        return i, None
    except Exception as e:
        return i, str(e)
    finally:
        if not keep_wav:
            for p in (wav_path, wav_path_clean):
                if p:
                    try:
                        Path(p).unlink(missing_ok=True)
                    except Exception:
                        pass


def generate_dataset(
    n: int,
    out_dir: Path,
    train_cfg: dict,
    seed: int = 42,
    keep_wav: bool = False,
    npz_subdir: str | None = None,
) -> None:
    """Generate n samples into out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    npz_dir = out_dir / npz_subdir if npz_subdir else out_dir
    npz_dir.mkdir(parents=True, exist_ok=True)

    gen_workers = train_cfg.get("gen_workers", 4)
    dsp_workers = train_cfg.get("dsp_workers", 4)
    paired_clean_snr_db = train_cfg.get("paired_clean_snr_db")  # None | float

    configs = build_configs(n, train_cfg, seed=seed,
                            paired_clean_snr_db=paired_clean_snr_db)
    meta_list = run_ts_generator(configs, out_dir, gen_workers=gen_workers)

    print(f"Running DSP on {n} samples ({dsp_workers} workers)"
          f"{' [paired clean+noisy]' if paired_clean_snr_db is not None else ''}...")
    if paired_clean_snr_db is not None:
        # configs[2*i] = noisy, configs[2*i+1] = clean. n_logical = n.
        args_list = [
            (i, configs[2*i], meta_list[2*i], meta_list[2*i + 1], str(npz_dir), keep_wav)
            for i in range(n)
        ]
    else:
        args_list = [(i, configs[i], meta_list[i], str(npz_dir), keep_wav) for i in range(n)]

    errors = []
    import os, time
    quiet = os.environ.get("CW_QUIET", "0") == "1"
    t0 = time.time()
    last_bucket = 0
    done = 0
    with ProcessPoolExecutor(max_workers=dsp_workers) as pool:
        if quiet:
            for i, err in pool.map(_dsp_work, args_list):
                done += 1
                if err:
                    errors.append((i, err))
                pct = int(100 * done / max(n, 1))
                bucket = (pct // 25) * 25
                if bucket > last_bucket and bucket > 0:
                    last_bucket = bucket
                    print(f"  DSP {bucket:>3d}%  ({done}/{n}, {time.time()-t0:.0f}s)", flush=True)
        else:
            for i, err in tqdm(pool.map(_dsp_work, args_list), total=n, desc="DSP"):
                if err:
                    errors.append((i, err))

    if errors:
        print(f"\nDSP errors ({len(errors)}/{n}):")
        for i, err in errors[:10]:
            print(f"  [{i}] {err}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more")

    print(f"Generated {n - len(errors)} samples in {npz_dir}")
