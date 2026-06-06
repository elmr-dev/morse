import { useEffect, useRef, useState } from 'react'
import { cer } from '../inference/decode'
import { loadSession } from '../inference/onnx'
import { generateAudio } from '../inference/generate'
import { randomCallsign, callsignRegion } from '../inference/callsign'
import { decodeDualCallsignDataUri, type DualDecodeResult } from '../inference/dualDecode'

const TONE_FREQ = 700
const MAX_LISTENS = 1   // audio already contains the callsign sent twice
const GAME_ROUNDS = 25
const RECEIVER_BANDWIDTHS = [
  { label: 'Wide', hz: 1200 },
  { label: 'Medium', hz: 700 },
  { label: 'Narrow', hz: 400 },
  { label: 'Tight', hz: 250 },
] as const

type Phase = 'idle' | 'listening' | 'guessing' | 'graded' | 'complete'
type ReceiverBandwidth = typeof RECEIVER_BANDWIDTHS[number]['hz']

interface Round {
  text: string
  region: 'US' | 'Canada' | 'World'
  wpm: number
  snr: number
  dataUri: string
}

function randomRound(): Round {
  // 20..30 WPM (inclusive). The model's CER climbs with WPM (final_eval
  // shows 12-25: ~0.04, 25-40: ~0.08, 40-60: ~0.15), so keeping the upper
  // bound at 30 matches a regime where dual-look + alignment-merge actually
  // helps and the bot stays beatable.
  const wpm = 20 + Math.floor(Math.random() * 11)         // 20..30 inclusive
  // Beat-the-Bot range: -14..-8 dB (inclusive, 7 integer values).
  // At -8 dB the bot is ~3% CER (easy); at -14 dB it's ~40% (hard).
  // The dual-look split-and-merge is meant to keep the bot honest in
  // the harder half of this range.
  const snr = -14 + Math.floor(Math.random() * 7)
  const text = randomCallsign() // weighted US > Canada > world
  const region = callsignRegion(text)
  // Generate one audio with the callsign sent twice. The space tells morse-
  // audio to insert a 7-unit word gap between the two repetitions, giving
  // the decoder a clear silence to split on for dual-look diversity combining.
  const sentText = `${text} ${text}`
  const out = generateAudio({ text: sentText, wpm, snrDb: snr, frequency: TONE_FREQ })
  return { text, region, wpm, snr, dataUri: out.dataUri }
}

