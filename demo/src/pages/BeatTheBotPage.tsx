import { useEffect, useRef, useState } from 'react'
import { cer } from '../inference/decode'
import { loadSession } from '../inference/onnx'
import { generateAudio } from '../inference/generate'
import { randomCallsign, callsignRegion } from '../inference/callsign'
import { decodeDualCallsignDataUri, type DualDecodeResult } from '../inference/dualDecode'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const TONE_FREQ = 700
const MAX_LISTENS = 1   // audio already contains the callsign sent twice

type Phase = 'idle' | 'listening' | 'guessing' | 'graded'

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

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

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
    setIsPlaying(false)
    const r = randomRound()
    setRound(r)
    setPhase('listening')
  }

  // The audio file is already callsign+space+callsign — one playback gives
  // the user (and the bot) two looks at the same call with independent noise.
  function playAudio() {
    if (!audioRef.current || !round) return
    if (listens >= MAX_LISTENS) return
    if (isPlaying) return
    setIsPlaying(true)
    setListens((n) => n + 1)
    const audio = audioRef.current
    audio.currentTime = 0
    void audio.play()
    const onEnd = () => {
      audio.removeEventListener('ended', onEnd)
      setIsPlaying(false)
    }
    audio.addEventListener('ended', onEnd)
  }

  async function submitGuess() {
    if (!round) return
    setPhase('guessing')
    try {
      // Bot uses the same audio the user heard, runs inference on each half,
      // and combines — same diversity-combining advantage the user gets from
      // hearing the callsign twice.
      const res = await decodeDualCallsignDataUri(round.dataUri, TONE_FREQ)
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
        Listen to a random callsign sent twice in CW (20–30 WPM, low SNR), the way
        operators repeat their own call. You and the bot both get the same clip —
        one shot at it. Type your guess; we grade both decodes on character error rate.
      </p>

      <Card className="mb-4">
        <CardContent>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 20 }}>
              <Stat label="You" value={score.wins.toString()} accent="good" />
              <Stat label="Bot" value={score.losses.toString()} accent="bad" />
              <Stat label="Ties" value={score.ties.toString()} />
            </div>
            <Button disabled={!modelReady} onClick={startRound}>
              {round ? 'New round' : 'Start'}
            </Button>
          </div>
          {!modelReady && <div className="loading"><span className="spinner" /> Loading model…</div>}
          {error && <div className="bad mono">{error}</div>}
        </CardContent>
      </Card>

      {round && phase !== 'idle' && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Round</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="muted">
              callsign · approx {round.wpm} wpm · SNR {round.snr} dB · region hidden until you submit
            </div>
            <audio ref={audioRef} src={round.dataUri} preload="auto" />
            <div className="row" style={{ marginTop: 12 }}>
              <Button
                variant="secondary"
                onClick={playAudio}
                disabled={phase !== 'listening' || listens >= MAX_LISTENS || isPlaying}
              >
                {isPlaying ? 'Playing…' : (listens === 0 ? 'Play' : 'Played')}
              </Button>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <Label htmlFor="guess">Your guess</Label>
              <Input
                id="guess"
                type="text"
                value={guess}
                onChange={(e) => setGuess(e.target.value.toUpperCase())}
                className="flex-1 [font-family:var(--mono)] text-[18px] [letter-spacing:2px]"
                disabled={phase !== 'listening'}
                maxLength={20}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && phase === 'listening' && guess.trim()) void submitGuess()
                }}
              />
              <Button
                variant="default"
                disabled={phase !== 'listening' || !guess.trim() || listens === 0}
                onClick={submitGuess}
              >
                {phase === 'guessing' ? <><span className="spinner" /> Grading…</> : 'Submit'}
              </Button>
            </div>
            {phase === 'listening' && listens === 0 && (
              <div className="muted">Hit Play to hear the clip — it sends the callsign twice.</div>
            )}
          </CardContent>
        </Card>
      )}

      {phase === 'graded' && round && botResult && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent>
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
              {botResult.agreement ? 'agreement' : 'used higher-confidence half'}
            </div>

            <div style={{ marginTop: 16 }}>
              <Verdict userCer={userCerPct!} botCer={botCerPct!} />
            </div>
          </CardContent>
        </Card>
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
    <Card className="bg-background">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="result-text">{chars.length ? chars : <span className="muted">(nothing)</span>}</div>
        <div className="muted" style={{ marginTop: 6 }}>CER: <span className={cerPct === 0 ? 'good' : ''}>{cerPct.toFixed(1)}%</span></div>
      </CardContent>
    </Card>
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
