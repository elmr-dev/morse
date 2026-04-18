// Minimal iterative radix-2 Cooley-Tukey FFT.

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if ((n & (n - 1)) !== 0) throw new Error('fft size must be power of 2')

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const theta = (-2 * Math.PI) / size
    const wReStep = Math.cos(theta)
    const wImStep = Math.sin(theta)
    for (let i = 0; i < n; i += size) {
      let wRe = 1, wIm = 0
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k], aIm = im[i + k]
        const bRe = re[i + k + half], bIm = im[i + k + half]
        const tRe = bRe * wRe - bIm * wIm
        const tIm = bRe * wIm + bIm * wRe
        re[i + k] = aRe + tRe
        im[i + k] = aIm + tIm
        re[i + k + half] = aRe - tRe
        im[i + k + half] = aIm - tIm
        const nRe = wRe * wReStep - wIm * wImStep
        wIm = wRe * wImStep + wIm * wReStep
        wRe = nRe
      }
    }
  }
}

export function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // Conjugate, forward FFT, conjugate, divide by n
  for (let i = 0; i < n; i++) im[i] = -im[i]
  fft(re, im)
  const inv = 1 / n
  for (let i = 0; i < n; i++) {
    re[i] *= inv
    im[i] = -im[i] * inv
  }
}
