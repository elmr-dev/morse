import { useCallback, useEffect, useRef, useState } from 'react'
import { dataUriToMonoFloat32 } from '../inference/audio'
import { generateContestHelperSample, type ContestHelperSample } from '../inference/contestSample'
import { decodeSamples, type PipelineResult } from '../inference/pipeline'
import { detectTopSignals, type SignalDetection } from '../inference/signalDetection'
import { ConfidenceText, Waterfall } from './ContestHelperPage'

const STREAM_SAMPLE_RATE = 8000
const DECODE_WINDOW_SECONDS = 6
const DETECT_INTERVAL_SECONDS = 2

type DecodeStatus = 'listening' | 'decoding' | 'done' | 'error'

export default function SingleDecoderPage() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const processedChunksRef = useRef<Set<string>>(new Set())
  const decodeChainRef = useRef<Promise<void>>(Promise.resolve())
  const streamVersionRef = useRef(0)
  const [seed, setSeed] = useState(20260605)
  const [sample, setSample] = useState<ContestHelperSample>(() => generateContestHelperSample(20260605))
  const [audio, setAudio] = useState<Float32Array | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [centerHz, setCenterHz] = useState(730)
  const [bandwidthHz, setBandwidthHz] = useState<50 | 100 | 200>(100)
  const [detected, setDetected] = useState<SignalDetection | null>(null)
  const [status, setStatus] = useState<DecodeStatus>('listening')
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resetStream = useCallback(() => {
    streamVersionRef.current += 1
    processedChunksRef.current.clear()
    decodeChainRef.current = Promise.resolve()
    setCurrentTime(0)
    setDetected(null)
    setStatus('listening')
    setResult(null)
    setError(null)
  }, [])

  const generate = useCallback(() => {
    const next = generateContestHelperSample(seed)
    setSample(next)
    setAudio(null)
    setAudioError(null)
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
    const onPlay = () => {
      if (audioEl.currentTime < 0.25) resetStream()
      setCurrentTime(audioEl.currentTime)
      stopFrameLoop()
      rafId = requestAnimationFrame(frameLoop)
    }
    const onTimeUpdate = () => setCurrentTime(audioEl.currentTime)
    const onEnded = () => {
      stopFrameLoop()
      setCurrentTime(audioEl.duration || sample.duration)
    }
    audioEl.addEventListener('play', onPlay)
    audioEl.addEventListener('timeupdate', onTimeUpdate)
    audioEl.addEventListener('seeked', onTimeUpdate)
    audioEl.addEventListener('pause', stopFrameLoop)
    audioEl.addEventListener('ended', onEnded)
    return () => {
      stopFrameLoop()
      audioEl.removeEventListener('play', onPlay)
      audioEl.removeEventListener('timeupdate', onTimeUpdate)
      audioEl.removeEventListener('seeked', onTimeUpdate)
      audioEl.removeEventListener('pause', stopFrameLoop)
      audioEl.removeEventListener('ended', onEnded)
    }
  }, [resetStream, sample.duration])

  const enqueueDecode = useCallback((endSeconds: number, finalChunk = false) => {
    if (!audio) return
    const boundedEnd = Math.min(sample.duration, Math.max(0, endSeconds))
    if (boundedEnd < DECODE_WINDOW_SECONDS) return

    const chunkIndex = finalChunk ? 'final' : String(Math.floor(boundedEnd / DETECT_INTERVAL_SECONDS))
    const key = `${chunkIndex}:${boundedEnd.toFixed(2)}:${centerHz}:${bandwidthHz}`
    if (processedChunksRef.current.has(key)) return
    processedChunksRef.current.add(key)

    const version = streamVersionRef.current
    decodeChainRef.current = decodeChainRef.current.then(async () => {
      if (streamVersionRef.current !== version) return

      const bandLow = Math.max(0, centerHz - bandwidthHz / 2)
      const bandHigh = Math.min(1200, centerHz + bandwidthHz / 2)
      const detections = detectTopSignals(audio, STREAM_SAMPLE_RATE, boundedEnd, {
        windowSeconds: 2,
        maxSignals: 1,
        minHz: bandLow,
        maxHz: bandHigh,
        stepHz: 5,
        minSeparationHz: bandwidthHz,
      })
      const top = detections[0] ?? null
      setDetected(top)
      if (!top) return

      const chunkStartSec = Math.max(0, boundedEnd - DECODE_WINDOW_SECONDS)
      const chunk = audio.slice(
        Math.floor(chunkStartSec * STREAM_SAMPLE_RATE),
        Math.floor(boundedEnd * STREAM_SAMPLE_RATE),
      )
      if (chunk.length < STREAM_SAMPLE_RATE * 0.5) return

      setStatus('decoding')
      setError(null)
      await yieldToUi()
      try {
        const decoded = await decodeSamples(chunk, top.toneHz)
        setResult((previous) => appendPipelineResult(previous, decoded))
        setStatus(finalChunk ? 'done' : 'listening')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    })
  }, [audio, bandwidthHz, centerHz, sample.duration])

  useEffect(() => {
    if (!audio) return
    if (currentTime < 0.25 && processedChunksRef.current.size > 0) {
      resetStream()
      return
    }

    const regularChunkLimit = Math.min(currentTime + 0.1, sample.duration - 0.25)
    for (let endSec = DECODE_WINDOW_SECONDS; endSec <= regularChunkLimit; endSec += DETECT_INTERVAL_SECONDS) {
      enqueueDecode(endSec)
    }
    if (currentTime >= sample.duration - 0.25) {
      enqueueDecode(sample.duration, true)
    }
  }, [audio, currentTime, enqueueDecode, resetStream, sample.duration])

  useEffect(() => {
    resetStream()
  }, [bandwidthHz, centerHz, resetStream])

  return (
    <main>
      <section className="panel contest-helper">
        <div className="contest-helper-head">
          <div>
            <h1>Single Decoder</h1>
            <p className="muted">Tune a receive band, detect the strongest CW signal inside it, and decode that stream.</p>
          </div>
          <div className="contest-actions">
            <label className="seed-control">
              <span>Seed</span>
              <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
            </label>
            <button onClick={generate}>Generate</button>
            <span className="stream-status">{audioError ? 'Audio failed' : status}</span>
          </div>
        </div>

        <div className="receiver single-tuner">
          <label className="control">
            <span>Center</span>
            <div className="range-row">
              <input
                type="range"
                min={250}
                max={1200}
                step={5}
                value={centerHz}
                onChange={(event) => setCenterHz(Number(event.target.value))}
              />
              <span className="value">{centerHz} Hz</span>
            </div>
          </label>
          <label className="control">
            <span>Band</span>
            <select value={bandwidthHz} onChange={(event) => setBandwidthHz(Number(event.target.value) as 50 | 100 | 200)}>
              <option value={200}>200 Hz</option>
              <option value={100}>100 Hz</option>
              <option value={50}>50 Hz</option>
            </select>
          </label>
          <div className="muted">
            {detected ? `Detected ${detected.toneHz} Hz (${Math.round(detected.score * 100)}%)` : 'No signal detected in band yet'}
          </div>
        </div>

        {audioError && <p className="bad">Audio load failed: {audioError}</p>}
        <Waterfall audio={audio} currentTime={currentTime} highlight={{ centerHz, bandwidthHz }} />
        <audio ref={audioRef} src={sample.dataUri} controls />
      </section>

      <section className="panel signal-tracks-panel">
        <h2>Decode</h2>
        <div className="result-text lane-result confidence-text">
          {error ? error : result ? <ConfidenceText result={result} /> : `${status}...`}
        </div>
        {result && (
          <div className="muted">
            confidence {Math.round(result.confidence * 100)}% · {Math.round(result.timing.totalMs)} ms
          </div>
        )}
      </section>
    </main>
  )
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

function appendPipelineResult(previous: PipelineResult | null, next: PipelineResult): PipelineResult {
  if (!previous) return next
  return {
    text: [previous.text, next.text].filter(Boolean).join(' '),
    confidence: (previous.confidence + next.confidence) / 2,
    chars: [...previous.chars, ...next.chars],
    timing: {
      audioMs: previous.timing.audioMs + next.timing.audioMs,
      dspMs: previous.timing.dspMs + next.timing.dspMs,
      modelMs: previous.timing.modelMs + next.timing.modelMs,
      decodeMs: previous.timing.decodeMs + next.timing.decodeMs,
      totalMs: previous.timing.totalMs + next.timing.totalMs,
    },
  }
}
