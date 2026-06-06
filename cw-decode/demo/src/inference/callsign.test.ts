import { describe, expect, it } from 'vitest'
import {
  randomCallsign,
  randomUsCallsign,
  randomCanadianCallsign,
  randomWorldCallsign,
  callsignRegion,
} from './callsign'

// Mulberry32 — small deterministic PRNG so test sequences are reproducible.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('callsign generators', () => {
  it('US callsigns start with K/W/N or A[A-L]', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 200; i++) {
      const call = randomUsCallsign(rng)
      // [letter prefix][digit][2-3 letters]
      expect(call).toMatch(/^([KWN][A-Z]?|A[A-L])\d[A-Z]{2,3}$/)
    }
  })

  it('Canadian callsigns start with V[A-Y] or CG/CY', () => {
    const rng = mulberry32(2)
    for (let i = 0; i < 200; i++) {
      const call = randomCanadianCallsign(rng)
      expect(call).toMatch(/^(V[ACEOGY]|CG|CY)\d[A-Z]{2,3}$/)
      // Canadian digits are 1-9, not 0
      const digit = call.match(/\d/)![0]
      expect(parseInt(digit)).toBeGreaterThanOrEqual(1)
      expect(parseInt(digit)).toBeLessThanOrEqual(9)
    }
  })

  it('World callsigns are not US/Canada', () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 200; i++) {
      const call = randomWorldCallsign(rng)
      expect(call).toMatch(/^[A-Z0-9]+\d[A-Z]{2,3}$/)
      expect(callsignRegion(call)).toBe('World')
    }
  })
})

describe('randomCallsign weighting', () => {
  it('roughly hits 60/25/15 US/Canada/World', () => {
    const rng = mulberry32(42)
    const counts = { US: 0, Canada: 0, World: 0 }
    const N = 5000
    for (let i = 0; i < N; i++) {
      const call = randomCallsign({ rng })
      counts[callsignRegion(call)]++
    }
    const us = counts.US / N
    const ca = counts.Canada / N
    const wo = counts.World / N
    // Allow ±5 percentage points for sample noise.
    expect(us).toBeGreaterThan(0.55)
    expect(us).toBeLessThan(0.65)
    expect(ca).toBeGreaterThan(0.20)
    expect(ca).toBeLessThan(0.30)
    expect(wo).toBeGreaterThan(0.10)
    expect(wo).toBeLessThan(0.20)
  })

  it('respects custom weights', () => {
    const rng = mulberry32(7)
    const counts = { US: 0, Canada: 0, World: 0 }
    const N = 2000
    for (let i = 0; i < N; i++) {
      const call = randomCallsign({ rng, weights: { us: 0, canada: 1, world: 0 } })
      counts[callsignRegion(call)]++
    }
    expect(counts.Canada).toBe(N)
    expect(counts.US).toBe(0)
    expect(counts.World).toBe(0)
  })
})

describe('callsignRegion', () => {
  it('classifies known callsigns', () => {
    // US — 1×1
    expect(callsignRegion('K1ABC')).toBe('US')
    expect(callsignRegion('W2DEF')).toBe('US')
    expect(callsignRegion('N3GHI')).toBe('US')
    // US — 1×2
    expect(callsignRegion('KA1XYZ')).toBe('US')
    expect(callsignRegion('WB6ABC')).toBe('US')
    // US — 2×1 Extra
    expect(callsignRegion('AA1AA')).toBe('US')
    expect(callsignRegion('AL7DE')).toBe('US')
    // Canada
    expect(callsignRegion('VE3ABC')).toBe('Canada')
    expect(callsignRegion('VA7DEF')).toBe('Canada')
    expect(callsignRegion('VO1XYZ')).toBe('Canada')
    expect(callsignRegion('VY1AAA')).toBe('Canada')
    // World
    expect(callsignRegion('G0ABC')).toBe('World')
    expect(callsignRegion('DL1XYZ')).toBe('World')
    expect(callsignRegion('JA1ABC')).toBe('World')
    expect(callsignRegion('VK2DEF')).toBe('World')
  })

  it('handles lowercase input', () => {
    expect(callsignRegion('ve3abc')).toBe('Canada')
    expect(callsignRegion('k1abc')).toBe('US')
  })
})
