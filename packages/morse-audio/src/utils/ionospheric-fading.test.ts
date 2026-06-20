import { describe, expect, it } from 'vitest';
import {
  FADING_PROFILES,
  generateIonosphericFadingEnvelope,
  randomIonosphericFadingOptions,
} from './ionospheric-fading';

describe('ionospheric fading envelope', () => {
  it('stays bounded by the configured fade floor and unity peak', () => {
    const depth = 0.55;
    const envelope = generateIonosphericFadingEnvelope(
      16_000,
      {
        depth,
        rate: 0.16,
        components: 2,
      },
      8_000,
      123
    );

    let min = Infinity;
    let max = -Infinity;
    for (const sample of envelope) {
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }

    expect(min).toBeGreaterThanOrEqual(1 - depth - 1e-6);
    expect(max).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('allows a single slow sinusoid for mild QSB', () => {
    const envelope = generateIonosphericFadingEnvelope(
      8_000,
      {
        depth: 0.25,
        rate: 0.08,
        components: 1,
        phases: [Math.PI / 2],
      },
      8_000
    );

    expect(envelope[0]).toBeCloseTo(1, 6);
  });

  it('keeps moderate profile movement slow at audio sample scale', () => {
    const moderate = FADING_PROFILES.moderate;
    if (!moderate) throw new Error('moderate profile should exist');

    const envelope = generateIonosphericFadingEnvelope(
      8_000,
      moderate,
      8_000,
      456
    );

    let maxStep = 0;
    for (let i = 1; i < envelope.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(envelope[i] - envelope[i - 1]));
    }

    expect(maxStep).toBeLessThan(0.001);
  });

  it('randomizes within the slow-QSB rate range', () => {
    const values = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7];
    let i = 0;
    const options = randomIonosphericFadingOptions(
      'severe',
      () => values[i++ % values.length]
    );

    expect(options).not.toBeNull();
    expect(options?.rate).toBeGreaterThanOrEqual(0.03);
    expect(options?.rate).toBeLessThanOrEqual(0.45);
  });
});
