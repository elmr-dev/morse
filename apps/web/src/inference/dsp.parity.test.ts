// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Parity test: TS extractEnvelope must match the training-side Python DSP
// (packages/ml/cw-dsp-research/dsp.py, scipy Butterworth) channel-for-channel
// on the committed golden fixtures in fixtures/dsp/. This is the conformance
// gate for the RBJ→Butterworth bandpass fix.
//
// Also includes a coefficient unit test against scipy.signal.butter's hardcoded
// SOS reference for 700/600/800 Hz at fs=8000.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IN_CHANNELS } from './constants';
import {
  butterBandpassOrder1Sos,
  DSP_SAMPLE_RATE,
  extractEnvelope,
  sosfiltZi,
} from './dsp';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/dsp');

interface ClipManifest {
  id: string;
  text: string;
  wpm: number;
  snr_db: number;
  tone_freq_hz: number;
  sample_rate: number;
  n_samples: number;
  n_envelope_frames: number;
  input_wav: string;
  envelope_json: string;
}

interface Index {
  channels: string[];
  dsp_sample_rate: number;
  clips: ClipManifest[];
}

function loadIndex(): Index {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'index.json'), 'utf8'));
}

/**
 * Minimal mono PCM-16 WAV reader. Trusts the fixture writer (no chunk hunting,
 * no compression). Returns Float32Array in [-1, 1] at the file's sample rate.
 */
function readWavPcm16Mono(path: string): { audio: Float32Array; sr: number } {
  const buf = readFileSync(path);
  if (buf.slice(0, 4).toString('ascii') !== 'RIFF')
    throw new Error(`${path}: not RIFF`);
  if (buf.slice(8, 12).toString('ascii') !== 'WAVE')
    throw new Error(`${path}: not WAVE`);
  // Locate 'fmt ' and 'data' chunks defensively (handles trailing chunks).
  let pos = 12;
  let sr = 0;
  let channels = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.slice(pos, pos + 4).toString('ascii');
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      // const fmtCode = buf.readUInt16LE(pos + 8);
      channels = buf.readUInt16LE(pos + 10);
      sr = buf.readUInt32LE(pos + 12);
      bits = buf.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      dataOffset = pos + 8;
      dataLen = size;
      break;
    }
    pos += 8 + size + (size & 1);
  }
  if (dataOffset < 0) throw new Error(`${path}: no data chunk`);
  if (channels !== 1)
    throw new Error(`${path}: expected mono, got ${channels}`);
  if (bits !== 16) throw new Error(`${path}: expected 16-bit, got ${bits}`);
  const nSamples = dataLen >> 1;
  const out = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    out[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return { audio: out, sr };
}

function loadEnvelopeJson(path: string): {
  shape: [number, number];
  data: Float32Array;
} {
  const j = JSON.parse(readFileSync(path, 'utf8')) as {
    shape: [number, number];
    data: number[];
  };
  return { shape: j.shape, data: Float32Array.from(j.data) };
}

describe('butterBandpassOrder1Sos — scipy SOS reference', () => {
  // Hardcoded from `butter(1, [tone-25, tone+25], btype="bandpass", fs=8000,
  // output="sos")[0]`. Same SOS layout: [b0, b1, b2, a0, a1, a2].
  const REFS: Record<string, [number, number, number, number, number, number]> =
    {
      '700': [
        0.019259274202335797, 0, -0.019259274202335797, 1, -1.6727603077362847,
        0.9614814515953285,
      ],
      '600': [
        0.019259274202335773, 0, -0.019259274202335773, 1, -1.7480297198120356,
        0.9614814515953288,
      ],
      '800': [
        0.019259274202335676, 0, -0.019259274202335676, 1, -1.5871777721140923,
        0.961481451595329,
      ],
    };
  for (const [toneStr, ref] of Object.entries(REFS)) {
    it(`tone=${toneStr}Hz matches scipy SOS within 1e-14`, () => {
      const tone = Number(toneStr);
      const sos = butterBandpassOrder1Sos(tone - 25, tone + 25, 8000);
      for (let i = 0; i < 6; i++) {
        expect(
          Math.abs(sos[i] - ref[i]),
          `coef[${i}] mine=${sos[i]} ref=${ref[i]}`
        ).toBeLessThan(1e-14);
      }
    });
  }
});

describe('sosfiltZi — scipy sosfilt_zi reference', () => {
  it('matches scipy for the 700 Hz section', () => {
    const sos = butterBandpassOrder1Sos(675, 725, 8000);
    const zi = sosfiltZi([sos]);
    // scipy.signal.sosfilt_zi(sos) for the 700 Hz section, hardcoded:
    expect(zi[0][0]).toBeCloseTo(-0.019259274202335797, 14);
    expect(zi[0][1]).toBeCloseTo(-0.019259274202335797, 14);
  });
});

describe('extractEnvelope — parity vs python golden fixture', () => {
  const index = loadIndex();
  expect(index.dsp_sample_rate).toBe(DSP_SAMPLE_RATE);
  expect(index.channels.length).toBe(IN_CHANNELS);

  // Per-channel max-abs-error gates. Both the bandpass (Butterworth) and the
  // smoothing boundary (reflectIdx mode='reflect') now match scipy exactly.
  // Observed max abs error across all 10 clips:
  //   ch0 ≈ 2.75e-4, ch1 ≈ 5.82e-11, ch2 ≈ 4.66e-10, ch3 ≈ 5.96e-8
  // Epsilons are set ~4–20× above observed max for numerical headroom.
  const EPS_PER_CHANNEL: [number, number, number, number] = [
    5e-4, // ch0 amplitude — bandpass + narrow Gaussian (σ=4)
    1e-9, // ch1 TKEO — uniform 30 ms
    1e-8, // ch2 matched 48 ms — uniform 48 ms
    1e-6, // ch3 matched 200 ms — uniform 200 ms
  ];

  for (const clip of index.clips) {
    it(`${clip.id} (T=${clip.n_envelope_frames}, tone=${clip.tone_freq_hz}Hz, SNR=${clip.snr_db}dB)`, () => {
      const { audio, sr } = readWavPcm16Mono(
        resolve(FIXTURE_DIR, clip.input_wav)
      );
      expect(sr).toBe(DSP_SAMPLE_RATE);
      const env = extractEnvelope(audio, DSP_SAMPLE_RATE, clip.tone_freq_hz);
      const golden = loadEnvelopeJson(resolve(FIXTURE_DIR, clip.envelope_json));
      expect(golden.shape[1]).toBe(IN_CHANNELS);
      expect(env.length).toBe(golden.shape[0] * IN_CHANNELS);

      const T = golden.shape[0];
      const maxErr = [0, 0, 0, 0];
      for (let t = 0; t < T; t++) {
        for (let c = 0; c < IN_CHANNELS; c++) {
          const d = Math.abs(
            env[t * IN_CHANNELS + c] - golden.data[t * IN_CHANNELS + c]
          );
          if (d > maxErr[c]) maxErr[c] = d;
        }
      }
      const msg = `max abs err [ch0=${maxErr[0].toExponential(2)}, ch1=${maxErr[1].toExponential(2)}, ch2=${maxErr[2].toExponential(2)}, ch3=${maxErr[3].toExponential(2)}]`;
      for (let c = 0; c < IN_CHANNELS; c++) {
        expect(maxErr[c], `${clip.id} ch${c} — ${msg}`).toBeLessThan(
          EPS_PER_CHANNEL[c]
        );
      }
    });
  }
});
