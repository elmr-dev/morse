// Tests the deployed ONNX model file against the demo's pipeline contracts.
//
// Uses `onnxruntime-node` rather than `onnxruntime-web` because the browser
// runtime needs wasm pathing that doesn't resolve cleanly in vitest's Node
// process. Both runtimes load the same .onnx file and produce identical
// numerical output, so this test still verifies the file is correctly
// shaped for what the demo expects.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ort from 'onnxruntime-node'
import { IN_CHANNELS, NUM_CLASSES } from './constants'
import { MAX_FRAMES, MAX_OUTPUT_FRAMES, publicAssetUrl } from './onnx'

const MODEL_PATH = resolve(__dirname, '../../public/model/cw_model_full.onnx')

let session: ort.InferenceSession | null = null

async function getSession() {
  if (!session) {
    const buf = readFileSync(MODEL_PATH)
    session = await ort.InferenceSession.create(buf, {
      executionProviders: ['cpu'],
    })
  }
  return session
}

describe('ONNX model file', () => {
  it('resolves public assets under the deployed Pages basename', () => {
    expect(publicAssetUrl('model/cw_model_full.onnx', '/morse/cw-decode/beat-the-bot/')).toBe(
      '/morse/cw-decode/beat-the-bot/model/cw_model_full.onnx',
    )
    expect(publicAssetUrl('/ort/', '/morse/cw-decode/beat-the-bot/')).toBe(
      '/morse/cw-decode/beat-the-bot/ort/',
    )
  })

  it('loads', async () => {
    const s = await getSession()
    expect(s).toBeDefined()
    expect(s.inputNames).toEqual(['envelopes'])
    expect(s.outputNames).toEqual(['log_probs'])
  })

  it('has input shape (1, MAX_FRAMES, IN_CHANNELS)', async () => {
    const s = await getSession()
    // ort.InferenceSession exposes input metadata via inputNames + a name->dims map
    // depending on version. We test by trying to feed a tensor of the demo's
    // expected shape; if the model expects something else, run() throws.
    const padded = new Float32Array(MAX_FRAMES * IN_CHANNELS)
    const input = new ort.Tensor('float32', padded, [1, MAX_FRAMES, IN_CHANNELS])
    const out = await s.run({ envelopes: input })
    // Output should be (1, MAX_OUTPUT_FRAMES, NUM_CLASSES) = (1, 4000, 42)
    const lp = out.log_probs as ort.Tensor
    expect(lp.dims).toEqual([1, MAX_OUTPUT_FRAMES, NUM_CLASSES])
    expect(lp.data.length).toBe(MAX_OUTPUT_FRAMES * NUM_CLASSES)
  })

  it('produces log-softmax outputs (rows sum to 1 in prob space)', async () => {
    const s = await getSession()
    // Use random input to force the model out of the all-zero degenerate path.
    const padded = new Float32Array(MAX_FRAMES * IN_CHANNELS)
    let seed = 12345
    for (let i = 0; i < padded.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      padded[i] = (seed / 0xffffffff)
    }
    const input = new ort.Tensor('float32', padded, [1, MAX_FRAMES, IN_CHANNELS])
    const out = await s.run({ envelopes: input })
    const lp = out.log_probs.data as Float32Array

    // Pick three random output frames; verify softmax(rows) sum to 1.
    const checkFrame = (t: number) => {
      let total = 0
      for (let c = 0; c < NUM_CLASSES; c++) {
        total += Math.exp(lp[t * NUM_CLASSES + c])
      }
      return total
    }
    expect(checkFrame(0)).toBeCloseTo(1.0, 3)
    expect(checkFrame(MAX_OUTPUT_FRAMES / 2)).toBeCloseTo(1.0, 3)
    expect(checkFrame(MAX_OUTPUT_FRAMES - 1)).toBeCloseTo(1.0, 3)
  })

  it('IN_CHANNELS matches the model — guards against constant drift', async () => {
    // If someone bumps IN_CHANNELS without re-exporting ONNX (or vice versa),
    // run() above would have thrown. This test is the explicit canary.
    expect(IN_CHANNELS).toBe(4)
  })
})
