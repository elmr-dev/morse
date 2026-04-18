// End-to-end pipeline: WAV data URI → audio → DSP → ONNX → CTC decode.

import { dataUriToMonoFloat32 } from './audio'
import { DSP_SAMPLE_RATE, extractEnvelope } from './dsp'
import { greedyDecode } from './decode'
import { runInference } from './onnx'
import { NUM_CLASSES } from './constants'

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
    timing: {
      audioMs: t1 - t0,
      dspMs: t2 - t1,
      modelMs: t3 - t2,
      decodeMs: t4 - t3,
      totalMs: t4 - t0,
    },
  }
}
