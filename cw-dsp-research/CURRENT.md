# CW DSP Research — Current State Report

**Date:** 2026-04-11  
**Commit:** 2b06499  
**Composite score:** 0.9016  

---

## Score History

| Commit | Score | Description |
|--------|-------|-------------|
| 8fd89f1 | 0.6508 | Initial baseline: 2ch IQ mag (40Hz LPF) + phase coherence |
| 7c40162 | 0.7070 | ch0: N2/fc20 Butterworth, halved group delay |
| cf5bfb7 | 0.7629 | ch2: STFT window 50ms→25ms, aligned delay |
| 6ef38b6 | 0.8684 | **Zero-phase sosfiltfilt + centered STFT: 0 group delay** |
| 9a28ff4 | 0.8757 | LPF cutoff 20→15 Hz |
| e3e6160 | 0.8978 | 95th percentile signal level in soft_normalize |
| a87b83c | 0.8983 | STFT window 40ms (320 samples): all tones on exact bins |
| 1883d04 | 0.8992 | STFT exponent 1/3→0.60 |
| a5bed3e | 0.8994 | STFT background bins 8→12 per side |
| 5eeb971 | 0.9003 | STFT bg: max(frame_bg, 500ms_running_median) |
| 241a9e8 | 0.9005 | Background smooth window 750ms→500ms |
| **2b06499** | **0.9016** | **STFT exponent re-optimized 0.60→0.79** |

---

## Current Architecture

### extract_envelope(audio, sample_rate=8000, tone_freq=600.0) → (T, 4)

#### Channel 0: IQ Magnitude (Butterworth)
- IQ demodulate: `I = audio × cos(2π·fc·t)`, `Q = audio × −sin(2π·fc·t)`
- Filter: 2nd-order Butterworth LPF at 15Hz, applied zero-phase via `sosfiltfilt` (effective 4th-order, ~16Hz noise BW)
- Magnitude: `mag = sqrt(I_filt² + Q_filt²)`
- Decimate 8000→500Hz by block-averaging ×16
- Normalize: `_soft_normalize(ch0, noise_window_ms=750)`
- **AUC: 0.9507**

#### Channel 1: STFT Spectral Contrast
- Window: 320 samples (40ms Hann), centered on each output frame (zero delay)
- Bin resolution: 25Hz/bin — all test tone frequencies (550, 600, 650, 700Hz) fall on exact bins
- Tone power: `pwr[tone_bin−1] + pwr[tone_bin] + pwr[tone_bin+1]` (3-bin sum for variance reduction)
- Background: median of 24 bins (12 each side, gap ±4 to ±16 from tone_bin)
- Background stabilization: `max(frame_bg, median_filter(frame_bg, 250_samples))` — 500ms running median prevents momentary bg dips from causing false spikes
- Compression: `(tone_power / bg_power)^0.79`
- Normalize: `_soft_normalize(ch1)` (default 500ms window)
- **AUC: 0.9259**

#### Channel 2: IQ + STFT Agreement
- `ch2 = min(ch0, ch1)` — requires both channels elevated simultaneously
- Vetoes noise bursts that appear in only one channel
- **AUC: 0.9367**

#### Channel 3: IQ Persistence (Box-Filter Matched Filter)
- 48ms centered box filter applied to raw IQ: `np.convolve(I/Q, ones(385)/385, 'same')`
- 385 samples (odd, centered → zero delay), noise BW ≈ 10.4Hz
- Decimate and normalize: `_soft_normalize(ch_box, noise_window_ms=750)`
- `ch3 = min(ch0, ch_box)` — requires both IQ channels (different bandwidths) to agree
- **AUC: 0.9536** (highest of all channels)

#### Normalization: `_soft_normalize(env, noise_window_ms, sr=500)`
1. Pre-smooth env with `win/10` kernel (75ms for 750ms window)
2. Running minimum over `win` samples (noise floor estimate)
3. `signal_level = percentile(env, 95)` — 95th percentile as ceiling
4. `normalized = (env − noise_floor) / (signal_level − median(noise_floor))`
5. Clip to [0, 1]

