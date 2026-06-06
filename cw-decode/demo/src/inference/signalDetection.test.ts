import { describe, expect, it } from 'vitest'
import { detectTopSignals } from './signalDetection'

describe('detectTopSignals', () => {
  it('finds the top separated tones in a mixed signal', () => {
    const sampleRate = 8000
    const seconds = 2
    const audio = new Float32Array(sampleRate * seconds)
    for (let i = 0; i < audio.length; i++) {
      const t = i / sampleRate
      audio[i] =
        0.6 * Math.sin(2 * Math.PI * 590 * t) +
        0.4 * Math.sin(2 * Math.PI * 730 * t) +
        0.3 * Math.sin(2 * Math.PI * 880 * t) +
        0.03 * Math.sin(2 * Math.PI * 410 * t)
    }

    const detections = detectTopSignals(audio, sampleRate, seconds)

    expect(detections.map((d) => d.toneHz)).toEqual([590, 730, 880])
  })

  it('returns at most three detections', () => {
    const sampleRate = 8000
    const seconds = 2
    const audio = new Float32Array(sampleRate * seconds)
    for (let i = 0; i < audio.length; i++) {
      const t = i / sampleRate
      audio[i] =
        Math.sin(2 * Math.PI * 390 * t) +
        Math.sin(2 * Math.PI * 520 * t) +
        Math.sin(2 * Math.PI * 650 * t) +
        Math.sin(2 * Math.PI * 810 * t)
    }

    expect(detectTopSignals(audio, sampleRate, seconds)).toHaveLength(3)
  })
})
