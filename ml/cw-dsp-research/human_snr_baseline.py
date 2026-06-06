"""
Run a human-in-the-loop SNR threshold probe for five-character CW tokens.

Each trial generates one synthetic CW clip with:
  - 5 random characters: 4 letters + 1 digit, shuffled
  - 650 Hz tone
  - 25-35 WPM
  - fixed-level Gaussian static mixed locally

The clip is played on repeat until a guess is entered. The truth and SNR are
revealed only after the guess, and results are saved for later analysis.

Usage:
    uv run python human_snr_baseline.py
    uv run python human_snr_baseline.py --trials 20 --snr-start -6
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import shlex
import shutil
import signal
import subprocess
import struct
import tempfile
import time
import wave
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from constants import AUDIO_SR


HERE = Path(__file__).resolve().parent
MORSE_AUDIO_DIR = HERE.parent.parent / "morse-audio"
GENERATE_CLI = MORSE_AUDIO_DIR / "packages" / "morse-audio" / "src" / "ml-training" / "generate-cli.ts"

DEFAULT_OUT_DIR = HERE / "human_baseline_audio"
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGITS = "0123456789"


@dataclass
class TrialResult:
    trial: int
    text: str
    guess: str
    exact: bool
    char_accuracy: float
    edit_distance: int
    snr_db: float
    next_snr_db: float
    wpm: float
    tone_hz: float
    wav_path: str
    seed: int
    listened_sec: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Human CW SNR baseline runner")
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--snr-start", type=float, default=-6.0)
    parser.add_argument("--snr-min", type=float, default=-24.0)
    parser.add_argument("--snr-max", type=float, default=8.0)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--fixed-noise-rms", type=float, default=0.025)
    parser.add_argument("--play-volume", type=float, default=0.35)
    parser.add_argument("--no-play", action="store_true", help="Generate and score without launching audio playback")
    parser.add_argument("--show-snr-before-guess", action="store_true")
    return parser.parse_args()


def random_token(rng: random.Random) -> str:
    chars = [rng.choice(DIGITS)] + [rng.choice(LETTERS) for _ in range(4)]
    rng.shuffle(chars)
    return "".join(chars)


def normalize_guess(value: str) -> str:
    return "".join(ch for ch in value.upper() if ch.isalnum())


def levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        for j, cb in enumerate(b, start=1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def read_wav_mono_float(path: Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
    if sw != 2:
        raise ValueError(f"expected 16-bit WAV, got sample width {sw}")
    values = struct.unpack("<" + "h" * (len(raw) // 2), raw)
    if nch > 1:
        mono = [sum(values[i : i + nch]) / nch for i in range(0, len(values), nch)]
    else:
        mono = list(values)
    return [v / 32768.0 for v in mono], sr


def write_wav_mono_float(path: Path, samples: list[float], sample_rate: int) -> None:
    clipped = [max(-0.999, min(0.999, x)) for x in samples]
    ints = [int(round(x * 32767.0)) for x in clipped]
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack("<" + "h" * len(ints), *ints))


def rms(samples: list[float]) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(x * x for x in samples) / len(samples))


def gaussian_noise(rng: random.Random, n: int, target_rms: float) -> list[float]:
    values: list[float] = []
    while len(values) < n:
        u1 = max(rng.random(), 1e-12)
        u2 = rng.random()
        mag = math.sqrt(-2.0 * math.log(u1))
        values.append(mag * math.cos(2.0 * math.pi * u2))
        if len(values) < n:
            values.append(mag * math.sin(2.0 * math.pi * u2))
    current = rms(values)
    scale = target_rms / current if current > 0 else 0.0
    return [x * scale for x in values]


def mix_fixed_noise(clean_path: Path, wav_path: Path, snr_db: float, seed: int, fixed_noise_rms: float) -> None:
    clean, sample_rate = read_wav_mono_float(clean_path)
    clean_rms = rms(clean)
    if clean_rms <= 0:
        raise ValueError("clean generated CW has zero RMS")

    signal_target_rms = fixed_noise_rms * math.pow(10.0, snr_db / 20.0)
    signal_scale = signal_target_rms / clean_rms
    noise = gaussian_noise(random.Random(seed), len(clean), fixed_noise_rms)
    mixed = [clean[i] * signal_scale + noise[i] for i in range(len(clean))]
    write_wav_mono_float(wav_path, mixed, sample_rate)


def generate_clip(text: str, wpm: float, snr_db: float, seed: int, wav_path: Path, fixed_noise_rms: float) -> None:
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    cfg = {
        "text": text,
        "wpm": float(wpm),
        "frequency": 650.0,
        "sampleRate": AUDIO_SR,
        "durationSec": 4,
        "seed": int(seed),
        # Use morse-audio for CW synthesis/timing, but mix threshold-test noise
        # locally so the static floor stays constant across SNR changes.
        "noise": {"snrDb": 80.0},
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        cfg_path = Path(tmpdir) / "config.json"
        clean_path = Path(tmpdir) / "clean.wav"
        cfg_path.write_text(json.dumps(cfg), encoding="utf-8")
        result = subprocess.run(
            [
                "npx",
                "tsx",
                str(GENERATE_CLI),
                "--from-json",
                str(cfg_path),
                "-o",
                str(clean_path),
            ],
            cwd=str(MORSE_AUDIO_DIR),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            mix_fixed_noise(clean_path, wav_path, snr_db, seed + 1, fixed_noise_rms)
    if result.returncode != 0:
        raise RuntimeError(f"morse-audio generator failed:\n{result.stderr}\n{result.stdout}")


def find_player() -> str | None:
    for cmd in ("afplay", "ffplay", "play", "paplay", "aplay"):
        path = shutil.which(cmd)
        if path:
            return path
    return None


def window_rms(samples: list[float], sample_rate: int, start_sec: float, end_sec: float) -> float:
    start = max(0, min(len(samples), int(start_sec * sample_rate)))
    end = max(start, min(len(samples), int(end_sec * sample_rate)))
    return rms(samples[start:end])


def analyze_clip(wav_path: Path) -> dict[str, float]:
    samples, sample_rate = read_wav_mono_float(wav_path)
    pad_rms = (window_rms(samples, sample_rate, 0.0, 0.8) + window_rms(samples, sample_rate, 3.6, 4.0)) / 2.0
    content_rms = window_rms(samples, sample_rate, 1.0, 3.4)
    return {
        "pad_rms": pad_rms,
        "content_rms": content_rms,
        "content_to_pad": content_rms / pad_rms if pad_rms > 0 else 0.0,
        "peak": max(abs(x) for x in samples) if samples else 0.0,
    }


def start_repeating_playback(player: str, wav_path: Path, volume: float) -> subprocess.Popen:
    quoted = shlex.quote(str(wav_path))
    if Path(player).name == "ffplay":
        command = f"while true; do {shlex.quote(player)} -nodisp -autoexit -loglevel quiet -volume {int(volume * 100)} {quoted}; sleep 0.2; done"
    elif Path(player).name == "afplay":
        command = f"while true; do {shlex.quote(player)} -v {shlex.quote(str(volume))} {quoted}; sleep 0.2; done"
    else:
        command = f"while true; do {shlex.quote(player)} {quoted}; sleep 0.2; done"
    return subprocess.Popen(
        ["sh", "-c", command],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid if hasattr(os, "setsid") else None,
    )


def stop_repeating_playback(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        if hasattr(os, "killpg"):
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        else:
            proc.terminate()
        proc.wait(timeout=2)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def staircase_step(trial_idx: int) -> float:
    if trial_idx < 6:
        return 3.0
    if trial_idx < 14:
        return 2.0
    return 1.0


def update_snr(current: float, exact: bool, trial_idx: int, snr_min: float, snr_max: float) -> float:
    step = staircase_step(trial_idx)
    next_snr = current - step if exact else current + step
    return max(snr_min, min(snr_max, next_snr))


def write_results(session_dir: Path, rows: list[TrialResult]) -> None:
    jsonl_path = session_dir / "results.jsonl"
    csv_path = session_dir / "results.csv"
    with jsonl_path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(asdict(row), sort_keys=True) + "\n")

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(asdict(rows[0]).keys()) if rows else [])
        if rows:
            writer.writeheader()
            for row in rows:
                writer.writerow(asdict(row))


def print_summary(rows: list[TrialResult]) -> None:
    if not rows:
        return
    exact_rate = sum(r.exact for r in rows) / len(rows)
    mean_char = sum(r.char_accuracy for r in rows) / len(rows)
    copied = [r.snr_db for r in rows if r.exact]
    misses = [r.snr_db for r in rows if not r.exact]
    print("\nSummary")
    print(f"  exact copy:        {sum(r.exact for r in rows)}/{len(rows)} ({exact_rate:.0%})")
    print(f"  mean char acc:     {mean_char:.0%}")
    if copied:
        print(f"  lowest exact SNR:  {min(copied):+.1f} dB")
    if misses:
        print(f"  highest miss SNR:  {max(misses):+.1f} dB")


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    session_seed = args.seed if args.seed is not None else rng.randrange(1, 2**31)
    rng.seed(session_seed)

    player = None if args.no_play else find_player()
    if not args.no_play and player is None:
        raise RuntimeError("No audio player found. Expected afplay, ffplay, play, paplay, or aplay.")

    session_name = datetime.now().strftime("%Y%m%d_%H%M%S")
    session_dir = args.out_dir / session_name
    session_dir.mkdir(parents=True, exist_ok=True)

    print(f"Session: {session_dir}")
    print(f"Seed: {session_seed}")
    print("Enter your 5-character guess. Empty guess counts as a miss. Ctrl-C stops and saves.\n")

    rows: list[TrialResult] = []
    snr_db = args.snr_start
    try:
        for trial_idx in range(args.trials):
            trial_no = trial_idx + 1
            text = random_token(rng)
            wpm = round(rng.uniform(25.0, 35.0), 1)
            clip_seed = rng.randrange(1, 2**31)
            wav_path = session_dir / f"trial_{trial_no:02d}.wav"

            generate_clip(text, wpm, snr_db, clip_seed, wav_path, args.fixed_noise_rms)
            stats = analyze_clip(wav_path)
            print(f"Trial {trial_no:02d}/{args.trials}: 650 Hz, {wpm:.1f} WPM", end="")
            if args.show_snr_before_guess:
                print(f", SNR {snr_db:+.1f} dB")
            else:
                print()
            print(
                f"  preflight: pad_rms={stats['pad_rms']:.4f} "
                f"content/pad={stats['content_to_pad']:.2f} peak={stats['peak']:.3f} "
                f"play_volume={args.play_volume:.2f}"
            )

            proc = None
            started = time.monotonic()
            try:
                if player:
                    proc = start_repeating_playback(player, wav_path, args.play_volume)
                guess_raw = input("Guess: ")
            finally:
                listened_sec = time.monotonic() - started
                stop_repeating_playback(proc)

            guess = normalize_guess(guess_raw)
            edit_distance = levenshtein(guess, text)
            char_accuracy = max(0.0, 1.0 - edit_distance / len(text))
            exact = guess == text
            next_snr = update_snr(snr_db, exact, trial_idx, args.snr_min, args.snr_max)

            rows.append(
                TrialResult(
                    trial=trial_no,
                    text=text,
                    guess=guess,
                    exact=exact,
                    char_accuracy=char_accuracy,
                    edit_distance=edit_distance,
                    snr_db=snr_db,
                    next_snr_db=next_snr,
                    wpm=wpm,
                    tone_hz=650.0,
                    wav_path=str(wav_path),
                    seed=clip_seed,
                    listened_sec=round(listened_sec, 2),
                )
            )
            write_results(session_dir, rows)

            status = "OK" if exact else "MISS"
            print(
                f"  {status}: truth={text} guess={guess or '<empty>'} "
                f"char_acc={char_accuracy:.0%} snr={snr_db:+.1f}dB -> next={next_snr:+.1f}dB\n"
            )
            snr_db = next_snr
    except KeyboardInterrupt:
        print("\nStopped early.")
    finally:
        write_results(session_dir, rows)
        print_summary(rows)
        print(f"\nWrote: {session_dir / 'results.csv'}")
        print(f"WAVs:  {session_dir}")


if __name__ == "__main__":
    main()
