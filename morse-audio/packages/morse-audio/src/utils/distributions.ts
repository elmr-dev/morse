/**
 * Statistical distribution functions for contest simulation
 *
 * These provide realistic randomization for:
 * - Pileup size (Poisson)
 * - Signal parameters (Gaussian, U-shaped)
 * - Timing intervals (Exponential)
 * - Fading envelopes (Rayleigh)
 */

/**
 * Poisson distribution - for pileup size
 * Returns number of events given an expected mean
 * @param mean Expected number of events (lambda)
 */
export function rndPoisson(mean: number): number {
  // Knuth algorithm for Poisson distribution
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;

  do {
    k++;
    p *= Math.random();
  } while (p > L);

  return k - 1;
}

/**
 * Rayleigh distribution - for signal fading amplitude
 * Models signal fading in radio propagation
 * @param sigma Scale parameter (mode of the distribution)
 */
export function rndRayleigh(sigma: number = 1): number {
  const u = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(1 - u || 0.0001));
}

/**
 * Gaussian (normal) distribution with limits
 * Used for pitch offset, WPM variance, etc.
 * @param mean Mean of the distribution
 * @param stdDev Standard deviation
 * @param minVal Minimum allowed value
 * @param maxVal Maximum allowed value
 */
export function rndGaussLim(
  mean: number,
  stdDev: number,
  minVal: number,
  maxVal: number
): number {
  let result: number;
  do {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
    result = mean + stdDev * z;
  } while (result < minVal || result > maxVal);

  return result;
}

/**
 * Standard Gaussian (normal) distribution
 * @param mean Mean of the distribution
 * @param stdDev Standard deviation
 */
export function rndGauss(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

/**
 * U-shaped (bimodal) distribution
 * Used for signal strength - stations are often either strong or weak
 * @param min Minimum value
 * @param max Maximum value
 * @param depth How "U-shaped" - 0 is uniform, 1 is very U-shaped
 */
export function rndUShaped(min: number, max: number, depth: number = 0.5): number {
  const u = Math.random();
  const range = max - min;

  // Apply U-shape transformation (pushes values toward extremes)
  const t = Math.pow(2 * Math.abs(u - 0.5), 1 - depth);
  const sign = u < 0.5 ? -1 : 1;
  const normalized = 0.5 + sign * t / 2;

  return min + normalized * range;
}

/**
 * Exponential distribution
 * Used for timing intervals (inter-arrival times)
 * @param mean Mean interval
 */
export function rndExponential(mean: number): number {
  return -mean * Math.log(1 - Math.random());
}

// ============================================
// Contest simulation helpers
// ============================================

/**
 * Generate WPM for a caller based on operator WPM
 * MorseRunner uses 50-100% of operator WPM
 * @param operatorWpm The contest operator's WPM setting
 */
export function generateCallerWpm(operatorWpm: number): number {
  const minWpm = Math.floor(operatorWpm * 0.5);
  const maxWpm = operatorWpm;
  const meanWpm = operatorWpm * 0.8;
  const stdDev = operatorWpm * 0.15;

  return Math.round(rndGaussLim(meanWpm, stdDev, minWpm, maxWpm));
}

/**
 * Generate pitch offset for a caller
 * MorseRunner uses ±300 Hz Gaussian
 * @param maxOffset Maximum offset in Hz (default 300)
 */
export function generatePitchOffset(maxOffset: number = 300): number {
  return Math.round(rndGaussLim(0, maxOffset / 2, -maxOffset, maxOffset));
}

/**
 * Generate signal strength with U-shaped distribution
 * Signals are often either strong or weak, rarely medium
 * @param snr Base SNR setting (higher = hearing weaker stations)
 */
export function generateSignalStrength(snr: number = 15): number {
  const baseStrength = rndUShaped(-20, 0, 0.4);
  const adjustment = (snr - 15) / 15 * 5;
  return Math.max(-25, Math.min(0, baseStrength + adjustment));
}

/**
 * Generate send delay for a caller (100-600ms)
 */
export function generateSendDelay(): number {
  return 100 + Math.random() * 500;
}

/**
 * Generate reply timeout (3-6 seconds)
 * @param skill Skill level affects patience
 */
export function generateReplyTimeout(skill: 'low' | 'medium' | 'high' = 'medium'): number {
  switch (skill) {
    case 'high':
      return 3000 + Math.random() * 1000;
    case 'medium':
      return 4000 + Math.random() * 1500;
    case 'low':
      return 5000 + Math.random() * 1000;
  }
}

/**
 * Generate patience (retries) for a caller (3-5)
 */
export function generatePatience(): number {
  return 3 + Math.floor(Math.random() * 3);
}

/**
 * Generate QSB bandwidth
 * Normal: 0.1-0.5 Hz, Flutter: 3-30 Hz
 * @param flutter Whether flutter effect is enabled
 */
export function generateQsbBandwidth(flutter: boolean = false): number {
  if (flutter) {
    return rndGaussLim(15, 8, 3, 30);
  }
  return rndGaussLim(0.3, 0.1, 0.1, 0.5);
}
