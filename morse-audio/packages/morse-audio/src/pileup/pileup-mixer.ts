/**
 * Pileup mixer for contest simulation
 *
 * Combines multiple station audio streams:
 * 1. Generate each station's audio independently
 * 2. Sum all station samples
 * 3. Apply receiver bandwidth filter
 * 4. Add global QRN (atmospheric noise)
 * 5. Apply soft limiting to prevent clipping
 */

import { getSampleRate } from '../utils/audio-generator';
import { BandwidthFilter } from '../utils/bandwidth-filter';
import { getData as getRiffWaveData, getMIMEType } from '../utils/riffwave';
import { getDataURI } from '../utils/datauri';
import { createPrng, gaussianRandom } from '../utils/prng';
import { PinkNoiseFilter } from '../utils/pink-noise';
import {
  generateStationAudio,
  calculatePileupDuration,
} from './station-chain';
import type {
  PileupStation,
  PileupReceiverOptions,
  PileupGeneratorOptions,
  GeneratedPileupAudio,
} from './types';

/**
 * Simple one-pole lowpass filter
 */
class OnePoleLP {
  private y1 = 0;
  private a: number;

  constructor(cutoffHz: number, sampleRate: number) {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    this.a = dt / (rc + dt);
  }

  process(x: number): number {
    this.y1 = this.y1 + this.a * (x - this.y1);
    return this.y1;
  }
}

/**
 * Simple one-pole highpass filter
 */
class OnePoleHP {
  private x1 = 0;
  private y1 = 0;
  private a: number;

  constructor(cutoffHz: number, sampleRate: number) {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    this.a = rc / (rc + dt);
  }

  process(x: number): number {
    this.y1 = this.a * (this.y1 + x - this.x1);
    this.x1 = x;
    return this.y1;
  }
}

/**
 * Generate QRN (atmospheric noise) for pileup
 */
function generateQRN(
  length: number,
  sampleRate: number,
  snrDb: number,
  prng: () => number
): Float32Array {
  const noise = new Float32Array(length);

  // Filters for spectral shaping
  const pinkFilter = new PinkNoiseFilter();
  const hpFilter = new OnePoleHP(200, sampleRate);
  const lpFilter = new OnePoleLP(4000, sampleRate);

  // Slow amplitude modulation
  const modFreq1 = 0.5 + prng() * 1.5;
  const modFreq2 = 1.0 + prng() * 2.0;
  const modPhase1 = prng() * 2 * Math.PI;
  const modPhase2 = prng() * 2 * Math.PI;

  // Crackle parameters
  const crackleRate = 15 + prng() * 20;
  let nextCrackle = Math.floor(
    (-Math.log(prng()) / crackleRate) * sampleRate
  );
  let crackleEnvelope = 0;
  const crackleSmooth = new OnePoleLP(500, sampleRate);

  // Calculate noise amplitude from SNR
  // Signal is ~0.5 (after mixing), noise amplitude = 0.5 / 10^(snr/20)
  const noiseAmplitude = 0.5 / Math.pow(10, snrDb / 20);
  const processingBoost = 12.0;

  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;

    // Generate pink noise
    const white = gaussianRandom(prng);
    const pink = pinkFilter.process(white);
    const filtered = lpFilter.process(hpFilter.process(pink));

    // Crackle
    if (i >= nextCrackle) {
      crackleEnvelope = 0.5 + prng() * 0.5;
      nextCrackle =
        i +
        Math.floor((-Math.log(prng() || 0.001) / crackleRate) * sampleRate);
    }
    crackleEnvelope *= 0.995;
    const crackle = crackleSmooth.process(gaussianRandom(prng) * crackleEnvelope);

    // Combine and modulate
    let n = filtered * processingBoost + crackle * 2.0;
    const mod =
      0.7 +
      0.3 *
        (0.6 * Math.sin(2 * Math.PI * modFreq1 * time + modPhase1) +
          0.4 * Math.sin(2 * Math.PI * modFreq2 * time + modPhase2));
    n *= mod;

    // Add air
    n += white * 0.08;

    // Soft compression
    n = Math.tanh(n * 1.2) / Math.tanh(1.2);

    noise[i] = n * noiseAmplitude;
  }

  return noise;
}

/**
 * Soft limiter to prevent clipping while preserving dynamics
 */
function softLimit(samples: Float32Array): void {
  for (let i = 0; i < samples.length; i++) {
    // tanh-based soft clipping
    samples[i] = Math.tanh(samples[i] * 1.5) / Math.tanh(1.5);
  }
}

/**
 * Validate pileup options
 */
function validateOptions(options: PileupGeneratorOptions): void {
  const { stations, receiver } = options;

  if (!stations || stations.length === 0) {
    throw new Error('At least one station is required');
  }

  if (stations.length > 8) {
    throw new Error('Maximum 8 stations allowed');
  }

  // Check for duplicate IDs
  const ids = new Set<string>();
  for (const station of stations) {
    if (ids.has(station.id)) {
      throw new Error(`Duplicate station ID: ${station.id}`);
    }
    ids.add(station.id);
  }

  // Validate receiver options
  if (
    receiver.centerFrequency < 400 ||
    receiver.centerFrequency > 1200
  ) {
    throw new Error('Center frequency must be between 400 and 1200 Hz');
  }

  if (receiver.bandwidth < 100 || receiver.bandwidth > 2400) {
    throw new Error('Bandwidth must be between 100 and 2400 Hz');
  }
}

