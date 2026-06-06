import { useCallback, useEffect, useRef, useState } from 'react'
import { dataUriToMonoFloat32 } from '../inference/audio'
import {
  generateContestHelperSample,
  type ContestHelperSample,
} from '../inference/contestSample'
import { decodeSamples, type PipelineResult } from '../inference/pipeline'
import { detectTopSignals, type SignalDetection } from '../inference/signalDetection'

interface TrackDecode {
  track: SignalDetection
  status: 'listening' | 'decoding' | 'done' | 'error'
  result?: PipelineResult
  error?: string
}

const STREAM_CHUNK_SECONDS = 6
const STREAM_SAMPLE_RATE = 8000
const WATERFALL_WINDOW_SECONDS = 12
const DECODE_STAGGER_SECONDS = 2

export default function ContestHelperPage() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const processedChunksRef = useRef<Set<string>>(new Set())
  const decodeChainRef = useRef<Promise<void>>(Promise.resolve())
  const pendingChunksRef = useRef(0)
  const streamVersionRef = useRef(0)
  const [seed, setSeed] = useState(20260605)
  const [sample, setSample] = useState<ContestHelperSample>(() => generateContestHelperSample(20260605))
  const [audio, setAudio] = useState<Float32Array | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isDecoding, setIsDecoding] = useState(false)
  const [trackDecodes, setTrackDecodes] = useState<TrackDecode[]>([])

  const resetStream = useCallback(() => {
    streamVersionRef.current += 1
    processedChunksRef.current.clear()
    decodeChainRef.current = Promise.resolve()
    pendingChunksRef.current = 0
    setIsDecoding(false)
    setTrackDecodes([])
  }, [])

  const generate = useCallback(() => {
    const next = generateContestHelperSample(seed)
    setSample(next)
    setAudio(null)
    setAudioError(null)
    setCurrentTime(0)
    resetStream()
  }, [resetStream, seed])

  useEffect(() => {
    let cancelled = false
    setAudioError(null)
    dataUriToMonoFloat32(sample.dataUri)
      .then((decoded) => {
        if (!cancelled) setAudio(decoded)
      })
      .catch((err) => {
        if (!cancelled) setAudioError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [sample])

  useEffect(() => {
    const audioEl = audioRef.current
    if (!audioEl) return
    let rafId = 0
    let lastFrameMs = 0
    const stopFrameLoop = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
    }
    const frameLoop = (frameMs: number) => {
      if (frameMs - lastFrameMs > 125) {
        lastFrameMs = frameMs
        setCurrentTime(audioEl.currentTime)
      }
      if (!audioEl.paused && !audioEl.ended) {
        rafId = requestAnimationFrame(frameLoop)
      }
    }
    const onTimeUpdate = () => setCurrentTime(audioEl.currentTime)
    const onPlay = () => {
      if (audioEl.currentTime < 0.25) resetStream()
      setCurrentTime(audioEl.currentTime)
      stopFrameLoop()
      rafId = requestAnimationFrame(frameLoop)
    }
    const onEnded = () => {
      stopFrameLoop()
      setCurrentTime(audioEl.duration || sample.duration)
    }
    audioEl.addEventListener('timeupdate', onTimeUpdate)
    audioEl.addEventListener('seeked', onTimeUpdate)
    audioEl.addEventListener('play', onPlay)
    audioEl.addEventListener('pause', stopFrameLoop)
    audioEl.addEventListener('ended', onEnded)
    return () => {
      stopFrameLoop()
      audioEl.removeEventListener('timeupdate', onTimeUpdate)
      audioEl.removeEventListener('seeked', onTimeUpdate)
      audioEl.removeEventListener('play', onPlay)
      audioEl.removeEventListener('pause', stopFrameLoop)
      audioEl.removeEventListener('ended', onEnded)
    }
  }, [resetStream, sample.duration])

  const enqueueStreamChunk = useCallback((chunkEndSec: number, finalChunk = false) => {
    if (!audio) return
    const boundedEndSec = Math.min(sample.duration, Math.max(0, chunkEndSec))
    if (boundedEndSec < 0.5) return

    const chunkIndex = finalChunk ? 'final' : String(Math.floor(boundedEndSec / DECODE_STAGGER_SECONDS))
    const key = `${chunkIndex}:${boundedEndSec.toFixed(2)}`
    if (processedChunksRef.current.has(key)) return
    processedChunksRef.current.add(key)

    const version = streamVersionRef.current
    pendingChunksRef.current += 1
    setIsDecoding(true)

    decodeChainRef.current = decodeChainRef.current.then(async () => {
      if (streamVersionRef.current !== version) return

      const chunkStartSec = Math.max(0, boundedEndSec - STREAM_CHUNK_SECONDS)
      const startSample = Math.floor(chunkStartSec * STREAM_SAMPLE_RATE)
      const endSample = Math.floor(boundedEndSec * STREAM_SAMPLE_RATE)
      const chunk = audio.slice(startSample, endSample)
      if (chunk.length < STREAM_SAMPLE_RATE * 0.5) return

      const detectedTracks = detectTopSignals(audio, STREAM_SAMPLE_RATE, boundedEndSec, {
        windowSeconds: 2,
        maxSignals: 3,
        minSeparationHz: 100,
      })
      setTrackDecodes((current) => mergeDetectedTracks(current, detectedTracks))

      const tracksToDecode = finalChunk
        ? detectedTracks
        : [detectedTracks[Math.floor(boundedEndSec / DECODE_STAGGER_SECONDS) % Math.max(1, detectedTracks.length)]].filter(Boolean)

      for (const track of tracksToDecode) {
        if (streamVersionRef.current !== version) return
        setTrackDecodes((current) =>
          current.map((decode) => decode.track.id === track.id ? { ...decode, track, status: 'decoding' } : decode),
        )
        await yieldToUi()
        try {
          const result = await decodeSamples(chunk, track.toneHz)
          setTrackDecodes((current) =>
            current.map((decode) =>
              decode.track.id === track.id
                ? {
                    ...decode,
                    track,
                    status: finalChunk ? 'done' : 'listening',
                    result: appendPipelineResult(decode.result, result),
                  }
                : decode,
            ),
          )
        } catch (err) {
          setTrackDecodes((current) =>
            current.map((decode) =>
              decode.track.id === track.id
                ? { ...decode, status: 'error', error: err instanceof Error ? err.message : String(err) }
                : decode,
            ),
          )
        }
        await yieldToUi()
      }
    }).finally(() => {
      pendingChunksRef.current = Math.max(0, pendingChunksRef.current - 1)
      if (pendingChunksRef.current === 0) setIsDecoding(false)
    })
  }, [audio, sample.duration])

  useEffect(() => {
    if (!audio) return
    if (currentTime < 0.25 && processedChunksRef.current.size > 0) {
      resetStream()
      return
    }

    const regularChunkLimit = Math.min(currentTime + 0.1, sample.duration - 0.25)
    for (let endSec = STREAM_CHUNK_SECONDS; endSec <= regularChunkLimit; endSec += DECODE_STAGGER_SECONDS) {
      enqueueStreamChunk(endSec)
    }

    if (currentTime >= sample.duration - 0.25) {
      enqueueStreamChunk(sample.duration, true)
    }
  }, [audio, currentTime, enqueueStreamChunk, resetStream, sample.duration])

  const streamStatus = audioError
    ? 'Audio failed'
    : !audio
      ? 'Loading audio'
      : isDecoding
        ? 'Decoding'
        : 'Listening'

  return (
    <main>
      <section className="panel contest-helper">
        <div className="contest-helper-head">
          <div>
            <h1>Contest Helper</h1>
            <p className="muted">
              Three generated CW signals across a 1200 Hz passband, decoded as separate tuned lanes.
            </p>
          </div>
          <div className="contest-actions">
            <label className="seed-control">
              <span>Seed</span>
              <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
            </label>
            <button onClick={generate}>Generate</button>
            <span className="stream-status">{streamStatus}</span>
          </div>
        </div>

        {audioError && <p className="bad">Audio load failed: {audioError}</p>}
        <Waterfall audio={audio} currentTime={currentTime} />
        <audio ref={audioRef} src={sample.dataUri} controls />
      </section>

      <section className="panel signal-tracks-panel">
        <h2>Signal Tracks</h2>
        <TrackList decodes={trackDecodes} />
      </section>
    </main>
  )
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

function appendPipelineResult(previous: PipelineResult | undefined, next: PipelineResult): PipelineResult {
  if (!previous) return next
  return {
    text: [previous.text, next.text].filter(Boolean).join(' '),
    confidence: (previous.confidence + next.confidence) / 2,
    timing: {
      audioMs: previous.timing.audioMs + next.timing.audioMs,
      dspMs: previous.timing.dspMs + next.timing.dspMs,
      modelMs: previous.timing.modelMs + next.timing.modelMs,
      decodeMs: previous.timing.decodeMs + next.timing.decodeMs,
      totalMs: previous.timing.totalMs + next.timing.totalMs,
    },
    chars: [...previous.chars, ...next.chars],
  }
}

function mergeDetectedTracks(current: TrackDecode[], detectedTracks: SignalDetection[]): TrackDecode[] {
  return detectedTracks.map((track) => {
    const previous = current.find((decode) => decode.track.id === track.id)
    return previous
      ? { ...previous, track }
      : { track, status: 'listening' as const }
  })
}

function TrackList({ decodes }: { decodes: TrackDecode[] }) {
  if (decodes.length === 0) return <p className="muted">Waiting for signal detections...</p>

  return (
    <div className="lane-list">
      {decodes.map((decode) => (
        <div className="lane-card" key={decode.track.id}>
          <div className="lane-card-head">
            <strong>{decode.track.label}</strong>
            <span>{decode.track.toneHz} Hz · detection {Math.round(decode.track.score * 100)}%</span>
          </div>
          <div className="result-text lane-result confidence-text">
            {decode.status === 'error'
              ? decode.error
              : decode.result?.text
                ? <ConfidenceText result={decode.result} />
                : `${decode.status}...`}
          </div>
          {decode.result && (
            <div className="muted">
              confidence {Math.round(decode.result.confidence * 100)}% · {Math.round(decode.result.timing.totalMs)} ms
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function ConfidenceText({ result }: { result: PipelineResult }) {
  let charIndex = 0

  return (
    <>
      {result.text.split('').map((char, index) => {
        if (char === ' ') return <span key={index}> </span>
        const decodedChar = result.chars[charIndex++]
        const confidence = decodedChar?.confidence ?? result.confidence
        return (
          <span key={index} style={{ color: confidenceColor(confidence) }}>
            {char}
          </span>
        )
      })}
    </>
  )
}

function confidenceColor(confidence: number): string {
  const t = Math.max(0, Math.min(1, confidence))
  const red = Math.round(235 * (1 - t) + 40 * t)
  const green = Math.round(64 * (1 - t) + 235 * t)
  const blue = Math.round(52 * (1 - t) + 90 * t)
  return `rgb(${red}, ${green}, ${blue})`
}

export function Waterfall({
  audio,
  currentTime,
  highlight,
}: {
  audio: Float32Array | null
  currentTime: number
  highlight?: { centerHz: number; bandwidthHz: number }
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastDrawTimeRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    clearWaterfall(ctx, canvas.width, canvas.height)
    lastDrawTimeRef.current = null

    if (!audio) {
      ctx.fillStyle = '#b9c7d6'
      ctx.fillText('Loading audio...', 16, 28)
    }
  }, [audio])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !audio) return

    const columnSeconds = WATERFALL_WINDOW_SECONDS / canvas.width
    const previousTime = lastDrawTimeRef.current

    if (previousTime === null || currentTime < previousTime || currentTime < 0.05) {
      clearWaterfall(ctx, canvas.width, canvas.height)
      lastDrawTimeRef.current = currentTime
      if (currentTime > 0) {
        drawWaterfallColumn(ctx, audio, currentTime, canvas.width - 1, canvas.height)
        drawFrequencyGrid(ctx, canvas.width, canvas.height)
        if (highlight) drawBandHighlight(ctx, canvas.width, canvas.height, highlight)
      }
      return
    }

    const elapsed = currentTime - previousTime
    const columnsToDraw = Math.max(0, Math.min(canvas.width, Math.floor(elapsed / columnSeconds)))
    if (columnsToDraw === 0) return

    scrollWaterfall(ctx, canvas.width, canvas.height, columnsToDraw)
    for (let i = 0; i < columnsToDraw; i++) {
      const t = previousTime + ((i + 1) / columnsToDraw) * elapsed
      drawWaterfallColumn(ctx, audio, t, canvas.width - columnsToDraw + i, canvas.height)
    }
    drawFrequencyGrid(ctx, canvas.width, canvas.height)
    if (highlight) drawBandHighlight(ctx, canvas.width, canvas.height, highlight)
    lastDrawTimeRef.current = previousTime + columnsToDraw * columnSeconds
  }, [audio, currentTime, highlight])

  return (
    <div className="waterfall-wrap">
      <div className="waterfall-panel">
        <div className="waterfall-y-axis" aria-hidden="true">
          {[1200, 1000, 800, 600, 400, 200, 0].map((hz) => (
            <span key={hz}>{hz}</span>
          ))}
        </div>
        <canvas ref={canvasRef} width={720} height={300} />
      </div>
    </div>
  )
}

function clearWaterfall(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.fillStyle = '#041327'
  ctx.fillRect(0, 0, width, height)
  drawFrequencyGrid(ctx, width, height)
}

function scrollWaterfall(ctx: CanvasRenderingContext2D, width: number, height: number, columns: number) {
  ctx.drawImage(ctx.canvas, columns, 0, width - columns, height, 0, 0, width - columns, height)
  ctx.fillStyle = '#041327'
  ctx.fillRect(width - columns, 0, columns, height)
}

function drawWaterfallColumn(
  ctx: CanvasRenderingContext2D,
  audio: Float32Array,
  timeSeconds: number,
  x: number,
  height: number,
) {
  const sampleRate = 8000
  const windowSize = 256
  const maxHz = 1200
  const bins = 80
  const image = ctx.createImageData(1, height)

  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 4
    image.data[i + 1] = 19
    image.data[i + 2] = 39
    image.data[i + 3] = 255
  }

  const center = Math.floor(timeSeconds * sampleRate)
  const start = Math.max(0, Math.min(audio.length - windowSize, center - Math.floor(windowSize / 2)))
  const magnitudes = new Float64Array(bins)
  for (let b = 0; b < bins; b++) {
    const hz = (b / (bins - 1)) * maxHz
    let re = 0
    let im = 0
    for (let n = 0; n < windowSize; n++) {
      const sample = audio[start + n] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (windowSize - 1)))
      const phase = (2 * Math.PI * hz * n) / sampleRate
      re += sample * Math.cos(phase)
      im -= sample * Math.sin(phase)
    }
    magnitudes[b] = Math.log10(1 + Math.hypot(re, im) * 9)
  }

  const sorted = Array.from(magnitudes).sort((a, b) => a - b)
  const floor = percentileNumber(sorted, 55)
  const ceiling = percentileNumber(sorted, 98)
  const spread = Math.max(ceiling - floor, 0.04)

  for (let b = 0; b < bins; b++) {
    const hz = (b / (bins - 1)) * maxHz
    const normalized = (magnitudes[b] - floor) / spread
    const y = height - 1 - Math.round((hz / maxHz) * (height - 1))
    paintColumn(image, 0, y, normalized, 1, height)
  }
  ctx.putImageData(image, x, 0)
}

function paintColumn(
  image: ImageData,
  x: number,
  y: number,
  normalizedMagnitude: number,
  width: number,
  height: number,
) {
  const intensity = Math.max(0, Math.min(1, (normalizedMagnitude - 0.62) * 2.1))
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy
    if (yy < 0 || yy >= height) continue
    const i = (yy * width + x) * 4
    image.data[i] = 4 + intensity * intensity * 95
    image.data[i + 1] = 19 + intensity * 236
    image.data[i + 2] = 39 - intensity * 18
    image.data[i + 3] = 255
  }
}

function percentileNumber(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0
  const rank = (pct / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

function drawFrequencyGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(120, 170, 205, 0.18)'
  for (let hz = 0; hz <= 1200; hz += 200) {
    const y = height - 1 - (hz / 1200) * (height - 1)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawBandHighlight(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  band: { centerHz: number; bandwidthHz: number },
) {
  const lowHz = Math.max(0, band.centerHz - band.bandwidthHz / 2)
  const highHz = Math.min(1200, band.centerHz + band.bandwidthHz / 2)
  const yHigh = height - 1 - (highHz / 1200) * (height - 1)
  const yLow = height - 1 - (lowHz / 1200) * (height - 1)
  const bandHeight = Math.max(1, yLow - yHigh)

  ctx.save()
  ctx.fillStyle = 'rgba(86, 255, 150, 0.10)'
  ctx.fillRect(0, yHigh, width, bandHeight)
  ctx.strokeStyle = 'rgba(160, 255, 190, 0.78)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, yHigh + 0.5, width - 1, bandHeight - 1)
  ctx.restore()
}
