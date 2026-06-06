// Greedy CTC decode with entropy gate + blank-ratio gate + run-length filter.
// Mirrors cw-ml/model/eval/decode.py:greedy_decode_with_confidence.

import { BLANK_IDX, IDX_TO_CHAR, LOG_NUM_CLASSES, NUM_CLASSES } from './constants'

export interface DecodeResult {
  text: string
  confidence: number
  indices: number[]
  chars: DecodedChar[]
}

export interface DecodedChar {
  char: string
  index: number
  confidence: number
  rawConfidence: number
  frame: number
}

export interface DecodeOptions {
  entropyThreshold?: number
  blankRatioThreshold?: number
  minRunLength?: number
}

export function greedyDecode(
  logProbs: Float32Array,  // flat (T * C)
  T: number,
  opts: DecodeOptions = {},
): DecodeResult {
  const entropyThreshold = opts.entropyThreshold ?? 0.3
  const blankRatioThreshold = opts.blankRatioThreshold ?? 0.999
  const minRunLength = opts.minRunLength ?? 1
  const C = NUM_CLASSES

  const argmax = new Int32Array(T)
  const maxLp = new Float32Array(T)

  for (let t = 0; t < T; t++) {
    let best = 0
    let bestLp = -Infinity
    for (let c = 0; c < C; c++) {
      const v = logProbs[t * C + c]
      if (v > bestLp) { bestLp = v; best = c }
    }
    argmax[t] = best
    maxLp[t] = bestLp

    if (entropyThreshold > 0) {
      let H = 0
      for (let c = 0; c < C; c++) {
        const lp = logProbs[t * C + c]
        const p = Math.exp(lp)
        if (p > 0) H -= p * lp
      }
      const conf = 1 - H / LOG_NUM_CLASSES
      if (conf < entropyThreshold) argmax[t] = BLANK_IDX
    }
  }

  let nonBlank = 0
  for (let t = 0; t < T; t++) if (argmax[t] !== BLANK_IDX) nonBlank++
  if (nonBlank < 2 || nonBlank / T < 1 - blankRatioThreshold) {
    return { text: '', confidence: 0, indices: [], chars: [] }
  }

  // Run-length filter
  const filtered = new Int32Array(T)
  let i = 0
  while (i < T) {
    const cls = argmax[i]
    let j = i + 1
    while (j < T && argmax[j] === cls) j++
    const runLen = j - i
    if (cls === BLANK_IDX || runLen >= minRunLength) {
      for (let k = i; k < j; k++) filtered[k] = cls
    } else {
      for (let k = i; k < j; k++) filtered[k] = BLANK_IDX
    }
    i = j
  }

  // CTC collapse
  const indices: number[] = []
  const confs: number[] = []
  const chars: DecodedChar[] = []
  let prev = -1
  for (let t = 0; t < T; t++) {
    const idx = filtered[t]
    if (idx !== prev) {
      if (idx !== BLANK_IDX) {
        const rawConfidence = Math.exp(maxLp[t])
        const confidence = calibrateCharConfidence(rawConfidence)
        const char = IDX_TO_CHAR[idx] ?? '?'
        indices.push(idx)
        confs.push(confidence)
        chars.push({ char, index: idx, confidence, rawConfidence, frame: t })
      }
      prev = idx
    }
  }
  const text = chars.map((c) => c.char).join('')
  const conf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0
  return { text, confidence: conf, indices, chars }
}

function calibrateCharConfidence(p: number): number {
  const clamped = Math.min(0.999, Math.max(0.001, p))
  const logit = Math.log(clamped / (1 - clamped))

  // Browser-side approximation of the offline calibration result. The model's
  // raw CTC frame posteriors are too sharp at low SNR, so shrink log-odds before
  // any multi-look fusion. Agreement between two sends can still become highly
  // confident because the fusion step adds independent evidence back in.
  const calibratedLogit = 0.65 * logit - 0.15
  return 1 / (1 + Math.exp(-calibratedLogit))
}

// Character Error Rate — Levenshtein distance / reference length
export function cer(ref: string, hyp: string): number {
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1
  const m = ref.length, n = hyp.length
  let prev = new Int32Array(n + 1)
  let curr = new Int32Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const t = prev; prev = curr; curr = t
  }
  return prev[n] / m
}
