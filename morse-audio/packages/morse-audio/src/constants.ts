/**
 * Default values and validation constants for morse audio settings
 */

// WPM (Words Per Minute) constraints
export const MIN_WPM = 5;
export const MAX_WPM = 60;
export const DEFAULT_WPM = 20;

// Frequency constraints (Hz)
export const MIN_FREQUENCY = 400;
export const MAX_FREQUENCY = 900;
export const DEFAULT_FREQUENCY = 700;

// Pre-delay constraints (ms) - helps with Bluetooth audio fade-in
export const MIN_PRE_DELAY = 100;
export const MAX_PRE_DELAY = 2000;
export const DEFAULT_PRE_DELAY = 300;

// Post-delay constraints (ms) - prevents end clipping on some browsers
export const MIN_POST_DELAY = 0;
export const MAX_POST_DELAY = 1000;
export const DEFAULT_POST_DELAY = 100;

// Audio generation settings
export const RAMP_DURATION = 10; // ms, for smooth audio transitions
export const MIN_RAMP_DURATION = 3; // ms, for ML training
export const MAX_RAMP_DURATION = 8; // ms, for ML training

// QRN (atmospheric noise) constraints - SNR in dB
export const MIN_SNR = -6; // Extremely noisy (noise louder than signal)
export const MAX_SNR = 40; // Very clean
export const DEFAULT_SNR = 20;

// ML training SNR range (wider than normal for challenging samples)
export const MIN_ML_SNR = -15; // Very challenging noise floor
export const MAX_ML_SNR = 20; // Clean but not pristine

// QSB (fading) constraints
export const MIN_FADE_DEPTH = 0;
export const MAX_FADE_DEPTH = 0.9;
export const DEFAULT_FADE_DEPTH = 0.5;

export const MIN_FADE_RATE = 0.05; // 20 sec period
export const MAX_FADE_RATE = 2.0; // 0.5 sec period
export const DEFAULT_FADE_RATE = 0.2; // 5 sec period

// Pileup constants

// Rayleigh fading constraints
export const MIN_RAYLEIGH_BANDWIDTH = 0.1; // Hz (very slow fading)
export const MAX_RAYLEIGH_BANDWIDTH = 2.0; // Hz (fast fading)
export const DEFAULT_RAYLEIGH_BANDWIDTH = 0.5;
export const MIN_RAYLEIGH_DEPTH = 0;
export const MAX_RAYLEIGH_DEPTH = 1;
export const DEFAULT_RAYLEIGH_DEPTH = 0.7;

// Flutter constraints
export const MIN_FLUTTER_RATE = 10; // Hz
export const MAX_FLUTTER_RATE = 30; // Hz
export const DEFAULT_FLUTTER_RATE = 15;
export const MIN_FLUTTER_DEPTH = 0;
export const MAX_FLUTTER_DEPTH = 1;
export const DEFAULT_FLUTTER_DEPTH = 0.5;

// Chirp constraints
export const MIN_CHIRP_DEVIATION = 5; // Hz
export const MAX_CHIRP_DEVIATION = 30; // Hz
export const DEFAULT_CHIRP_DEVIATION = 20;
export const MIN_CHIRP_TIME_CONSTANT = 10; // ms
export const MAX_CHIRP_TIME_CONSTANT = 10; // ms (tightened for ML training)
export const DEFAULT_CHIRP_TIME_CONSTANT = 10;

// Buzz constraints
export const MIN_BUZZ_AMPLITUDE = 0;
export const MAX_BUZZ_AMPLITUDE = 0.3;
export const DEFAULT_BUZZ_AMPLITUDE = 0.1;

// Bandwidth filter constraints
export const MIN_BANDWIDTH = 100; // Hz
export const MAX_BANDWIDTH = 2400; // Hz
export const DEFAULT_BANDWIDTH = 500; // Hz
export const BANDWIDTH_STEP = 50; // Hz (common receiver increment)

// Station constraints
export const MAX_STATIONS = 8;
export const MIN_FREQUENCY_OFFSET = -500; // Hz
export const MAX_FREQUENCY_OFFSET = 500; // Hz
export const MIN_SIGNAL_STRENGTH = -30; // dB relative to S9
export const MAX_SIGNAL_STRENGTH = 20; // dB relative to S9
export const DEFAULT_SIGNAL_STRENGTH = 0; // S9

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Validate and normalize WPM value
 */
