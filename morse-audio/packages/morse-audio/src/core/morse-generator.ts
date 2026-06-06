import { createPrng, randomSeed } from '../utils/prng';
import { randomIonosphericFadingOptions, randomFadingSeverity } from '../utils/ionospheric-fading';
import { randomMultipathOptions } from '../utils/multipath';
import { randomAGCOptions } from '../utils/agc';
import { getData as getWavData, getMIMEType } from '../utils/riffwave';
import { getDataURI } from '../utils/datauri';
import { getFistOptions } from './fist-model';
import { randomQrmOptions } from './qrm-generator';
import { randomBroadbandInterferenceOptions } from './broadband-interference';
import { generateMorsePipeline } from './generation-pipeline';
import type {
  MorseAudioConfig,
  MorseAudioResult,
  ParameterDistributions,
  FistProfile,
  SampleRate,
} from './types';

/**
 * Primary Adapter for generating complete Morse audio samples.
 *
 * The synthesis/effects/noise/padding ordering lives in `generateMorsePipeline`;
 * this class keeps the public shape and batch/random convenience methods.
 */
export class MorseAudioGenerator {
  generate(config: MorseAudioConfig): MorseAudioResult {
    return generateMorsePipeline(config, {
      minPaddingSec: 0.2,
      emitNoiseAudio: false,
      normalizePeak: 0.95,
    });
  }

  generateBatch(
    count: number,
    texts: string[],
    distributions: ParameterDistributions,
    baseSeed?: number
  ): MorseAudioResult[] {
    const samples: MorseAudioResult[] = [];
    const basePrng = createPrng(baseSeed ?? randomSeed());

    for (let i = 0; i < count; i++) {
      const prng = createPrng(Math.floor(basePrng() * 2147483647));
      const text = texts[Math.floor(prng() * texts.length)];
      samples.push(this.generate(this.generateRandomConfig(text, distributions, prng)));
    }

    return samples;
  }

  private generateRandomConfig(
    text: string,
    dist: ParameterDistributions,
    prng: () => number
  ): MorseAudioConfig {
    const wpm = Math.round(dist.wpmRange[0] + prng() * (dist.wpmRange[1] - dist.wpmRange[0]));
    const fwpm = prng() < 0.3 ? Math.round(wpm * (0.6 + prng() * 0.4)) : wpm;
    const frequency = Math.round(dist.frequencyRange[0] + prng() * (dist.frequencyRange[1] - dist.frequencyRange[0]));
    const sampleRateOptions: SampleRate[] = [8000, 16000, 22050, 44100];
    const sampleRate = sampleRateOptions[Math.floor(prng() * sampleRateOptions.length)];
    const snrDb = dist.snrRange[0] + prng() * (dist.snrRange[1] - dist.snrRange[0]);

    let fistProfile: FistProfile | undefined;
    let cumulative = 0;
    const fistRoll = prng();
    for (const [profile, prob] of Object.entries(dist.fistDistribution)) {
      cumulative += prob ?? 0;
      if (fistRoll < cumulative) {
        fistProfile = profile as FistProfile;
        break;
      }
    }

    const noise: MorseAudioConfig['noise'] = { snrDb };
    if (prng() < dist.qsbProbability) {
      noise.qsb = { depth: 0.04 + prng() * 0.10, freqHz: 0.1 + prng() * 0.6 };
    }
    if (prng() < dist.qrnProbability) {
      noise.qrn = { rate: 2 + prng() * 6, amplitudeMultiplier: 3 + prng() * 5 };
    }
    if (prng() < dist.powerLineProbability) {
      noise.powerLine = {
        baseHz: prng() < 0.7 ? 60 : 50,
        level: 8 + prng() * 14,
        buzzDepth: 0.25 + prng() * 0.45,
        coronaLevel: 0.1 + prng() * 0.4,
      };
    }

    const config: MorseAudioConfig = {
      text,
      wpm,
      fwpm: fwpm !== wpm ? fwpm : undefined,
      fist: fistProfile ? getFistOptions(fistProfile, prng) : undefined,
      frequency,
      sampleRate,
      noise,
      durationSec: 10,
      seed: Math.floor(prng() * 2147483647),
    };

    if (prng() < dist.ionosphericFadingProbability) {
      const severity = randomFadingSeverity(prng);
      if (severity !== 'none') {
        config.ionosphericFading = randomIonosphericFadingOptions(severity, prng) ?? undefined;
      }
    }

    if (prng() < dist.multipathProbability) config.multipath = randomMultipathOptions(prng);
    if (prng() < dist.dopplerSpreadProbability) {
      config.dopplerSpread = {
        spreadHz: 1 + prng() * 19,
        components: 3 + Math.floor(prng() * 4),
      };
    }
    if (prng() < dist.cwQrmProbability) {
      const qrmCount = prng() < dist.multipleQrmProbability ? 2 : 1;
      config.cwQrm = Array.from({ length: qrmCount }, () => randomQrmOptions(prng));
    }
    if (prng() < dist.broadbandInterferenceProbability) {
      config.broadbandInterference = randomBroadbandInterferenceOptions(prng);
    }
    if (prng() < dist.agcProbability) config.agc = randomAGCOptions(prng);
    if (prng() < dist.pitchWobbleProbability) {
      config.pitchWobble = {
        amplitude: prng() * 3,
        rate: 0.01 + prng() * 0.09,
        phase: prng() * 2 * Math.PI,
      };
    }
    if (prng() < dist.chirpProbability) {
      config.chirp = {
        deviation: 5 + prng() * 25,
        timeConstant: 10,
      };
    }

    return config;
  }

  toWavBuffer(result: MorseAudioResult): ArrayBuffer {
    const wavData = getWavData(result.audio, result.metadata.config.sampleRate);
    const buffer = new ArrayBuffer(wavData.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < wavData.length; i++) view[i] = wavData[i];
    return buffer;
  }

  toDataUri(result: MorseAudioResult): string {
    return getDataURI(getWavData(result.audio, result.metadata.config.sampleRate), getMIMEType());
  }

  toMetadataJson(result: MorseAudioResult): string {
    return JSON.stringify(result.metadata, null, 2);
  }
}

export function createMorseAudioGenerator(): MorseAudioGenerator {
  return new MorseAudioGenerator();
}

/** @deprecated Use MorseAudioGenerator instead */
export const TrainingSampleGenerator = MorseAudioGenerator;
/** @deprecated Use createMorseAudioGenerator instead */
export const createTrainingSampleGenerator = createMorseAudioGenerator;
