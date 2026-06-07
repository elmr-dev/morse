import type { RadioEffectsOptions } from 'morse-audio';

/**
 * Playback status states
 */
export type MorsePlaybackStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'completed'
  | 'error';

/**
 * Props for the MorseAudio component
 */
export interface MorseAudioProps {
  /** The text to convert to morse code */
  text: string;
  /** Words per minute for character speed */
  wpm: number;
  /** Farnsworth WPM for spacing between characters (defaults to wpm) */
  fwpm?: number;
  /** Audio frequency in Hz (default: 700) */
  frequency?: number;
  /** Delay before playback in ms, helps with Bluetooth audio (default: 300) */
  preDelay?: number;
  /** Delay after playback in ms, prevents clipping on some browsers (default: 100) */
  postDelay?: number;
  /** Radio effects simulation (QRN noise, QSB fading) - off by default */
  radioEffects?: RadioEffectsOptions;
  /** Whether to auto-play when text changes (default: true) */
  autoPlay?: boolean;
  /** Called when playback starts */
  onPlay?: () => void;
  /** Called when playback completes */
  onComplete?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when status changes */
  onStatusChange?: (status: MorsePlaybackStatus) => void;
}

/**
 * Ref handle for imperative control of MorseAudio
 */
export interface MorseAudioRef {
  /** Start playing the morse audio */
  play: () => void;
  /** Stop playback */
  stop: () => void;
  /** Replay from the beginning */
  replay: () => void;
  /** Current playback status */
  status: MorsePlaybackStatus;
  /** Duration of the audio in seconds, null if not loaded */
  duration: number | null;
}

/**
 * Options for the useMorseAudio hook
 */
export interface UseMorseAudioOptions {
  /** The text to convert to morse code */
  text: string;
  /** Words per minute for character speed */
  wpm: number;
  /** Farnsworth WPM for spacing between characters (defaults to wpm) */
  fwpm?: number;
  /** Audio frequency in Hz (default: 700) */
  frequency?: number;
  /** Delay before playback in ms (default: 300) */
  preDelay?: number;
  /** Delay after playback in ms (default: 100) */
  postDelay?: number;
  /** Radio effects simulation (QRN noise, QSB fading) - off by default */
  radioEffects?: RadioEffectsOptions;
  /** Whether to auto-play when text changes (default: false for hook) */
  autoPlay?: boolean;
  /** Called when playback starts */
  onPlay?: () => void;
  /** Called when playback completes */
  onComplete?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when status changes */
  onStatusChange?: (status: MorsePlaybackStatus) => void;
}

/**
 * Return value from useMorseAudio hook
 */
export interface UseMorseAudioReturn {
  /** Start playing the morse audio */
  play: () => void;
  /** Stop playback */
  stop: () => void;
  /** Replay from the beginning */
  replay: () => void;
  /** Current playback status */
  status: MorsePlaybackStatus;
  /** Duration of the audio in seconds, null if not loaded */
  duration: number | null;
}
