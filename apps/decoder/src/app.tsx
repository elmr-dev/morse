import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CopySheet, type CopyLine } from './components/CopySheet';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { WaterfallPanel } from './components/WaterfallPanel';

// ── Types ────────────────────────────────────────────────────────────────────

/** Mirror of `DeviceInfo` from Rust. */
interface DeviceInfo {
  id: string;
  name: string;
  default: boolean;
}

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

/** Mirror of the Rust `SpectrumFrame`. */
interface SpectrumFrame {
  bins: number[];
  detectedSignals: number[];
}

type DeviceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; devices: DeviceInfo[] };

type MonitorStatus = 'off' | 'starting' | 'on' | 'stopping' | 'error';

type Colormap = 'viridis' | 'inferno' | 'jet' | 'hot' | 'bone' | 'grayscale';

/** Three-way theme selector: follow OS, force light, or force dark. */
export type ThemeOverride = 'system' | 'light' | 'dark';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TONE_HZ = 700;
const STORAGE_PREFIX = 'morse-decoder:';
const GAP_THRESHOLD = 2;
/** Hz delta that counts as "retuned to a different signal". */
const RETUNE_THRESHOLD = 30;
const ENVELOPE_BARS = 52;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function zuluStamp(date: Date): string {
  const h = date.getUTCHours().toString().padStart(2, '0');
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  return `${h}${m}Z`;
}

function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
}

// ── App ──────────────────────────────────────────────────────────────────────

