/**
 * Diagnostic: measure the actual SNR of audio produced by the calibrated mixer
 * and compare it to the requested SNR. Run with:
 *
 *   pnpm tsx packages/morse-audio/src/utils/snr-verify.ts
 *
 * The check works by generating signal and noise *separately* with the same
 * settings the production pipeline uses, measuring each one's power, and then
 * computing what the SNR would be after mixWithCalibratedNoise applied a given
 * signalGain. (Peak normalization is a uniform scalar so it cancels in the
 * signal/noise power ratio — we don't have to undo it.)
 *
 * The expected outcome: requested SNR ≈ measured SNR (within ~0.3 dB) for any
 * setting in the slider's range, when measured in the 2500 Hz reference
 * bandwidth (i.e. before any narrower receiver bandpass).
 */

import { translate } from './morse-code';
import { generateEnvelope } from './envelope';
import { generateCalibratedNoise, DEFAULT_REFERENCE_PEAK } from './snr-mixing';
import { applyBandwidthFilter } from './bandwidth-filter';

const SAMPLE_RATE = 22050;
const FREQUENCY = 600;
const REFERENCE_BANDWIDTH = 2500;

/** Build a continuous keyed sine that mirrors what synthesizeTone does, so the
 *  measured signal RMS matches what the live pipeline produces. */
function makeKeyedSignal(text: string, wpm: number): { samples: Float32Array; envelope: Float32Array } {
  const { timings } = translate(text, wpm, wpm);
  const envelope = generateEnvelope(timings, SAMPLE_RATE);
  const samples = new Float32Array(envelope.length);
  const twoPi = 2 * Math.PI;
  let phase = 0;
  for (let i = 0; i < envelope.length; i++) {
    samples[i] = Math.sin(phase) * envelope[i] * 0.8; // matches SIGNAL_AMPLITUDE
    phase += (twoPi * FREQUENCY) / SAMPLE_RATE;
    if (phase >= twoPi) phase -= twoPi;
  }
  return { samples, envelope };
}

function makeContinuousSignal(durationSec: number): Float32Array {
  const length = Math.floor(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(length);
  const twoPi = 2 * Math.PI;
  let phase = 0;
  for (let i = 0; i < length; i++) {
    samples[i] = Math.sin(phase) * 0.8;
    phase += (twoPi * FREQUENCY) / SAMPLE_RATE;
    if (phase >= twoPi) phase -= twoPi;
  }
  return samples;
}

/** Compute RMS over samples where envelope > threshold (signal-on time only). */
function rmsOver(samples: Float32Array, mask?: Float32Array, threshold = 0.5): number {
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!mask || mask[i] > threshold) {
      sumSq += samples[i] * samples[i];
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

function powerToDb(power: number): number {
  return 10 * Math.log10(power);
}

interface Measurement {
  requested: number;
  signalRms: number;
  noiseRms: number;
  measured: number;
  offset: number;
}

function measure(snrDb: number, signal: Float32Array, signalMask: Float32Array, noise: Float32Array): Measurement {
  const signalGain = Math.pow(10, snrDb / 20);

  // Apply gain to signal samples to match what mixWithCalibratedNoise does.
  const scaledSignal = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) scaledSignal[i] = signal[i] * signalGain;

  const sigRms = rmsOver(scaledSignal, signalMask);
  const noiseRms = rmsOver(noise);

  const measuredSnr = powerToDb((sigRms * sigRms) / (noiseRms * noiseRms));
  return {
    requested: snrDb,
    signalRms: sigRms,
    noiseRms,
    measured: measuredSnr,
    offset: measuredSnr - snrDb,
  };
}

function main() {
  console.log('SNR calibration check');
  console.log(`  Reference bandwidth: ${REFERENCE_BANDWIDTH} Hz`);
  console.log(`  Tone frequency:      ${FREQUENCY} Hz`);
  console.log(`  Sample rate:         ${SAMPLE_RATE} Hz`);
  console.log();

  // --- Case 1: continuous sine (idealized — what the SNR math is calibrated against)
  const contSignal = makeContinuousSignal(2);
  const contNoise = generateCalibratedNoise({
    length: contSignal.length,
    sampleRate: SAMPLE_RATE,
    centerFrequency: FREQUENCY,
    referenceBandwidth: REFERENCE_BANDWIDTH,
    targetPeak: DEFAULT_REFERENCE_PEAK,
  });

  console.log('Case A: continuous tone (the canonical SNR scenario)');
  console.log('  requested  measured  offset    sigRMS    noiseRMS');
  for (const snr of [-18, -12, -6, 0, 6, 12, 20, 30]) {
    const m = measure(snr, contSignal, new Float32Array(contSignal.length).fill(1), contNoise);
    console.log(
      `  ${m.requested.toString().padStart(8)} ${m.measured.toFixed(2).padStart(8)}  ${
        (m.offset >= 0 ? '+' : '') + m.offset.toFixed(2)
      }  ${m.signalRms.toFixed(4)}    ${m.noiseRms.toFixed(4)}`
    );
  }

  // --- Case 2: keyed morse (measured during signal-on time)
  console.log();
  console.log('Case B: keyed morse "EEEEEEEEEE" — measured during dits only');
  const { samples: keyedSignal, envelope } = makeKeyedSignal('EEEEEEEEEEEEEEEE', 20);
  const keyedNoise = generateCalibratedNoise({
    length: keyedSignal.length,
    sampleRate: SAMPLE_RATE,
    centerFrequency: FREQUENCY,
    referenceBandwidth: REFERENCE_BANDWIDTH,
    targetPeak: DEFAULT_REFERENCE_PEAK,
  });
  console.log('  requested  measured  offset    sigRMS    noiseRMS');
  for (const snr of [-18, -12, -6, 0, 6, 12, 20]) {
    const m = measure(snr, keyedSignal, envelope, keyedNoise);
    console.log(
      `  ${m.requested.toString().padStart(8)} ${m.measured.toFixed(2).padStart(8)}  ${
        (m.offset >= 0 ? '+' : '') + m.offset.toFixed(2)
      }  ${m.signalRms.toFixed(4)}    ${m.noiseRms.toFixed(4)}`
    );
  }

  // --- Case 3: confirm the bandpass effect — narrow receiver should reduce noise RMS
  // proportionally to sqrt(targetBW / referenceBW) for white noise; less for pink.
  console.log();
  console.log('Case C: narrowing the receiver bandpass (signal stays put, noise drops)');
  console.log('  bandwidth   noiseRMS  noisedB-vs-2500   theoretical(white)');
  for (const bw of [2500, 1000, 500, 300, 250, 100]) {
    const filtered = applyBandwidthFilter(contNoise, FREQUENCY, bw, SAMPLE_RATE, 4);
    const filteredRms = rmsOver(filtered);
    const referenceRms = rmsOver(contNoise);
    const dbDiff = 20 * Math.log10(filteredRms / referenceRms);
    const theoretical = 10 * Math.log10(bw / 2500);
    console.log(
      `  ${bw.toString().padStart(8)} Hz    ${filteredRms.toFixed(4)}     ${dbDiff.toFixed(2)} dB           ${theoretical.toFixed(2)} dB`
    );
  }
}

// Only run when invoked directly via tsx, not if accidentally imported.
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main();
}
