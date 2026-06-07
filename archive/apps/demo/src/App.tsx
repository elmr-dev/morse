import {
  FIST_PROFILES,
  MAX_BANDWIDTH,
  MAX_BUZZ_AMPLITUDE,
  MAX_CHIRP_DEVIATION,
  MAX_FADE_DEPTH,
  MAX_FLUTTER_DEPTH,
  MAX_FLUTTER_RATE,
  MAX_FREQUENCY,
  MAX_RAYLEIGH_BANDWIDTH,
  MAX_RAYLEIGH_DEPTH,
  MAX_SNR,
  MAX_WPM,
  MIN_BANDWIDTH,
  MIN_BUZZ_AMPLITUDE,
  MIN_CHIRP_DEVIATION,
  MIN_FADE_DEPTH,
  MIN_FLUTTER_DEPTH,
  MIN_FLUTTER_RATE,
  MIN_FREQUENCY,
  MIN_RAYLEIGH_BANDWIDTH,
  MIN_RAYLEIGH_DEPTH,
  MIN_WPM,
  type SampleRate,
} from 'morse-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Section } from './components/Section';
import { Slider } from './components/Slider';
import {
  BANDPASS_PRESETS,
  DEFAULT_SETTINGS,
  type DemoSettings,
  FIST_PRESETS,
  generateDemoAudio,
} from './pipeline';

const QUICK_TEXTS = [
  'CQ CQ CQ DE W1AW',
  'PARIS PARIS PARIS',
  '599 TU 73',
  'SOS',
  'THE QUICK BROWN FOX',
];
const SAMPLE_RATES: SampleRate[] = [8000, 16000, 22050, 44100];

