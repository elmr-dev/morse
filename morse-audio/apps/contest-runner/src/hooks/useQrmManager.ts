/**
 * useQrmManager - Manages QRM (interference) from other stations
 *
 * Creates random interfering stations that:
 * - Send QRL?, long CQ, or QSY messages
 * - Appear approximately every 23 seconds when enabled
 * - Have random pitch offsets
 */

import { useCallback, useRef, useEffect } from 'react';
import type { UseContestAudioReturn } from 'react-morse-audio';
import { rndExponential, generatePitchOffset } from 'morse-audio';

// QRM message types
const QRM_MESSAGES = [
  'QRL?',
  'QRL? QRL?',
  'CQ CQ CQ DE {CALL} {CALL} K',
  'CQ TEST {CALL} {CALL}',
  'QSY QSY',
  'UP UP',
  'QRZ? QRZ?',
];

// Fake callsigns for QRM stations
const QRM_CALLSIGNS = [
  'UA3XYZ', 'DL5ABC', 'JA1ABC', 'W1XYZ', 'VE3ABC',
  'G4XYZ', 'PY2ABC', 'LU1XYZ', 'ZS6ABC', 'VK4XYZ',
  'SP5ABC', 'F6XYZ', 'I2ABC', 'OH3XYZ', 'SM5ABC',
];

interface QrmStation {
  id: string;
  call: string;
  message: string;
  wpm: number;
  frequencyOffset: number;
  patienceLeft: number;
}

interface UseQrmManagerOptions {
  enabled: boolean;
  audio: UseContestAudioReturn;
  operatorWpm: number;
}

export function useQrmManager({
  enabled,
  audio,
  operatorWpm,
}: UseQrmManagerOptions) {
  const timerRef = useRef<number | null>(null);
  const activeQrmRef = useRef<QrmStation | null>(null);

  /**
   * Generate a random QRM station
   */
  const generateQrmStation = useCallback((): QrmStation => {
    const call = QRM_CALLSIGNS[Math.floor(Math.random() * QRM_CALLSIGNS.length)];
    let message = QRM_MESSAGES[Math.floor(Math.random() * QRM_MESSAGES.length)];

    // Replace {CALL} placeholder
    message = message.replace(/{CALL}/g, call);

    return {
      id: `qrm-${crypto.randomUUID()}`,
      call,
      message,
      wpm: operatorWpm + Math.floor(Math.random() * 10) - 5, // ±5 WPM
      frequencyOffset: generatePitchOffset(300),
      patienceLeft: 1 + Math.floor(Math.random() * 5), // 1-5 repeats
    };
  }, [operatorWpm]);

  /**
   * Play a QRM station
   */
  const playQrm = useCallback(async () => {
    if (!audio.isRunning) return;

    const station = activeQrmRef.current || generateQrmStation();
    activeQrmRef.current = station;

    try {
      await audio.playStation({
        id: station.id,
        text: station.message,
        wpm: station.wpm,
        frequencyOffset: station.frequencyOffset,
        signalStrength: -8 + Math.random() * 8, // -8 to 0 dBm
      });

      // Decrement patience
      station.patienceLeft--;

      // If patience left, schedule another send
      if (station.patienceLeft > 0) {
        const delay = 2000 + Math.random() * 3000; // 2-5 seconds
        setTimeout(playQrm, delay);
      } else {
        activeQrmRef.current = null;
      }
    } catch {
      // Audio engine stopped
      activeQrmRef.current = null;
    }
  }, [audio, generateQrmStation]);

  /**
   * Schedule next QRM event
   */
  const scheduleNextQrm = useCallback(() => {
    if (!enabled) return;

    // Mean interval of ~23 seconds
    const delay = rndExponential(23000);

    timerRef.current = window.setTimeout(() => {
      if (enabled && audio.isRunning) {
        playQrm();
      }
      scheduleNextQrm();
    }, delay);
  }, [enabled, audio, playQrm]);

  /**
   * Start QRM generation
   */
  const startQrm = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    scheduleNextQrm();
  }, [scheduleNextQrm]);

  /**
   * Stop QRM generation
   */
  const stopQrm = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    activeQrmRef.current = null;
  }, []);

  // Handle enabled state changes
  useEffect(() => {
    if (enabled && audio.isRunning) {
      startQrm();
    } else {
      stopQrm();
    }

    return stopQrm;
  }, [enabled, audio.isRunning, startQrm, stopQrm]);

  return {
    startQrm,
    stopQrm,
    isActive: activeQrmRef.current !== null,
  };
}
