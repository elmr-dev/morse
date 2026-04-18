"""
Generate fixed synthetic test data using the morse-audio TypeScript library.
Run once to populate testdata/.

Uses `npx tsx` to call the morse-audio generate-cli, which outputs:
  - A WAV file at 8kHz
  - JSON metadata to stdout (character timings, effectiveWpm)

Ground-truth binary envelope is reconstructed from character timings
+ standard Morse code timing (machine-perfect, no fist jitter).
"""
import subprocess, json, tempfile, os, wave, struct
import numpy as np
from pathlib import Path
from constants import *

# ============================================================================
# Paths
# ============================================================================

MORSE_AUDIO_DIR = os.path.join(os.path.dirname(__file__), "..", "morse-audio")
GENERATE_CLI = os.path.join(
    MORSE_AUDIO_DIR,
    "packages", "morse-audio", "src", "ml-training", "generate-cli.ts"
)

# ============================================================================
# Morse code table
# ============================================================================

MORSE_CODE = {
    'A': '.-',   'B': '-...',  'C': '-.-.',  'D': '-..',   'E': '.',
    'F': '..-.',  'G': '--.',   'H': '....',  'I': '..',    'J': '.---',
    'K': '-.-',   'L': '.-..',  'M': '--',    'N': '-.',    'O': '---',
    'P': '.--.',  'Q': '--.-',  'R': '.-.',   'S': '...',   'T': '-',
    'U': '..-',   'V': '...-',  'W': '.--',   'X': '-..-',  'Y': '-.--',
    'Z': '--..',  '0': '-----', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.',  '/': '-..-.', '?': '..--..', '.': '.-.-.-',
    ',': '--..--', '=': '-...-',
}

# ============================================================================
# Test configurations — 6 SNR levels × 4 samples each = 24 samples
# ============================================================================

TEST_CONFIGS = []
for snr in SNR_LEVELS:
    for i in range(4):
        wpm = [18, 24, 30, 36][i]
        tone_freq = [550, 600, 650, 700][i]
        text = [
            "CQ CQ DE W1ABC",
            "W1ABC 599 GA",
            "QTH ATLANTA NAME MARK",
            "5NN 14025",
        ][i]
        # Add mild ionospheric fading at low SNR for realism
        config = {
            "text": text,
            "wpm": wpm,
            "snr_db": snr,
            "tone_freq": tone_freq,
            "add_fading": snr < 0,
        }
        TEST_CONFIGS.append(config)

# ============================================================================
# Ground-truth reconstruction
# ============================================================================

def gt_binary_from_characters(characters, effective_wpm, audio_samples, audio_sr):
    """
    Reconstruct binary tone-on/off at audio_sr from character-level metadata.

    For machine-perfect CW (no fist model), element durations within each
    character follow standard Morse timing:
      dit_ms = 1200 / effective_wpm
      dah_ms = 3 * dit_ms
      intra_char_gap_ms = dit_ms  (between elements within a character)

    The generator starts each character at character.startMs.
    """
    dit_ms = 1200.0 / effective_wpm
    gt = np.zeros(audio_samples, dtype=np.float32)

    for char_meta in characters:
        char = char_meta["char"].upper()
        start_ms = char_meta["startMs"]

        code = MORSE_CODE.get(char)
        if not code:
            continue

        # Walk through elements within this character
        t_ms = 0.0
        for idx, sym in enumerate(code):
            elem_dur = dit_ms if sym == '.' else 3 * dit_ms
            abs_start_ms = start_ms + t_ms
            abs_end_ms = abs_start_ms + elem_dur

            s = int(abs_start_ms / 1000.0 * audio_sr)
            e = int(abs_end_ms / 1000.0 * audio_sr)
            s = max(0, min(s, audio_samples))
            e = max(0, min(e, audio_samples))
            gt[s:e] = 1.0

            t_ms += elem_dur
            if idx < len(code) - 1:
                t_ms += dit_ms  # intra-char gap

    return gt


def decimate_binary(gt, factor, n_out):
    """Majority-vote decimation of binary ground truth."""
    n = min(len(gt), n_out * factor)
    gt_trim = gt[:n_out * factor]
    if len(gt_trim) < n_out * factor:
        gt_trim = np.pad(gt_trim, (0, n_out * factor - len(gt_trim)))
    blocks = gt_trim.reshape(n_out, factor)
    return (blocks.mean(axis=1) > 0.5).astype(np.float32)


# ============================================================================
# WAV reading (no soundfile dependency)
# ============================================================================

