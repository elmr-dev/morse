import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Mirror of `DeviceInfo` from Rust. */
interface DeviceInfo {
  id: string;
  name: string;
  default: boolean;
}

/** Single decoded character with its per-emission model confidence. */
interface CharResult {
  ch: string;
  confidence: number;
}

/** Mirror of the Rust `DecodeResult`. */
interface DecodeResult {
  chars: CharResult[];
  text: string;
  confidence: number;
  detectedToneHz: number;
}

type DeviceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; devices: DeviceInfo[] };

type OutputDeviceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; devices: DeviceInfo[] };

type MonitorStatus = 'off' | 'starting' | 'on' | 'stopping' | 'error';

/** One row in the copy sheet. */
interface CopyLine {
  id: number;
  /** UTC time the capture started, formatted as e.g. "1423Z". */
  timestamp: string;
  chars: CharResult[];
  confidence: number;
  detectedToneHz: number;
  status: 'active' | 'settled' | 'empty';
}

const DEFAULT_TONE_HZ = 700;
const DEFAULT_SECONDS = 8;
const STORAGE_PREFIX = 'morse-decoder:';
/** Opacity floor for low-confidence characters — keeps them readable. */
const CONFIDENCE_FLOOR = 0.30;

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
    // Storage unavailable/full — not fatal.
  }
}

/** Format a Date as a Zulu (UTC) timestamp: "1423Z". */
function zuluStamp(date: Date): string {
  const h = date.getUTCHours().toString().padStart(2, '0');
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  return `${h}${m}Z`;
}

