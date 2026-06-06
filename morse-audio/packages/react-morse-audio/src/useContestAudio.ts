import { useCallback, useEffect, useRef, useState } from 'react';
import { createContestAudioEngine } from 'morse-audio';
import type {
  IContestAudioEngine,
  ContestEngineOptions,
  ContestEngineStatus,
  PlayStationOptions,
  PlaySidetoneOptions,
  ActiveStation,
  QrnOptions,
} from 'morse-audio';

/**
 * Options for the useContestAudio hook
 */
export interface UseContestAudioOptions {
  /** Audio sample rate (default: 44100) */
  sampleRate?: number;
  /** Initial QRN (noise) settings */
  qrn?: QrnOptions;
  /** Receiver bandwidth in Hz (default: 500) */
  bandwidth?: number;
  /** Center frequency of the receiver in Hz (default: 700) */
  centerFrequency?: number;
  /** Sidetone frequency in Hz (default: 700) */
  sidetoneFrequency?: number;
  /** Sidetone volume 0-1 (default: 0.8) */
  sidetoneVolume?: number;
  /** Receiver volume 0-1 (default: 0.5) */
  receiverVolume?: number;
  /** Called when engine status changes */
  onStatusChange?: (status: ContestEngineStatus) => void;
  /** Called when a station transmission completes */
  onStationComplete?: (id: string) => void;
  /** Called when sidetone playback completes */
  onSidetoneComplete?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
}

/**
 * Return value from useContestAudio hook
 */
export interface UseContestAudioReturn {
  /** Current engine status */
  status: ContestEngineStatus;
  /** Whether the engine is running */
  isRunning: boolean;
  /** Start the audio engine */
  start: () => Promise<void>;
  /** Stop the audio engine */
  stop: () => void;
  /** Set QRN (noise) options, or null to disable */
  setQRN: (options: QrnOptions | null) => void;
  /** Set receiver bandwidth in Hz */
  setBandwidth: (hz: number) => void;
  /** Set receiver center frequency in Hz */
  setCenterFrequency: (hz: number) => void;
  /** Set receiver volume 0-1 */
  setReceiverVolume: (volume: number) => void;
  /** Set sidetone frequency in Hz */
  setSidetoneFrequency: (hz: number) => void;
  /** Set sidetone volume 0-1 */
  setSidetoneVolume: (volume: number) => void;
  /** Play a station through the receiver */
  playStation: (options: PlayStationOptions) => Promise<string>;
  /** Play local sidetone (clean, no noise) */
  playSidetone: (options: PlaySidetoneOptions) => Promise<void>;
  /** Stop a specific station */
  stopStation: (id: string) => void;
  /** Stop sidetone playback */
  stopSidetone: () => void;
  /** Stop all stations */
  stopAllStations: () => void;
  /** Get currently active stations */
  activeStations: ActiveStation[];
  /** Whether sidetone is currently playing */
  isSending: boolean;
}

/**
 * React hook for managing contest audio simulation
 *
 * Provides real-time audio streaming with:
 * - Continuous QRN (band noise/static)
 * - Dynamic station injection with effects
 * - Clean local sidetone playback
 *
 * @example
 * ```tsx
 * const {
 *   start,
 *   stop,
 *   isRunning,
 *   playStation,
 *   playSidetone,
 *   setQRN,
 * } = useContestAudio({
 *   qrn: { snr: 15 },
 *   bandwidth: 500,
 *   onStationComplete: (id) => console.log('Station completed:', id),
 * });
 *
 * // Start the engine
 * await start();
 *
 * // Enable noise
 * setQRN({ snr: 10 });
 *
 * // Play a station through the receiver
 * await playStation({
 *   text: 'W1ABC',
 *   wpm: 25,
 *   frequencyOffset: -100,
 *   signalStrength: -6,
 * });
 *
 * // Play your own sidetone (clean, loud)
 * await playSidetone({
 *   text: 'W1?',
 *   wpm: 25,
 * });
 * ```
 */
