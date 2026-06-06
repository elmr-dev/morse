/**
 * Types for pileup simulation - multi-station contest audio
 */

/**
 * Rayleigh fading options for realistic HF ionospheric multipath simulation
 */
export interface RayleighFadingOptions {
  /** Fading bandwidth in Hz (0.1-2.0), controls how fast fades occur */
  bandwidth: number;
  /** Fading depth (0-1), how deep the fades go (1 = complete fade) */
  depth: number;
}

/**
 * Flutter options for auroral distortion simulation
 */
export interface FlutterOptions {
  /** Flutter rate in Hz (10-30), speed of amplitude modulation */
  rate: number;
  /** Flutter depth (0-1), intensity of the effect */
  depth: number;
}

/**
 * Chirp options for frequency drift on keying
 */
export interface ChirpOptions {
  /** Frequency deviation in Hz (5-50), how far frequency drifts */
  deviation: number;
  /** Time constant in ms (10-100), how quickly frequency settles */
  timeConstant: number;
}

/**
 * Buzz options for AC hum simulation
 */
export interface BuzzOptions {
  /** AC frequency (50 Hz for Europe/Asia, 60 Hz for Americas) */
  frequency: 50 | 60;
  /** Amplitude of buzz relative to signal (0-0.3) */
  amplitude: number;
}

/**
 * Per-station effects configuration
 */
export interface StationEffectsOptions {
  /** Rayleigh fading (HF propagation) */
  rayleigh?: RayleighFadingOptions;
  /** Flutter (auroral distortion) */
  flutter?: FlutterOptions;
  /** Chirp (frequency drift on keying) */
  chirp?: ChirpOptions;
  /** Buzz (AC hum) */
  buzz?: BuzzOptions;
}

/**
 * Configuration for a single station in a pileup
 */
export interface PileupStation {
  /** Unique identifier for this station */
  id: string;
  /** Callsign or text to send */
  text: string;
  /** Words per minute for character speed */
  wpm: number;
  /** Farnsworth WPM for spacing (defaults to wpm) */
  fwpm?: number;
  /** Frequency offset from receiver center in Hz (-500 to +500) */
  frequencyOffset: number;
  /** Signal strength in dB relative to S9 (-30 to +20) */
  signalStrength: number;
  /** Delay before station starts transmitting in ms */
  startDelay: number;
  /** Per-station effects */
  effects?: StationEffectsOptions;
}

/**
 * Receiver configuration for pileup simulation
 */
export interface PileupReceiverOptions {
  /** Center frequency of the receiver passband in Hz (400-1200, default: 700) */
  centerFrequency: number;
  /** Receiver bandwidth in Hz (100-2400 in 50 Hz steps, default: 500) */
  bandwidth: number;
  /** QRN (atmospheric noise) settings */
  qrn?: {
    /** Signal-to-noise ratio in dB (lower = noisier) */
    snr?: number;
  };
}

/**
 * Options for generating pileup audio
 */
export interface PileupGeneratorOptions {
  /** Array of stations in the pileup (max 8) */
  stations: PileupStation[];
  /** Receiver configuration */
  receiver: PileupReceiverOptions;
  /** Pre-delay before audio starts in ms (default: 300) */
  preDelay?: number;
  /** Post-delay after audio ends in ms (default: 100) */
  postDelay?: number;
}

/**
 * Result of generating pileup audio
 */
export interface GeneratedPileupAudio {
  /** Base64-encoded WAV data URI ready for playback */
  dataUri: string;
  /** Duration in seconds */
  duration: number;
  /** Sample rate used for audio generation */
  sampleRate: number;
  /** Station IDs in order of their start times */
  stationOrder: string[];
}
