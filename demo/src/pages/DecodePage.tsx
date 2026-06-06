import { useEffect, useRef, useState } from 'react'
import { decodeDataUri, type PipelineResult } from '../inference/pipeline'
import { cer } from '../inference/decode'
import { loadSession } from '../inference/onnx'
import { generateAudio } from '../inference/generate'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

const TONE_FREQ = 700

function randomText(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export default function DecodePage() {
  const [text, setText] = useState(() => randomText(8))
  const [wpm, setWpm] = useState(25)
  const [snr, setSnr] = useState(6)
  const [qsb, setQsb] = useState(false)

  const [dataUri, setDataUri] = useState<string | null>(null)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    loadSession()
      .then(() => setModelReady(true))
      .catch((e) => setError(String(e)))
  }, [])

  async function onGenerate() {
    setError(null)
    setResult(null)
    setBusy(true)
    try {
      const out = generateAudio({
        text,
        wpm,
        snrDb: snr,
        frequency: TONE_FREQ,
        qsb,
      })
      setDataUri(out.dataUri)
      const decoded = await decodeDataUri(out.dataUri, TONE_FREQ)
      setResult(decoded)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>Decode Demo</h1>
      <p>
        Generate a morse code clip at any speed and SNR, listen to it, and see what the model decodes.
        Model: <code>CWNet</code> (808k params, 3.1 MB ONNX) running in your browser via onnxruntime-web.
      </p>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Generate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="row">
            <Label htmlFor="text">Text</Label>
            <Input
              id="text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value.toUpperCase())}
              className="flex-1 [font-family:var(--mono)]"
              maxLength={40}
            />
            <Button variant="secondary" onClick={() => setText(randomText(8))} type="button">Random</Button>
          </div>
          <div className="row">
            <Label>WPM</Label>
            <Slider min={12} max={50} value={[wpm]} onValueChange={([n]) => setWpm(n)} />
            <span className="value">{wpm}</span>
          </div>
          <div className="row">
            <Label>SNR (dB)</Label>
            <Slider min={-15} max={20} value={[snr]} onValueChange={([n]) => setSnr(n)} />
            <span className="value">{snr}</span>
          </div>
          <div className="row">
            <Label htmlFor="qsb">QSB (fading)</Label>
            <Switch id="qsb" checked={qsb} onCheckedChange={setQsb} />
            <span className="muted">Moderate signal fading, 0.2 Hz rate</span>
          </div>
          <div className="row">
            <Button variant="default" disabled={busy || !modelReady || !text.trim()} onClick={onGenerate}>
              {busy ? (
                <>
                  <span className="spinner" /> Decoding…
                </>
              ) : (
                'Generate & decode'
              )}
            </Button>
            {!modelReady && <span className="loading"><span className="spinner" /> Loading model…</span>}
            {error && <span className="bad mono">{error}</span>}
          </div>
        </CardContent>
      </Card>

      {dataUri && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Audio</CardTitle>
          </CardHeader>
          <CardContent>
            <audio ref={audioRef} src={dataUri} controls style={{ width: '100%' }} />
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Model output</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="result-text">{result.text || <span className="muted">(no output)</span>}</div>
            <div className="stats">
              <Stat label="CER" value={(cer(text, result.text) * 100).toFixed(1) + '%'} />
              <Stat label="Confidence" value={(result.confidence * 100).toFixed(0) + '%'} />
              <Stat label="Inference" value={result.timing.modelMs.toFixed(0) + ' ms'} />
              <Stat label="Total" value={result.timing.totalMs.toFixed(0) + ' ms'} />
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              Audio decode {result.timing.audioMs.toFixed(0)} ms · DSP {result.timing.dspMs.toFixed(0)} ms · CTC {result.timing.decodeMs.toFixed(0)} ms
            </div>
            <div style={{ marginTop: 14 }}>
              <span className="muted">Ground truth:&nbsp;</span>
              <DiffLine ref_={text} hyp={result.text} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="cell">
      <div className="label">{label}</div>
      <div className="v">{value}</div>
    </div>
  )
}

function DiffLine({ ref_, hyp }: { ref_: string; hyp: string }) {
  const maxLen = Math.max(ref_.length, hyp.length)
  const chars = []
  for (let i = 0; i < maxLen; i++) {
    const r = ref_[i] ?? '·'
    const h = hyp[i] ?? '·'
    const match = r === h
    chars.push(
      <span key={i} className={`diff-char ${match ? 'match' : 'miss'}`} style={{ fontFamily: 'var(--mono)' }}>
        {r}
      </span>,
    )
  }
  return <span>{chars}</span>
}