export function useContestAudio(options: UseContestAudioOptions = {}): UseContestAudioReturn {
  const {
    sampleRate,
    qrn,
    bandwidth,
    centerFrequency,
    sidetoneFrequency,
    sidetoneVolume,
    receiverVolume,
    onStatusChange,
    onStationComplete,
    onSidetoneComplete,
    onError,
  } = options;

  const [status, setStatus] = useState<ContestEngineStatus>('stopped');
  const [activeStations, setActiveStations] = useState<ActiveStation[]>([]);
  const [isSending, setIsSending] = useState(false);

  const engineRef = useRef<IContestAudioEngine | null>(null);
  const callbacksRef = useRef({
    onStatusChange,
    onStationComplete,
    onSidetoneComplete,
    onError,
  });

  // Update callbacks ref
  useEffect(() => {
    callbacksRef.current = {
      onStatusChange,
      onStationComplete,
      onSidetoneComplete,
      onError,
    };
  }, [onStatusChange, onStationComplete, onSidetoneComplete, onError]);

  // Initialize engine
  useEffect(() => {
    const engineOptions: ContestEngineOptions = {
      sampleRate,
      qrn,
      bandwidth,
      centerFrequency,
      sidetoneFrequency,
      sidetoneVolume,
      receiverVolume,
    };

    const engine = createContestAudioEngine(engineOptions);

    engine.setCallbacks({
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
        callbacksRef.current.onStatusChange?.(newStatus);
      },
      onStationComplete: (id) => {
        setActiveStations(engine.getActiveStations());
        callbacksRef.current.onStationComplete?.(id);
      },
      onSidetoneComplete: () => {
        setIsSending(false);
        callbacksRef.current.onSidetoneComplete?.();
      },
      onError: (error) => {
        callbacksRef.current.onError?.(error);
      },
    });

    engineRef.current = engine;

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [sampleRate, bandwidth, centerFrequency, sidetoneFrequency, sidetoneVolume, receiverVolume]);

  // Update QRN when it changes
  useEffect(() => {
    if (engineRef.current && status === 'running') {
      engineRef.current.setQRN(qrn ?? null);
    }
  }, [qrn, status]);

  const start = useCallback(async () => {
    if (engineRef.current) {
      await engineRef.current.start();
    }
  }, []);

  const stop = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop();
      setActiveStations([]);
      setIsSending(false);
    }
  }, []);

  const setQRN = useCallback((qrnOptions: QrnOptions | null) => {
    if (engineRef.current) {
      engineRef.current.setQRN(qrnOptions);
    }
  }, []);

  const setBandwidth = useCallback((hz: number) => {
    if (engineRef.current) {
      engineRef.current.setBandwidth(hz);
    }
  }, []);

  const setCenterFrequency = useCallback((hz: number) => {
    if (engineRef.current) {
      engineRef.current.setCenterFrequency(hz);
    }
  }, []);

  const setReceiverVolume = useCallback((volume: number) => {
    if (engineRef.current) {
      engineRef.current.setReceiverVolume(volume);
    }
  }, []);

  const setSidetoneFrequency = useCallback((hz: number) => {
    if (engineRef.current) {
      engineRef.current.setSidetoneFrequency(hz);
    }
  }, []);

  const setSidetoneVolume = useCallback((volume: number) => {
    if (engineRef.current) {
      engineRef.current.setSidetoneVolume(volume);
    }
  }, []);

  const playStation = useCallback(async (stationOptions: PlayStationOptions): Promise<string> => {
    if (!engineRef.current) {
      throw new Error('Engine not initialized');
    }
    const id = await engineRef.current.playStation(stationOptions);
    setActiveStations(engineRef.current.getActiveStations());
    return id;
  }, []);

  const playSidetone = useCallback(async (sidetoneOptions: PlaySidetoneOptions): Promise<void> => {
    if (!engineRef.current) {
      throw new Error('Engine not initialized');
    }
    setIsSending(true);
    await engineRef.current.playSidetone(sidetoneOptions);
  }, []);

  const stopStation = useCallback((id: string) => {
    if (engineRef.current) {
      engineRef.current.stopStation(id);
      setActiveStations(engineRef.current.getActiveStations());
    }
  }, []);

  const stopSidetone = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stopSidetone();
      setIsSending(false);
    }
  }, []);

  const stopAllStations = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stopAllStations();
      setActiveStations([]);
    }
  }, []);

  return {
    status,
    isRunning: status === 'running',
    start,
    stop,
    setQRN,
    setBandwidth,
    setCenterFrequency,
    setReceiverVolume,
    setSidetoneFrequency,
    setSidetoneVolume,
    playStation,
    playSidetone,
    stopStation,
    stopSidetone,
    stopAllStations,
    activeStations,
    isSending,
  };
}
