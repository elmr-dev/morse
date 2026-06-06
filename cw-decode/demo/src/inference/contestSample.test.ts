import { describe, expect, it } from 'vitest'
import { generateContestHelperSample } from './contestSample'

describe('generateContestHelperSample', () => {
  it('generates one repeated contest exchange per lane', () => {
    const sample = generateContestHelperSample(123)

    expect(sample.lanes).toHaveLength(3)
    for (const lane of sample.lanes) {
      expect(lane.message).toContain(`${lane.callsign} ${lane.callsign}`)
      expect(lane.message).toContain(lane.exchange)
      expect(lane.message.split(lane.callsign).length - 1).toBeGreaterThanOrEqual(4)
      expect(lane.message).toMatch(/599 599 [A-Z]{2} [A-Z]{2}/)
    }
  })

  it('keeps lanes separated by contest-helper frequency offsets', () => {
    const tones = generateContestHelperSample(123).lanes.map((lane) => lane.toneHz)

    expect(tones).toEqual([590, 730, 880])
  })

  it('keeps the bottom lane at -10 dB and stronger lanes above it', () => {
    const snrs = generateContestHelperSample(123).lanes.map((lane) => lane.snrDb)

    expect(snrs).toEqual([-10, -7, -4])
    expect(snrs[0]).toBe(-10)
    expect(Math.max(...snrs)).toBeLessThanOrEqual(-4)
  })
})
