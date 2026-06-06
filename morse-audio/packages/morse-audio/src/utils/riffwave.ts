/**
 * RIFF WAV encoder - converts audio samples to WAV file bytes
 *
 * Based on public domain code.
 */

const SAMPLE_RATE = 22050;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

/**
 * Convert audio samples to WAV file bytes
 *
 * @param data - Audio samples (Float32Array with values -1 to 1, or number array)
 * @param sampleRate - Sample rate in Hz (default 8000)
 * @returns Array of bytes representing a WAV file
 */
export function getData(data: Float32Array | number[], sampleRate: number = SAMPLE_RATE): number[] {
  const numSamples = data.length;
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const blockAlign = NUM_CHANNELS * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = 36 + dataSize;

  const wav: number[] = [];

  // Helper to write a string as bytes
  const writeString = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      wav.push(s.charCodeAt(i));
    }
  };

  // Helper to write a 32-bit little-endian integer
  const writeUint32 = (n: number) => {
    wav.push(n & 0xff);
    wav.push((n >> 8) & 0xff);
    wav.push((n >> 16) & 0xff);
    wav.push((n >> 24) & 0xff);
  };

  // Helper to write a 16-bit little-endian integer
  const writeUint16 = (n: number) => {
    wav.push(n & 0xff);
    wav.push((n >> 8) & 0xff);
  };

  // RIFF header
  writeString('RIFF');
  writeUint32(fileSize);
  writeString('WAVE');

  // fmt subchunk
  writeString('fmt ');
  writeUint32(16); // Subchunk1Size (16 for PCM)
  writeUint16(1); // AudioFormat (1 = PCM)
  writeUint16(NUM_CHANNELS);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(BITS_PER_SAMPLE);

  // data subchunk
  writeString('data');
  writeUint32(dataSize);

  // Convert samples to 16-bit signed PCM (little-endian)
  for (let i = 0; i < numSamples; i++) {
    // Input is -1 to 1, convert to -32768 to 32767
    const sample = data[i];
    const scaled = Math.round(sample * 32767);
    const clamped = Math.max(-32768, Math.min(32767, scaled));
    // Write as signed 16-bit little-endian
    wav.push(clamped & 0xff);
    wav.push((clamped >> 8) & 0xff);
  }

  return wav;
}

/**
 * Get the MIME type for WAV files
 */
export function getMIMEType(): string {
  return 'audio/wav';
}