export function validateWpm(wpm: number): number {
  return clamp(Math.round(wpm), MIN_WPM, MAX_WPM);
}

/**
 * Validate and normalize frequency value
 */
export function validateFrequency(frequency: number): number {
  return clamp(Math.round(frequency), MIN_FREQUENCY, MAX_FREQUENCY);
}

/**
 * Validate and normalize pre-delay value
 */
export function validatePreDelay(preDelay: number): number {
  return clamp(Math.round(preDelay), MIN_PRE_DELAY, MAX_PRE_DELAY);
}

/**
 * Validate and normalize post-delay value
 */
export function validatePostDelay(postDelay: number): number {
  return clamp(Math.round(postDelay), MIN_POST_DELAY, MAX_POST_DELAY);
}

/**
 * Validate fwpm ensuring it doesn't exceed wpm
 */
export function validateFwpm(fwpm: number, wpm: number): number {
  const validatedFwpm = validateWpm(fwpm);
  return Math.min(validatedFwpm, wpm);
}

/**
 * Validate and normalize SNR value for QRN
 */
export function validateSnr(snr: number): number {
  return clamp(snr, MIN_SNR, MAX_SNR);
}

/**
 * Validate and normalize fade depth for QSB
 */
export function validateFadeDepth(depth: number): number {
  return clamp(depth, MIN_FADE_DEPTH, MAX_FADE_DEPTH);
}

/**
 * Validate and normalize fade rate for QSB
 */
export function validateFadeRate(rate: number): number {
  return clamp(rate, MIN_FADE_RATE, MAX_FADE_RATE);
}

/**
 * Validate and normalize Rayleigh fading bandwidth
 */
export function validateRayleighBandwidth(bandwidth: number): number {
  return clamp(bandwidth, MIN_RAYLEIGH_BANDWIDTH, MAX_RAYLEIGH_BANDWIDTH);
}

/**
 * Validate and normalize Rayleigh fading depth
 */
export function validateRayleighDepth(depth: number): number {
  return clamp(depth, MIN_RAYLEIGH_DEPTH, MAX_RAYLEIGH_DEPTH);
}

/**
 * Validate and normalize flutter rate
 */
export function validateFlutterRate(rate: number): number {
  return clamp(rate, MIN_FLUTTER_RATE, MAX_FLUTTER_RATE);
}

/**
 * Validate and normalize flutter depth
 */
export function validateFlutterDepth(depth: number): number {
  return clamp(depth, MIN_FLUTTER_DEPTH, MAX_FLUTTER_DEPTH);
}

/**
 * Validate and normalize chirp deviation
 */
export function validateChirpDeviation(deviation: number): number {
  return clamp(deviation, MIN_CHIRP_DEVIATION, MAX_CHIRP_DEVIATION);
}

/**
 * Validate and normalize chirp time constant
 */
export function validateChirpTimeConstant(timeConstant: number): number {
  return clamp(timeConstant, MIN_CHIRP_TIME_CONSTANT, MAX_CHIRP_TIME_CONSTANT);
}

/**
 * Validate and normalize buzz amplitude
 */
export function validateBuzzAmplitude(amplitude: number): number {
  return clamp(amplitude, MIN_BUZZ_AMPLITUDE, MAX_BUZZ_AMPLITUDE);
}

/**
 * Validate and normalize receiver bandwidth
 */
export function validateBandwidth(bandwidth: number): number {
  // Round to nearest BANDWIDTH_STEP
  const rounded = Math.round(bandwidth / BANDWIDTH_STEP) * BANDWIDTH_STEP;
  return clamp(rounded, MIN_BANDWIDTH, MAX_BANDWIDTH);
}

/**
 * Validate and normalize frequency offset
 */
export function validateFrequencyOffset(offset: number): number {
  return clamp(offset, MIN_FREQUENCY_OFFSET, MAX_FREQUENCY_OFFSET);
}

/**
 * Validate and normalize signal strength
 */
export function validateSignalStrength(strength: number): number {
  return clamp(strength, MIN_SIGNAL_STRENGTH, MAX_SIGNAL_STRENGTH);
}
