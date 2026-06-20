// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAudio } from './generate';

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

  it('maps UI QSB to signal fading instead of noise-floor modulation', () => {
    generateAudio({
      text: 'CQ',
      wpm: 20,
      snrDb: -5,
      qsb: true,
      seed: 123,
    });

    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        noise: { snrDb: -5 },
        ionosphericFading: { depth: 0.55, rate: 0.16, components: 2 },
      })
    );
  });

  it('omits signal fading when UI QSB is disabled', () => {
    generateAudio({
      text: 'CQ',
      wpm: 20,
      snrDb: -5,
      qsb: false,
      seed: 123,
    });

    expect(mocks.generate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        ionosphericFading: expect.anything(),
      })
    );
  });
});