def read_wav_mono_8k(wav_path, target_sr=8000):
    """Read a WAV file, resample to target_sr if needed, return float32 array."""
    with wave.open(str(wav_path), 'rb') as wf:
        nchannels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        nframes = wf.getnframes()
        raw = wf.readframes(nframes)

    # Decode samples
    if sampwidth == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 4:
        samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width: {sampwidth}")

    # Mix to mono if stereo
    if nchannels > 1:
        samples = samples.reshape(-1, nchannels).mean(axis=1)

    # Resample if needed (simple integer ratio)
    if framerate != target_sr:
        if framerate % target_sr == 0:
            # Downsample by integer factor
            factor = framerate // target_sr
            n = len(samples) // factor * factor
            samples = samples[:n].reshape(-1, factor).mean(axis=1)
        elif target_sr % framerate == 0:
            # Upsample by integer factor (repeat)
            factor = target_sr // framerate
            samples = np.repeat(samples, factor)
        else:
            # General case: use scipy resample
            from scipy.signal import resample_poly
            from math import gcd
            g = gcd(target_sr, framerate)
            samples = resample_poly(samples, target_sr // g, framerate // g)

    return samples.astype(np.float32), framerate if framerate == target_sr else target_sr


# ============================================================================
# Sample generation
# ============================================================================

def generate_sample(config, output_path, seed):
    """Generate one test sample via the morse-audio TypeScript generator."""
    with tempfile.TemporaryDirectory() as tmpdir:
        wav_path = os.path.join(tmpdir, "sample.wav")
        cfg_path = os.path.join(tmpdir, "config.json")

        # Build JSON config for generate-cli --from-json
        gen_config = {
            "text": config["text"],
            "wpm": config["wpm"],
            "frequency": config["tone_freq"],
            "sampleRate": AUDIO_SR,
            "durationSec": 15,
            "seed": seed,
            "noise": {
                "snrDb": config["snr_db"],
            },
        }

        # Add mild ionospheric fading at low SNR
        if config.get("add_fading"):
            gen_config["ionosphericFading"] = {
                "depth": 0.3,
                "rate": 0.2,
                "components": 3,
            }

        with open(cfg_path, "w") as f:
            json.dump(gen_config, f)

        # Call the TypeScript generator
        result = subprocess.run(
            ["npx", "tsx", os.path.abspath(GENERATE_CLI),
             "--from-json", cfg_path,
             "-o", wav_path],
            capture_output=True, text=True,
            cwd=os.path.abspath(MORSE_AUDIO_DIR),
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"morse-audio generator failed:\n"
                f"stdout: {result.stdout}\n"
                f"stderr: {result.stderr}"
            )

        # Parse metadata from stdout
        stdout = result.stdout.strip()
        if not stdout:
            raise RuntimeError(f"No metadata from generator. stderr: {result.stderr}")

        metadata = json.loads(stdout)

        # Read the generated WAV
        audio, _ = read_wav_mono_8k(wav_path, target_sr=AUDIO_SR)
        n_audio = len(audio)

        # Reconstruct ground-truth binary envelope at AUDIO_SR
        gt_audio = gt_binary_from_characters(
            metadata["characters"],
            metadata["effectiveWpm"],
            n_audio,
            AUDIO_SR,
        )

        # Decimate gt to ENVELOPE_SR (500 Hz)
        n_env = n_audio // DECIMATION
        gt_500 = decimate_binary(gt_audio, DECIMATION, n_env)

        # Build gt_elements list for compatibility with evaluate.py
        gt_elements = []
        dit_ms = 1200.0 / metadata["effectiveWpm"]
        for char_meta in metadata["characters"]:
            char = char_meta["char"].upper()
            code = MORSE_CODE.get(char)
            if not code:
                continue
            t_ms = 0.0
            for idx, sym in enumerate(code):
                elem_dur = dit_ms if sym == '.' else 3 * dit_ms
                gt_elements.append({
                    "char": char,
                    "type": "dit" if sym == '.' else "dah",
                    "start_s": (char_meta["startMs"] + t_ms) / 1000.0,
                    "end_s": (char_meta["startMs"] + t_ms + elem_dur) / 1000.0,
                })
                t_ms += elem_dur
                if idx < len(code) - 1:
                    t_ms += dit_ms

        np.savez_compressed(
            output_path,
            audio=audio,
            gt_binary=gt_500,
            gt_elements=json.dumps(gt_elements),
            snr_db=config["snr_db"],
            wpm=config["wpm"],
            tone_freq=config["tone_freq"],
        )


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    os.makedirs(TESTDATA_DIR, exist_ok=True)
    np.random.seed(42)  # FIXED SEED — never change

    print(f"Generating {len(TEST_CONFIGS)} test samples using morse-audio TypeScript library...")
    print(f"SNR levels: {SNR_LEVELS}")
    print()

    errors = []
    for i, config in enumerate(TEST_CONFIGS):
        path = os.path.join(TESTDATA_DIR, f"sample_{i:03d}.npz")
        seed = 42 + i  # deterministic per sample
        try:
            generate_sample(config, path, seed)
            print(f"[{i+1:2d}/{len(TEST_CONFIGS)}] {path}: "
                  f"'{config['text'][:20]}...' "
                  f"SNR={config['snr_db']:+d}dB WPM={config['wpm']}")
        except Exception as e:
            print(f"[{i+1:2d}/{len(TEST_CONFIGS)}] ERROR on sample {i}: {e}")
            errors.append((i, str(e)))

    print()
    if errors:
        print(f"ERRORS on {len(errors)} samples:")
        for idx, msg in errors:
            print(f"  sample_{idx:03d}: {msg}")
    else:
        print(f"Done: {len(TEST_CONFIGS)} samples in {TESTDATA_DIR}/")
