// Tests for the dual-look decoder pieces. Doesn't run the ONNX model
// (covered in onnx.test.ts) — focuses on the deterministic logic:
// silence-gap detection, envelope split, and ensemble combining.

import { describe, expect, it } from 'vitest'
import {
  findInterCallsignSplit,
  splitEnvelope,
  combineDualDecodes,
  alignAndMergeDecodes,
} from './dualDecode'
import { IN_CHANNELS } from './constants'

// Build a fake 4-channel envelope where ch0 is high inside [a..b] and
// [c..d], low elsewhere. The other channels are noise. Used to verify
// silence-gap detection across plausible callsign-pair shapes.
function makeFakeEnvelope(
  totalFrames: number,
  highRanges: Array<[number, number]>,
  highValue: number = 0.8,
): Float32Array {
  const out = new Float32Array(totalFrames * IN_CHANNELS)
  for (let t = 0; t < totalFrames; t++) {
    const high = highRanges.some(([a, b]) => t >= a && t < b)
    // ch0: clean signal/silence
    out[t * IN_CHANNELS + 0] = high ? highValue : 0.02
    // ch1-3: small noise so we can verify the splitter only looks at ch0
    out[t * IN_CHANNELS + 1] = 0.5
    out[t * IN_CHANNELS + 2] = 0.5
    out[t * IN_CHANNELS + 3] = 0.5
  }
  return out
}

describe('findInterCallsignSplit', () => {
  it('finds the gap center between two equal-width signal blocks', () => {
    const T = 1000
    // Signal at frames 100..400, gap 400..600, signal 600..900
    const env = makeFakeEnvelope(T, [[100, 400], [600, 900]])
    const split = findInterCallsignSplit(env)
    // Gap is [400, 600]; center is 500. Allow ±10 frames.
    expect(split).toBeGreaterThan(490)
    expect(split).toBeLessThan(510)
  })

  it('finds the gap when slightly off-center', () => {
    const T = 1000
    // Signal blocks of slightly unequal length around center.
    const env = makeFakeEnvelope(T, [[100, 470], [580, 950]])
    const split = findInterCallsignSplit(env)
    // Gap is [470, 580]; center 525. Allow ±15.
    expect(split).toBeGreaterThan(510)
    expect(split).toBeLessThan(540)
  })

  it('falls back to midpoint when no clear gap is detected', () => {
    const T = 1000
    // No silence at all — all-on envelope.
    const env = makeFakeEnvelope(T, [[0, T]])
    const split = findInterCallsignSplit(env)
    expect(split).toBe(Math.floor(T / 2))
  })

  it('ignores brief intra-character gaps that are too short', () => {
    const T = 1000
    // Signal block with a tiny gap inside the first half (intra-char gap),
    // a real long gap in the middle, more signal, another tiny gap,
    // more signal. The splitter should pick the central long gap.
    const env = makeFakeEnvelope(T, [
      [100, 200], [220, 400],     // first callsign with a 20-frame intra gap
      [600, 750], [770, 900],     // second callsign with a 20-frame intra gap
    ])
    const split = findInterCallsignSplit(env)
    // The 200-frame [400, 600] gap dominates; center 500.
    expect(split).toBeGreaterThan(480)
    expect(split).toBeLessThan(520)
  })

  it('only looks at ch0', () => {
    const T = 1000
    // Make ch0 have a clear gap, but other channels look "loud" everywhere.
    const env = new Float32Array(T * IN_CHANNELS)
    for (let t = 0; t < T; t++) {
      const inGap = t >= 400 && t < 600
      env[t * IN_CHANNELS + 0] = inGap ? 0.0 : 0.9
      // Pollute ch1-3 with high values across the whole clip
      env[t * IN_CHANNELS + 1] = 0.95
      env[t * IN_CHANNELS + 2] = 0.95
      env[t * IN_CHANNELS + 3] = 0.95
    }
    const split = findInterCallsignSplit(env)
    expect(split).toBeGreaterThan(490)
    expect(split).toBeLessThan(510)
  })
})

describe('splitEnvelope', () => {
  it('produces two halves whose lengths sum to the original', () => {
    const T = 1000
    const env = makeFakeEnvelope(T, [[100, 400], [600, 900]])
    const { first, second } = splitEnvelope(env, 500)
    expect(first.length).toBe(500 * IN_CHANNELS)
    expect(second.length).toBe(500 * IN_CHANNELS)
    expect(first.length + second.length).toBe(env.length)
  })

  it('first half preserves the first signal block', () => {
    const T = 1000
    const env = makeFakeEnvelope(T, [[100, 400], [600, 900]])
    const { first } = splitEnvelope(env, 500)
    // ch0 around frame 250 should be high in the first half (was at t=250 in original)
    expect(first[250 * IN_CHANNELS + 0]).toBeGreaterThan(0.5)
    // ch0 around frame 50 should be low (silence before first signal)
    expect(first[50 * IN_CHANNELS + 0]).toBeLessThan(0.1)
  })

  it('second half preserves the second signal block', () => {
    const T = 1000
    const env = makeFakeEnvelope(T, [[100, 400], [600, 900]])
    const { second } = splitEnvelope(env, 500)
    // Frame 200 in second half = frame 700 in original (signal high)
    expect(second[200 * IN_CHANNELS + 0]).toBeGreaterThan(0.5)
    // Frame 50 in second half = frame 550 in original (gap, low)
    expect(second[50 * IN_CHANNELS + 0]).toBeLessThan(0.1)
  })
})