export default function App() {
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!audioRef.current && typeof Audio !== 'undefined')
    audioRef.current = new Audio();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const off = () => setIsPlaying(false);
    const on = () => setIsPlaying(true);
    audio.addEventListener('play', on);
    audio.addEventListener('pause', off);
    audio.addEventListener('ended', off);
    return () => {
      audio.removeEventListener('play', on);
      audio.removeEventListener('pause', off);
      audio.removeEventListener('ended', off);
    };
  }, []);

  const generated = useMemo(() => {
    try {
      setError(null);
      return generateDemoAudio(settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [settings]);

  const set = <K extends keyof DemoSettings>(
    key: K,
    value: DemoSettings[K]
  ) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const patch = <K extends keyof DemoSettings>(
    key: K,
    value: Partial<DemoSettings[K]>
  ) => {
    setSettings((s) => ({
      ...s,
      [key]: { ...(s[key] as object), ...value } as DemoSettings[K],
    }));
  };

  const play = () => {
    if (!audioRef.current || !generated) return;
    audioRef.current.src = generated.dataUri;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch((err) => setError(err.message));
  };

  const stop = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>morse-audio workbench</h1>
          <p>Drive the full generator pipeline from one screen.</p>
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={isPlaying ? stop : play}
            disabled={!generated}
          >
            {isPlaying ? 'Stop' : 'Play'}
          </button>
          <button onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset</button>
        </div>
      </header>

      <div className="statusbar">
        <span>
          {generated ? `${generated.duration.toFixed(2)} s` : 'No audio'}
        </span>
        <span>{generated ? `${generated.sampleRate} Hz` : '-'}</span>
        <span>
          {generated
            ? `${generated.effectiveWpm.toFixed(1)} effective WPM`
            : '-'}
        </span>
        <span>
          {settings.bandpass.enabled
            ? `${settings.bandpass.bandwidth} Hz receiver filter`
            : 'No post filter'}
        </span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <main className="workbench">
        <div className="column">
          <Section title="Source">
            <div className="field">
              <label>Text</label>
              <input
                value={settings.text}
                onChange={(e) => set('text', e.target.value.toUpperCase())}
              />
              <div className="chips">
                {QUICK_TEXTS.map((text) => (
                  <button key={text} onClick={() => set('text', text)}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid-2">
              <Slider
                label="WPM"
                value={settings.wpm}
                min={MIN_WPM}
                max={MAX_WPM}
                unit="wpm"
                onChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    wpm: v,
                    fwpm: Math.min(s.fwpm, v),
                  }))
                }
              />
              <Slider
                label="Farnsworth"
                value={settings.fwpm}
                min={MIN_WPM}
                max={settings.wpm}
                unit="wpm"
                onChange={(v) => set('fwpm', v)}
              />
              <Slider
                label="Tone"
                value={settings.frequency}
                min={MIN_FREQUENCY}
                max={MAX_FREQUENCY}
                unit="Hz"
                onChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    frequency: v,
                    bandpass: s.bandpass.lockToTone
                      ? { ...s.bandpass, centerFrequency: v }
                      : s.bandpass,
                  }))
                }
              />
              <Slider
                label="Duration"
                value={settings.durationSec}
                min={0}
                max={30}
                step={0.5}
                format={(v) => (v === 0 ? 'auto' : `${v.toFixed(1)} s`)}
                onChange={(v) => set('durationSec', v)}
              />
              <Slider
                label="Seed"
                value={settings.seed}
                min={1}
                max={999999}
                step={1}
                onChange={(v) => set('seed', v)}
              />
              <div className="field">
                <label>Sample rate</label>
                <select
                  value={settings.sampleRate}
                  onChange={(e) =>
                    set('sampleRate', Number(e.target.value) as SampleRate)
                  }
                >
                  {SAMPLE_RATES.map((sr) => (
                    <option key={sr} value={sr}>
                      {sr} Hz
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Section>

          <Section
            title="Fist"
            enabled={settings.fist.enabled}
            onToggle={(enabled) => patch('fist', { enabled })}
          >
            <div className="segmented">
              {FIST_PRESETS.map((preset) => (
                <button
                  key={preset.profile}
                  className={
                    settings.fist.profile === preset.profile ? 'active' : ''
                  }
                  onClick={() => {
                    if (preset.profile === 'custom') {
                      patch('fist', { profile: 'custom' });
                      return;
                    }
                    const p = FIST_PROFILES[preset.profile];
                    patch('fist', {
                      profile: preset.profile,
                      jitter: p.jitter,
                      dahBias: p.dahBias,
                      speedDriftWpmPerSec: p.speedDriftWpmPerSec,
                      charGapStretchFraction: p.charGapStretchFraction,
                      charGapStretchMin: p.charGapStretchRange[0],
                      charGapStretchMax: p.charGapStretchRange[1],
                    });
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="grid-2">
              <Slider
                label="Jitter"
                value={settings.fist.jitter}
                min={0}
                max={0.5}
                step={0.005}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                onChange={(v) =>
                  patch('fist', { profile: 'custom', jitter: v })
                }
              />
              <Slider
                label="Dah bias"
                value={settings.fist.dahBias}
                min={-0.2}
                max={0.6}
                step={0.005}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                onChange={(v) =>
                  patch('fist', { profile: 'custom', dahBias: v })
                }
              />
              <Slider
                label="Drift"
                value={settings.fist.speedDriftWpmPerSec}
                min={0}
                max={1}
                step={0.05}
                unit="wpm/s"
                onChange={(v) =>
                  patch('fist', { profile: 'custom', speedDriftWpmPerSec: v })
                }
              />
              <Slider
                label="Long gaps"
                value={settings.fist.charGapStretchFraction}
                min={0}
                max={0.5}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) =>
                  patch('fist', {
                    profile: 'custom',
                    charGapStretchFraction: v,
                  })
                }
              />
              <Slider
                label="Gap min"
                value={settings.fist.charGapStretchMin}
                min={1}
                max={settings.fist.charGapStretchMax}
                step={0.05}
                format={(v) => `${v.toFixed(2)}x`}
                onChange={(v) =>
                  patch('fist', { profile: 'custom', charGapStretchMin: v })
                }
              />
              <Slider
                label="Gap max"
                value={settings.fist.charGapStretchMax}
                min={settings.fist.charGapStretchMin}
                max={3.5}
                step={0.05}
                format={(v) => `${v.toFixed(2)}x`}
                onChange={(v) =>
                  patch('fist', { profile: 'custom', charGapStretchMax: v })
                }
              />
            </div>
          </Section>

          <Section title="Receiver Noise">
            <Slider
              label="SNR"
              value={settings.noise.snrDb}
              min={-18}
              max={MAX_SNR}
              unit="dB"
              onChange={(v) => patch('noise', { snrDb: v })}
            />
            <div className="inline-toggles">
              <label>
                <input
                  type="checkbox"
                  checked={settings.noise.qsbEnabled}
                  onChange={(e) =>
                    patch('noise', { qsbEnabled: e.target.checked })
                  }
                />{' '}
                Noise QSB
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.noise.qrnEnabled}
                  onChange={(e) =>
                    patch('noise', { qrnEnabled: e.target.checked })
                  }
                />{' '}
                Impulse QRN
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.noise.powerLineEnabled}
                  onChange={(e) =>
                    patch('noise', { powerLineEnabled: e.target.checked })
                  }
                />{' '}
                Power line
              </label>
            </div>
            <div className="grid-2">
              <Slider
                label="Noise QSB depth"
                value={settings.noise.qsbDepth}
                min={0}
                max={0.5}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => patch('noise', { qsbDepth: v })}
              />
              <Slider
                label="Noise QSB rate"
                value={settings.noise.qsbRate}
                min={0.05}
                max={2}
                step={0.05}
                unit="Hz"
                onChange={(v) => patch('noise', { qsbRate: v })}
              />
              <Slider
                label="Impulse rate"
                value={settings.noise.qrnRate}
                min={0.1}
                max={20}
                step={0.1}
                unit="/s"
                onChange={(v) => patch('noise', { qrnRate: v })}
              />
              <Slider
                label="Impulse amplitude"
                value={settings.noise.qrnAmplitude}
                min={1}
                max={15}
                step={0.5}
                format={(v) => `${v.toFixed(1)}x`}
                onChange={(v) => patch('noise', { qrnAmplitude: v })}
              />
              <Slider
                label="Power-line level"
                value={settings.noise.powerLineLevel}
                min={-10}
                max={30}
                unit="dB"
                onChange={(v) => patch('noise', { powerLineLevel: v })}
              />
              <Slider
                label="Power-line buzz"
                value={settings.noise.powerLineBuzzDepth}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => patch('noise', { powerLineBuzzDepth: v })}
              />
              <Slider
                label="Corona"
                value={settings.noise.powerLineCorona}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => patch('noise', { powerLineCorona: v })}
              />
              <div className="field">
                <label>Power-line base</label>
                <select
                  value={settings.noise.powerLineBaseHz}
                  onChange={(e) =>
                    patch('noise', {
                      powerLineBaseHz: Number(e.target.value) as 50 | 60,
                    })
                  }
                >
                  <option value={50}>50 Hz</option>
                  <option value={60}>60 Hz</option>
                </select>
              </div>
            </div>
          </Section>
        </div>

        <div className="column">
          <Section title="Propagation">
            <ToggleRow
              label="Ionospheric fading"
              checked={settings.ionospheric.enabled}
              onChange={(enabled) => patch('ionospheric', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Iono depth"
                value={settings.ionospheric.depth}
                min={MIN_FADE_DEPTH}
                max={MAX_FADE_DEPTH}
                step={0.05}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => patch('ionospheric', { depth: v })}
              />
              <Slider
                label="Iono rate"
                value={settings.ionospheric.rate}
                min={0.1}
                max={8}
                step={0.1}
                unit="Hz"
                onChange={(v) => patch('ionospheric', { rate: v })}
              />
              <Slider
                label="Iono components"
                value={settings.ionospheric.components}
                min={2}
                max={5}
                step={1}
                onChange={(v) => patch('ionospheric', { components: v })}
              />
            </div>
            <ToggleRow
              label="Multipath"
              checked={settings.multipath.enabled}
              onChange={(enabled) => patch('multipath', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Paths"
                value={settings.multipath.paths}
                min={2}
                max={4}
                step={1}
                onChange={(v) => patch('multipath', { paths: v })}
              />
              <Slider
                label="Max delay"
                value={settings.multipath.maxDelayMs}
                min={1}
                max={10}
                step={0.5}
                unit="ms"
                onChange={(v) => patch('multipath', { maxDelayMs: v })}
              />
              <Slider
                label="Decay"
                value={settings.multipath.decay}
                min={0.3}
                max={0.9}
                step={0.01}
                onChange={(v) => patch('multipath', { decay: v })}
              />
              <Slider
                label="Phase spread"
                value={settings.multipath.phaseSpread}
                min={0}
                max={2}
                step={0.05}
                format={(v) => `${v.toFixed(2)}π`}
                onChange={(v) => patch('multipath', { phaseSpread: v })}
              />
            </div>
            <ToggleRow
              label="Doppler spread"
              checked={settings.doppler.enabled}
              onChange={(enabled) => patch('doppler', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Spread"
                value={settings.doppler.spreadHz}
                min={1}
                max={20}
                unit="Hz"
                onChange={(v) => patch('doppler', { spreadHz: v })}
              />
              <Slider
                label="Components"
                value={settings.doppler.components}
                min={3}
                max={7}
                step={1}
                onChange={(v) => patch('doppler', { components: v })}
              />
            </div>
          </Section>

          <Section title="Tone Defects">
            <ToggleRow
              label="Pitch wobble"
              checked={settings.pitchWobble.enabled}
              onChange={(enabled) => patch('pitchWobble', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Wobble amplitude"
                value={settings.pitchWobble.amplitude}
                min={0}
                max={3}
                step={0.05}
                unit="Hz"
                onChange={(v) => patch('pitchWobble', { amplitude: v })}
              />
              <Slider
                label="Wobble rate"
                value={settings.pitchWobble.rate}
                min={0.01}
                max={0.1}
                step={0.005}
                unit="Hz"
                onChange={(v) => patch('pitchWobble', { rate: v })}
              />
              <Slider
                label="Wobble phase"
                value={settings.pitchWobble.phase}
                min={0}
                max={6.28}
                step={0.01}
                onChange={(v) => patch('pitchWobble', { phase: v })}
              />
            </div>
            <ToggleRow
              label="Rayleigh fading"
              checked={settings.rayleigh.enabled}
              onChange={(enabled) => patch('rayleigh', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Rayleigh bandwidth"
                value={settings.rayleigh.bandwidth}
                min={MIN_RAYLEIGH_BANDWIDTH}
                max={MAX_RAYLEIGH_BANDWIDTH}
                step={0.05}
                unit="Hz"
                onChange={(v) => patch('rayleigh', { bandwidth: v })}
              />
              <Slider
                label="Rayleigh depth"
                value={settings.rayleigh.depth}
                min={MIN_RAYLEIGH_DEPTH}
                max={MAX_RAYLEIGH_DEPTH}
                step={0.05}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => patch('rayleigh', { depth: v })}
              />
            </div>
            <ToggleRow
              label="Flutter"
              checked={settings.flutter.enabled}
              onChange={(enabled) => patch('flutter', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Flutter rate"
                value={settings.flutter.rate}
                min={MIN_FLUTTER_RATE}
                max={MAX_FLUTTER_RATE}
                unit="Hz"
                onChange={(v) => patch('flutter', { rate: v })}
              />
              <Slider
                label="Flutter depth"
                value={settings.flutter.depth}
                min={MIN_FLUTTER_DEPTH}
                max={MAX_FLUTTER_DEPTH}
                step={0.05}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => patch('flutter', { depth: v })}
              />
            </div>
            <ToggleRow
              label="Chirp"
              checked={settings.chirp.enabled}
              onChange={(enabled) => patch('chirp', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Chirp deviation"
                value={settings.chirp.deviation}
                min={MIN_CHIRP_DEVIATION}
                max={MAX_CHIRP_DEVIATION}
                unit="Hz"
                onChange={(v) => patch('chirp', { deviation: v })}
              />
              <Slider
                label="Chirp time"
                value={settings.chirp.timeConstant}
                min={5}
                max={60}
                unit="ms"
                onChange={(v) => patch('chirp', { timeConstant: v })}
              />
            </div>
            <ToggleRow
              label="Buzz"
              checked={settings.buzz.enabled}
              onChange={(enabled) => patch('buzz', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Buzz amount"
                value={settings.buzz.amplitude}
                min={MIN_BUZZ_AMPLITUDE}
                max={MAX_BUZZ_AMPLITUDE}
                step={0.01}
                onChange={(v) => patch('buzz', { amplitude: v })}
              />
              <div className="field">
                <label>Buzz base</label>
                <select
                  value={settings.buzz.frequency}
                  onChange={(e) =>
                    patch('buzz', {
                      frequency: Number(e.target.value) as 50 | 60,
                    })
                  }
                >
                  <option value={50}>50 Hz</option>
                  <option value={60}>60 Hz</option>
                </select>
              </div>
            </div>
          </Section>
        </div>

        <div className="column">
          <Section title="Interference">
            <ToggleRow
              label="CW QRM"
              checked={settings.cwQrm.enabled}
              onChange={(enabled) => patch('cwQrm', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="QRM stations"
                value={settings.cwQrm.count}
                min={1}
                max={4}
                step={1}
                onChange={(v) => patch('cwQrm', { count: v })}
              />
              <Slider
                label="QRM spacing"
                value={settings.cwQrm.separationHz}
                min={50}
                max={800}
                unit="Hz"
                onChange={(v) => patch('cwQrm', { separationHz: v })}
              />
              <Slider
                label="QRM power"
                value={settings.cwQrm.powerDb}
                min={-30}
                max={20}
                unit="dB"
                onChange={(v) => patch('cwQrm', { powerDb: v })}
              />
              <Slider
                label="QRM WPM"
                value={settings.cwQrm.wpm}
                min={5}
                max={60}
                unit="wpm"
                onChange={(v) => patch('cwQrm', { wpm: v })}
              />
            </div>
            <div className="field">
              <label>QRM text override</label>
              <input
                value={settings.cwQrm.text}
                onChange={(e) =>
                  patch('cwQrm', { text: e.target.value.toUpperCase() })
                }
                placeholder="blank = generated traffic"
              />
            </div>
            <ToggleRow
              label="Broadband hash"
              checked={settings.broadband.enabled}
              onChange={(enabled) => patch('broadband', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="Hash center"
                value={settings.broadband.centerFrequency}
                min={100}
                max={3000}
                unit="Hz"
                onChange={(v) => patch('broadband', { centerFrequency: v })}
              />
              <Slider
                label="Hash bandwidth"
                value={settings.broadband.bandwidth}
                min={100}
                max={2200}
                unit="Hz"
                onChange={(v) => patch('broadband', { bandwidth: v })}
              />
              <Slider
                label="Hash power"
                value={settings.broadband.powerDb}
                min={-30}
                max={15}
                unit="dB"
                onChange={(v) => patch('broadband', { powerDb: v })}
              />
            </div>
          </Section>

          <Section title="Receiver">
            <ToggleRow
              label="AGC"
              checked={settings.agc.enabled}
              onChange={(enabled) => patch('agc', { enabled })}
            />
            <div className="grid-2">
              <Slider
                label="AGC attack"
                value={settings.agc.attackMs}
                min={1}
                max={200}
                unit="ms"
                onChange={(v) => patch('agc', { attackMs: v })}
              />
              <Slider
                label="AGC release"
                value={settings.agc.releaseMs}
                min={20}
                max={2000}
                unit="ms"
                onChange={(v) => patch('agc', { releaseMs: v })}
              />
              <Slider
                label="AGC target"
                value={settings.agc.targetLevel}
                min={0.1}
                max={1}
                step={0.01}
                onChange={(v) => patch('agc', { targetLevel: v })}
              />
              <Slider
                label="AGC max gain"
                value={settings.agc.maxGain}
                min={1}
                max={40}
                step={1}
                format={(v) => `${v}x`}
                onChange={(v) => patch('agc', { maxGain: v })}
              />
            </div>
            <ToggleRow
              label="Post bandpass"
              checked={settings.bandpass.enabled}
              onChange={(enabled) => patch('bandpass', { enabled })}
            />
            <div className="chips">
              {BANDPASS_PRESETS.map((bw) => (
                <button
                  key={bw}
                  onClick={() => patch('bandpass', { bandwidth: bw })}
                >
                  {bw} Hz
                </button>
              ))}
            </div>
            <div className="grid-2">
              <Slider
                label="Bandwidth"
                value={settings.bandpass.bandwidth}
                min={MIN_BANDWIDTH}
                max={MAX_BANDWIDTH}
                step={50}
                unit="Hz"
                onChange={(v) => patch('bandpass', { bandwidth: v })}
              />
              <Slider
                label="Filter center"
                value={settings.bandpass.centerFrequency}
                min={MIN_FREQUENCY}
                max={MAX_FREQUENCY}
                unit="Hz"
                disabled={settings.bandpass.lockToTone}
                onChange={(v) => patch('bandpass', { centerFrequency: v })}
              />
              <Slider
                label="Stages"
                value={settings.bandpass.stages}
                min={1}
                max={8}
                step={1}
                onChange={(v) => patch('bandpass', { stages: v })}
              />
            </div>
            <label className="checkline">
              <input
                type="checkbox"
                checked={settings.bandpass.lockToTone}
                onChange={(e) =>
                  patch('bandpass', {
                    lockToTone: e.target.checked,
                    centerFrequency: e.target.checked
                      ? settings.frequency
                      : settings.bandpass.centerFrequency,
                  })
                }
              />{' '}
              Lock center to tone
            </label>
          </Section>

          <Section title="Metadata">
            <pre className="metadata">{generated?.metadataJson ?? ''}</pre>
          </Section>
        </div>
      </main>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