export default function BeatTheBotPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [round, setRound] = useState<Round | null>(null)
  const [listens, setListens] = useState(0)
  const [guess, setGuess] = useState('')
  const [botResult, setBotResult] = useState<DualDecodeResult | null>(null)
  const [modelReady, setModelReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [score, setScore] = useState({ wins: 0, losses: 0, ties: 0 })
  const [roundNumber, setRoundNumber] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const filterRef = useRef<BiquadFilterNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const botDecodeRef = useRef<Promise<DualDecodeResult> | null>(null)
  const pendingAutoplayRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [receiverVolume, setReceiverVolume] = useState(0.85)
  const [receiverBandwidth, setReceiverBandwidth] = useState<ReceiverBandwidth>(700)

  useEffect(() => {
    loadSession()
      .then(() => setModelReady(true))
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    configureReceiver(receiverVolume, receiverBandwidth)
  }, [receiverVolume, receiverBandwidth])

  useEffect(() => {
    if (!round || !pendingAutoplayRef.current || phase !== 'listening') return
    pendingAutoplayRef.current = false
    window.setTimeout(() => void playAudio(), 0)
  }, [round, phase])

  useEffect(() => {
    return () => {
      void audioContextRef.current?.close()
    }
  }, [])

  function configureReceiver(volume = receiverVolume, bandwidth = receiverBandwidth) {
    if (filterRef.current) {
      filterRef.current.type = 'bandpass'
      filterRef.current.frequency.value = TONE_FREQ
      filterRef.current.Q.value = TONE_FREQ / bandwidth
    }
    if (gainRef.current) {
      gainRef.current.gain.value = volume
    }
    if (audioRef.current && !gainRef.current) {
      audioRef.current.volume = volume
    }
  }

  async function ensureReceiver() {
    const audio = audioRef.current
    if (!audio) return
    if (!audioContextRef.current) {
      const AC: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext
      audioContextRef.current = new AC()
    }
    const ctx = audioContextRef.current
    if (!sourceRef.current) {
      const source = ctx.createMediaElementSource(audio)
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()
      source.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      sourceRef.current = source
      filterRef.current = filter
      gainRef.current = gain
      audio.volume = 1
      configureReceiver()
    }
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
  }

  function startBotDecode(r: Round) {
    botDecodeRef.current = decodeDualCallsignDataUri(r.dataUri, TONE_FREQ)
    botDecodeRef.current.catch((e) => {
      setError(String(e))
    })
  }

  function startRound(nextRoundNumber: number, autoplay = false) {
    setError(null)
    setBotResult(null)
    setGuess('')
    setListens(0)
    setIsPlaying(false)
    botDecodeRef.current = null
    const r = randomRound()
    pendingAutoplayRef.current = autoplay
    setRound(r)
    setRoundNumber(nextRoundNumber)
    setPhase('listening')
  }

  function startGame() {
    setScore({ wins: 0, losses: 0, ties: 0 })
    startRound(1, true)
  }

  function resetGame() {
    audioRef.current?.pause()
    pendingAutoplayRef.current = false
    botDecodeRef.current = null
    setError(null)
    setBotResult(null)
    setGuess('')
    setListens(0)
    setIsPlaying(false)
    setRound(null)
    setRoundNumber(0)
    setScore({ wins: 0, losses: 0, ties: 0 })
    setPhase('idle')
  }

  function nextRound() {
    if (roundNumber >= GAME_ROUNDS) {
      setPhase('complete')
      return
    }
    startRound(roundNumber + 1, true)
  }

  // The audio file is already callsign+space+callsign — one playback gives
  // the user (and the bot) two looks at the same call with independent noise.
  async function playAudio() {
    if (!audioRef.current || !round) return
    if (listens >= MAX_LISTENS) return
    if (isPlaying) return
    try {
      await ensureReceiver()
      setIsPlaying(true)
      setListens((n) => n + 1)
      startBotDecode(round)
      const audio = audioRef.current
      audio.currentTime = 0
      await audio.play()
      const onEnd = () => {
        audio.removeEventListener('ended', onEnd)
        setIsPlaying(false)
      }
      audio.addEventListener('ended', onEnd)
    } catch (e) {
      setError(String(e))
      setIsPlaying(false)
    }
  }

  async function submitGuess() {
    if (!round) return
    setPhase('guessing')
    try {
      // Bot uses the same audio the user heard, runs inference on each half,
      // and combines — same diversity-combining advantage the user gets from
      // hearing the callsign twice.
      const res = await (botDecodeRef.current ?? decodeDualCallsignDataUri(round.dataUri, TONE_FREQ))
      setBotResult(res)
      const userCer = cer(round.text, guess.toUpperCase().trim())
      const botCer = cer(round.text, res.text)
      setScore((s) => {
        if (userCer < botCer) return { ...s, wins: s.wins + 1 }
        if (userCer > botCer) return { ...s, losses: s.losses + 1 }
        return { ...s, ties: s.ties + 1 }
      })
      setPhase(roundNumber >= GAME_ROUNDS ? 'complete' : 'graded')
    } catch (e) {
      setError(String(e))
      setPhase('listening')
    }
  }

  const userCerPct = round && (phase === 'graded' || phase === 'complete')
    ? cer(round.text, guess.toUpperCase().trim()) * 100
    : null
  const botCerPct = round && botResult
    ? cer(round.text, botResult.text) * 100
    : null

  return (
    <div>
      <h1>Beat the Bot</h1>
      <p>
        Listen to a random callsign sent twice in CW (20–30 WPM, low SNR), the way
        operators repeat their own call. You and the bot both get the same clip —
        one shot at it. Type your guess; we grade both decodes on character error rate.
      </p>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <Stat label="You" value={score.wins.toString()} accent="good" />
            <Stat label="Bot" value={score.losses.toString()} accent="bad" />
            <Stat label="Ties" value={score.ties.toString()} />
          </div>
          <div className="row" style={{ margin: 0 }}>
            <button className="primary" disabled={!modelReady} onClick={startGame}>
              {round ? 'New Game' : 'Start'}
            </button>
            <button disabled={!round && score.wins + score.losses + score.ties === 0} onClick={resetGame}>
              Reset
            </button>
          </div>
        </div>
        {!modelReady && <div className="loading"><span className="spinner" /> Loading model…</div>}
        {error && <div className="bad mono">{error}</div>}
      </div>

      {round && phase !== 'idle' && (
        <div className="panel">
          <h3>Round {roundNumber} of {GAME_ROUNDS}</h3>
          <div className="muted">
            callsign · approx {round.wpm} wpm · SNR {round.snr} dB · region hidden until you submit
          </div>
          <audio ref={audioRef} src={round.dataUri} preload="auto" />
          <div className="receiver">
            <div className="receiver-head">
              <h3>Receiver</h3>
              <span className="muted">center {TONE_FREQ} Hz</span>
            </div>
            <div className="receiver-grid">
              <label className="control">
                <span>Bandwidth</span>
                <select
                  value={receiverBandwidth}
                  onChange={(e) => setReceiverBandwidth(Number(e.target.value) as ReceiverBandwidth)}
                >
                  {RECEIVER_BANDWIDTHS.map((option) => (
                    <option key={option.hz} value={option.hz}>
                      {option.label} · {option.hz} Hz
                    </option>
                  ))}
                </select>
              </label>
              <label className="control">
                <span>Volume</span>
                <div className="range-row">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(receiverVolume * 100)}
                    onChange={(e) => setReceiverVolume(Number(e.target.value) / 100)}
                  />
                  <span className="value">{Math.round(receiverVolume * 100)}%</span>
                </div>
              </label>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              onClick={() => void playAudio()}
              disabled={phase !== 'listening' || listens >= MAX_LISTENS || isPlaying}
            >
              {isPlaying ? 'Playing…' : (listens === 0 ? 'Play' : 'Played')}
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
              {phase === 'guessing' ? <><span className="spinner" /> Grading…</> : 'Check'}
            </button>
          </div>
          {phase === 'listening' && listens === 0 && (
            <div className="muted">Hit Play to hear the clip — it sends the callsign twice.</div>
          )}
        </div>
      )}

      {(phase === 'graded' || phase === 'complete') && round && botResult && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Results</h3>
            {phase === 'graded' && (
              <button className="primary" onClick={nextRound}>
                Next
              </button>
            )}
          </div>
          <div style={{ marginBottom: 14 }}>
            <span className="muted">Ground truth:&nbsp;</span>
            <span className="mono" style={{ fontSize: 20, color: 'var(--text-h)', letterSpacing: 2 }}>
              {round.text}
            </span>
            <span className="muted" style={{ marginLeft: 10 }}>({round.region})</span>
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

          <div className="muted mono" style={{ marginTop: 10, fontSize: 12 }}>
            Bot two-look detail: 1st → {botResult.firstHalf.text || '(empty)'} (
            {(botResult.firstHalf.confidence * 100).toFixed(0)}%) · 2nd →{' '}
            {botResult.secondHalf.text || '(empty)'} (
            {(botResult.secondHalf.confidence * 100).toFixed(0)}%) ·{' '}
            {botResult.agreement ? 'agreement, fused confidence' : 'aligned and fused per character'}
          </div>

          {botResult.fusion.length > 0 && (
            <div className="muted mono" style={{ marginTop: 8, fontSize: 12 }}>
              Bot char confidence:{' '}
              {botResult.fusion.map((c, i) => (
                <span key={`${c.char}-${i}`} style={{ marginRight: 8 }}>
                  {c.char}{Math.round(c.confidence * 100)}
                  {c.alternatives.length > 0 && `/${c.alternatives[0].char}${Math.round(c.alternatives[0].confidence * 100)}`}
                </span>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Verdict userCer={userCerPct!} botCer={botCerPct!} />
          </div>
          {phase === 'complete' && (
            <div style={{ marginTop: 16 }}>
              <GameVerdict score={score} />
            </div>
          )}
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

function GameVerdict({ score }: { score: { wins: number; losses: number; ties: number } }) {
  const message = score.wins > score.losses
    ? 'You win the game.'
    : score.wins < score.losses
      ? 'Bot wins the game.'
      : 'Game tied.'
  const className = score.wins > score.losses ? 'good' : score.wins < score.losses ? 'bad' : ''
  return (
    <div className="game-verdict">
      <div className={`mono ${className}`}>{message}</div>
      <div className="muted">
        Final score after {GAME_ROUNDS} rounds: You {score.wins}, Bot {score.losses}, Ties {score.ties}.
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'bad' }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className={`mono ${accent ?? ''}`} style={{ fontSize: 22, fontWeight: 600, color: accent ? undefined : 'var(--text-h)' }}>{value}</div>
    </div>
  )
}
