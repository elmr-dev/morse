# CW DSP Research — Findings & Next Steps

**Date:** 2026-04-10  
**Current score:** 0.9016 (composite)  
**Baseline at start:** 0.8992

---

## Architecture (current, commit 2b06499)

```
ch0: IQ magnitude (sosfiltfilt zero-phase, 15Hz Butterworth N=2 → eff. N=4)
     Normalized: noise_window=750ms, 95th percentile signal level
     AUC: 0.9507

ch1: STFT spectral contrast (320-sample Hann, 40ms, 25Hz/bin)
     Tone bins: tone_bin±1 (sum of 3 bins)
     Background: median of 12 bins per side (±4–16 from tone)
     Background stabilized: max(frame_bg, 500ms_running_median)
     Compression: (ratio)^0.79
     AUC: 0.9259

ch2: min(ch0, ch1) — agreement filter (vetoes single-channel noise bursts)
     AUC: 0.9367

ch3: min(ch0, ch_box) — IQ persistence filter
     ch_box: 48ms centered box filter IQ, noise_window=750ms
     AUC: 0.9536
```

---

## Key Insights From All Sessions

### What worked (in rough order of impact):
1. **Zero-phase sosfiltfilt + centered STFT** (+0.1025): The single biggest gain. Eliminates group delay from both channels. Both channels now have zero effective delay → timing errors near zero at high SNR.
2. **STFT 25ms→40ms window** (+0.0005 direct, but enables exact bin alignment): 320-sample window gives 25Hz/bin. GCD(550,600,650,700)=50, so all test tone frequencies fall on exact bins → no Hann sidelobe leakage.
3. **95th percentile signal level** (+0.0038): Raised from 90th. Prevents noise spikes from setting the normalization ceiling, reduces false positives.
4. **Background stabilization: max(frame_bg, 500ms_running_median)** (+0.0009): Prevents momentary dips in background power from causing false high-ratio spikes in ch1.
5. **STFT exponent 0.79** (re-optimized after bg change, +0.0011): With more stable background, less compression needed. The optimal exponent shifted from 0.60 to 0.79 after adding background stabilization.
6. **Wider background bins: 12 per side** (+0.0002): More bins → lower variance in background estimate.

### What consistently failed:
- **Phase coherence channels**: AUC 0.6265 at test SNR range. At -18dB post-filter SNR ~+1.2dB, signal amplitude is too small to create coherent phase signal.
- **Single-bin tone power** (Goertzel approach): Higher average AUC but higher temporal variance → more HMM insertions → lower composite. The AUC-vs-composite paradox.
- **Triangle weighting** (0.5+1+0.5): Same paradox — more discriminative average but noisier frame-to-frame.
- **Longer STFT windows** (640-sample, 80ms): Better SNR per frame but temporal smearing kills timing for high-WPM samples. ch1 AUC went UP but composite went DOWN.
- **Larger box filters** (64ms): More SNR gain at low BW but timing degradation hurts mid/high-SNR samples. 48ms appears optimal for the 18-36 WPM range.

### The AUC vs Composite Paradox
Many changes that improve **per-channel AUC** hurt **composite score**:
- Root cause: The HMM is a temporal smoother. Channels with high frame-to-frame variance confuse the HMM's forward-backward algorithm even if the long-run average discrimination is better.
- Rule: **Prefer stable channels over maximally-discriminative channels.** A channel where OFF state is consistently near 0.1 and ON state consistently near 0.8 is better than one with OFF at 0.0–0.4 and ON at 0.6–1.0.

---

## Current Bottlenecks

### -18dB performance (score: 0.6560)
- 100–130 detected elements vs 38–40 GT elements (3-4× false positive rate)
- Theoretical: at -18dB input with 15Hz BW, post-filter SNR ≈ +1.2dB. Detection is near the fundamental limit.
- The HMM generates ~50 element-onset events/second from noise fluctuations at this SNR; temporal prior can't suppress them all.

### Sample 7 (-12dB, 36WPM, 700Hz)
- 61-69 detected elements vs 34 GT (2× false positive rate)
- 36 WPM → dit = 33ms. STFT window (40ms) > dit → temporal smearing in ch1.
- ch0 (15Hz) is near the 15Hz fundamental frequency of 36WPM; slight attenuation.
- This sample is a chronic weak point.

---

## Ideas Not Yet Tried

### High-priority:
1. **Adaptive background smoothing window** — current 500ms is global; try per-sample adaptation based on estimated noise stationarity. (Complex, might not help.)

2. **ch0 LPF cutoff 15→12 or 13Hz** — slightly narrower bandwidth gives +0.5dB SNR. Risk: 36WPM dit fundamental at 15Hz already gets attenuated; going to 12Hz increases this.

3. **Multi-scale box filter** — instead of single 48ms box, try max(soft_normalize(box_33ms), soft_normalize(box_48ms)) as ch_box. Adapts to different WPM without knowing the WPM.

4. **Spectral kurtosis** — detect non-Gaussian (deterministic) signal vs Gaussian noise using excess kurtosis of STFT magnitudes. Complex, might help at -18dB.

5. **ch2 = min(ch0, ch1, ch_box)** (3-way min) — ultra-conservative agreement channel requiring all three to be elevated simultaneously. Could reduce false positives but might miss real weak elements.

6. **ch1 STFT: use median filter on tone_power instead of bg stabilization** — apply running median to the tone_power itself (before ratio) to reduce its variance. Complementary to current bg stabilization.

### Already tried & failed (do NOT retry):
- STFT window 640 samples (80ms)
- ch3 = min(ch1, ch_box) instead of min(ch0, ch_box)
- Blackman window for STFT (same as Hann)
- Background bins: all non-tone bins (worse than 24 local bins)
- Background bins: 16 per side (worse than 12)
- ch1 noise_window=750ms (worse)
- 97th percentile signal level (worse)
- Mean background (worse, less robust than median)
- Box filter 40ms, 64ms (both worse than 48ms)
- Temporal median filter on bg_power (size=7, 15) — slight hurt
- Background smooth window 1000ms, 250ms (both slightly worse than 500ms)

---

## Score Trajectory

```
0.6508 → 0.7070 → 0.7629 → 0.8684 → 0.8992 → 0.9016
         (+group  (+STFT   (+zero   (session  (this
          delay)   align)   phase)   history)  session)
```

The three major step changes:
1. Zero-phase filtering (sosfiltfilt): +0.1025
2. 15Hz LPF: +0.0073  
3. Channel architecture (4ch + min agreement): multiple small gains

We are now in a regime of diminishing returns. Each improvement is ~0.001–0.002.

---

## Technical Reference

- Test set: 6 SNR levels (-18, -12, -6, -3, 0, +6 dB) × 4 WPM/freq pairs
- Per-SNR group: WPM=[18,24,30,36], tone_freq=[550,600,650,700]Hz
- SNR < 0: ionospheric fading added (depth=0.3, rate=0.2Hz, 3 components)
- Envelope rate: 500Hz (audio 8kHz / 16 decimation)
- HMM: fitted on first 6 samples (one per SNR level), 2-state Beta emissions
- Composite = 0.3*AUC + 0.25*F1 + 0.2*IoU + 0.15*timing_score + 0.1*elem_ratio