/**
 * Generate pileup audio from multiple stations
 *
 * @param options - Pileup generation options
 * @returns Generated audio with data URI and metadata
 */
export function generatePileupAudio(
  options: PileupGeneratorOptions
): GeneratedPileupAudio {
  validateOptions(options);

  const {
    stations,
    receiver,
    preDelay = 300,
    postDelay = 100,
  } = options;

  const sampleRate = getSampleRate();

  // Calculate total duration
  const totalDuration = calculatePileupDuration(stations, preDelay, postDelay);
  const totalSamples = Math.ceil((totalDuration / 1000) * sampleRate);

  // Add pre-delay to each station's start time
  const adjustedStations = stations.map((s) => ({
    ...s,
    startDelay: s.startDelay + preDelay,
  }));

  // Generate audio for each station
  const stationResults = adjustedStations.map((station, index) =>
    generateStationAudio(
      station,
      receiver.centerFrequency,
      sampleRate,
      totalDuration,
      index * 10000 // Different seed per station
    )
  );

  // Mix all stations together
  const mixed = new Float32Array(totalSamples);

  for (const result of stationResults) {
    for (let i = 0; i < totalSamples; i++) {
      mixed[i] += result.samples[i];
    }
  }

  // Apply receiver bandwidth filter
  const filter = new BandwidthFilter(
    receiver.centerFrequency,
    receiver.bandwidth,
    sampleRate,
    4 // 4-stage filter for good selectivity
  );

  const filtered = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    filtered[i] = filter.process(mixed[i]);
  }

  // Add QRN if enabled
  let output = filtered;
  if (receiver.qrn && receiver.qrn.snr !== undefined) {
    const prng = createPrng(54321);
    const qrn = generateQRN(totalSamples, sampleRate, receiver.qrn.snr, prng);

    for (let i = 0; i < totalSamples; i++) {
      output[i] += qrn[i];
    }
  }

  // Apply soft limiting
  softLimit(output);

  // Sort stations by start time for metadata
  const stationOrder = [...stations]
    .sort((a, b) => a.startDelay - b.startDelay)
    .map((s) => s.id);

  // Convert to WAV
  const wavData = getRiffWaveData(output, sampleRate);
  const dataUri = getDataURI(wavData, getMIMEType());

  return {
    dataUri,
    duration: totalDuration / 1000,
    sampleRate,
    stationOrder,
  };
}

/**
 * Generate pileup audio and return raw samples (for testing/analysis)
 *
 * @param options - Pileup generation options
 * @returns Object containing raw samples and metadata
 */
export function generatePileupSamples(
  options: PileupGeneratorOptions
): {
  samples: Float32Array;
  duration: number;
  sampleRate: number;
  stationOrder: string[];
} {
  validateOptions(options);

  const {
    stations,
    receiver,
    preDelay = 300,
    postDelay = 100,
  } = options;

  const sampleRate = getSampleRate();

  // Calculate total duration
  const totalDuration = calculatePileupDuration(stations, preDelay, postDelay);
  const totalSamples = Math.ceil((totalDuration / 1000) * sampleRate);

  // Add pre-delay to each station's start time
  const adjustedStations = stations.map((s) => ({
    ...s,
    startDelay: s.startDelay + preDelay,
  }));

  // Generate audio for each station
  const stationResults = adjustedStations.map((station, index) =>
    generateStationAudio(
      station,
      receiver.centerFrequency,
      sampleRate,
      totalDuration,
      index * 10000
    )
  );

  // Mix all stations together
  const mixed = new Float32Array(totalSamples);

  for (const result of stationResults) {
    for (let i = 0; i < totalSamples; i++) {
      mixed[i] += result.samples[i];
    }
  }

  // Apply receiver bandwidth filter
  const filter = new BandwidthFilter(
    receiver.centerFrequency,
    receiver.bandwidth,
    sampleRate,
    4
  );

  const filtered = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    filtered[i] = filter.process(mixed[i]);
  }

  // Add QRN if enabled
  let output = filtered;
  if (receiver.qrn && receiver.qrn.snr !== undefined) {
    const prng = createPrng(54321);
    const qrn = generateQRN(totalSamples, sampleRate, receiver.qrn.snr, prng);

    for (let i = 0; i < totalSamples; i++) {
      output[i] += qrn[i];
    }
  }

  // Apply soft limiting
  softLimit(output);

  // Sort stations by start time
  const stationOrder = [...stations]
    .sort((a, b) => a.startDelay - b.startDelay)
    .map((s) => s.id);

  return {
    samples: output,
    duration: totalDuration / 1000,
    sampleRate,
    stationOrder,
  };
}

/**
 * Calculate attenuation for each station based on receiver settings
 *
 * @param stations - Array of stations
 * @param receiver - Receiver settings
 * @returns Map of station ID to attenuation in dB
 */
export function calculateStationAttenuations(
  stations: PileupStation[],
  receiver: PileupReceiverOptions
): Map<string, number> {
  const sampleRate = getSampleRate();
  const filter = new BandwidthFilter(
    receiver.centerFrequency,
    receiver.bandwidth,
    sampleRate
  );

  const attenuations = new Map<string, number>();

  for (const station of stations) {
    const attenuation = filter.calculateAttenuation(station.frequencyOffset);
    attenuations.set(station.id, attenuation);
  }

  return attenuations;
}
