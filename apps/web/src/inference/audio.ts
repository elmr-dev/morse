// Decode a WAV data URI (from morse-audio) to mono Float32 audio at 8000 Hz.

import { DSP_SAMPLE_RATE } from './dsp';

export async function dataUriToMonoFloat32(
  dataUri: string,
  targetSampleRate: number = DSP_SAMPLE_RATE
): Promise<Float32Array> {
  const resp = await fetch(dataUri);
  const buf = await resp.arrayBuffer();
  return arrayBufferToMonoFloat32(buf, targetSampleRate);
}

export async function arrayBufferToMonoFloat32(
  buf: ArrayBuffer,
  targetSampleRate: number
): Promise<Float32Array> {
  // Decode once in a native-rate AudioContext to parse the WAV, then render
  // into an OfflineAudioContext at the target sample rate (handles resampling + mono mix).
  const win = window as Window & {
    webkitAudioContext?: typeof AudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const AC = win.webkitAudioContext ?? AudioContext;
  const tmp = new AC();
  const decoded = await tmp.decodeAudioData(buf.slice(0));
  await tmp.close();

  const frames = Math.ceil(decoded.duration * targetSampleRate);
  const OAC = win.webkitOfflineAudioContext ?? OfflineAudioContext;
  const off = new OAC(1, frames, targetSampleRate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice(); // copy out of the internal buffer
}