---

## Per-SNR Performance

| SNR | Score |
|-----|-------|
| +6 dB | 0.9819 |
| +0 dB | 0.9790 |
| −3 dB | 0.9670 |
| −6 dB | 0.9634 |
| −12 dB | 0.8622 |
| **−18 dB** | **0.6560** |

**The dominant bottleneck is −18dB.** At this SNR, the post-filter signal-to-noise ratio after IQ demodulation + 15Hz LPF is only **+1.2dB**. Noise generates 100–130 spurious "element" detections versus 38–40 true elements per sample. This is close to the theoretical detection limit for OOK in AWGN.

---

## Key Design Decisions and Why

### Why zero-phase filters everywhere
The single biggest gain in the project (+0.1025) came from switching to zero-phase processing:
- `sosfiltfilt` on ch0: forward-backward pass → 0 group delay, effective order doubled
- Centered STFT frames: `audio_pad[k*16 − half_win : k*16 + half_win]` → 0 delay

Zero-phase means the envelope peaks align precisely with the actual tone on/off edges. The HMM can then learn tight timing priors.

### Why 320-sample STFT (not 200 or 640)
- 200 samples (25ms): 40Hz/bin. At 700Hz, bin = 17.5 → only 36% of tone energy captured due to Hann leakage.
- **320 samples (40ms): 25Hz/bin. 550/25=22, 600/25=24, 650/25=26, 700/25=28 — all exact.** Full energy in tone_bin.
- 640 samples (80ms): 12.5Hz/bin, also exact. BUT temporal smearing kills timing for 36WPM (33ms dits). Tried and hurt.

### Why 48ms box filter (not 33ms or 64ms)
- Matched filter for 25WPM dits (48ms). Compromise for 18–36WPM range.
- 40ms: too short, noise BW wider → less SNR gain.
- 64ms: more SNR gain at low BW but temporal smearing hurts high-WPM. Tried and hurt.
- 48ms is empirically optimal for this test set.

### Why min() for ch2 and ch3 (not mean, geometric mean, product)
- `min(a, b)`: requires BOTH channels to be elevated → vetoes single-channel noise bursts
- `mean(a, b)`: single noisy channel can pull result up → more insertions
- `product(a, b)`: too aggressive (0.9 × 0.85 = 0.765 vs min = 0.85); reduces true positives disproportionately
- `min` empirically best. Tried `ch3 = min(ch1, ch_box)` — significantly worse (AUC of ch0 = 0.9507 matters more as anchor).

### Why 3 bins for tone_power (not 1)
- 1 bin: maximum AUC (all signal in one bin at exact alignment) but high temporal variance → HMM insertions. Tried as "Goertzel single-bin" → hurt composite.
- 3 bins: adds noise from adjacent bins (−SNR) but reduces temporal variance (6 DOF vs 2 DOF for chi-squared) → more stable HMM input.
- The AUC-vs-composite paradox: the HMM needs stable channels, not maximally-discriminative ones.

### Why max(frame_bg, running_median_bg)
- Per-frame spectral median tracks instantaneous noise level
- Momentary dips in background (quiet noise fluctuation) make `tone_power/bg_power` spike even when no tone is present
- `max(frame, smooth)` prevents the denominator from going too low → fewer false positives
- 500ms smoothing window is empirically optimal (250ms and 1000ms both slightly worse)

### Why 95th percentile for signal level (not 90th, 97th)
- 90th: too low, aggressive normalization amplifies noise. Switching to 95th gave +0.0038.
- 97th: tried, slightly worse — starts capturing noise spikes as "signal ceiling".
- 95th is the empirical optimum.

---

## The AUC vs Composite Paradox

This is the dominant failure pattern for improvements. Many changes that raise per-channel AUC hurt composite score:

