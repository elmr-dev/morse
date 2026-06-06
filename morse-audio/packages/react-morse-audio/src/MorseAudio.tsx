import { forwardRef, useImperativeHandle } from 'react';
import {
  DEFAULT_FREQUENCY,
  DEFAULT_PRE_DELAY,
  DEFAULT_POST_DELAY,
} from 'morse-audio';
import type { MorseAudioProps, MorseAudioRef } from './types';
import { useMorseAudio } from './useMorseAudio';

/**
 * React component for playing morse code audio
 *
 * @example
 * ```tsx
 * // Basic usage - auto-plays when text changes
 * <MorseAudio
 *   text="CQ CQ CQ"
 *   wpm={20}
 *   onComplete={() => console.log('Done!')}
 * />
 *
 * // With ref for programmatic control
 * const morseRef = useRef<MorseAudioRef>(null);
 *
 * <MorseAudio
 *   ref={morseRef}
 *   text="Hello World"
 *   wpm={25}
 *   autoPlay={false}
 * />
 *
 * <button onClick={() => morseRef.current?.play()}>Play</button>
 * ```
 */
export const MorseAudio = forwardRef<MorseAudioRef, MorseAudioProps>(
  function MorseAudio(props, ref) {
    const {
      text,
      wpm,
      fwpm,
      frequency = DEFAULT_FREQUENCY,
      preDelay = DEFAULT_PRE_DELAY,
      postDelay = DEFAULT_POST_DELAY,
      radioEffects,
      autoPlay = true,
      onPlay,
      onComplete,
      onError,
      onStatusChange,
    } = props;

    const { play, stop, replay, status, duration } = useMorseAudio({
      text,
      wpm,
      fwpm,
      frequency,
      preDelay,
      postDelay,
      radioEffects,
      autoPlay,
      onPlay,
      onComplete,
      onError,
      onStatusChange,
    });

    // Expose imperative API via ref
    useImperativeHandle(ref, () => ({
      play,
      stop,
      replay,
      status,
      duration,
    }), [play, stop, replay, status, duration]);

    // This component renders nothing visible
    return null;
  }
);
