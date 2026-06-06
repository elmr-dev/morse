/**
 * Shared envelope generation for morse code audio
 *
 * Generates keying envelopes with raised cosine attack/decay ramps
 * to prevent clicking artifacts in the audio.
 */

/**
 * Generate keying envelope from morse timings
 *
 * Uses raised cosine ramps for clean attack/decay without
 * over-smoothing. This produces crisp, click-free morse keying.
 *
 * @param timings - Array of timing values (positive = sound, negative = silence)
 * @param sampleRate - Sample rate in Hz
 * @param rampDurationMs - Envelope ramp duration in ms (default 5ms)
 * @returns Float32Array envelope (0-1)
 */
export function generateEnvelope(
  timings: number[],
  sampleRate: number,
  rampDurationMs: number = 5
): Float32Array {
  let totalMs = 0;
  for (const timing of timings) {
    totalMs += Math.abs(timing);
  }

  const totalSamples = Math.ceil((totalMs / 1000) * sampleRate);
  const envelope = new Float32Array(totalSamples);
  const rampSamples = Math.ceil((rampDurationMs / 1000) * sampleRate);

  let sampleIndex = 0;

  for (const timing of timings) {
    const numSamples = Math.ceil((Math.abs(timing) / 1000) * sampleRate);
    const isSound = timing > 0;

    if (isSound) {
      const attackEnd = Math.min(rampSamples, numSamples);
      const decayStart = Math.max(numSamples - rampSamples, attackEnd);

      for (let i = 0; i < numSamples && sampleIndex < totalSamples; i++) {
        let env = 1.0;
        if (i < attackEnd) {
          // Attack ramp: raised cosine from 0 to 1
          env = 0.5 * (1 - Math.cos((Math.PI * i) / rampSamples));
        } else if (i >= decayStart) {
          // Decay ramp: raised cosine from 1 to 0
          env = 0.5 * (1 + Math.cos((Math.PI * (i - decayStart)) / rampSamples));
        }
        envelope[sampleIndex++] = env;
      }
    } else {
      // Silence - just advance index (array is zero-initialized)
      sampleIndex += numSamples;
      // Clamp to bounds
      if (sampleIndex > totalSamples) {
        sampleIndex = totalSamples;
      }
    }
  }

  return envelope;
}

/**
 * Generate envelope with lead-in padding for audio playback
 *
 * Includes a configurable lead-in period of silence, useful for
 * Bluetooth audio devices that have fade-in behavior.
 *
 * @param timings - Array of timing values (positive = sound, negative = silence)
 * @param sampleRate - Sample rate in Hz
 * @param rampDurationMs - Envelope ramp duration in ms (default 5ms)
 * @param leadInMs - Silence padding at start (default 300ms)
 * @returns Float32Array envelope (0-1)
 */
export function generateEnvelopeWithLeadIn(
  timings: number[],
  sampleRate: number,
  rampDurationMs: number = 5,
  leadInMs: number = 300
): Float32Array {
  // Calculate total number of samples needed (including lead-in padding)
  let totalMs = leadInMs;
  for (const timing of timings) {
    totalMs += Math.abs(timing);
  }

  const totalSamples = Math.ceil((totalMs / 1000) * sampleRate);
  const leadInSamples = Math.ceil((leadInMs / 1000) * sampleRate);
  const envelope = new Float32Array(totalSamples);
  const rampSamples = Math.ceil((rampDurationMs / 1000) * sampleRate);

  let sampleIndex = leadInSamples; // Skip lead-in (already zero-filled)

  for (const timing of timings) {
    const numSamples = Math.ceil((Math.abs(timing) / 1000) * sampleRate);
    const isSound = timing > 0;

    if (isSound) {
      const attackEnd = Math.min(rampSamples, numSamples);
      const decayStart = Math.max(numSamples - rampSamples, attackEnd);

      for (let i = 0; i < numSamples && sampleIndex < totalSamples; i++) {
        let env = 1.0;
        if (i < attackEnd) {
          // Attack ramp: raised cosine from 0 to 1
          env = 0.5 * (1 - Math.cos((Math.PI * i) / rampSamples));
        } else if (i >= decayStart) {
          // Decay ramp: raised cosine from 1 to 0
          env = 0.5 * (1 + Math.cos((Math.PI * (i - decayStart)) / rampSamples));
        }
        envelope[sampleIndex++] = env;
      }
    } else {
      // Silence - just advance index (array is zero-initialized)
      sampleIndex += numSamples;
      // Clamp to bounds
      if (sampleIndex > totalSamples) {
        sampleIndex = totalSamples;
      }
    }
  }

  return envelope;
}
