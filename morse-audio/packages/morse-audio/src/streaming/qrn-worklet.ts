/**
 * AudioWorklet processor for continuous QRN (atmospheric noise) generation
 *
 * Runs in a separate audio thread for glitch-free continuous playback.
 * Uses the same noise algorithm as radio-effects.ts but optimized for real-time.
 */

/**
 * QRN Worklet processor code as a string
 * This will be loaded into an AudioWorklet context
 */
export const QRN_WORKLET_CODE = `
/**
 * Pink noise filter using Paul Kellet's economy method
 */
class PinkNoiseFilter {
  constructor() {
    this.b0 = 0;
    this.b1 = 0;
    this.b2 = 0;
    this.b3 = 0;
    this.b4 = 0;
    this.b5 = 0;
    this.b6 = 0;
  }

  process(white) {
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.96900 * this.b2 + white * 0.1538520;
    this.b3 = 0.86650 * this.b3 + white * 0.3104856;
    this.b4 = 0.55000 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.0168980;
    const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
    this.b6 = white * 0.115926;
    return pink * 0.11;
  }
}

/**
 * Simple one-pole low-pass filter
 */
class OnePoleLP {
  constructor(cutoffHz, sampleRate) {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    this.a = dt / (rc + dt);
    this.y1 = 0;
  }

  process(x) {
    this.y1 = this.y1 + this.a * (x - this.y1);
    return this.y1;
  }
}

/**
 * Simple one-pole high-pass filter
 */
class OnePoleHP {
  constructor(cutoffHz, sampleRate) {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    this.a = rc / (rc + dt);
    this.x1 = 0;
    this.y1 = 0;
  }

  process(x) {
    this.y1 = this.a * (this.y1 + x - this.x1);
    this.x1 = x;
    return this.y1;
  }
}

/**
 * Seeded PRNG (mulberry32) for reproducible noise
 */
function createPrng(seed) {
  return function() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate Gaussian white noise sample
 */
function gaussianNoise(prng) {
  const u1 = prng();
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}

/**
 * QRN AudioWorklet Processor
 */
class QrnProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.enabled = false;
    this.amplitude = 0.1;
    this.sampleRate = 44100;

    // Initialize noise generators
    this.prng = createPrng(12345);
    this.pinkFilter = new PinkNoiseFilter();
    this.hpFilter = new OnePoleHP(200, this.sampleRate);
    this.lpFilter = new OnePoleLP(4000, this.sampleRate);
    this.crackleSmooth = new OnePoleLP(500, this.sampleRate);

    // Modulation parameters (randomized with multiple slow-varying components)
    this.modFreq1 = 0.08 + this.prng() * 0.15;  // Very slow: 0.08-0.23 Hz
    this.modFreq2 = 0.15 + this.prng() * 0.25;  // Slow: 0.15-0.4 Hz
    this.modFreq3 = 0.3 + this.prng() * 0.4;    // Medium: 0.3-0.7 Hz
    this.modFreq4 = 0.5 + this.prng() * 1.0;    // Faster: 0.5-1.5 Hz
    this.modPhase1 = this.prng() * 2 * Math.PI;
    this.modPhase2 = this.prng() * 2 * Math.PI;
    this.modPhase3 = this.prng() * 2 * Math.PI;
    this.modPhase4 = this.prng() * 2 * Math.PI;

    // Heterodyne tones
    this.toneFreq1 = 500 + this.prng() * 1500;
    this.toneFreq2 = 600 + this.prng() * 1200;
    this.toneDrift1 = (this.prng() - 0.5) * 0.5;
    this.toneDrift2 = (this.prng() - 0.5) * 0.3;
    this.toneAmp = 0.03;

    // Crackle state
    this.crackleRate = 15 + this.prng() * 20;
    this.nextCrackle = Math.floor(-Math.log(this.prng()) / this.crackleRate * this.sampleRate);
    this.crackleEnvelope = 0;
    this.sampleCount = 0;

    // Boost factor
    this.processingBoost = 12.0;

    // Handle messages from main thread
    this.port.onmessage = (event) => {
      const { type, data } = event.data;
      switch (type) {
        case 'setEnabled':
          this.enabled = data.enabled;
          break;
        case 'setAmplitude':
          this.amplitude = data.amplitude;
          break;
        case 'setSnr':
          // Convert SNR (dB) to amplitude: signal ~0.8, noise = 0.8 / 10^(snr/20)
          this.amplitude = 0.8 / Math.pow(10, data.snr / 20);
          break;
        case 'setSampleRate':
          this.sampleRate = data.sampleRate;
          // Reinitialize filters with new sample rate
          this.hpFilter = new OnePoleHP(200, this.sampleRate);
          this.lpFilter = new OnePoleLP(4000, this.sampleRate);
          this.crackleSmooth = new OnePoleLP(500, this.sampleRate);
          break;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    if (!channel) return true;

    // If disabled, output silence
    if (!this.enabled) {
      channel.fill(0);
      return true;
    }

    for (let i = 0; i < channel.length; i++) {
      const time = this.sampleCount / this.sampleRate;

      // Generate white noise
      const white = gaussianNoise(this.prng);

      // Convert to pink noise
      const pink = this.pinkFilter.process(white);

      // Band-pass filter
      const filtered = this.lpFilter.process(this.hpFilter.process(pink));

      // Crackling impulse layer
      if (this.sampleCount >= this.nextCrackle) {
        this.crackleEnvelope = 0.5 + this.prng() * 0.5;
        this.nextCrackle = this.sampleCount + Math.floor(-Math.log(this.prng() || 0.001) / this.crackleRate * this.sampleRate);
      }
      this.crackleEnvelope *= 0.995;
      const crackle = this.crackleSmooth.process(gaussianNoise(this.prng) * this.crackleEnvelope);

      // Combine noise and crackle
      let noise = (filtered * this.processingBoost) + (crackle * 2.0);

      // Apply slow amplitude modulation ("breathing") with multiple non-harmonic frequencies
      // Using 4 frequencies with irrational ratios to avoid rhythmic patterns
      const mod1 = Math.sin(2 * Math.PI * this.modFreq1 * time + this.modPhase1);
      const mod2 = Math.sin(2 * Math.PI * this.modFreq2 * time + this.modPhase2);
      const mod3 = Math.sin(2 * Math.PI * this.modFreq3 * time + this.modPhase3);
      const mod4 = Math.sin(2 * Math.PI * this.modFreq4 * time + this.modPhase4);
      // Weighted combination for organic, non-periodic modulation
      const mod = 0.65 + 0.35 * (mod1 * 0.35 + mod2 * 0.3 + mod3 * 0.2 + mod4 * 0.15);
      noise *= mod;

      // Add faint heterodyne tones with drift
      const tone1 = Math.sin(2 * Math.PI * (this.toneFreq1 + this.toneDrift1 * time) * time);
      const tone2 = Math.sin(2 * Math.PI * (this.toneFreq2 + this.toneDrift2 * time) * time);
      noise += (tone1 + tone2 * 0.7) * this.toneAmp;

      // Add tiny bit of raw white noise for "air"
      noise += white * 0.08;

      // Soft compression (AGC simulation)
      noise = Math.tanh(noise * 1.2) / Math.tanh(1.2);

      channel[i] = noise * this.amplitude;
      this.sampleCount++;
    }

    return true;
  }
}

registerProcessor('qrn-processor', QrnProcessor);
`;

/**
 * Create a Blob URL for the QRN worklet
 */
export function createQrnWorkletUrl(): string {
  const blob = new Blob([QRN_WORKLET_CODE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

/**
 * Revoke a previously created worklet URL
 */
export function revokeQrnWorkletUrl(url: string): void {
  URL.revokeObjectURL(url);
}
