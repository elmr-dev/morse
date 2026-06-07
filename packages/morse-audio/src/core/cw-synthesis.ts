import type {
  BuzzOptions,
  ChirpOptions,
  FlutterOptions,
  RayleighFadingOptions,
} from '../pileup/types';
import { Buzz } from '../utils/buzz';
import { generateChirpOffsets } from '../utils/chirp';
import { generateEnvelope } from '../utils/envelope';
import { Flutter } from '../utils/flutter';
import type { PitchWobbleOptions } from '../utils/pitch-wobble';
import { generatePitchWobbleOffsets } from '../utils/pitch-wobble';
import { RayleighFading } from '../utils/rayleigh-fading';

export interface CwSynthesisOptions {
  timings: number[];
  frequency: number;
  sampleRate: number;
  rampDurationMs?: number;
  amplitude?: number;
  seed?: number;
  startDelayMs?: number;
  totalDurationMs?: number;
  chirp?: ChirpOptions;
  pitchWobble?: PitchWobbleOptions;
  rayleigh?: RayleighFadingOptions;
  flutter?: FlutterOptions;
  buzz?: BuzzOptions;
}

export interface CwSynthesisResult {
  samples: Float32Array;
  envelope: Float32Array;
  contentEnvelope: Float32Array;
  contentOffsetSamples: number;
  durationSec: number;
}

/**
 * Synthesize a CW tone from finalized Morse timings. Translation, fist policy,
 * noise, padding, and output format sit outside this Module.
 */
export function synthesizeCw(options: CwSynthesisOptions): CwSynthesisResult {
  const {
    timings,
    frequency,
    sampleRate,
    rampDurationMs = 5,
    amplitude = 0.8,
    seed = 0,
    startDelayMs = 0,
    totalDurationMs,
    chirp,
    pitchWobble,
    rayleigh,
    flutter,
    buzz,
  } = options;

  const contentEnvelope = generateEnvelope(timings, sampleRate, rampDurationMs);
  const contentOffsetSamples = Math.max(
    0,
    Math.ceil((startDelayMs / 1000) * sampleRate)
  );
  const minTotalSamples = contentOffsetSamples + contentEnvelope.length;
  const totalSamples =
    totalDurationMs === undefined
      ? minTotalSamples
      : Math.max(
          minTotalSamples,
          Math.ceil((totalDurationMs / 1000) * sampleRate)
        );

  const envelope = new Float32Array(totalSamples);
  for (let i = 0; i < contentEnvelope.length; i++) {
    envelope[i + contentOffsetSamples] = contentEnvelope[i];
  }

  let freqOffsets: Float32Array | undefined;
  if (chirp) {
    freqOffsets = generateChirpOffsets(envelope, chirp, sampleRate);
  }

  if (pitchWobble) {
    const wobbleOffsets = generatePitchWobbleOffsets(
      envelope.length,
      pitchWobble,
      sampleRate
    );
    if (freqOffsets) {
      for (let i = 0; i < freqOffsets.length; i++)
        freqOffsets[i] += wobbleOffsets[i];
    } else {
      freqOffsets = wobbleOffsets;
    }
  }

  const rayleighProcessor = rayleigh
    ? new RayleighFading(rayleigh, sampleRate, seed + 1)
    : null;
  const flutterProcessor = flutter
    ? new Flutter(flutter, sampleRate, seed + 2)
    : null;
  const buzzProcessor = buzz ? new Buzz(buzz, sampleRate) : null;

  const samples = new Float32Array(totalSamples);
  const twoPi = 2 * Math.PI;
  let phase = 0;

  for (let i = 0; i < totalSamples; i++) {
    const env = envelope[i];
    const freq = frequency + (freqOffsets ? freqOffsets[i] : 0);
    let sample = Math.sin(phase) * env;

    if (rayleighProcessor) sample *= rayleighProcessor.nextSample();
    if (flutterProcessor) sample *= flutterProcessor.getEnvelope(i);
    if (buzzProcessor && env > 0.1) sample += buzzProcessor.getSample(i) * env;

    samples[i] = sample * amplitude;

    phase += (twoPi * freq) / sampleRate;
    if (phase >= twoPi) phase -= twoPi;
  }

  return {
    samples,
    envelope,
    contentEnvelope,
    contentOffsetSamples,
    durationSec: totalSamples / sampleRate,
  };
}
