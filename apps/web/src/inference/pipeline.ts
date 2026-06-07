// End-to-end pipeline: WAV data URI → audio → DSP → ONNX → CTC decode.

import { dataUriToMonoFloat32 } from './audio';
import { IN_CHANNELS, NUM_CLASSES, PLAYER_ENVELOPE_BARS } from './constants';
import { greedyDecode } from './decode';
import { DSP_SAMPLE_RATE, extractEnvelope } from './dsp';
import { runInference } from './onnx';

export interface DecodeTiming {
  audioMs: number;
  dspMs: number;
  modelMs: number;
  decodeMs: number;
  totalMs: number;
}

export interface PipelineResult {
  text: string;
  confidence: number;
  timing: DecodeTiming;
  /** Keying envelope (display channel) downsampled to PLAYER_ENVELOPE_BARS peaks, for the audio scrubber. */
  envelopeBars: number[];
}

// Channel rendered in the scrubber. ch3 = 200ms long matched filter (~5 Hz BW):
// character-scale and heavily noise-rejecting, so it reads as clean keying at low
// SNR where ch0 (raw amplitude) looks like noise. Slightly rounds fast dit edges.
const DISPLAY_CHANNEL = 3;

/**
 * Reduce an interleaved (T, IN_CHANNELS) envelope to a fixed number of
 * display bars by taking the PEAK of the display channel per bucket.
 * Peak (not mean) preserves short dit edges at high WPM.
 */
export function envelopeToBars(
  envelope: Float32Array,
  bars: number = PLAYER_ENVELOPE_BARS
): number[] {
  const T = envelope.length / IN_CHANNELS;
  const out = new Array<number>(bars).fill(0);
  if (T === 0) return out;
  for (let b = 0; b < bars; b++) {
    const lo = Math.floor((b * T) / bars);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * T) / bars));
    let peak = 0;
    for (let i = lo; i < hi && i < T; i++) {
      const v = envelope[i * IN_CHANNELS + DISPLAY_CHANNEL];
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}

export async function decodeDataUri(
  dataUri: string,
  toneFreq: number = 700
): Promise<PipelineResult> {
  const t0 = performance.now();
  const audio = await dataUriToMonoFloat32(dataUri, DSP_SAMPLE_RATE);
  const t1 = performance.now();
  const envelope = extractEnvelope(audio, DSP_SAMPLE_RATE, toneFreq);
  const t2 = performance.now();
  const logProbs = await runInference(envelope);
  const t3 = performance.now();
  const T = logProbs.length / NUM_CLASSES;
  const result = greedyDecode(logProbs, T);
  const t4 = performance.now();
  return {
    text: result.text,
    confidence: result.confidence,
    timing: {
      audioMs: t1 - t0,
      dspMs: t2 - t1,
      modelMs: t3 - t2,
      decodeMs: t4 - t3,
      totalMs: t4 - t0,
    },
    envelopeBars: envelopeToBars(envelope),
  };
}
