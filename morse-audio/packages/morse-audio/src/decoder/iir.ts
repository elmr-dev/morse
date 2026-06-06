/**
 * Butterworth IIR filter design and filtering.
 *
 * Design approach:
 *   - LP: analog Butterworth prototype poles scaled by pre-warped cutoff → bilinear transform
 *   - BP: LP→BP frequency transformation → bilinear transform
 * SOS sections stored as [b0, b1, b2, a1, a2] (a0=1, normalized).
 */

/** Second-order section: [b0, b1, b2, a1, a2] with a0=1 (normalized). */
export type SOS = [number, number, number, number, number];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute analog Butterworth LP prototype poles (left half-plane).
 * Standard convention: s_k = exp(j*(π/2 + π*(2k-1)/(2N))), k=1..N
 * Returned as array of [re, im] pairs.
 */
function analogButterworthPoles(N: number): Array<[number, number]> {
  const poles: Array<[number, number]> = [];
  for (let k = 1; k <= N; k++) {
    const theta = Math.PI / 2 + (Math.PI * (2 * k - 1)) / (2 * N);
    poles.push([Math.cos(theta), Math.sin(theta)]);
  }
  return poles;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Design a Butterworth lowpass filter.
 * Returns SOS sections (each [b0, b1, b2, a1, a2], a0=1).
 */
export function butterworthLowpass(
  order: number,
  cutoffHz: number,
  sampleRateHz: number,
): SOS[] {
  // Pre-warp cutoff: Omega = 2*tan(wc/2) where wc = 2π*fc/fs
  const wc = (2 * Math.PI * cutoffHz) / sampleRateHz;
  const Omega = 2 * Math.tan(wc / 2);

  const N = order;
  const analogPoles = analogButterworthPoles(N);

  // Scale prototype poles by Omega
  const scaledPoles = analogPoles.map(([re, im]) => [Omega * re, Omega * im] as [number, number]);

  const sections: SOS[] = [];
  const processed = new Set<number>();

  for (let k = 0; k < N; k++) {
    if (processed.has(k)) continue;
    const [re, im] = scaledPoles[k];

    if (Math.abs(im) < 1e-10) {
      // Real pole at s = re (negative real)
      // H(s) = -re/(s-re), BLT: s = 2*(z-1)/(z+1)
      // H(z) = -re*(z+1) / (2*(z-1) - re*(z+1))
      //      = (-re/den0) * (1 + z^-1) / (1 + (den1/den0)*z^-1)
      processed.add(k);
      const den0 = 2 - re;
      const den1 = -2 - re;
      const num  = -re;
      const inv  = 1 / den0;
      sections.push([num * inv, num * inv, 0, den1 * inv, 0]);
    } else {
      // Find conjugate partner (same re, negated im)
      let partner = -1;
      for (let j = k + 1; j < N; j++) {
        if (!processed.has(j)) {
          const [re2, im2] = scaledPoles[j];
          if (Math.abs(re2 - re) < 1e-10 && Math.abs(im2 + im) < 1e-10) {
            partner = j;
            break;
          }
        }
      }
      processed.add(k);
      if (partner >= 0) processed.add(partner);

      // Conjugate pair at (re ± j*im)
      // Analog denom: s² - 2*re*s + (re²+im²)
      // After BLT s=2*(z-1)/(z+1):
      //   c0*z² + c1*z + c2 = (4-4*re+mag2)*z² + (-8+2*mag2)*z + (4+4*re+mag2)
      // LP numerator = mag2*(z+1)² (gives unity DC gain)
      const mag2 = re * re + im * im;
      const c0 =  4 - 4 * re + mag2;
      const c1 = -8 + 2 * mag2;
      const c2 =  4 + 4 * re + mag2;
      const inv = 1 / c0;
      sections.push([
        mag2 * inv,
        2 * mag2 * inv,
        mag2 * inv,
        c1 * inv,
        c2 * inv,
      ]);
    }
  }

  return sections;
}

/**
 * Design a Butterworth bandpass filter.
 * The BP order is 2*order (LP→BP doubles the order).
 * Returns SOS sections.
 */
export function butterworthBandpass(
  order: number,
  centerHz: number,
  halfBwHz: number,
  sampleRateHz: number,
): SOS[] {
  // Pre-warp the band edges to analog
  const wlo = (2 * Math.PI * (centerHz - halfBwHz)) / sampleRateHz;
  const whi = (2 * Math.PI * (centerHz + halfBwHz)) / sampleRateHz;

  // Pre-warped analog frequencies
  const Omlo = 2 * Math.tan(Math.max(wlo, 1e-6) / 2);
  const Omhi = 2 * Math.tan(Math.min(whi, Math.PI - 1e-6) / 2);
  const Bw   = Omhi - Omlo;
  // Center frequency from warped edges (geometric mean)
  const Om0w = Math.sqrt(Omlo * Omhi);

  // Butterworth LP prototype poles (unit cutoff)
  const N = order;
  const analogPoles = analogButterworthPoles(N);

  // LP → BP transformation: each LP pole s_k maps to two BP poles via
  // s_bp = (Bw/2)*s_k ± sqrt((Bw/2)²*s_k² - Om0w²)
  // (quadratic formula for the LP-to-BP frequency transformation)
  const sections: SOS[] = [];

  for (const [lpRe, lpIm] of analogPoles) {
    // For complex conjugate LP pole pairs, only process the upper half-plane pole
    // (lpIm > 0). The lower half-plane conjugate produces identical SOS sections
    // (buildBP2 only depends on pRe and pRe²+pIm², not the sign of pIm), so
    // iterating over all N poles would apply each section twice.
    if (lpIm <= 0) continue;

    // Scaled: s_k_scaled = s_k * Bw/2
    const halfBw = Bw / 2;
    const srRe = lpRe * halfBw;
    const srIm = lpIm * halfBw;

    // Discriminant: (halfBw*s_k)² - Om0w²
    // = srRe² - srIm² - Om0w²  + j*(2*srRe*srIm)
    const discRe = srRe * srRe - srIm * srIm - Om0w * Om0w;
    const discIm = 2 * srRe * srIm;

    // sqrt of complex discriminant
    const discMag = Math.sqrt(discRe * discRe + discIm * discIm);
    const discArg = Math.atan2(discIm, discRe);
    const sqrtRe  = Math.sqrt(discMag) * Math.cos(discArg / 2);
    const sqrtIm  = Math.sqrt(discMag) * Math.sin(discArg / 2);

    // Two BP poles: s_bp = srRe ± sqrtRe + j*(srIm ± sqrtIm)
    const bp1Re = srRe + sqrtRe;
    const bp1Im = srIm + sqrtIm;
    const bp2Re = srRe - sqrtRe;
    const bp2Im = srIm - sqrtIm;

    // Now apply BLT to each pair of BP poles
    // For each BP pole (and its conjugate), build a 2nd-order section
    // BLT of one BP pole (complex) with its conjugate gives a 4th-order section,
    // but we factorize into two 2nd-order sections by pairing bp1 with conj(bp1)
    // and bp2 with conj(bp2).

    // BP pole 1: (bp1Re + j*bp1Im) and its conjugate (bp1Re - j*bp1Im)
    // BLT: z = (1 + s/2)/(1 - s/2)  (with digital s)
    // For BLT of analog BP pole pair (pRe ± j*pIm):
    // Analog denom: (s - pRe - j*pIm)(s - pRe + j*pIm) = s² - 2*pRe*s + (pRe²+pIm²)
    // After BLT s = 2*(z-1)/(z+1):
    const buildBP2 = (pRe: number, pIm: number): SOS => {
      const mag2 = pRe * pRe + pIm * pIm;
      const c0 =  4 - 4 * pRe + mag2;
      const c1 = -8 + 2 * mag2;
      const c2 =  4 + 4 * pRe + mag2;
      // BP numerator: gain at center → bp numerator is Bw*s (from LP→BP), but
      // for 2nd-order BLT section of bandpass, the numerator is 1-z^-2 (bandpass shape)
      // Derivation: LP num = 1, LP→BP gives s → (s²+Om0²)/(Bw*s)
      // So the BLT numerator for the BP section is (z-1)²  after bilinear transform
      // → coefficients: [1, 0, -1] times Bw/2 ... let's compute gain correction.
      // Numerator after BLT of Bw/(s + pLP): for bandpass, num = Bw*(z-1)*(z+1)...
      // Actually for standard LP→BP transform, each LP pole s_k generates a 2nd order
      // BP section where numerator is Bw*s (before BLT), which after BLT is:
      // Bw * 2*(z-1)/(z+1) = Bw*2*(1 - z^-1) / (1 + z^-1)
      // But we already divided out (z+1) when building the biquad...
      // The cleanest approach: normalize so DC and Nyquist gain = 0, peak gain near center.
      // For BP biquad, standard numerator is [1, 0, -1] (bandpass shape).
      const inv = 1 / c0;
      // Bw factor for numerator scaling to achieve unity gain at resonance
      const numScale = Bw; // contributes Bw to numerator
      return [
        numScale * inv,
        0,
        -numScale * inv,
        c1 * inv,
        c2 * inv,
      ];
    };

    sections.push(buildBP2(bp1Re, bp1Im));
    sections.push(buildBP2(bp2Re, bp2Im));
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Apply SOS filter (causal forward pass).
 * Uses direct form II transposed structure.
 * Each section: [b0, b1, b2, a1, a2], a0=1.
 */
export function sosfilt(sos: SOS[], signal: Float64Array): Float64Array {
  const n = signal.length;
  const out = new Float64Array(n);
  // Copy input to output, then apply each section in-place
  for (let i = 0; i < n; i++) out[i] = signal[i];

  const z = new Float64Array(sos.length * 2); // delay line per section

  for (let si = 0; si < sos.length; si++) {
    const [b0, b1, b2, a1, a2] = sos[si];
    const zi = si * 2;
    let z1 = z[zi];
    let z2 = z[zi + 1];

    for (let i = 0; i < n; i++) {
      const x = out[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      out[i] = y;
    }

    z[zi]     = z1;
    z[zi + 1] = z2;
  }

  return out;
}

/**
 * Apply SOS filter zero-phase (forward + backward pass).
 * Pads signal with reflected edges to reduce startup transients (like scipy filtfilt).
 */
export function sosfiltfilt(sos: SOS[], signal: Float64Array): Float64Array {
  if (signal.length === 0) return new Float64Array(0);

  const n = signal.length;
  // Pad length: 3 * max filter order (similar to scipy's padlen heuristic)
  const padLen = Math.min(3 * sos.length * 2, n - 1);

  if (padLen <= 0 || n <= 1) {
    // No padding possible, just do forward+backward without padding
    const fwd = sosfilt(sos, signal);
    const rev = new Float64Array(n);
    for (let i = 0; i < n; i++) rev[i] = fwd[n - 1 - i];
    const bwd = sosfilt(sos, rev);
    const result = new Float64Array(n);
    for (let i = 0; i < n; i++) result[i] = bwd[n - 1 - i];
    return result;
  }

  // Build padded signal with reflected edges
  const paddedLen = n + 2 * padLen;
  const padded = new Float64Array(paddedLen);

  // Left pad: reflect around signal[0]
  for (let i = 0; i < padLen; i++) {
    const srcIdx = Math.min(padLen - i, n - 1);
    padded[i] = 2 * signal[0] - signal[srcIdx];
  }
  // Copy original
  for (let i = 0; i < n; i++) {
    padded[padLen + i] = signal[i];
  }
  // Right pad: reflect around signal[n-1]
  for (let i = 0; i < padLen; i++) {
    const srcIdx = Math.max(n - 2 - i, 0);
    padded[padLen + n + i] = 2 * signal[n - 1] - signal[srcIdx];
  }

  // Forward pass
  const fwd = sosfilt(sos, padded);

  // Reverse
  const rev = new Float64Array(paddedLen);
  for (let i = 0; i < paddedLen; i++) rev[i] = fwd[paddedLen - 1 - i];

  // Backward pass
  const bwd = sosfilt(sos, rev);

  // Extract and reverse back
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = bwd[paddedLen - 1 - (padLen + i)];
  }
  return result;
}
