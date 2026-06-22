// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  toDataUri: vi.fn(),
}));

vi.mock('morse-audio', () => ({
  createMorseAudioGenerator: () => mocks,
}));

describe('generateAudio', () => {
  beforeEach(() => {
    mocks.generate.mockReset();
    mocks.toDataUri.mockReset();
    mocks.generate.mockReturnValue({ audio: new Float32Array(0) });
    mocks.toDataUri.mockReturnValue('data:audio/wav;base64,AAAA');
  });

  it('maps UI QSB to a rough HF propagation preset', async () => {
    const { generateAudio } = await import('./generate');

    generateAudio({
      text: 'CQ',
      wpm: 20,
      snrDb: -5,
      qsb: true,
      seed: 123,
    });

    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        noise: {
          snrDb: -5,
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
      })
    );
  });

  it('omits rough HF propagation effects when UI QSB is disabled', async () => {
    const { generateAudio } = await import('./generate');

    generateAudio({
      text: 'CQ',
      wpm: 20,
      snrDb: -5,
      qsb: false,
      seed: 123,
    });

    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        noise: { snrDb: -5 },
      })
    );
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        ionosphericFading: expect.anything(),
        multipath: expect.anything(),
        dopplerSpread: expect.anything(),
        rayleigh: expect.anything(),
        agc: expect.anything(),
      })
    );
  });
});
