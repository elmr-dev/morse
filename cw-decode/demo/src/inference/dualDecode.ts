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
//   3. Greedy-decodes each half with calibrated per-character confidence,
//   4. Levenshtein-aligns the two strings and fuses character evidence.

import { ENVELOPE_SR, extractEnvelope, DSP_SAMPLE_RATE } from './dsp'
import { greedyDecode, type DecodedChar, type DecodeResult } from './decode'
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
  /** Per-position fusion diagnostics for the combined decode. */
  fusion: FusedChar[]
}

export interface FusedChar extends DecodedChar {
  source: 'first' | 'second' | 'both'
  alternatives: Array<{ char: string; confidence: number; source: 'first' | 'second' }>
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

function clampProb(p: number): number {
  return Math.min(0.999, Math.max(0.001, p))
}

function logit(p: number): number {
  const q = clampProb(p)
  return Math.log(q / (1 - q))
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function charAt(result: DecodeResult, pos: number): DecodedChar {
  return result.chars[pos] ?? {
    char: result.text[pos] ?? '',
    index: result.indices[pos] ?? -1,
    confidence: result.confidence,
    rawConfidence: result.confidence,
    frame: -1,
  }
}

function singleSourceChar(c: DecodedChar, source: 'first' | 'second'): FusedChar {
  const confidence = sigmoid(logit(c.confidence) - 0.65)
  return {
    ...c,
    confidence,
    source,
    alternatives: [],
  }
}

function fuseMatchingChars(a: DecodedChar, b: DecodedChar): FusedChar {
  const confidence = sigmoid(logit(a.confidence) + logit(b.confidence))
  return {
    char: a.char,
    index: a.index,
    confidence,
    rawConfidence: Math.max(a.rawConfidence, b.rawConfidence),
    frame: Math.round((a.frame + b.frame) / 2),
    source: 'both',
    alternatives: [],
  }
}

function fuseSubstitution(a: DecodedChar, b: DecodedChar): FusedChar {
  const oddsA = Math.exp(logit(a.confidence))
  const oddsB = Math.exp(logit(b.confidence))
  const total = oddsA + oddsB
  const aPosterior = oddsA / total
  const bPosterior = oddsB / total
  if (aPosterior >= bPosterior) {
    return {
      ...a,
      confidence: aPosterior,
      source: 'first',
      alternatives: [{ char: b.char, confidence: bPosterior, source: 'second' }],
    }
  }
  return {
    ...b,
    confidence: bPosterior,
    source: 'second',
    alternatives: [{ char: a.char, confidence: aPosterior, source: 'first' }],
  }
}

function resultFromFusedChars(chars: FusedChar[]): DecodeResult & { fusion: FusedChar[] } {
  const text = chars.map((c) => c.char).join('')
  const confidence = chars.length
    ? chars.reduce((sum, c) => sum + c.confidence, 0) / chars.length
    : 0
  return {
    text,
    confidence,
    indices: chars.map((c) => c.index),
    chars,
    fusion: chars,
  }
}

/**
 * Levenshtein-align two decoded strings and merge them. For each aligned
 * position:
 *   - match → emit the character (definitely correct)
 *   - gap on one side → emit the character from the other side
 *     with reduced confidence because the other send missed it
 *   - substitution → emit the character with stronger calibrated character
 *     evidence and keep the other as an alternative
 *
 * This recovers from the "high-confidence-but-missing-letters" failure
 * mode where mean per-char confidence inflates as length drops:
 *   a = "K1AC" (conf 0.90, missing B)
 *   b = "K1ABC" (conf 0.70)
 *   align → K-1-A-{-,B}-C  → emit "K1ABC" (B from b, all else from match)
 */
export function alignAndMergeDecodes(a: DecodeResult, b: DecodeResult): DecodeResult {
  const sa = a.text
  const sb = b.text
  if (sa === sb) {
    const fused = sa.split('').map((_, i) => fuseMatchingChars(charAt(a, i), charAt(b, i)))
    return resultFromFusedChars(fused)
  }
  if (sa.length === 0) return resultFromFusedChars(b.chars.map((c) => singleSourceChar(c, 'second')))
  if (sb.length === 0) return resultFromFusedChars(a.chars.map((c) => singleSourceChar(c, 'first')))

  const m = sa.length
  const n = sb.length
  // dp[i][j] = edit distance from sa[0..i] to sb[0..j]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = sa[i - 1] === sb[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,        // del from a
        dp[i][j - 1] + 1,        // ins from b
        dp[i - 1][j - 1] + cost, // match or sub
      )
    }
  }

  // Traceback. Build merged characters in reverse.
  const merged: FusedChar[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sa[i - 1] === sb[j - 1]) {
      // match
      merged.push(fuseMatchingChars(charAt(a, i - 1), charAt(b, j - 1)))
      i--; j--
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      // substitution → compare calibrated character evidence, not whole-text confidence
      merged.push(fuseSubstitution(charAt(a, i - 1), charAt(b, j - 1)))
      i--; j--
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      // del from a → b is missing this char; emit a's char but reduce confidence
      merged.push(singleSourceChar(charAt(a, i - 1), 'first'))
      i--
    } else {
      // ins (j > 0) → a is missing; emit b's char but reduce confidence
      merged.push(singleSourceChar(charAt(b, j - 1), 'second'))
      j--
    }
  }
  merged.reverse()
  return resultFromFusedChars(merged)
}

/**
 * Combine two independent decode results from the same callsign sent twice.
 *
 * Strategy:
 *   1. Both halves agree → return that text with fused confidence.
 *   2. Empty side → return the non-empty side with reduced confidence.
 *   3. Disagreement → Levenshtein-align and merge so missing characters
 *      from one side are filled from the other (see alignAndMergeDecodes).
 *
 * A future upgrade is to sum per-frame log-probabilities BEFORE CTC
 * decoding for true coherent integration (~√2 SNR gain). The post-decode
 * merge is the simple, calibration-robust starting point.
 */
export function combineDualDecodes(
  a: DecodeResult,
  b: DecodeResult,
): { result: DecodeResult; agreement: boolean } {
  const agreement = a.text === b.text && a.text.length > 0
  if (agreement) {
    const result = alignAndMergeDecodes(a, b)
    return {
      result,
      agreement: true,
    }
  }
  return { result: alignAndMergeDecodes(a, b), agreement: false }
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
  const fusionCandidate = (result as unknown as { fusion?: unknown }).fusion
  const fusion = Array.isArray(fusionCandidate)
    ? (fusionCandidate as FusedChar[])
    : []
  return {
    ...result,
    firstHalf: decA,
    secondHalf: decB,
    agreement,
    splitFrame,
    fusion,
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
