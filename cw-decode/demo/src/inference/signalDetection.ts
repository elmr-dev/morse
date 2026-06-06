export interface SignalDetection {
  id: string
  label: string
  toneHz: number
  score: number
}

export interface SignalDetectionOptions {
  windowSeconds?: number
  maxSignals?: number
  minHz?: number
  maxHz?: number
  stepHz?: number
  minSeparationHz?: number
}

export function detectTopSignals(
  audio: Float32Array,
  sampleRate: number,
  endSeconds: number,
  options: SignalDetectionOptions = {},
): SignalDetection[] {
  const windowSeconds = options.windowSeconds ?? 2
  const maxSignals = options.maxSignals ?? 3
  const minHz = options.minHz ?? 250
  const maxHz = options.maxHz ?? 1200
  const stepHz = options.stepHz ?? 10
  const minSeparationHz = options.minSeparationHz ?? 100
  const end = Math.min(audio.length, Math.max(0, Math.floor(endSeconds * sampleRate)))
  const start = Math.max(0, end - Math.floor(windowSeconds * sampleRate))
  const samples = audio.subarray(start, end)
  if (samples.length < sampleRate * 0.25) return []

  const powers: Array<{ hz: number; power: number }> = []
  for (let hz = minHz; hz <= maxHz; hz += stepHz) {
    powers.push({ hz, power: goertzelPower(samples, sampleRate, hz) })
  }

  const sortedPower = powers.map((item) => item.power).sort((a, b) => a - b)
  const floor = percentile(sortedPower, 55)
  const ceiling = percentile(sortedPower, 98)
  const spread = Math.max(ceiling - floor, 1e-9)

  const peaks = powers
    .map((item, index) => ({ ...item, index, score: (item.power - floor) / spread }))
    .filter((item, index, list) =>
      item.score > 0.45 &&
      item.power >= (list[index - 1]?.power ?? -Infinity) &&
      item.power >= (list[index + 1]?.power ?? -Infinity),
    )
    .sort((a, b) => b.score - a.score)

  const chosen: typeof peaks = []
  for (const peak of peaks) {
    if (chosen.some((item) => Math.abs(item.hz - peak.hz) < minSeparationHz)) continue
    chosen.push(peak)
    if (chosen.length >= maxSignals) break
  }

  return chosen
    .sort((a, b) => a.hz - b.hz)
    .map((peak, index) => ({
      id: `track-${index}`,
      label: `Track ${index + 1}`,
      toneHz: Math.round(peak.hz),
      score: Math.max(0, Math.min(1, peak.score)),
    }))
}

function goertzelPower(samples: Float32Array, sampleRate: number, hz: number): number {
  const omega = (2 * Math.PI * hz) / sampleRate
  const cosine = Math.cos(omega)
  const coeff = 2 * cosine
  let q0 = 0
  let q1 = 0
  let q2 = 0

  for (let i = 0; i < samples.length; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, samples.length - 1))
    q0 = coeff * q1 - q2 + samples[i] * win
    q2 = q1
    q1 = q0
  }

  return q1 * q1 + q2 * q2 - coeff * q1 * q2
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0
  const rank = (pct / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}
