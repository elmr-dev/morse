/**
 * QRN (atmospheric noise/static) options
 */
export interface QrnOptions {
  /** Signal-to-noise ratio in dB (3-40, lower = noisier, default: 20) */
  snr?: number;
}

/**
 * QSB (signal fading) options
 */
export interface QsbOptions {
  /** Fade depth: 0-0.9, how much signal fades (default: 0.5) */
  depth?: number;
  /** Fade rate in Hz (0.05-2, default: 0.2 = 5 sec cycle) */
  rate?: number;
}

/**
 * Radio effects simulation options for realistic HF conditions
 */
export interface RadioEffectsOptions {
  /** QRN - Atmospheric noise/static (off by default) */
  qrn?: QrnOptions;
  /** QSB - Signal fading (off by default) */
  qsb?: QsbOptions;
}

/**
 * Options for generating morse code audio
 */
export interface MorseGeneratorOptions {
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
}

/**
 * Result of generating morse code audio
 */
export interface GeneratedMorseAudio {
  /** Base64-encoded WAV data URI ready for playback */
  dataUri: string;
  /** Array of timing values in ms (positive = sound, negative = silence) */
  timings: number[];
  /** Sample rate used for audio generation */
  sampleRate: number;
}
