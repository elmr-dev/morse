import { translateWithMetadata } from '../utils/morse-code';
import { applyIonosphericFading } from '../utils/ionospheric-fading';
import { applyMultipath } from '../utils/multipath';
import { applyDopplerSpread } from '../utils/doppler-spread';
import { applyAGC } from '../utils/agc';
import { createPrng, randomSeed } from '../utils/prng';
import { generateUsbPassbandNoise } from '../utils/usb-passband-noise';
import { applyFistModel } from './fist-model';
import { generateQrmSignal, mixQrmSignals } from './qrm-generator';
import { generateBroadbandInterference, mixBroadbandInterference } from './broadband-interference';
import { synthesizeCw } from './cw-synthesis';
import type {
  BroadbandInterferenceOptions,
  CharacterMetadata,
  CWQrmOptions,
  ElementMetadata,
  FistOptions,
  MorseAudioMetadata,
  NoiseConfig,
} from './types';
import type { IonosphericFadingOptions } from '../utils/ionospheric-fading';
import type { MultipathOptions } from '../utils/multipath';
import type { DopplerSpreadOptions } from '../utils/doppler-spread';
import type { AGCOptions } from '../utils/agc';
import type { PitchWobbleOptions } from '../utils/pitch-wobble';
import type { RayleighFadingOptions, FlutterOptions, ChirpOptions, BuzzOptions } from '../pileup/types';

export interface PipelineConfig {
  text: string;
  wpm: number;
  fwpm?: number;
  fist?: FistOptions;
  frequency: number;
  sampleRate: number;
  noise: NoiseConfig;
  ionosphericFading?: IonosphericFadingOptions;
  multipath?: MultipathOptions;
  dopplerSpread?: DopplerSpreadOptions;
  cwQrm?: CWQrmOptions[];
  broadbandInterference?: BroadbandInterferenceOptions;
  agc?: AGCOptions;
  pitchWobble?: PitchWobbleOptions;
  rayleigh?: RayleighFadingOptions;
  flutter?: FlutterOptions;
  chirp?: ChirpOptions;
  buzz?: BuzzOptions;
  durationSec: number;
  seed?: number;
}

export interface PipelinePolicy {
  minPaddingSec: number;
  emitNoiseAudio: boolean;
  normalizePeak?: number;
}

export interface PipelineResult<TConfig extends PipelineConfig> {
  audio: Float32Array;
  noiseAudio?: Float32Array;
  metadata: Omit<MorseAudioMetadata, 'config'> & { config: TConfig };
}

const DEFAULT_POLICY: PipelinePolicy = {
  minPaddingSec: 0.2,
  emitNoiseAudio: false,
  normalizePeak: 0.95,
};

function generateImpulseQRN(
  length: number,
  sampleRate: number,
  rate: number,
  amplitude: number,
  seed: number
): Float32Array {
  const prng = createPrng(seed);
  const output = new Float32Array(length);
  const meanGapSamples = sampleRate / rate;
  let t = Math.floor(-Math.log(prng() || 0.0001) * meanGapSamples);

  while (t < length) {
    const tauSamples = sampleRate * (0.0005 + prng() * 0.0015);
    const amp = amplitude * (0.5 + prng());
    const limit = Math.min(length, t + Math.ceil(tauSamples * 8));
    for (let i = t; i < limit; i++) output[i] += amp * Math.exp(-(i - t) / tauSamples);
    t += Math.ceil(-Math.log(prng() || 0.0001) * meanGapSamples);
  }

  return output;
}

function generatePowerLineInterference(
  length: number,
  sampleRate: number,
  baseHz: number,
  masterLevel: number,
  buzzDepth: number,
  coronaLevel: number,
  seed: number
): Float32Array {
  const prng = createPrng(seed);
  const twoPi = 2 * Math.PI;
  const output = new Float32Array(length);
  const oversample = 4;
  const osRate = sampleRate * oversample;
  const slewAlpha = 1 - Math.exp(-1 / (0.5 * sampleRate));
  let freqTarget = baseHz + (prng() - 0.5) * 0.4;
  let freqCurrent = freqTarget;
  let nextDriftAt = Math.round(sampleRate * (1.0 + prng() * 0.4));
  let driftCounter = 0;
  let sawPhase = prng();
  const amPhase0 = prng() * twoPi;

  function softClip(x: number): number {
    const threshold = 0.15;
    const a = Math.abs(x);
    if (a <= threshold) return x;
    const sign = x > 0 ? 1 : -1;
    return sign * (threshold + (1 - threshold) * Math.tanh((a - threshold) / (1 - threshold)));
  }

  const corona = generateUsbPassbandNoise({
    length,
    sampleRate,
    seed: Math.floor(prng() * 2147483647),
    lowCutHz: baseHz * 2,
    bandwidthHz: baseHz * 4,
    targetRms: 1,
    pops: false,
    agcDepth: 0,
  });

  for (let n = 0; n < length; n++) {
    if (++driftCounter >= nextDriftAt) {
      freqTarget = baseHz + (prng() - 0.5) * 0.4;
      nextDriftAt = Math.round(sampleRate * (1.0 + prng() * 0.4));
      driftCounter = 0;
    }
    freqCurrent += slewAlpha * (freqTarget - freqCurrent);

    let buzz = 0;
    for (let k = 0; k < oversample; k++) {
      sawPhase += freqCurrent / osRate;
      if (sawPhase >= 1) sawPhase -= 1;
      buzz += softClip(2 * sawPhase - 1);
    }
    buzz /= oversample;

    const amEnv = 0.3 + 0.7 * buzzDepth * Math.abs(Math.sin(twoPi * baseHz * n / sampleRate + amPhase0));
    output[n] = (buzz * amEnv + corona[n] * coronaLevel * 0.12) * masterLevel;
  }

  return output;
}

