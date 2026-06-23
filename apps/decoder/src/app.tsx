import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';
import './app.css';

/** Mirror of the Rust `DeviceInfo` returned by `list_input_devices`. */
interface DeviceInfo {
  id: string;
  name: string;
  default: boolean;
}

/** Mirror of the Rust `DecodeResult`: collapsed text + mean per-character
 *  confidence in [0, 1]. */
interface DecodeResult {
  text: string;
  confidence: number;
}

type DeviceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; devices: DeviceInfo[] };

type DecodeState =
  | { status: 'idle' }
  | { status: 'capturing' }
  | { status: 'done'; result: DecodeResult }
  | { status: 'error'; message: string };

/** CW tone the DSP centers on. 700 Hz matches the decode default; the IC-7300's
 *  factory CW pitch is 600 Hz, so operators may want to match their rig. */
const DEFAULT_TONE_HZ = 700;
const DEFAULT_SECONDS = 8;

/** Persist capture settings in webview localStorage (kept across app launches by
 *  Tauri) so device/tone/seconds don't have to be re-entered each session. */
const STORAGE_PREFIX = 'morse-decoder:';

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: unknown): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable/full — settings just won't persist; not fatal.
  }
}

/** Show the decode confidence as a labelled, colour-coded badge. The label is
 *  text (not colour alone) so it reads on any display and to screen readers. */
function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const level = value >= 0.8 ? 'high' : value >= 0.5 ? 'fair' : 'low';
  const label = level === 'high' ? 'High' : level === 'fair' ? 'Fair' : 'Low';
  return (
    <span
      className={`confidence confidence-${level}`}
      title="Mean model certainty across the decoded characters"
    >
      {label} confidence · {pct}%
    </span>
  );
}

function App() {
  const [devices, setDevices] = useState<DeviceState>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string>(() =>
    loadSetting('device', '')
  );
  const [toneHz, setToneHz] = useState(() =>
    loadSetting('toneHz', DEFAULT_TONE_HZ)
  );
  const [seconds, setSeconds] = useState(() =>
    loadSetting('seconds', DEFAULT_SECONDS)
  );
  const [decode, setDecode] = useState<DecodeState>({ status: 'idle' });

  const loadDevices = useCallback(async () => {
    setDevices({ status: 'loading' });
    try {
      const list = await invoke<DeviceInfo[]>('list_input_devices');
      setDevices({ status: 'ready', devices: list });
      // Keep the saved device if it's still present; otherwise fall back to the
      // host default (or first device).
      setSelectedId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        const preferred = list.find((d) => d.default) ?? list[0];
        return preferred?.id ?? '';
      });
    } catch (err) {
      setDevices({ status: 'error', message: String(err) });
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  // Persist settings whenever they change.
  useEffect(() => {
    if (selectedId) saveSetting('device', selectedId);
  }, [selectedId]);
  useEffect(() => {
    saveSetting('toneHz', toneHz);
  }, [toneHz]);
  useEffect(() => {
    saveSetting('seconds', seconds);
  }, [seconds]);

  const capturing = decode.status === 'capturing';

  async function handleDecode() {
    setDecode({ status: 'capturing' });
    try {
      const result = await invoke<DecodeResult>('capture_and_decode', {
        device: selectedId || null,
        seconds,
        toneHz,
      });
      setDecode({ status: 'done', result });
    } catch (err) {
      setDecode({ status: 'error', message: String(err) });
    }
  }

  return (
    <main className="app">
      <header>
        <h1>Morse Decoder</h1>
        <p className="subtitle">
          Capture live audio from an input device and decode CW.
        </p>
      </header>

      <section className="controls" aria-label="Capture settings">
        <div className="field">
          <label htmlFor="device">Input device</label>
          {devices.status === 'loading' && (
            <div className="device-skeleton" aria-hidden="true" />
          )}
          {devices.status === 'error' && (
            <p className="error" role="alert">
              Could not list devices: {devices.message}{' '}
              <button type="button" className="link" onClick={loadDevices}>
                Retry
              </button>
            </p>
          )}
          {devices.status === 'ready' &&
            (devices.devices.length === 0 ? (
              <p className="empty">
                No input devices found.{' '}
                <button type="button" className="link" onClick={loadDevices}>
                  Refresh
                </button>
              </p>
            ) : (
              <div className="device-row">
                <select
                  id="device"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  disabled={capturing}
                >
                  {devices.devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="link"
                  onClick={loadDevices}
                  disabled={capturing}
                >
                  Refresh
                </button>
              </div>
            ))}
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="tone">Tone (Hz)</label>
            <input
              id="tone"
              type="number"
              min={100}
              max={2000}
              step={10}
              value={toneHz}
              disabled={capturing}
              onChange={(e) => setToneHz(Number(e.target.value))}
            />
            <span className="hint">IC-7300 factory pitch is 600 Hz</span>
          </div>

          <div className="field">
            <label htmlFor="seconds">Capture (s)</label>
            <input
              id="seconds"
              type="number"
              min={1}
              max={16}
              step={1}
              value={seconds}
              disabled={capturing}
              onChange={(e) => setSeconds(Number(e.target.value))}
            />
            <span className="hint">Max 16 s (model window)</span>
          </div>
        </div>

        <button
          type="button"
          className="decode"
          onClick={handleDecode}
          disabled={capturing || devices.status !== 'ready'}
          aria-busy={capturing}
        >
          {capturing ? `Capturing ${seconds}s…` : 'Capture & decode'}
        </button>
      </section>

      <section className="result" aria-label="Decoded text" aria-live="polite">
        {decode.status === 'idle' && (
          <p className="placeholder">Decoded text will appear here.</p>
        )}
        {decode.status === 'capturing' && (
          <p className="placeholder">Listening…</p>
        )}
        {decode.status === 'error' && (
          <p className="error" role="alert">
            {decode.message}
          </p>
        )}
        {decode.status === 'done' &&
          (decode.result.text.length > 0 ? (
            <div className="decoded-wrap">
              <output className="decoded">{decode.result.text}</output>
              <ConfidenceBadge value={decode.result.confidence} />
            </div>
          ) : (
            <p className="placeholder">No CW detected in that window.</p>
          ))}
      </section>
    </main>
  );
}

export default App;
