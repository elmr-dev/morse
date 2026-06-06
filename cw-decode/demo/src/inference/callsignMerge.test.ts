import { describe, expect, it } from 'vitest'
import {
  areLikelySameCallsign,
  extractCallsignsFromText,
  inferContestSpacing,
  mergeLikelyCallsigns,
} from './callsignMerge'

describe('inferContestSpacing', () => {
  it('adds spaces between repeated adjacent callsigns before extraction', () => {
    expect(inferContestSpacing('VA2WAVA2WA')).toBe('VA2WA VA2WA')
  })

  it('keeps repeated callsigns as repeated evidence', () => {
    const spaced = inferContestSpacing('N0CALN0CAL599599NCNC')

    expect(spaced).toContain('N0CAL N0CAL')
    expect(spaced).toContain('599 599')
  })

  it('recovers likely callsigns from a noisy collapsed contest stream', () => {
    const spaced = inferContestSpacing('N0CALN0AL599529NCNCN0TRALN0CAL99599NK')

    expect(spaced).toContain('N0CAL')
    expect(spaced).toContain('599')
  })
})

describe('extractCallsignsFromText', () => {
  it('finds callsigns in a decoded stream without spaces', () => {
    const calls = extractCallsignsFromText('CQK1ABCW2DEFN0CAL', 'lane-a', 0.7).map((obs) => obs.value)

    expect(calls).toContain('K1ABC')
    expect(calls).toContain('W2DEF')
    expect(calls).toContain('N0CAL')
  })

  it('normalizes punctuation and lower-case decode text', () => {
    const calls = extractCallsignsFromText('k1abc/ve3xyz?', 'lane-a')

    expect(calls.map((obs) => obs.value)).toContain('K1ABC')
    expect(calls.map((obs) => obs.value)).toContain('VE3XYZ')
  })

  it('rejects four-letter suffix callsigns', () => {
    const calls = extractCallsignsFromText('AA1BBBB K1ABC', 'lane-a').map((obs) => obs.value)

    expect(calls).not.toContain('AA1BBBB')
    expect(calls).toContain('K1ABC')
  })

  it('does not make a cross-boundary call from repeated adjacent callsigns', () => {
    const calls = extractCallsignsFromText('VA2WAVA2WA', 'lane-a').map((obs) => obs.value)

    expect(calls).toEqual(['VA2WA', 'VA2WA'])
    expect(calls).not.toContain('VA2WAV')
    expect(calls).not.toContain('A2WA')
  })

  it('prefers the real callsign over a leading noise character', () => {
    const calls = extractCallsignsFromText('CQK1ABC', 'lane-a').map((obs) => obs.value)

    expect(calls).toContain('K1ABC')
    expect(calls).not.toContain('QK1ABC')
  })

  it('returns multiple observations for repeated callsigns in a lane', () => {
    const calls = extractCallsignsFromText('N0CALN0CAL599599NCNCN0CAL', 'lane-a').map((obs) => obs.value)

    expect(calls.filter((call) => call === 'N0CAL')).toHaveLength(3)
  })
})

describe('mergeLikelyCallsigns', () => {
  it('merges one-character misses with the same digit signature', () => {
    const merged = mergeLikelyCallsigns([
      { value: 'K1ABC', laneId: 'lane-a', confidence: 0.7 },
      { value: 'K1ABZ', laneId: 'lane-b', confidence: 0.4 },
      { value: 'W2DEF', laneId: 'lane-c', confidence: 0.8 },
    ])

    expect(merged).toHaveLength(2)
    expect(merged.find((candidate) => candidate.value === 'K1ABC')?.observations).toHaveLength(2)
    expect(merged.find((candidate) => candidate.value === 'W2DEF')?.observations).toHaveLength(1)
  })

  it('does not merge calls with different numbers', () => {
    expect(areLikelySameCallsign('K1ABC', 'K2ABC')).toBe(false)
  })

  it('raises confidence when the same call appears multiple times', () => {
    const merged = mergeLikelyCallsigns([
      { value: 'N0CAL', laneId: 'lane-a', confidence: 0.23 },
      { value: 'N0CAL', laneId: 'lane-a', confidence: 0.23 },
      { value: 'N0CAL', laneId: 'lane-a', confidence: 0.23 },
    ])

    expect(merged[0].value).toBe('N0CAL')
    expect(merged[0].confidence).toBeGreaterThan(0.5)
  })
})
