import { describe, expect, it } from 'vitest'
import { DSP_SAMPLE_RATE } from './dsp'
import { MAX_FRAMES } from './onnx'
import { splitDecodeWindows } from './pipeline'

describe('splitDecodeWindows', () => {
  it('splits audio longer than the fixed ONNX frame limit', () => {
    const thirtySeconds = new Float32Array(30 * DSP_SAMPLE_RATE)
    const windows = splitDecodeWindows(thirtySeconds)

    expect(windows.length).toBeGreaterThan(1)
    for (const window of windows) {
      expect(Math.floor(window.length / 16)).toBeLessThanOrEqual(MAX_FRAMES)
    }
  })

  it('keeps short audio as a single window', () => {
    const tenSeconds = new Float32Array(10 * DSP_SAMPLE_RATE)

    expect(splitDecodeWindows(tenSeconds)).toEqual([tenSeconds])
  })
})
