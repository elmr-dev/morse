# Changelog

All notable changes to `morse-audio` and `react-morse-audio` are documented here.
Both packages version in lockstep.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] — 2026-04-22

### Fixed

- **SNR calibration is now accurate.** In 1.3.0, `generateCalibratedNoise`
  normalized noise by *peak* amplitude, but SNR is a power (RMS²) ratio. A
  sine and noise with the same peak don't have the same RMS, so the requested
  SNR was offset from the actual SNR by ~7 dB across the entire range. After
  the fix, requested SNR matches measured SNR within 0.3 dB at every level
  from -18 dB to +30 dB, measured in the reference bandwidth. Verified by a
  new test suite (`SNR calibration accuracy`) and by the diagnostic script at
  `packages/morse-audio/src/utils/snr-verify.ts`.

  The fix: `generateCalibratedNoise` now RMS-normalizes the noise to
  `referenceSinePeak / sqrt(2)` (the RMS of a sine at that peak) instead of
  peak-normalizing to `referenceSinePeak`. The `mixWithCalibratedNoise` peak
  normalization on the final mix is unchanged and continues to handle any
  short-lived crackle peaks above ±1.0.

### Changed

- `generateCalibratedNoise` option `targetPeak` renamed to
  `referenceSinePeak` to reflect its real meaning ("the peak of the sine wave
  whose power the noise is matched to"). The default is unchanged (0.8). 1.3.0
  was less than a day old when this rename landed and the old name produced
  miscalibrated output, so any caller using it needed to change anyway.

### Added

- `rmsNormalize(samples, targetRms)` — exported in-place utility, the RMS
  counterpart to `peakNormalize`.

- `snr-verify.ts` — runnable diagnostic that prints requested vs measured SNR
  for a range of values. Run it with `pnpm tsx packages/morse-audio/src/utils/snr-verify.ts`
  to confirm the calibration on your machine.

## [1.3.0] — 2026-04-22

This release is **additive** — no existing API is removed or changed. The headline
addition is a new top-level entry point, `generateRealisticMorseAudio`, that
combines every effect the library knows how to apply into a single call, plus the
SNR-calibrated mixing primitives it builds on. The classic `generateMorseAudio`,
`generatePileupAudio`, and contest-engine streaming APIs continue to behave
exactly as they did in 1.2.0.

### Added

#### `generateRealisticMorseAudio()` — full effects chain in one call

A new high-level generator that runs the complete realistic-CW pipeline:

```text
text → translate → optional fist model → tone synthesis with
  chirp/buzz/Rayleigh fading/flutter → optional QSB → optional
  SNR-calibrated atmospheric noise → optional receiver bandpass → WAV
```

```ts
import { generateRealisticMorseAudio, FIST_PROFILES } from 'morse-audio';

const { dataUri, effectiveWpm } = generateRealisticMorseAudio({
  text: 'CQ DE W1AW',
  wpm: 22,
  frequency: 600,
  fist: FIST_PROFILES.bug,         // banana-boat swing
  qrn: { snr: 6 },                 // calibrated against 2.5 kHz reference
  bandpass: { bandwidth: 300 },    // narrow CW filter — boosts effective SNR
});
new Audio(dataUri).play();
```

The result includes `samples`, `duration`, `sampleRate`, `dataUri`, and
`effectiveWpm` (which differs from the requested WPM when the fist model
applies speed drift or character-gap stretching).

Re-exported from `react-morse-audio` for convenience alongside the existing
`generateMorseAudio`.

#### SNR-calibrated noise mixing primitives

Three new low-level helpers that implement the radio-correct convention where
SNR is measured in a fixed reference noise bandwidth (typically 2.5 kHz, the SSB
standard) and the receiver's IF filter, applied after mixing, can improve the
*effective* SNR by attenuating out-of-band noise:

- `peakNormalize(samples, targetPeak)` — in-place utility.
- `generateCalibratedNoise({ length, sampleRate, centerFrequency, ... })` —
  produces atmospheric noise pre-filtered to a reference bandwidth and
  peak-normalized to a target level.
- `mixWithCalibratedNoise(signal, noise, { snrDb, outputPeak })` — combines a
  clean signal with pre-calibrated noise using an AGC-style constant-loudness
  model: the signal is scaled by `10^(snrDb/20)` relative to a fixed noise
  floor, the result is peak-normalized, and the loudest sample always lands at
  the same playback volume.

The new constants `DEFAULT_SNR_REFERENCE_BANDWIDTH` (2500 Hz),
`DEFAULT_REFERENCE_PEAK` (0.8), and `DEFAULT_OUTPUT_PEAK` (0.85) document the
defaults so callers building custom pipelines can match them.

This calibration model is the one used internally by
`generateRealisticMorseAudio`. The classic `applyRadioEffects` helper still
follows its original convention (noise amplitude scales as SNR drops) and is
unchanged.

#### `Bug` fist profile — Vibroplex / banana-boat swing

A new entry in `FIST_PROFILES` modelling a Vibroplex bug operator's signature
swing: tight, machine-precise dits (the mechanical pendulum) and famously
elongated dahs ("dahhhh"), with minimal hesitation between characters. Sits
between `average` and `poor` in the profile lineup.

```ts
import { FIST_PROFILES } from 'morse-audio';
generateRealisticMorseAudio({
  text: 'BANANA BOAT', wpm: 18,
  fist: FIST_PROFILES.bug,
});
```

The `FistProfile` type now includes `'bug'` alongside the existing
`'machine' | 'good' | 'average' | 'poor' | 'very_poor'`. The Bug profile is
intentionally **not** part of `FIST_DISTRIBUTION` (which is used by
`randomFistProfile()` to pick a representative population sample); it's a
stylistic choice, not a percentage of typical operators.

#### Demo app — `apps/demo`

A new in-repo Vite + React app under `apps/demo` that exposes every option of
`generateRealisticMorseAudio` as a tweakable control, including a bandpass
preset board (2.4 kHz / 1.8 kHz / 1.0 kHz / 500 Hz / 300 Hz / 250 Hz / 100 Hz)
so you can hear the effective-SNR boost of narrowing the receiver. The demo
does no audio processing of its own — it's a thin UI on top of the library.

### Notes

No existing behavior changes. `generateMorseAudio`, `generatePileupAudio`,
`createContestAudioEngine`, `applyRadioEffects`, `applyBandwidthFilter`, and
all other previously exported APIs continue to behave exactly as they did in
1.2.0. The new `generateRealisticMorseAudio` lives alongside them as the
opinionated "one call for realistic CW" entry point.

## [1.2.0] and earlier

See git history.
