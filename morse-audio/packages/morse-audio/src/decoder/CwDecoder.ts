/**
 * CwDecoder — end-to-end CW Morse decoder.
 *
 * Pipeline:
 *   1. computeV11Features (DSP, 5-channel, 500Hz) → (T, 5) features
 *   2. Place features at the END of a T_FIXED=7500-frame window (prepend zeros)
 *      The backward GRU then starts from actual trailing silence — matching training.
 *      (Appending zeros to the end causes the backward GRU to process thousands of
 *       zero frames before reaching content, which the model was never trained on.)
 *   3. Single ONNX inference: features (1, 7500, 5) → logits (1, 3750, 42)
 *   4. Discard logits for the prepended-zeros region; keep the content region
 *   5. CTC greedy decode → string
 *
 * For best results, generate audio that fills T_FIXED (15 seconds) so no
 * zero-prepending is needed and the backward GRU sees real trailing noise.
 */

import * as ort from 'onnxruntime-web';
import { computeV11Features } from './dsp.js';
import { ctcGreedyDecode } from './ctc.js';

export interface DecodeResult {
  text: string;
}

// Model constants (must match export_onnx_batch.py)
const T_FIXED     = 7500;  // fixed input length: 15 s at 500 Hz
const NUM_CLASSES = 42;
const IN_CHANNELS = 5;
const DEFAULT_SR  = 8000;

/** Linear interpolation resampler — adequate quality for 8kHz downsampling. */
function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const lo  = Math.floor(pos);
    const hi  = Math.min(lo + 1, input.length - 1);
    const frac = pos - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

export class CwDecoder {
  private session: ort.InferenceSession | null = null;

  /**
   * Load ONNX model from a URL string or ArrayBuffer.
   * @param modelUrlOrBuffer - URL or raw bytes of the .onnx file
   * @param wasmPaths - Optional path/URL prefix for the onnxruntime-web WASM files.
   *   Defaults to the CDN. Set to '/models/' (or similar) to serve locally.
   *   Example: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/'
   */
  async load(
    modelUrlOrBuffer: string | ArrayBuffer | Uint8Array,
    wasmPaths?: string,
  ): Promise<void> {
    if (wasmPaths !== undefined) {
      ort.env.wasm.wasmPaths = wasmPaths;
    } else {
      ort.env.wasm.wasmPaths =
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';
    }
    // onnxruntime-web 1.24+ accepts string or Uint8Array; convert ArrayBuffer if needed
    const model =
      modelUrlOrBuffer instanceof ArrayBuffer
        ? new Uint8Array(modelUrlOrBuffer)
        : modelUrlOrBuffer;
    this.session = await ort.InferenceSession.create(
      model as Parameters<typeof ort.InferenceSession.create>[0],
      { executionProviders: ['wasm'] },
    );
  }

  get isLoaded(): boolean {
    return this.session !== null;
  }

  /**
   * Decode audio (Float32Array at 8kHz) for a given carrier frequency.
   * Returns the decoded Morse text.
   */
  async decode(
    audio: Float32Array,
    toneFreqHz: number,
    sampleRate: number = DEFAULT_SR,
  ): Promise<DecodeResult> {
    if (!this.session) {
      throw new Error('CwDecoder: model not loaded. Call load() first.');
    }

    // 1. Resample to 8000 Hz if needed (mic input is typically 44100 or 48000 Hz)
    let audio8k = audio;
    if (sampleRate !== 8000) {
      audio8k = resampleLinear(audio, sampleRate, 8000);
    }

    // 2. DSP feature extraction → (T, 5) at 500Hz
    const { features, frames: T } = computeV11Features(audio8k, 8000, toneFreqHz);

    // 3. Place features at END of T_FIXED window (prepend zeros).
    //    The model's backward GRU runs right→left. With content at the end,
    //    the backward GRU starts from real trailing silence — same as training.
    //    With content at the start and zeros appended, the backward GRU starts
    //    from thousands of zero frames never seen during training.
    const T_actual  = Math.min(T, T_FIXED);
    const offset    = T_FIXED - T_actual;          // zero frames prepended
    const paddedData = new Float32Array(T_FIXED * IN_CHANNELS); // all zeros
    paddedData.set(features.slice(0, T_actual * IN_CHANNELS), offset * IN_CHANNELS);

    // 4. Single ONNX inference: features (1, T_FIXED, 5) → logits (1, T_FIXED//2, 42)
    const featuresTensor = new ort.Tensor('float32', paddedData, [1, T_FIXED, IN_CHANNELS]);
    const results = await this.session.run({ features: featuresTensor });
    const logitsData = (results['logits']).data as Float32Array;

    // 5. Skip logits for prepended zeros; keep content region onward
    const outStart     = Math.floor(offset / 2);   // first output frame for actual content
    const contentLogits = logitsData.slice(outStart * NUM_CLASSES);

    // 6. CTC greedy decode
    const text = ctcGreedyDecode(contentLogits, NUM_CLASSES);

    return { text };
  }
}
