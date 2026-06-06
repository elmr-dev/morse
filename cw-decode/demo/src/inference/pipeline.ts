// End-to-end pipeline: WAV data URI → audio → DSP → ONNX → CTC decode.

import { dataUriToMonoFloat32 } from './audio'
import { DSP_SAMPLE_RATE, extractEnvelope } from './dsp'
import { greedyDecode, type DecodedChar } from './decode'
import { MAX_FRAMES, runInference } from './onnx'
import { NUM_CLASSES } from './constants'

const ENVELOPE_FRAMES_PER_SECOND = 500
const MAX_DECODE_SECONDS = MAX_FRAMES / ENVELOPE_FRAMES_PER_SECOND
const WINDOW_SECONDS = 14

export function splitDecodeWindows(audio: Float32Array): Float32Array[] {
  if (audio.length / DSP_SAMPLE_RATE <= MAX_DECODE_SECONDS) return [audio]

  const windowSamples = WINDOW_SECONDS * DSP_SAMPLE_RATE
  const windows: Float32Array[] = []
  for (let start = 0; start < audio.length; start += windowSamples) {
    const end = Math.min(audio.length, start + windowSamples)
    const slice = audio.slice(start, end)
    if (slice.length < DSP_SAMPLE_RATE * 0.5) continue
    windows.push(slice)
  }
  return windows
}

export interface DecodeTiming {
  audioMs: number
  dspMs: number
  modelMs: number
  decodeMs: number
  totalMs: number
}

export interface PipelineResult {
  text: string
  confidence: number
  chars: DecodedChar[]
  timing: DecodeTiming
}

export async function decodeDataUri(
  dataUri: string,
  toneFreq: number = 700,
): Promise<PipelineResult> {
  const t0 = performance.now()
  const audio = await dataUriToMonoFloat32(dataUri, DSP_SAMPLE_RATE)
  const t1 = performance.now()
  const envelope = extractEnvelope(audio, DSP_SAMPLE_RATE, toneFreq)
  const t2 = performance.now()
  const logProbs = await runInference(envelope)
  const t3 = performance.now()
  const T = logProbs.length / NUM_CLASSES
  const result = greedyDecode(logProbs, T)
  const t4 = performance.now()
  return {
    text: result.text,
    confidence: result.confidence,
    chars: result.chars,
    timing: {
      audioMs: t1 - t0,
      dspMs: t2 - t1,
      modelMs: t3 - t2,
      decodeMs: t4 - t3,
      totalMs: t4 - t0,
    },
  }
}

export async function decodeSamples(
  audio: Float32Array,
  toneFreq: number = 700,
): Promise<PipelineResult> {
  if (audio.length / DSP_SAMPLE_RATE > MAX_DECODE_SECONDS) {
    return decodeSamplesWindowed(audio, toneFreq)
  }

  const t0 = performance.now()
  const envelope = extractEnvelope(audio, DSP_SAMPLE_RATE, toneFreq)
  const t1 = performance.now()
  const logProbs = await runInference(envelope)
  const t2 = performance.now()
  const T = logProbs.length / NUM_CLASSES
  const result = greedyDecode(logProbs, T)
  const t3 = performance.now()
  return {
    text: result.text,
    confidence: result.confidence,
    chars: result.chars,
    timing: {
      audioMs: 0,
      dspMs: t1 - t0,
      modelMs: t2 - t1,
      decodeMs: t3 - t2,
      totalMs: t3 - t0,
    },
  }
}

async function decodeSamplesWindowed(
  audio: Float32Array,
  toneFreq: number,
): Promise<PipelineResult> {
  const t0 = performance.now()
  const parts: PipelineResult[] = []

  for (const slice of splitDecodeWindows(audio)) {
    parts.push(await decodeSamples(slice, toneFreq))
  }

  const t1 = performance.now()
  const texts = parts.map((part) => part.text).filter(Boolean)
  const confidence =
    parts.length > 0
      ? parts.reduce((sum, part) => sum + part.confidence, 0) / parts.length
      : 0

  return {
    text: texts.join(' '),
    confidence,
    chars: parts.flatMap((part) => part.chars),
    timing: {
      audioMs: 0,
      dspMs: parts.reduce((sum, part) => sum + part.timing.dspMs, 0),
      modelMs: parts.reduce((sum, part) => sum + part.timing.modelMs, 0),
      decodeMs: parts.reduce((sum, part) => sum + part.timing.decodeMs, 0),
      totalMs: t1 - t0,
    },
  }
}
