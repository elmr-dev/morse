import { useCallback, useEffect, useRef, useState } from 'react';
import {
  generateMorseAudio,
  calculateDuration,
  DEFAULT_FREQUENCY,
  DEFAULT_PRE_DELAY,
  DEFAULT_POST_DELAY,
} from 'morse-audio';
import type { MorsePlaybackStatus, UseMorseAudioOptions, UseMorseAudioReturn } from './types';

/**
 * Hook for programmatic control of morse code audio playback
 *
 * @example
 * ```tsx
 * const { play, stop, status, duration } = useMorseAudio({
 *   text: 'CQ CQ CQ',
 *   wpm: 20,
 *   onComplete: () => console.log('Finished!')
 * });
 *
 * return (
 *   <button onClick={play} disabled={status === 'playing'}>
 *     Play Morse
 *   </button>
 * );
 * ```
 */
export function useMorseAudio(options: UseMorseAudioOptions): UseMorseAudioReturn {
  const {
    text,
    wpm,
    fwpm,
    frequency = DEFAULT_FREQUENCY,
    preDelay = DEFAULT_PRE_DELAY,
    postDelay = DEFAULT_POST_DELAY,
    radioEffects,
    autoPlay = false,
    onPlay,
    onComplete,
    onError,
    onStatusChange,
  } = options;

  const [status, setStatus] = useState<MorsePlaybackStatus>('idle');
  const [duration, setDuration] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previousParamsRef = useRef<string>('');

  // Update status and call callback
  const updateStatus = useCallback((newStatus: MorsePlaybackStatus) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  // Initialize audio element
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    const audio = audioRef.current;

    const handleCanPlayThrough = () => {
      if (status === 'loading') {
        updateStatus('ready');
        if (autoPlay) {
          audio.play().catch((error) => {
            updateStatus('error');
            onError?.(error);
          });
        }
      }
    };

    const handlePlay = () => {
      updateStatus('playing');
      onPlay?.();
    };

    const handleEnded = () => {
      updateStatus('completed');
      onComplete?.();
    };

    const handleError = () => {
      const error = new Error('Audio playback failed');
      updateStatus('error');
      onError?.(error);
    };

    audio.addEventListener('canplaythrough', handleCanPlayThrough);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('canplaythrough', handleCanPlayThrough);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [status, autoPlay, onPlay, onComplete, onError, updateStatus]);

  // Generate audio when parameters change
  useEffect(() => {
    if (!text) {
      updateStatus('idle');
      setDuration(null);
      return;
    }

    // Create a key from all audio-affecting parameters
    const paramsKey = JSON.stringify({
      text,
      wpm,
      fwpm,
      frequency,
      preDelay,
      postDelay,
      radioEffects,
    });

    // Check if we need to regenerate
    const paramsChanged = paramsKey !== previousParamsRef.current;

    if (paramsChanged || status === 'idle') {
      previousParamsRef.current = paramsKey;
      updateStatus('loading');

      try {
        const { dataUri, timings } = generateMorseAudio({
          text,
          wpm,
          fwpm,
          frequency,
          preDelay,
          postDelay,
          radioEffects,
        });

        setDuration(calculateDuration(timings));

        if (audioRef.current) {
          audioRef.current.src = dataUri;
          audioRef.current.load();
        }
      } catch (error) {
        updateStatus('error');
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }, [text, wpm, fwpm, frequency, preDelay, postDelay, radioEffects, onError, updateStatus, status]);

  const play = useCallback(() => {
    if (!audioRef.current || !text) return;

    if (status === 'ready' || status === 'completed') {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((error) => {
        updateStatus('error');
        onError?.(error);
      });
    } else if (status === 'idle') {
      // Trigger generation which will auto-play if autoPlay is true
      previousParamsRef.current = ''; // Force regeneration
      updateStatus('loading');
    }
  }, [text, status, updateStatus, onError]);

  const stop = useCallback(() => {
    if (!audioRef.current) return;

    audioRef.current.pause();
    audioRef.current.currentTime = 0;

    if (status === 'playing') {
      updateStatus('ready');
    }
  }, [status, updateStatus]);

  const replay = useCallback(() => {
    if (!audioRef.current) return;

    audioRef.current.currentTime = 0;
    audioRef.current.play().catch((error) => {
      updateStatus('error');
      onError?.(error);
    });
  }, [updateStatus, onError]);

  return {
    play,
    stop,
    replay,
    status,
    duration,
  };
}
