// Full-sequence CWNet inference. The ONNX graph is traced at a fixed envelope
// length (MAX_FRAMES); clients zero-pad shorter audio and trim the output.

import * as ort from 'onnxruntime-web'
import { IN_CHANNELS, NUM_CLASSES } from './constants'

// Use an absolute URL so Vite's dev-time module resolver doesn't treat this
// as a source import (files in /public can't be imported from source).
ort.env.wasm.wasmPaths =
  typeof window !== 'undefined'
    ? `${window.location.origin}${import.meta.env.BASE_URL}ort/`
    : '/ort/'
ort.env.wasm.numThreads = 1

export const MAX_FRAMES = 8000  // 16 s at 500 Hz envelope rate
export const MAX_OUTPUT_FRAMES = MAX_FRAMES / 2

let sessionPromise: Promise<ort.InferenceSession> | null = null

const DEFAULT_MODEL_URL = `${import.meta.env.BASE_URL}model/cw_model_full.onnx`

export function loadSession(modelUrl = DEFAULT_MODEL_URL): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  }
  return sessionPromise
}

/**
 * Run inference on a (T, 3) envelope at 500 Hz.
 * Pads to MAX_FRAMES, runs the fixed-shape graph, trims output back to (T/2, 42).
 */
export async function runInference(envelope: Float32Array): Promise<Float32Array> {
  const session = await loadSession()
  const T = envelope.length / IN_CHANNELS
  if (!Number.isInteger(T)) throw new Error('envelope length not a multiple of channels')
  if (T > MAX_FRAMES) {
    throw new Error(`audio too long: ${T} frames (max ${MAX_FRAMES} = ${MAX_FRAMES / 500}s)`)
  }

  const padded = new Float32Array(MAX_FRAMES * IN_CHANNELS)
  padded.set(envelope, 0)

  const input = new ort.Tensor('float32', padded, [1, MAX_FRAMES, IN_CHANNELS])
  const out = await session.run({ envelopes: input })
  const full = out.log_probs.data as Float32Array  // length MAX_OUTPUT_FRAMES * NUM_CLASSES

  const Tout = Math.floor(T / 2)
  return new Float32Array(full.buffer, full.byteOffset, Tout * NUM_CLASSES).slice()
}
