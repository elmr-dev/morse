// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Audio generation using morse-audio's training-equivalent pipeline (MorseAudioGenerator).
//
// The simple generateMorseAudio helper uses legacy peak-signal SNR scaling. The
// MorseAudioGenerator path uses the shared receiver-chain mixer, so UI SNR values
// map to the same keyed-CW/receiver-noise calibration as generated samples.

import { createMorseAudioGenerator } from 'morse-audio';

const ROUGH_QSB_PRESET = {
  noise: {
    qsb: { depth: 0.08, freqHz: 0.18 },
    qrn: { rate: 3, amplitudeMultiplier: 4 },
  },
  ionosphericFading: { depth: 0.55, rate: 0.16, components: 2 },
  multipath: {
    paths: [
      { delayMs: 2.5, amplitude: 0.28, phase: Math.PI },
      { delayMs: 6.5, amplitude: 0.16, phase: Math.PI / 2 },
    ],
  },
  dopplerSpread: { spreadHz: 2.5, components: 3 },
  rayleigh: { bandwidth: 0.45, depth: 0.18 },
  agc: {
    attackMs: 8,
    releaseMs: 180,
    targetLevel: 0.55,
    maxGain: 6,
  },
};

// Lazy singleton — defers construction to first call rather than at module
// import time, keeping the module side-effect-free.
let _gen: ReturnType<typeof createMorseAudioGenerator> | null = null;
function gen() {
  if (!_gen) _gen = createMorseAudioGenerator();
  return _gen;
}

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
  const g = gen();
  const result = g.generate({
    text: opts.text,
    wpm: opts.wpm,
    frequency: opts.frequency ?? 700,
    sampleRate: 22050,
    noise: {
      snrDb: opts.snrDb,
      ...(opts.qsb ? ROUGH_QSB_PRESET.noise : {}),
    },
    ...(opts.qsb
      ? {
          ionosphericFading: ROUGH_QSB_PRESET.ionosphericFading,
          multipath: ROUGH_QSB_PRESET.multipath,
          dopplerSpread: ROUGH_QSB_PRESET.dopplerSpread,
          rayleigh: ROUGH_QSB_PRESET.rayleigh,
          agc: ROUGH_QSB_PRESET.agc,
        }
      : {}),
    durationSec: 0,
    seed: opts.seed ?? Math.floor(Math.random() * 2147483647),
  });
  return { dataUri: g.toDataUri(result), sampleRate: 22050 };
}
