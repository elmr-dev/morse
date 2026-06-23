import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';

/** Mirror of the Rust `DeviceInfo` returned by `list_input_devices`. */
interface DeviceInfo {
  id: string;
  name: string;
  default: boolean;
}

/** Mirror of the Rust `DecodeResult`: collapsed text, mean per-character
 *  confidence in [0, 1], and the CW tone the DSP actually used. */
interface DecodeResult {
  text: string;
  confidence: number;
  /** CW tone the DSP bandpass was centred on, in Hz (camelCase from Rust). */
  detectedToneHz: number;
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
  const color =
    level === 'high'
      ? 'text-good'
      : level === 'fair'
        ? 'text-warning'
        : 'text-destructive';
  return (
    <span
      className={`inline-flex rounded-full border border-current px-2.5 py-1 text-xs font-semibold ${color}`}
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
  const [autoDetect, setAutoDetect] = useState(() =>
    loadSetting('autoDetect', true)
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
    saveSetting('autoDetect', autoDetect);
  }, [autoDetect]);
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
        toneHz: autoDetect ? null : toneHz,
      });
      setDecode({ status: 'done', result });
    } catch (err) {
      setDecode({ status: 'error', message: String(err) });
    }
  }

  const fieldCls = 'flex flex-col gap-1.5';
  const labelCls = 'text-sm font-semibold';
  const inputCls =
    'min-h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base';
  const hintCls = 'text-xs text-muted-foreground';
  const linkCls = 'min-h-11 px-1 text-primary';

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-2xl font-semibold">Morse Decoder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture live audio from an input device and decode CW.
        </p>
      </header>

      <section className="flex flex-col gap-4" aria-label="Capture settings">
        <div className={fieldCls}>
          <label htmlFor="device" className={labelCls}>
            Input device
          </label>
          {devices.status === 'loading' && (
            <div
              className="h-11 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {devices.status === 'error' && (
            <p className="text-destructive" role="alert">
              Could not list devices: {devices.message}{' '}
              <button type="button" className={linkCls} onClick={loadDevices}>
                Retry
              </button>
            </p>
          )}
          {devices.status === 'ready' &&
            (devices.devices.length === 0 ? (
              <p className="text-muted-foreground">
                No input devices found.{' '}
                <button type="button" className={linkCls} onClick={loadDevices}>
                  Refresh
                </button>
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  id="device"
                  className={`${inputCls} flex-1`}
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
                  className={linkCls}
                  onClick={loadDevices}
                  disabled={capturing}
                >
                  Refresh
                </button>
              </div>
            ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className={fieldCls}>
            <span className={labelCls}>Tone (Hz)</span>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-input px-3">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={autoDetect}
                disabled={capturing}
                onChange={(e) => setAutoDetect(e.target.checked)}
              />
              <span className="text-base">Auto-detect</span>
              {decode.status === 'done' && decode.result.detectedToneHz > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {Math.round(decode.result.detectedToneHz)} Hz
                </span>
              )}
            </label>
            {!autoDetect && (
              <input
                id="tone"
                className={inputCls}
                type="number"
                min={100}
                max={2000}
                step={10}
                value={toneHz}
                disabled={capturing}
                onChange={(e) => setToneHz(Number(e.target.value))}
              />
            )}
            <span className={hintCls}>
              {autoDetect
                ? 'Spectral peak in 300–1000 Hz'
                : 'IC-7300 factory pitch is 600 Hz'}
            </span>
          </div>

          <div className={fieldCls}>
            <label htmlFor="seconds" className={labelCls}>
              Capture (s)
            </label>
            <input
              id="seconds"
              className={inputCls}
              type="number"
              min={1}
              max={16}
              step={1}
              value={seconds}
              disabled={capturing}
              onChange={(e) => setSeconds(Number(e.target.value))}
            />
            <span className={hintCls}>Max 16 s (model window)</span>
          </div>
        </div>

        <button
          type="button"
          className="min-h-12 cursor-pointer rounded-lg bg-primary px-5 font-semibold text-primary-foreground transition-opacity active:opacity-85 disabled:cursor-default disabled:opacity-50"
          onClick={handleDecode}
          disabled={capturing || devices.status !== 'ready'}
          aria-busy={capturing}
        >
          {capturing ? `Capturing ${seconds}s…` : 'Capture & decode'}
        </button>
      </section>

      <section
        className="flex min-h-20 items-center rounded-xl border border-border p-4"
        aria-label="Decoded text"
        aria-live="polite"
      >
        {decode.status === 'idle' && (
          <p className="text-muted-foreground">
            Decoded text will appear here.
          </p>
        )}
        {decode.status === 'capturing' && (
          <p className="text-muted-foreground">Listening…</p>
        )}
        {decode.status === 'error' && (
          <p className="text-destructive" role="alert">
            {decode.message}
          </p>
        )}
        {decode.status === 'done' &&
          (decode.result.text.length > 0 ? (
            <div className="flex flex-col items-start gap-2.5">
              <output className="font-mono text-xl tracking-[0.08em] break-words">
                {decode.result.text}
              </output>
              <ConfidenceBadge value={decode.result.confidence} />
            </div>
          ) : (
            <p className="text-muted-foreground">
              No CW detected in that window.
            </p>
          ))}
      </section>
    </main>
  );
}

export default App;