describe('combineDualDecodes', () => {
  const make = (text: string, conf: number) => ({
    text,
    confidence: conf,
    indices: text.split('').map((_, i) => i + 1),
  })

  it('returns agreement when both halves match', () => {
    const a = make('K1ABC', 0.7)
    const b = make('K1ABC', 0.6)
    const out = combineDualDecodes(a, b)
    expect(out.agreement).toBe(true)
    expect(out.result.text).toBe('K1ABC')
    // Reports the higher-confidence as the combined confidence.
    expect(out.result.confidence).toBe(0.7)
  })

  it('prefers the non-empty half when one is empty', () => {
    const a = make('', 0.0)
    const b = make('K1ABC', 0.5)
    const out = combineDualDecodes(a, b)
    expect(out.agreement).toBe(false)
    expect(out.result.text).toBe('K1ABC')
  })

  it('returns either when both empty', () => {
    const a = make('', 0)
    const b = make('', 0)
    const out = combineDualDecodes(a, b)
    expect(out.result.text).toBe('')
    expect(out.agreement).toBe(false)
  })

  it('does NOT report agreement when both halves are empty', () => {
    const a = make('', 0.1)
    const b = make('', 0.05)
    const out = combineDualDecodes(a, b)
    expect(out.agreement).toBe(false)
  })

  it('on disagreement, fills missing characters from the longer half', () => {
    // The exact failure the user reported: high-conf shorter decode
    // shouldn't beat a correct-length decode missing one letter.
    const a = make('K1AC', 0.9)     // missing B
    const b = make('K1ABC', 0.7)
    const out = combineDualDecodes(a, b)
    expect(out.agreement).toBe(false)
    expect(out.result.text).toBe('K1ABC')
  })

  it('on substitution, picks the higher-confidence side', () => {
    // Same length, single char differs. Both give equal length → no
    // gap-filling; substitution picks higher-conf side.
    const a = make('K1ABZ', 0.8)
    const b = make('K1ABC', 0.5)
    const out = combineDualDecodes(a, b)
    expect(out.agreement).toBe(false)
    expect(out.result.text).toBe('K1ABZ')

    // Reverse confidence
    const out2 = combineDualDecodes(make('K1ABZ', 0.5), make('K1ABC', 0.8))
    expect(out2.result.text).toBe('K1ABC')
  })
})

describe('alignAndMergeDecodes', () => {
  const make = (text: string, conf: number) => ({
    text,
    confidence: conf,
    indices: [],
  })

  it('returns either when texts are equal', () => {
    const out = alignAndMergeDecodes(make('K1ABC', 0.5), make('K1ABC', 0.7))
    expect(out.text).toBe('K1ABC')
  })

  it('returns the non-empty side when one is empty', () => {
    expect(alignAndMergeDecodes(make('', 0), make('K1ABC', 0.5)).text).toBe('K1ABC')
    expect(alignAndMergeDecodes(make('K1ABC', 0.5), make('', 0)).text).toBe('K1ABC')
  })

  it('fills a missing letter in the middle from the other half', () => {
    const out = alignAndMergeDecodes(make('K1AC', 0.9), make('K1ABC', 0.7))
    expect(out.text).toBe('K1ABC')
  })

  it('fills a missing letter at the end from the other half', () => {
    const out = alignAndMergeDecodes(make('K1AB', 0.9), make('K1ABC', 0.7))
    expect(out.text).toBe('K1ABC')
  })

  it('fills a missing letter at the start from the other half', () => {
    const out = alignAndMergeDecodes(make('1ABC', 0.9), make('K1ABC', 0.7))
    expect(out.text).toBe('K1ABC')
  })

  it('union-merges when each side is missing a different letter (different lengths)', () => {
    // For union to fire, the alignment has to prefer indels over substitutions,
    // which only happens when the strings have different lengths. Same-length
    // strings differing by one letter are scored as one substitution (cheaper)
    // and fall through to confidence-based pick.
    const out = alignAndMergeDecodes(make('KABC', 0.8), make('K1AB', 0.7))
    // align (Levenshtein cost 2):
    //   K - A B C
    //   K 1 A B -
    // Merged: K1ABC (1 from b, C from a)
    expect(out.text).toBe('K1ABC')
  })

  it('on substitution, picks the side with higher overall confidence', () => {
    expect(alignAndMergeDecodes(make('K1ABZ', 0.8), make('K1ABC', 0.5)).text).toBe('K1ABZ')
    expect(alignAndMergeDecodes(make('K1ABZ', 0.5), make('K1ABC', 0.8)).text).toBe('K1ABC')
  })
})
