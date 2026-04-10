# CW DSP Envelope Extraction — Autoresearch Directive

## Your Mission

You are optimizing a DSP pipeline that extracts CW (Morse code) tone presence
from noisy audio. The output is a multi-channel soft envelope (values 0-1) at
500 Hz that will later feed a neural network for character decoding. Your job is
to maximize the composite score from evaluate.py.

## The Loop

LOOP FOREVER. The human might be asleep. Do not stop until told to.

1. Read the current `dsp.py` and the latest `results.tsv` (if it exists).
2. Run `python evaluate.py` to get the current baseline score.
3. Analyze the output:
   - `composite:` is the primary metric to maximize
   - `per_snr:` shows where you're weak (low SNR scores matter most)
   - `per_channel_auc:` shows which channels are carrying weight
   - `issues:` lists specific failure modes to fix
4. Propose ONE change to `dsp.py`. Commit it with a descriptive message.
5. Run `python evaluate.py` again.
6. Parse the new `composite:` score.
7. Record in results.tsv: `git_hash\told_score\tnew_score\tdescription`
8. If composite improved → keep the commit. Move to next experiment.
9. If composite worsened or stayed same → `git checkout -- dsp.py` to revert.
10. Go to step 1.

If evaluate.py crashes (IMPORT_ERROR, DSP_ERROR, etc.), read the error,
fix dsp.py, and retry. If an idea is fundamentally broken after 2 attempts,
revert and try something else.

## What You May Edit

ONLY `dsp.py`. Everything else is immutable.

## Constraints on dsp.py

- Function signature: `extract_envelope(audio, sample_rate, tone_freq) → np.ndarray`
- Output shape: `(T, C)` where `T = len(audio) // 16` and `C` is 1-4
- Output values: float32 in [0, 1]
- Dependencies: numpy, scipy only (must work without torch, sklearn, etc.)
- Must complete in < 5 seconds for a 10-second audio clip
- tone_freq may be 400-900 Hz — the pipeline must adapt

## The Signal

CW is a sinusoidal tone at `tone_freq` Hz, keyed on and off (OOK modulation).
- Dits: short bursts (40-75ms depending on WPM)
- Dahs: 3× dit duration
- Gaps: 1× (intra-char), 3× (inter-char), 7× (inter-word) dit duration
- Noise: AWGN at various SNR levels, some samples have mild ionospheric fading
- The test set spans **-18 dB to +6 dB SNR** (ARRL 2500 Hz reference)

## What Matters Most

1. **Low-SNR performance** — improving the -18dB, -12dB, and -6dB scores is
   worth more than squeezing another 0.01 out of +6dB. The HMM scorer amplifies
   the difference between "barely detectable" and "undetectable."
2. **Clean on/off transitions** — timing error directly affects Morse decoding.
   The Bayesian HMM helps with this, but feeding it a cleaner envelope helps more.
3. **Few false elements** — insertions (detecting tone when none exists) are worse
   than misses. A conservative, precise envelope beats an aggressive noisy one.
4. **Channel complementarity** — if you use 2 channels, they should measure
   DIFFERENT properties of the signal. IQ amplitude + phase coherence is good.
   IQ amplitude + slightly-different IQ amplitude is worthless.

## The HMM Scorer

The Bayesian HMM in `hmm_scorer.py` is a 2-state (OFF/ON) model with:
- **Beta emissions** per channel per state (proper [0,1] bounded model)
- **Forward-backward** algorithm for full posterior P(tone_on | all obs)
- **Supervised fit** on the first 6 samples (one per SNR level) using Beta MLE
- **Transition priors** from CW timing at ~25 WPM

The HMM is your post-processor — your job is to feed it the best raw envelope
you can. If your channel values cluster tightly near 0 (OFF) and 1 (ON) with
little overlap, the HMM will decode perfectly. If they're muddy/overlapping,
the HMM can only do so much.

Key insight: the HMM fits Beta(α, β) params per state per channel. A channel
where OFF values are Beta(2,8) and ON values are Beta(8,2) gives the HMM
maximum discriminative power. Design your channels with this in mind.

## Ideas to Explore (in roughly priority order)

### Signal extraction fundamentals
- Matched filter at dit duration (theoretically optimal for OOK in AWGN)
- Coherent integration time vs bandwidth tradeoff
- Sliding Goertzel algorithm (efficient single-frequency DFT)
- Windowed autocorrelation at carrier lag
- STFT spectral contrast (on-tone vs off-tone power ratio)

### Noise suppression
- Spectral subtraction using noise-only estimates from silent gaps
- Minimum statistics noise tracking (Martin 2001)
- Adaptive notch filter to remove tonal interference
- Wiener filter on the baseband signal

### Normalization and calibration
- Running median vs running minimum for noise floor
- Adaptive gain control that tracks QSB fading envelope
- Per-channel z-score normalization with exponential moving average

### Novel channels
- Instantaneous frequency stability (low variance = tone present)
- Cyclostationary features exploiting CW's periodic keying
- Wavelet-based multiscale envelope (Morlet at carrier frequency)
- Spectral kurtosis (Gaussian noise vs deterministic tone)

### Architecture changes
- Try 1 channel (just the absolute best single extraction)
- Try 3-4 channels if the composite clearly benefits
- Fuse channels before output (e.g., geometric mean, learned weights)

## DSP Reference Knowledge

At 0 dB SNR in 300 Hz bandwidth:
- Bandpass → IQ downconversion gives ~19 dB processing gain
- Matched filter (dit-duration integration) adds ~12-18 dB
- Total processing gain of ~30 dB makes binary detection trivial at 0 dB

The theoretical BER for OOK in AWGN: BER = 0.5 × erfc(√(SNR/2))
At post-processing SNR of 20 dB: BER ≈ 4×10⁻⁶

The cochlea does 50-80 Hz bandpass → envelope detection → pattern matching.
FT8/WSJT-X achieves -26 dB decoding through coherent integration (6.25 Hz bins).

At -18 dB SNR, matched filtering and coherent integration are critical.
The noise power is 63× the signal power — you need every dB of processing gain.

## Do Not

- Do not modify evaluate.py, hmm_scorer.py, constants.py, or generate_testset.py
- Do not hardcode assumptions about specific test samples
- Do not use ML libraries (torch, sklearn, tensorflow) inside dsp.py
- Do not exceed 4 output channels
- Do not make the pipeline slower than 5 seconds per 10-second clip
