// Dual-look CTC decoding for repeated-callsign audio.
//
// When the same callsign is sent twice in one clip ("K1ABC K1ABC"), the
// envelope has two signal segments separated by a long silence (7 dit-units
// for a word gap, plus generator padding). Each segment carries the same
// information but with independent noise. Running inference on each segment
// and combining the results gives the bot a real diversity-combining gain
// at low SNR — the same trick human ops use when asking "again please?".
//
// This module:
//   1. Splits a (T, IN_CHANNELS) envelope at the inter-callsign silence,
//   2. Runs the model on each half,
//   3. Greedy-decodes each half,
//   4. Picks the higher-confidence decode (simple ensemble; future work
//      can sum log-probs frame-by-frame for ~√2 SNR gain).

import { ENVELOPE_SR, extractEnvelope, DSP_SAMPLE_RATE } from './dsp'
import { greedyDecode, type DecodeResult } from './decode'
import { runInference } from './onnx'
import { IN_CHANNELS, NUM_CLASSES } from './constants'
import { dataUriToMonoFloat32 } from './audio'

export interface DualDecodeResult extends DecodeResult {
  /** Decode of the first send. */
  firstHalf: DecodeResult
  /** Decode of the second send. */
  secondHalf: DecodeResult
  /** True when the two decodes agreed exactly. */
  agreement: boolean
  /** Frame index in the envelope where the split was made (at envelope rate). */
  splitFrame: number
}

const SILENCE_THRESHOLD = 0.1   // ch0 below this is considered silence
const MIN_GAP_FRAMES = 100      // ~200 ms — must be longer than an intra-character gap at fast WPM
const SEARCH_BAND = 0.30        // search ±30% around the audio midpoint for the gap

/**
 * Locate the inter-callsign silence gap by finding the longest contiguous
 * run of low-amplitude frames within the middle 60% of the envelope.
 *
 * Returns the frame index at the CENTER of that run, suitable for splitting
 * the envelope into two halves that each contain one callsign.
 */
export function findInterCallsignSplit(
  envelope: Float32Array,
  channels: number = IN_CHANNELS,
): number {
  const T = envelope.length / channels
  const lo = Math.floor(T * (0.5 - SEARCH_BAND))
  const hi = Math.floor(T * (0.5 + SEARCH_BAND))

  let bestStart = -1
  let bestLen = 0
  let runStart = -1
  for (let t = lo; t < hi; t++) {
    const ch0 = envelope[t * channels]
    if (ch0 < SILENCE_THRESHOLD) {
      if (runStart < 0) runStart = t
    } else {
      if (runStart >= 0) {
        const len = t - runStart
        if (len > bestLen) { bestLen = len; bestStart = runStart }
        runStart = -1
      }
    }
  }
  if (runStart >= 0) {
    const len = hi - runStart
    if (len > bestLen) { bestLen = len; bestStart = runStart }
  }

  if (bestLen < MIN_GAP_FRAMES) {
    // No clear gap found — fall back to exact midpoint. Decoded halves
    // will overlap a bit but each still contains one full callsign.
    return Math.floor(T / 2)
  }
  return bestStart + Math.floor(bestLen / 2)
}

/**
 * Split a (T, channels) envelope into two halves at a given frame index.
 * Both halves are returned as Float32Array in the same interleaved layout.
 * The split frame is mapped to model output rate (250 Hz) for downstream use.
 */
export function splitEnvelope(
  envelope: Float32Array,
  splitFrame: number,
  channels: number = IN_CHANNELS,
): { first: Float32Array; second: Float32Array } {
  const total = envelope.length / channels
  const splitIdx = splitFrame * channels
  const first = envelope.slice(0, splitIdx)
  const second = envelope.slice(splitIdx, total * channels)
  return { first, second }
}

/**
 * Combine two independent decode results from the same callsign sent twice.
 *
 * Strategy (in order of preference):
 *   1. Both halves agree → use either (high confidence, return max conf).
 *   2. Disagreement → return the higher-confidence half.
 *
 * A future revision will sum log-probabilities frame-by-frame for true
 * coherent integration; this simple ensemble is the fallback that already
 * helps when noise drops one half but not the other.
 */
export function combineDualDecodes(
  a: DecodeResult,
  b: DecodeResult,
): { result: DecodeResult; agreement: boolean } {
  const agreement = a.text === b.text && a.text.length > 0
  if (agreement) {
    return {
      result: {
        text: a.text,
        confidence: Math.max(a.confidence, b.confidence),
        indices: a.indices,
      },
      agreement: true,
    }
  }
  // Pick higher-confidence half. Tie-breaks favor non-empty.
  if (a.text.length === 0) return { result: b, agreement: false }
  if (b.text.length === 0) return { result: a, agreement: false }
  return { result: a.confidence >= b.confidence ? a : b, agreement: false }
}

/**
 * Run dual-look inference on an envelope that contains the same callsign
 * sent twice. Splits at the inter-send silence, decodes each half, and
 * returns the combined best guess plus diagnostics.
 */
export async function decodeDualCallsignFromEnvelope(
  envelope: Float32Array,
  channels: number = IN_CHANNELS,
): Promise<DualDecodeResult> {
  const splitFrame = findInterCallsignSplit(envelope, channels)
  const { first, second } = splitEnvelope(envelope, splitFrame, channels)

  // onnxruntime-web's InferenceSession.run() is NOT reentrant — calling
  // it twice concurrently on the same session throws "Session already
  // started". Run sequentially. (Two-second-ish back-to-back inferences
  // is fine for the BeatTheBot UI.)
  const logProbsA = await runInference(first)
  const logProbsB = await runInference(second)
  const Ta = logProbsA.length / NUM_CLASSES
  const Tb = logProbsB.length / NUM_CLASSES
  const decA = greedyDecode(logProbsA, Ta)
  const decB = greedyDecode(logProbsB, Tb)
  const { result, agreement } = combineDualDecodes(decA, decB)
  return {
    ...result,
    firstHalf: decA,
    secondHalf: decB,
    agreement,
    splitFrame,
  }
}

/**
 * Convenience: dual-decode straight from a WAV data URI. Used by the
 * BeatTheBot page after generating the dual-callsign audio.
 */
export async function decodeDualCallsignDataUri(
  dataUri: string,
  toneFreq: number = 700,
): Promise<DualDecodeResult> {
  const audio = await dataUriToMonoFloat32(dataUri, DSP_SAMPLE_RATE)
  const envelope = extractEnvelope(audio, DSP_SAMPLE_RATE, toneFreq)
  return decodeDualCallsignFromEnvelope(envelope)
}

// Re-export for convenience
export { ENVELOPE_SR }