/** Clamp confidence to the opacity floor. */
function charOpacity(confidence: number): number {
  return Math.max(CONFIDENCE_FLOOR, Math.min(1.0, confidence));
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Render one settled copy-sheet line. */
function SettledLine({ line }: { line: CopyLine }) {
  const pct = Math.round(line.confidence * 100);
  return (
    <div className="flex items-baseline gap-3 font-mono leading-relaxed">
      <span className="shrink-0 text-xs text-muted-foreground">{line.timestamp}</span>
      {line.status === 'empty' ? (
        <span className="text-muted-foreground/50 text-sm italic">no copy</span>
      ) : (
        <>
          <span className="flex-1 break-all text-base tracking-[0.06em] select-text">
            {line.chars.map((c, i) =>
              c.ch === ' ' ? (
                <span key={i}> </span>
              ) : (
                <span key={i} style={{ opacity: charOpacity(c.confidence) }}>
                  {c.ch}
                </span>
              )
            )}
          </span>
          <span
            className="shrink-0 text-xs text-muted-foreground/60 tabular-nums"
            title="Mean per-emission confidence"
          >
            {pct}%
          </span>
        </>
      )}
    </div>
  );
}

/** Render the active (capturing) line — stamp + blinking cursor. */
function ActiveLine({ timestamp }: { timestamp: string }) {
  return (
    <div className="flex items-baseline gap-3 font-mono leading-relaxed">
      <span className="shrink-0 text-xs text-muted-foreground">{timestamp}</span>
      <span className="text-muted-foreground animate-pulse motion-reduce:animate-none">▌</span>
    </div>
  );
}

/** The accumulating copy sheet. */
function CopySheet({ lines }: { lines: CopyLine[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Each capture appends a line. Select text here to copy.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 select-text cursor-text">
      {lines.map((line) =>
        line.status === 'active' ? (
          <ActiveLine key={line.id} timestamp={line.timestamp} />
        ) : (
          <SettledLine key={line.id} line={line} />
        )
      )}
      <div ref={bottomRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

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

  // Copy sheet
  const [copyLines, setCopyLines] = useState<CopyLine[]>([]);
  /** True while the continuous capture loop is running. */
  const [running, setRunning] = useState(false);
  /** Set to true to break the capture loop after the current window completes. */
  const stopRef = useRef(false);
  const [lastToneHz, setLastToneHz] = useState(0);

  // Monitor
  const [outputDevices, setOutputDevices] = useState<OutputDeviceState>({
    status: 'loading',
  });
  const [monitorOutputId, setMonitorOutputId] = useState<string>(() =>
    loadSetting('monitorOutput', '')
  );
  const [monitorVolume, setMonitorVolume] = useState<number>(() =>
    loadSetting('monitorVolume', 1.0)
  );
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>('off');
  const [monitorError, setMonitorError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setDevices({ status: 'loading' });
    try {
      const list = await invoke<DeviceInfo[]>('list_input_devices');
      setDevices({ status: 'ready', devices: list });
      setSelectedId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        const preferred = list.find((d) => d.default) ?? list[0];
        return preferred?.id ?? '';
      });
    } catch (err) {
      setDevices({ status: 'error', message: String(err) });
    }
  }, []);

  const loadOutputDevices = useCallback(async () => {
    setOutputDevices({ status: 'loading' });
    try {
      const list = await invoke<DeviceInfo[]>('list_output_devices');
      setOutputDevices({ status: 'ready', devices: list });
      setMonitorOutputId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        const preferred = list.find((d) => d.default) ?? list[0];
        return preferred?.id ?? '';
      });
    } catch (err) {
      setOutputDevices({ status: 'error', message: String(err) });
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    void loadOutputDevices();
  }, [loadDevices, loadOutputDevices]);

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
  useEffect(() => {
    if (monitorOutputId) saveSetting('monitorOutput', monitorOutputId);
  }, [monitorOutputId]);
  useEffect(() => {
    saveSetting('monitorVolume', monitorVolume);
  }, [monitorVolume]);

  const monitorOn = monitorStatus === 'on';
  const monitorBusy = monitorStatus === 'starting' || monitorStatus === 'stopping';

  async function handleMonitorToggle() {
    setMonitorError(null);
    if (monitorOn) {
      setMonitorStatus('stopping');
      try {
        await invoke('stop_monitor');
        setMonitorStatus('off');
      } catch (err) {
        setMonitorStatus('error');
        setMonitorError(String(err));
      }
    } else {
      setMonitorStatus('starting');
      try {
        await invoke('start_monitor', {
          inputDevice: selectedId || null,
          outputDevice: monitorOutputId || null,
          volume: monitorVolume,
        });
        setMonitorStatus('on');
      } catch (err) {
        setMonitorStatus('error');
        setMonitorError(String(err));
      }
    }
  }

  async function handleVolumeChange(v: number) {
    setMonitorVolume(v);
    if (monitorOn) {
      try {
        await invoke('set_monitor_volume', { volume: v });
      } catch {
        // non-fatal
      }
    }
  }

  async function handleCapture() {
    if (running) {
      // Signal the loop to stop after the current window completes.
      stopRef.current = true;
      return;
    }

    stopRef.current = false;
    setRunning(true);

    while (!stopRef.current) {
      const ts = zuluStamp(new Date());
      const lineId = Date.now();

      setCopyLines((prev) => [
        ...prev,
        { id: lineId, timestamp: ts, chars: [], confidence: 0, detectedToneHz: 0, status: 'active' },
      ]);

      try {
        const result = await invoke<DecodeResult>('capture_and_decode', {
          device: selectedId || null,
          seconds,
          toneHz: autoDetect ? null : toneHz,
        });

        if (result.detectedToneHz > 0) setLastToneHz(result.detectedToneHz);

        const hasContent = result.chars.some((c) => c.ch !== ' ');
        setCopyLines((prev) => {
          if (!hasContent) {
            // Empty window — remove the placeholder silently.
            return prev.filter((l) => l.id !== lineId);
          }
          return prev.map((l) =>
            l.id !== lineId
              ? l
              : {
                  ...l,
                  chars: result.chars,
                  confidence: result.confidence,
                  detectedToneHz: result.detectedToneHz,
                  status: 'settled' as const,
                }
          );
        });
      } catch (err) {
        // On error: remove the placeholder, surface the message, stop the loop.
        const errMsg = String(err);
        setCopyLines((prev) =>
          prev
            .filter((l) => l.id !== lineId)
            .concat({
              id: lineId,
              timestamp: ts,
              chars: [{ ch: errMsg, confidence: 1.0 }],
              confidence: 0,
              detectedToneHz: 0,
              status: 'empty',
            })
        );
        stopRef.current = true;
      }
    }

    setRunning(false);
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

      {/* Capture settings */}
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
                  disabled={running}
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
                  disabled={running}
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
                disabled={running}
                onChange={(e) => setAutoDetect(e.target.checked)}
              />
              <span className="text-base">Auto-detect</span>
              {lastToneHz > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {Math.round(lastToneHz)} Hz
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
                disabled={running}
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
              disabled={running}
              onChange={(e) => setSeconds(Number(e.target.value))}
            />
            <span className={hintCls}>Max 16 s (model window)</span>
          </div>
        </div>

        <button
          type="button"
          className={`min-h-12 cursor-pointer rounded-lg px-5 font-semibold transition-opacity active:opacity-85 disabled:cursor-default disabled:opacity-50 ${
            running
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-primary text-primary-foreground'
          }`}
          onClick={() => void handleCapture()}
          disabled={!running && devices.status !== 'ready'}
          aria-busy={running}
        >
          {running ? 'Stop' : 'Capture & decode'}
        </button>
      </section>

      {/* Copy sheet */}
      <section
        className="flex flex-col gap-3 rounded-xl border border-border p-4"
        aria-label="Copy sheet"
        aria-live="polite"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Copy sheet
        </h2>
        <CopySheet lines={copyLines} />
        {copyLines.length > 0 && (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            onClick={() => setCopyLines([])}
          >
            Clear
          </button>
        )}
      </section>

      {/* Monitor */}
      <section className="flex flex-col gap-4" aria-label="Monitor">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Monitor
        </h2>

        <div className={fieldCls}>
          <label htmlFor="output-device" className={labelCls}>
            Output device
          </label>
          {outputDevices.status === 'loading' && (
            <div
              className="h-11 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {outputDevices.status === 'error' && (
            <p className="text-destructive" role="alert">
              Could not list devices: {outputDevices.message}{' '}
              <button
                type="button"
                className={linkCls}
                onClick={loadOutputDevices}
              >
                Retry
              </button>
            </p>
          )}
          {outputDevices.status === 'ready' &&
            (outputDevices.devices.length === 0 ? (
              <p className="text-muted-foreground">
                No output devices found.{' '}
                <button
                  type="button"
                  className={linkCls}
                  onClick={loadOutputDevices}
                >
                  Refresh
                </button>
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  id="output-device"
                  className={`${inputCls} flex-1`}
                  value={monitorOutputId}
                  onChange={(e) => setMonitorOutputId(e.target.value)}
                  disabled={monitorOn || monitorBusy}
                >
                  {outputDevices.devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={linkCls}
                  onClick={loadOutputDevices}
                  disabled={monitorOn || monitorBusy}
                >
                  Refresh
                </button>
              </div>
            ))}
        </div>

        <div className={fieldCls}>
          <label htmlFor="monitor-volume" className={labelCls}>
            Volume{' '}
            <span className="font-normal text-muted-foreground">
              {Math.round(monitorVolume * 100)}%
            </span>
          </label>
          <input
            id="monitor-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={monitorVolume}
            className="h-11 w-full cursor-pointer accent-primary"
            onChange={(e) => void handleVolumeChange(Number(e.target.value))}
          />
        </div>

        <button
          type="button"
          className="min-h-12 cursor-pointer rounded-lg bg-primary px-5 font-semibold text-primary-foreground transition-opacity active:opacity-85 disabled:cursor-default disabled:opacity-50"
          onClick={() => void handleMonitorToggle()}
          disabled={monitorBusy || outputDevices.status !== 'ready'}
          aria-pressed={monitorOn}
        >
          {monitorStatus === 'starting'
            ? 'Starting…'
            : monitorStatus === 'stopping'
              ? 'Stopping…'
              : monitorOn
                ? 'Stop monitor'
                : 'Start monitor'}
        </button>

        {monitorStatus === 'error' && monitorError && (
          <p className="text-sm text-destructive" role="alert">
            {monitorError}
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
