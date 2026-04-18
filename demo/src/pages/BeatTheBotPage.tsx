import { useEffect, useRef, useState } from 'react'
import { decodeDataUri, type PipelineResult } from '../inference/pipeline'
import { cer } from '../inference/decode'
import { loadSession } from '../inference/onnx'
import { generateAudio } from '../inference/generate'

const TONE_FREQ = 700
const MAX_LISTENS = 2
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

type Phase = 'idle' | 'listening' | 'guessing' | 'graded'

interface Round {
  text: string
  wpm: number
  snr: number
  dataUri: string
}

function randomRound(): Round {
  const len = 5 + Math.floor(Math.random() * 3)           // 5–7 chars
  const wpm = 25 + Math.floor(Math.random() * 11)         // 25–35 wpm
  // Training-calibrated SNR. At -8 dB the bot is ~10% CER; at -12 dB ~40%. Pick -10..-6.
  const snr = -10 + Math.floor(Math.random() * 5)
  let text = ''
  for (let i = 0; i < len; i++) text += CHARS[Math.floor(Math.random() * CHARS.length)]
  const out = generateAudio({ text, wpm, snrDb: snr, frequency: TONE_FREQ })
  return { text, wpm, snr, dataUri: out.dataUri }
}

export default function BeatTheBotPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [round, setRound] = useState<Round | null>(null)
  const [listens, setListens] = useState(0)
  const [guess, setGuess] = useState('')
  const [botResult, setBotResult] = useState<PipelineResult | null>(null)
  const [modelReady, setModelReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [score, setScore] = useState({ wins: 0, losses: 0, ties: 0 })

  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    loadSession()
      .then(() => setModelReady(true))
      .catch((e) => setError(String(e)))
  }, [])

  function startRound() {
    setError(null)
    setBotResult(null)
    setGuess('')
    setListens(0)
    const r = randomRound()
    setRound(r)
    setPhase('listening')
  }

  function playAudio() {
    if (!audioRef.current || !round) return
    if (listens >= MAX_LISTENS) return
    audioRef.current.currentTime = 0
    void audioRef.current.play()
    setListens((n) => n + 1)
  }

  async function submitGuess() {
    if (!round) return
    setPhase('guessing')
    try {
      const res = await decodeDataUri(round.dataUri, TONE_FREQ)
      setBotResult(res)
      const userCer = cer(round.text, guess.toUpperCase().trim())
      const botCer = cer(round.text, res.text)
      setScore((s) => {
        if (userCer < botCer) return { ...s, wins: s.wins + 1 }
        if (userCer > botCer) return { ...s, losses: s.losses + 1 }
        return { ...s, ties: s.ties + 1 }
      })
      setPhase('graded')
    } catch (e) {
      setError(String(e))
      setPhase('listening')
    }
  }

  const userCerPct = round && phase === 'graded'
    ? cer(round.text, guess.toUpperCase().trim()) * 100
    : null
  const botCerPct = round && botResult
    ? cer(round.text, botResult.text) * 100
    : null

  return (
    <div>
      <h1>Beat the Bot</h1>
      <p>
        Listen to a short morse clip (5–7 characters, 25–35 WPM, low SNR). You get up to
        two listens, then type your guess. We grade you against our model on character error rate.
      </p>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <Stat label="You" value={score.wins.toString()} accent="good" />
            <Stat label="Bot" value={score.losses.toString()} accent="bad" />
            <Stat label="Ties" value={score.ties.toString()} />
          </div>
          <button className="primary" disabled={!modelReady} onClick={startRound}>
            {round ? 'New round' : 'Start'}
          </button>
        </div>
        {!modelReady && <div className="loading"><span className="spinner" /> Loading model…</div>}
        {error && <div className="bad mono">{error}</div>}
      </div>

      {round && phase !== 'idle' && (
        <div className="panel">
          <h3>Round</h3>
          <div className="muted">
            {round.text.length} characters · approx {round.wpm} wpm · SNR {round.snr} dB (hidden until you submit)
          </div>
          <audio ref={audioRef} src={round.dataUri} preload="auto" />
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={playAudio} disabled={phase !== 'listening' || listens >= MAX_LISTENS}>
              Play ({MAX_LISTENS - listens} left)
            </button>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <label>Your guess</label>
            <input
              type="text"
              value={guess}
              onChange={(e) => setGuess(e.target.value.toUpperCase())}
              style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 18, letterSpacing: 2 }}
              disabled={phase !== 'listening'}
              maxLength={20}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && phase === 'listening' && guess.trim()) void submitGuess()
              }}
            />
            <button
              className="primary"
              disabled={phase !== 'listening' || !guess.trim() || listens === 0}
              onClick={submitGuess}
            >
              {phase === 'guessing' ? <><span className="spinner" /> Grading…</> : 'Submit'}
            </button>
          </div>
          {phase === 'listening' && listens === 0 && (
            <div className="muted">Hit Play to hear the clip.</div>
          )}
        </div>
      )}

      {phase === 'graded' && round && botResult && (
        <div className="panel">
          <h3>Results</h3>
          <div style={{ marginBottom: 14 }}>
            <span className="muted">Ground truth:&nbsp;</span>
            <span className="mono" style={{ fontSize: 20, color: 'var(--text-h)', letterSpacing: 2 }}>
              {round.text}
            </span>
          </div>

          <div className="grid-2">
            <ResultCard
              title="You"
              guess={guess.toUpperCase().trim()}
              truth={round.text}
              cerPct={userCerPct!}
            />
            <ResultCard
              title="Bot"
              guess={botResult.text}
              truth={round.text}
              cerPct={botCerPct!}
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <Verdict userCer={userCerPct!} botCer={botCerPct!} />
          </div>
        </div>
      )}
    </div>
  )
}

function ResultCard({ title, guess, truth, cerPct }: { title: string; guess: string; truth: string; cerPct: number }) {
  const maxLen = Math.max(guess.length, truth.length)
  const chars = []
  for (let i = 0; i < maxLen; i++) {
    const g = guess[i] ?? '·'
    const t = truth[i] ?? '·'
    chars.push(
      <span key={i} className={`diff-char ${g === t ? 'match' : 'miss'}`} style={{ fontFamily: 'var(--mono)' }}>
        {g}
      </span>,
    )
  }
  return (
    <div className="panel" style={{ background: 'var(--bg)', margin: 0 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <div className="result-text">{chars.length ? chars : <span className="muted">(nothing)</span>}</div>
      <div className="muted" style={{ marginTop: 6 }}>CER: <span className={cerPct === 0 ? 'good' : ''}>{cerPct.toFixed(1)}%</span></div>
    </div>
  )
}

function Verdict({ userCer, botCer }: { userCer: number; botCer: number }) {
  if (userCer < botCer) return <span className="good" style={{ fontSize: 18, fontWeight: 600 }}>You win this round.</span>
  if (userCer > botCer) return <span className="bad" style={{ fontSize: 18, fontWeight: 600 }}>Bot wins this round.</span>
  return <span style={{ fontSize: 18, fontWeight: 600 }}>Tie.</span>
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'bad' }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className={`mono ${accent ?? ''}`} style={{ fontSize: 22, fontWeight: 600, color: accent ? undefined : 'var(--text-h)' }}>{value}</div>
    </div>
  )
}