| Experiment | AUC | Composite | Why it hurts |
|------------|-----|-----------|--------------|
| Single-bin STFT (Goertzel) | ↑ | ↓ | Higher temporal variance → more HMM insertions |
| Triangle weights (0.5+1+0.5) | ↑ | ↓ | Same — fewer effective DOF, higher variance |
| 640-sample STFT | ↑↑ ch1 | ↓↓ | Temporal smearing → missed element edges |
| ch3 = raw ch_box (no min) | ↑ ch3 | ↓ | The min() agreement veto is doing important work |

**Rule:** Design for channel stability first, discriminability second. The HMM's forward-backward algorithm amplifies temporal stability into detection quality.

---

## What Has Been Tried and Failed

### STFT window size
- 200 samples (25ms): used to work, but misaligned bins at 700Hz hurt
- 640 samples (80ms): temporal smearing, lower composite despite higher AUC

### Background estimation
- Mean instead of median: slightly worse (less robust to outlier bins)
- Temporal median filter sizes 7, 15 on bg_power: slight hurt
- 16 bins per side (instead of 12): worse than 12
- All non-tone bins (~154 bins): worse than 24 local bins
- 1000ms smoothing window: slightly worse than 500ms
- 250ms smoothing window: slightly worse than 500ms

### Tone power computation
- Single bin: AUC up, composite down (variance paradox)
- Blackman window: same as Hann
- Triangle weighting 0.5+1+0.5: AUC up, composite down

### Channel combinations
- ch3 = min(ch1, ch_box): significantly worse (ch0 AUC 0.9507 > ch1 0.9259 matters here)
- ch3 = raw ch_box (no min): worse
- ch1 noise_window=750ms: worse

### Normalization
- 97th percentile signal level: slightly worse than 95th
- ch1 noise_window=750ms: worse

### Box filter duration
- 40ms: worse (noise BW wider)
- 64ms: worse (timing degradation)
- 48ms: optimal

---

## Ideas to Try Next

### Most promising (not yet tried)
1. **Multi-scale box filter** — compute ch_box as `max(soft_normalize(box_33ms), soft_normalize(box_48ms))`. The 33ms box is matched to 36WPM; the 48ms is matched to 25WPM. Taking max adapts to the actual content without knowing WPM. Could specifically help sample 7 (-12dB, 36WPM).

2. **3-way min channel** — `ch2 = min(ch0, ch1, ch_box)` instead of `min(ch0, ch1)`. Ultra-conservative: requires all three channels elevated simultaneously. Might reduce -18dB insertions further. Risk: too conservative at mid-SNR, misses real elements.

3. **Running median on tone_power itself** — apply `median_filter(tone_power, size=N)` before computing ratio. Reduces temporal variance of tone_power estimate. Complementary to the existing bg stabilization (which smooths the denominator; this smooths the numerator).

4. **ch0 LPF 13–14Hz** — slightly narrower bandwidth, +0.3–0.5dB SNR at the cost of slightly more 36WPM attenuation. Small potential gain.

5. **Adaptive STFT exponent** — currently global 0.79. At low SNR the ratio distribution is different than at high SNR. Could adapt based on estimated noise level.

### Lower priority
- Spectral kurtosis as a channel (complex to implement, uncertain benefit)
- Matched Wiener filter (requires noise PSD estimate)
- Minimum statistics noise tracker (Martin 2001) as noise floor for soft_normalize
- Wavelet envelope (Morlet at carrier frequency)

---

## Remaining Headroom Estimate

Based on per-SNR scores:
- +6dB to +0dB: 0.98–0.97, approaching ceiling (~0.99 theoretical max)
- −3dB to −6dB: 0.967–0.963, ~2–3% headroom
- −12dB: 0.862, ~10% headroom (sample 7 is chronic)
- −18dB: 0.656, ~30% headroom but near theoretical detection limit

Realistic next target: **0.905–0.910** from:
- Better handling of sample 7 (36WPM) → multi-scale box filter
- Incremental -12dB improvements via noise stability
- Each successful experiment adds ~0.001–0.003

Breaking 0.92 would likely require a fundamentally different approach to -18dB (e.g., iterative demodulation, known-symbol-assisted detection, or exploiting CW timing structure in the DSP layer rather than the HMM layer).