function normalizePeak(audio: Float32Array, noiseAudio: Float32Array | undefined, targetPeak: number): void {
  let peakAbs = 0;
  for (let i = 0; i < audio.length; i++) peakAbs = Math.max(peakAbs, Math.abs(audio[i]));
  if (peakAbs <= targetPeak || peakAbs <= 0) return;

  const scale = targetPeak / peakAbs;
  for (let i = 0; i < audio.length; i++) audio[i] *= scale;
  if (noiseAudio) {
    for (let i = 0; i < noiseAudio.length; i++) noiseAudio[i] *= scale;
  }
}

function offsetMetadata<T extends CharacterMetadata | ElementMetadata>(items: T[] | undefined, offsetMs: number): T[] | undefined {
  return items?.map((item) => ({
    ...item,
    startMs: item.startMs + offsetMs,
    endMs: item.endMs + offsetMs,
  }));
}

export function generateMorsePipeline<TConfig extends PipelineConfig>(
  config: TConfig,
  policy: Partial<PipelinePolicy> = {}
): PipelineResult<TConfig> {
  const resolvedPolicy = { ...DEFAULT_POLICY, ...policy };
  const prng = createPrng(config.seed ?? randomSeed());
  const sampleRate = config.sampleRate;
  const fwpm = config.fwpm ?? config.wpm;
  const translation = translateWithMetadata(config.text, config.wpm, fwpm);

  let timings: number[];
  let characters: CharacterMetadata[];
  let elements: ElementMetadata[] | undefined;
  let effectiveWpm = config.wpm;

  if (config.fist) {
    const fistResult = applyFistModel(
      translation,
      config.fist,
      config.wpm,
      Math.floor(prng() * 2147483647)
    );
    timings = fistResult.timings;
    characters = fistResult.characters;
    elements = fistResult.elements;
    effectiveWpm = fistResult.effectiveWpm;
  } else {
    timings = translation.timings;
    characters = translation.characters;
  }

  const rampDuration = 3 + prng() * 5;
  const synthesis = synthesizeCw({
    timings,
    frequency: config.frequency,
    sampleRate,
    rampDurationMs: rampDuration,
    seed: Math.floor(prng() * 2147483647),
    rayleigh: config.rayleigh,
    flutter: config.flutter,
    chirp: config.chirp,
    pitchWobble: config.pitchWobble,
    buzz: config.buzz,
  });

  let audio = synthesis.samples;
  const envelope = synthesis.envelope;

  if (config.ionosphericFading) {
    audio = applyIonosphericFading(audio, config.ionosphericFading, sampleRate, Math.floor(prng() * 2147483647));
  }

  if (config.multipath) {
    audio = applyMultipath(audio, config.multipath, sampleRate);
  }

  if (config.dopplerSpread) {
    audio = applyDopplerSpread(
      audio,
      envelope,
      config.frequency,
      config.dopplerSpread,
      sampleRate,
      Math.floor(prng() * 2147483647)
    );
  }

  if (config.cwQrm?.length) {
    const qrmSignals = config.cwQrm.map((qrmConfig) => generateQrmSignal(
      audio.length,
      config.frequency,
      qrmConfig,
      sampleRate,
      Math.floor(prng() * 2147483647)
    ));
    audio = mixQrmSignals(audio, qrmSignals);
  }

  if (config.broadbandInterference) {
    const interference = generateBroadbandInterference(
      audio.length,
      config.broadbandInterference,
      sampleRate,
      Math.floor(prng() * 2147483647)
    );
    audio = mixBroadbandInterference(audio, interference);
  }

  const cleanAudioSnapshot = audio.slice();
  const noiseConfig = config.noise;
  let totalPower = 0;
  for (let i = 0; i < audio.length; i++) totalPower += audio[i] * audio[i];
  totalPower /= audio.length;
  const noiseLevel = totalPower < 1e-10
    ? 0.001
    : Math.sqrt(totalPower / Math.pow(10, noiseConfig.snrDb / 10));

  const noiseSamples = generateUsbPassbandNoise({
    length: audio.length,
    sampleRate,
    seed: Math.floor(prng() * 2147483647),
  });

  if (noiseConfig.qsb) {
    const { depth, freqHz } = noiseConfig.qsb;
    const phase = prng() * 2 * Math.PI;
    const twoPiF = 2 * Math.PI * freqHz;
    for (let i = 0; i < noiseSamples.length; i++) {
      noiseSamples[i] *= 1 + depth * Math.sin(twoPiF * i / sampleRate + phase);
    }
  }

  for (let i = 0; i < audio.length; i++) audio[i] += noiseSamples[i] * noiseLevel;

  if (noiseConfig.qrn) {
    const qrn = generateImpulseQRN(
      audio.length,
      sampleRate,
      noiseConfig.qrn.rate,
      noiseConfig.qrn.amplitudeMultiplier * noiseLevel,
      Math.floor(prng() * 2147483647)
    );
    for (let i = 0; i < audio.length; i++) audio[i] += qrn[i];
  }

  if (noiseConfig.powerLine) {
    const { baseHz, level, buzzDepth, coronaLevel } = noiseConfig.powerLine;
    const interference = generatePowerLineInterference(
      audio.length,
      sampleRate,
      baseHz,
      noiseLevel * Math.pow(10, level / 20),
      buzzDepth,
      coronaLevel ?? 0.3,
      Math.floor(prng() * 2147483647)
    );
    for (let i = 0; i < audio.length; i++) audio[i] += interference[i];
  }

  const noiseOnlyContent = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i++) noiseOnlyContent[i] = audio[i] - cleanAudioSnapshot[i];

  if (config.agc) {
    audio = applyAGC(audio, sampleRate, config.agc);
  }

  const minPaddingSamples = Math.ceil(resolvedPolicy.minPaddingSec * sampleRate);
  const contentSamples = audio.length;
  const minRequiredSamples = contentSamples + 2 * minPaddingSamples;
  const requestedSamples = config.durationSec > 0
    ? Math.ceil(config.durationSec * sampleRate)
    : minRequiredSamples;
  const targetSamples = Math.max(requestedSamples, minRequiredSamples);
  const leadingPadding = Math.floor((targetSamples - contentSamples) / 2);
  const finalAudio = new Float32Array(targetSamples);

  let noiseRms = 0;
  let silentSampleCount = 0;
  for (let i = 0; i < contentSamples; i++) {
    if (envelope[i] < 0.01) {
      const v = config.agc ? audio[i] : noiseOnlyContent[i];
      noiseRms += v * v;
      silentSampleCount++;
    }
  }
  if (silentSampleCount > 100) {
    noiseRms = Math.sqrt(noiseRms / silentSampleCount);
  } else {
    noiseRms = noiseLevel;
  }

  const paddingNoise = generateUsbPassbandNoise({
    length: targetSamples,
    sampleRate,
    seed: Math.floor(prng() * 2147483647),
    targetRms: noiseRms,
  });

  for (let i = 0; i < targetSamples; i++) finalAudio[i] = paddingNoise[i];
  for (let i = 0; i < contentSamples; i++) finalAudio[i + leadingPadding] = audio[i];

  let noiseAudio: Float32Array | undefined;
  if (resolvedPolicy.emitNoiseAudio) {
    noiseAudio = new Float32Array(targetSamples);
    for (let i = 0; i < targetSamples; i++) noiseAudio[i] = paddingNoise[i];
    for (let i = 0; i < noiseOnlyContent.length; i++) noiseAudio[i + leadingPadding] = noiseOnlyContent[i];
  }

  if (resolvedPolicy.normalizePeak) {
    normalizePeak(finalAudio, noiseAudio, resolvedPolicy.normalizePeak);
  }

  const offsetMs = (leadingPadding / sampleRate) * 1000;
  const offsetCharacters = offsetMetadata(characters, offsetMs) ?? [];
  const offsetElements = offsetMetadata(elements, offsetMs);

  return {
    audio: finalAudio,
    ...(noiseAudio ? { noiseAudio } : {}),
    metadata: {
      config,
      characters: offsetCharacters,
      ...(offsetElements ? { elements: offsetElements } : {}),
      fullText: config.text,
      effectiveWpm,
      effectiveSnr: noiseConfig.snrDb,
      actualDurationSec: finalAudio.length / sampleRate,
      totalSamples: finalAudio.length,
    },
  };
}
