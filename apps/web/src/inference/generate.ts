// Audio generation using morse-audio's training-equivalent pipeline (MorseAudioGenerator).
//
// The simple generateMorseAudio helper uses peak-signal SNR scaling, which is ~5–10 dB
// different from the training data's RMS-power SNR. Using MorseAudioGenerator with a
// NoiseConfig matches the exact SNR calibration the model was trained on, so UI "-5 dB"
// corresponds to training "-5 dB".

import { createMorseAudioGenerator } from 'morse-audio';

const gen = createMorseAudioGenerator();

export interface GenerateOptions {
  text: string;
  wpm: number;
  snrDb: number;
  frequency?: number;
  qsb?: boolean;
  seed?: number;
}

export interface GeneratedAudio {
  dataUri: string;
  sampleRate: number;
}

export function generateAudio(opts: GenerateOptions): GeneratedAudio {
  const result = gen.generate({
    text: opts.text,
    wpm: opts.wpm,
    frequency: opts.frequency ?? 700,
    sampleRate: 22050,
    noise: {
      snrDb: opts.snrDb,
      ...(opts.qsb ? { qsb: { depth: 0.5, freqHz: 0.2 } } : {}),
    },
    durationSec: 0,
    seed: opts.seed ?? Math.floor(Math.random() * 2147483647),
  });
  return { dataUri: gen.toDataUri(result), sampleRate: 22050 };
}