function App() {
  // ── Devices ────────────────────────────────────────────────────────────────
  const [devices, setDevices] = useState<DeviceState>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string>(() => loadSetting('device', ''));
  const [monitorOutputId, setMonitorOutputId] = useState<string>(() =>
    loadSetting('monitorOutput', ''),
  );

  // ── Tuning ─────────────────────────────────────────────────────────────────
  const [autoDetect, setAutoDetect] = useState(() => loadSetting('autoDetect', true));
  const [toneHz, setToneHz] = useState(() => loadSetting('toneHz', DEFAULT_TONE_HZ));

  // ── Capture ────────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [copyLines, setCopyLines] = useState<CopyLine[]>([]);
  const [lastToneHz, setLastToneHz] = useState(0);

  // Live-capture event state in refs to avoid stale closures.
  const emptyCountRef = useRef(0);
  const currentLineIdRef = useRef<number | null>(null);
  const lastToneHzRef = useRef(0);

  // ── Monitor ────────────────────────────────────────────────────────────────
  const [monitorVolume, setMonitorVolume] = useState<number>(() =>
    loadSetting('monitorVolume', 1.0),
  );
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>('off');

  // ── Waterfall ──────────────────────────────────────────────────────────────
  const [spectrumBins, setSpectrumBins] = useState<number[]>([]);
  const [detectedSignals, setDetectedSignals] = useState<number[]>([]);
  const [colormap, setColormap] = useState<Colormap>(() =>
    loadSetting('colormap', 'viridis' as Colormap),
  );

  // Envelope scope: rolling amplitude bars driven by confidence of incoming events.
  const [envelopeBars, setEnvelopeBars] = useState<number[]>(() =>
    new Array(ENVELOPE_BARS).fill(0.03),
  );
  const envelopeBarsRef = useRef<number[]>(new Array(ENVELOPE_BARS).fill(0.03));

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [themeOverride, setThemeOverride] = useState<ThemeOverride>(
    () => loadSetting<ThemeOverride>('themeOverride', 'system'),
  );
  // Live OS preference — updated by the MQ listener below.
  const [osDark, setOsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  // Computed actual dark value.
  const dark = themeOverride === 'dark' || (themeOverride === 'system' && osDark);

  // Sync theme class whenever computed dark changes.
  useEffect(() => {
    applyTheme(dark);
  }, [dark]);

  // Always track OS preference so 'system' mode reacts to changes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  function handleThemeChange(next: ThemeOverride) {
    setThemeOverride(next);
    saveSetting('themeOverride', next);
  }

  // ── Device loading ─────────────────────────────────────────────────────────
  const loadDevices = useCallback(async () => {
    setDevices({ status: 'loading' });
    try {
      const list = await invoke<DeviceInfo[]>('list_input_devices');
      setDevices({ status: 'ready', devices: list });
      setSelectedId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        return list.find((d) => d.default)?.id ?? list[0]?.id ?? '';
      });
    } catch (err) {
      setDevices({ status: 'error', message: String(err) });
    }
  }, []);

  const loadOutputDevices = useCallback(async () => {
    try {
      const list = await invoke<DeviceInfo[]>('list_output_devices');
      setMonitorOutputId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        return list.find((d) => d.default)?.id ?? list[0]?.id ?? '';
      });
    } catch {
      // Non-fatal — monitor will use host default.
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    void loadOutputDevices();
  }, [loadDevices, loadOutputDevices]);

  // ── Persist settings ───────────────────────────────────────────────────────
  useEffect(() => { if (selectedId) saveSetting('device', selectedId); }, [selectedId]);
  useEffect(() => { saveSetting('autoDetect', autoDetect); }, [autoDetect]);
  useEffect(() => { saveSetting('toneHz', toneHz); }, [toneHz]);
  useEffect(() => { if (monitorOutputId) saveSetting('monitorOutput', monitorOutputId); }, [monitorOutputId]);
  useEffect(() => { saveSetting('monitorVolume', monitorVolume); }, [monitorVolume]);
  useEffect(() => { saveSetting('colormap', colormap); }, [colormap]);

  // ── Spectrum frames ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    let unlisten: (() => void) | null = null;
    listen<SpectrumFrame>('spectrum-frame', (event) => {
      setSpectrumBins(event.payload.bins);
      setDetectedSignals(event.payload.detectedSignals);
    })
      .then((fn) => { unlisten = fn; })
      .catch((e: unknown) => console.error('spectrum-frame listen error:', e));
    return () => { unlisten?.(); };
  }, [running]);

  // ── Live decode events ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    let unlisten: (() => void) | null = null;

    listen<DecodeResult>('live-decode', (event) => {
      const result = event.payload;
      const hasContent = result.chars.some((c) => c.ch !== ' ');

      // Update envelope scope.
      const amp = hasContent
        ? Math.max(0.1, Math.min(1, result.confidence * 1.2))
        : 0.03 + Math.random() * 0.05;
      envelopeBarsRef.current = [...envelopeBarsRef.current.slice(1), amp];
      setEnvelopeBars(envelopeBarsRef.current.slice());

      if (!hasContent) {
        emptyCountRef.current += 1;
        if (emptyCountRef.current >= GAP_THRESHOLD && currentLineIdRef.current !== null) {
          const sealId = currentLineIdRef.current;
          currentLineIdRef.current = null;
          setCopyLines((prev) =>
            prev.map((l) =>
              l.id === sealId
                ? { ...l, status: (l.chars && l.chars.length > 0 ? 'settled' : 'empty') as CopyLine['status'] }
                : l,
            ),
          );
        }
        return;
      }

      emptyCountRef.current = 0;

      // Detected a signal at a new frequency — insert a TUNED divider.
      if (
        result.detectedToneHz > 0 &&
        lastToneHzRef.current > 0 &&
        Math.abs(result.detectedToneHz - lastToneHzRef.current) > RETUNE_THRESHOLD
      ) {
        const label = `${Math.round(result.detectedToneHz)} Hz`;
        setCopyLines((prev) => {
          if (prev.length === 0) return prev; // first acquisition — no divider
          const lines = prev.slice();
          // Collapse rapid hops into the last divider.
          if (lines[0] && lines[0].divider) {
            lines[0] = { ...lines[0], label };
          } else {
            lines.unshift({ id: 'div-' + Date.now(), divider: true, label });
          }
          return lines.length > 250 ? lines.slice(0, 250) : lines;
        });
        if (currentLineIdRef.current !== null) {
          const sealId = currentLineIdRef.current;
          currentLineIdRef.current = null;
          setCopyLines((prev) =>
            prev.map((l) =>
              l.id === sealId
                ? { ...l, status: (l.chars && l.chars.length > 0 ? 'settled' : 'empty') as CopyLine['status'] }
                : l,
            ),
          );
        }
      }

      if (result.detectedToneHz > 0) {
        lastToneHzRef.current = result.detectedToneHz;
        setLastToneHz(result.detectedToneHz);
        // In AUTO mode, follow the detected tone.
        if (autoDetect) setToneHz(Math.round(result.detectedToneHz));
      }

      if (currentLineIdRef.current === null) {
        const lineId = Date.now();
        const ts = zuluStamp(new Date());
        currentLineIdRef.current = lineId;
        setCopyLines((prev) => {
          const next = [
            {
              id: lineId,
              timestamp: ts,
              chars: result.chars,
              confidence: result.confidence,
              status: 'active' as const,
            },
            ...prev,
          ];
          return next.length > 250 ? next.slice(0, 250) : next;
        });
      } else {
        const updateId = currentLineIdRef.current;
        setCopyLines((prev) =>
          prev.map((l) =>
            l.id === updateId
              ? { ...l, chars: result.chars, confidence: result.confidence }
              : l,
          ),
        );
      }
    })
      .then((fn) => { unlisten = fn; })
      .catch((e: unknown) => console.error('live-decode listen error:', e));

    return () => { unlisten?.(); };
  }, [running, autoDetect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop capture when webview is destroyed.
  useEffect(() => {
    return () => { invoke('stop_live_capture').catch(() => {}); };
  }, []);

  // ── Capture control ────────────────────────────────────────────────────────
  async function handleStart() {
    emptyCountRef.current = 0;
    currentLineIdRef.current = null;
    lastToneHzRef.current = 0;
    setSpectrumBins([]);
    setDetectedSignals([]);
    envelopeBarsRef.current = new Array(ENVELOPE_BARS).fill(0.03);
    setEnvelopeBars(envelopeBarsRef.current.slice());
    setRunning(true);
    try {
      await invoke('start_live_capture', {
        device: selectedId || null,
        toneHz: autoDetect ? null : toneHz,
      });
    } catch (err) {
      setRunning(false);
      const ts = zuluStamp(new Date());
      setCopyLines((prev) => [
        { id: Date.now(), timestamp: ts, chars: [{ ch: String(err), confidence: 1.0 }], confidence: 0, status: 'empty' as const },
        ...prev,
      ]);
    }
  }

  async function handleStop() {
    setRunning(false);
    try { await invoke('stop_live_capture'); } catch { /* ignore */ }
    if (currentLineIdRef.current !== null) {
      const sealId = currentLineIdRef.current;
      currentLineIdRef.current = null;
      setCopyLines((prev) =>
        prev.map((l) =>
          l.id === sealId
            ? { ...l, status: (l.chars && l.chars.length > 0 ? 'settled' : 'empty') as CopyLine['status'] }
            : l,
        ),
      );
    }
    emptyCountRef.current = 0;
    envelopeBarsRef.current = new Array(ENVELOPE_BARS).fill(0.03);
    setEnvelopeBars(envelopeBarsRef.current.slice());
  }

  // ── Monitor control ────────────────────────────────────────────────────────
  async function handleMonitorToggle() {
    const monitorOn = monitorStatus === 'on';
    if (monitorOn) {
      setMonitorStatus('stopping');
      try {
        await invoke('stop_monitor');
        setMonitorStatus('off');
      } catch {
        setMonitorStatus('error');
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
      } catch {
        setMonitorStatus('error');
      }
    }
  }

  async function handleVolumeChange(v: number) {
    setMonitorVolume(v);
    if (monitorStatus === 'on') {
      try { await invoke('set_monitor_volume', { volume: v }); } catch { /* non-fatal */ }
    }
  }

  // ── Tuning control ─────────────────────────────────────────────────────────
  function handleSetAuto() {
    setAutoDetect(true);
    if (lastToneHz > 0) setToneHz(Math.round(lastToneHz));
  }

  function handleSetManual() {
    setAutoDetect(false);
  }

  function handleWaterfallTune(hz: number) {
    setToneHz(hz);
    setAutoDetect(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const inputDevices =
    devices.status === 'ready' ? devices.devices : [];
  const selectedDevice = inputDevices.find((d) => d.id === selectedId);

  // Mean confidence of the last settled line.
  const lastConfidence = (() => {
    for (const l of copyLines) {
      if (!l.divider && l.status === 'settled' && l.confidence != null) return l.confidence;
    }
    return 0;
  })();

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--card)',
        overflow: 'hidden',
      }}
    >
      <TitleBar themeOverride={themeOverride} onThemeChange={handleThemeChange} />

      <Toolbar
        devices={inputDevices}
        selectedId={selectedId}
        onDeviceChange={setSelectedId}
        running={running}
        monitorStatus={monitorStatus}
        monitorVolume={monitorVolume}
        onMonitorToggle={() => void handleMonitorToggle()}
        onVolumeChange={(v) => void handleVolumeChange(v)}
        toneHz={autoDetect && lastToneHz > 0 ? lastToneHz : toneHz}
        autoDetect={autoDetect}
        onSetAuto={handleSetAuto}
        onSetManual={handleSetManual}
        onStart={() => void handleStart()}
        onStop={() => void handleStop()}
      />

      {/* Body: waterfall | copy sheet */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <WaterfallPanel
          spectrumBins={spectrumBins}
          detectedSignals={detectedSignals}
          toneHz={autoDetect && lastToneHz > 0 ? lastToneHz : toneHz}
          autoDetect={autoDetect}
          colormap={colormap}
          running={running}
          onColormapChange={setColormap}
          onTune={handleWaterfallTune}
          envelopeBars={envelopeBars}
        />

        <CopySheet
          lines={copyLines}
          onClear={() => setCopyLines([])}
        />
      </div>

      <StatusBar
        running={running}
        deviceName={selectedDevice?.name ?? ''}
        toneHz={autoDetect && lastToneHz > 0 ? lastToneHz : toneHz}
        autoDetect={autoDetect}
        confidence={lastConfidence}
      />
    </div>
  );
}

export default App;
