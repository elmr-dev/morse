# Streaming Contest Audio Architecture

This document explains the real-time streaming audio system used for contest simulation. It's intended for developers and AI coding agents to understand the architecture, design decisions, and common pitfalls.

## Table of Contents

1. [Overview](#overview)
2. [Web Audio API Fundamentals](#web-audio-api-fundamentals)
3. [Audio Graph Architecture](#audio-graph-architecture)
4. [QRN Worklet Implementation](#qrn-worklet-implementation)
5. [Sample Rate Considerations](#sample-rate-considerations)
6. [Effect Processing Pipeline](#effect-processing-pipeline)
7. [Critical Implementation Details](#critical-implementation-details)
8. [Common Pitfalls](#common-pitfalls)
9. [React Integration](#react-integration)

---

## Overview

The streaming system simulates a real ham radio contest experience:

- **Continuous QRN** (atmospheric noise/static) plays without stopping
- **Pileup stations** can be dynamically injected with realistic HF effects
- **Local sidetone** (your own sending) plays loud and clear over the noise

This differs from the standard `generateMorseAudio()` approach which pre-renders entire audio files as base64 WAV data URIs. The streaming approach uses Web Audio API for real-time synthesis and mixing.

### Why Streaming?

| Aspect | Pre-rendered (WAV) | Streaming (Web Audio) |
|--------|-------------------|----------------------|
| Latency | High (must generate entire file) | Low (instant playback) |
| Continuous audio | Not possible | Yes (QRN runs forever) |
| Dynamic mixing | No | Yes (overlay multiple sources) |
| Memory | Stores full audio | Generates on-demand |
| Browser support | Universal | Modern browsers |

---

## Web Audio API Fundamentals

### AudioContext

The `AudioContext` is the central hub for all Web Audio operations. It:
- Manages the audio processing graph
- Provides timing via `currentTime`
- Controls the destination (speakers)
- Has a sample rate (typically 44100 Hz)

```typescript
const audioContext = new AudioContext({ sampleRate: 44100 });
```

**Important**: AudioContext must be created/resumed after a user gesture (click/tap) due to browser autoplay policies.

### Audio Nodes

Audio flows through a graph of connected nodes:

- **Source nodes**: Generate audio (oscillators, buffers, worklets)
- **Processing nodes**: Modify audio (gain, filters, effects)
- **Destination node**: Output to speakers

### AudioWorklet

`AudioWorklet` runs JavaScript in a separate audio thread, enabling:
- Glitch-free continuous audio generation
- Low-latency custom DSP
- No main thread blocking

This is how we generate continuous QRN without audio dropouts.

---

## Audio Graph Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AudioContext                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐                                               │
│  │  QRN Worklet     │──┐                                            │
│  │  (continuous     │  │                                            │
│  │   noise gen)     │  │    ┌────────────┐                          │
│  └──────────────────┘  │    │            │                          │
│                        ├───▶│  qrnGain   │──┐                       │
│  (worklet output)      │    │            │  │                       │
│                        │    └────────────┘  │                       │
│                                             │    ┌──────────────┐   │
│  ┌──────────────────┐                       │    │              │   │
│  │ Station Buffer   │                       ├───▶│ receiverGain │──┐│
│  │ Source Node      │───────────────────────┘    │   (0.5)      │  ││
│  │ (morse audio)    │                            └──────────────┘  ││
│  └──────────────────┘                                              ││
│                                                                     ││
│                            ┌──────────────┐    ┌──────────────┐    ││
│  ┌──────────────────┐      │              │    │              │    ││
│  │ Sidetone Buffer  │─────▶│ sidetoneGain │───▶│  masterGain  │────┼┤
│  │ Source Node      │      │   (0.8)      │    │    (1.0)     │    ││
│  │ (clean morse)    │      └──────────────┘    └──────────────┘    ││
│  └──────────────────┘                                 │            ││
│                                                       │            ││
│                                                       ▼            ││
│                                              ┌──────────────┐      ││
│                                              │ destination  │◀─────┘│
│                                              │  (speakers)  │       │
│                                              └──────────────┘       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Structure?

1. **QRN through receiverGain**: Noise goes through the "receiver" path so it's mixed with stations at appropriate levels.

2. **Sidetone bypasses receiver**: Your own sending doesn't go through the receiver - it's a local oscillator. This is why sidetone is clean and loud while stations have noise.

3. **Separate gain nodes**: Allow independent volume control of noise, stations, and sidetone.

4. **masterGain**: Single point to mute/unmute everything.

---

## QRN Worklet Implementation

### Why a Worklet?

The QRN (atmospheric noise) must play continuously without gaps. Main thread JavaScript can't guarantee this because:
- Garbage collection pauses
- Other JavaScript execution
- Browser repaints

AudioWorklet runs in a dedicated audio thread with real-time priority.

### Worklet Code as String

The worklet code is embedded as a string and loaded via Blob URL:

```typescript
export const QRN_WORKLET_CODE = `
class QrnProcessor extends AudioWorkletProcessor {
  // ... processor code
}
registerProcessor('qrn-processor', QrnProcessor);
`;

function createQrnWorkletUrl(): string {
  const blob = new Blob([QRN_WORKLET_CODE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}
```

**Why?** AudioWorklet modules must be loaded from a URL. Embedding as a string avoids needing a separate file that bundlers might mishandle.

### QRN Algorithm Components

1. **Pink Noise**: Base layer using Paul Kellet's economy method
   - White noise filtered to -3dB/octave slope
   - Sounds more natural than white noise

2. **Band-pass Filtering**: 200Hz - 4kHz
   - Simulates receiver audio bandwidth
   - Removes rumble and harsh highs

3. **Crackling Impulses**: Poisson-distributed bursts
   - Simulates lightning crashes / static crashes
   - Random timing and intensity

4. **Amplitude Modulation**: Multiple slow sine waves
   - Creates "breathing" quality of real static
   - **Uses 4 non-harmonic frequencies** to avoid rhythmic patterns
   - Frequencies: ~0.1Hz, ~0.25Hz, ~0.5Hz, ~1Hz

5. **Heterodyne Tones**: Faint drifting tones
   - Simulates distant carriers
   - Adds texture to the noise

6. **Soft Compression**: tanh() limiting
   - Simulates AGC (automatic gain control)
   - Prevents harsh peaks

### Message Passing

The main thread communicates with the worklet via `postMessage`:

```typescript
// Enable/disable QRN
this.qrnWorkletNode.port.postMessage({
  type: 'setEnabled',
  data: { enabled: true }
});

// Set noise level via SNR
this.qrnWorkletNode.port.postMessage({
  type: 'setSnr',
  data: { snr: 15 }  // dB
});
```

---

## Sample Rate Considerations

### Web Audio API: 44100 Hz

Web Audio API typically uses 44100 Hz. The streaming engine uses this rate for:
- QRN worklet
- Station audio buffers
- Sidetone audio buffers

### Existing Library: 22050 Hz

The pre-rendered morse audio (`generateMorseAudio()`) uses 22050 Hz for:
- Smaller file sizes
- Sufficient for CW tones (400-1200 Hz)

### In Streaming Mode

We generate samples at 44100 Hz by passing the sample rate to `generateSamples()`:

```typescript
const samples = generateSamples(timings, frequency, 44100);  // Not 22050!
```

The `generateSamples()` function accepts sample rate as a parameter and works correctly at any rate.

---

## Effect Processing Pipeline

When playing a station through the receiver, effects are applied in this order:

```
Text → Timings → Raw Samples → Effects → Bandwidth Filter → Gain → AudioBuffer
```

### 1. Generate Raw Samples

```typescript
const timings = getMorseTimings(text, wpm, fwpm);
let samples = generateSamples(timings, stationFrequency, sampleRate);
const envelope = generateEnvelope(timings, sampleRate);
```

The station's frequency = centerFrequency + frequencyOffset. This creates the beat note you hear.

### 2. Apply Per-Station Effects

```typescript
samples = applyStationEffects(samples, envelope, stationFrequency, sampleRate, effects);
```

Effects are applied in order:
1. **Rayleigh Fading**: Ionospheric multipath (slow random amplitude)
2. **Flutter**: Auroral distortion (10-30 Hz modulation)
3. **Chirp**: Frequency drift on keying (needs envelope + base frequency)
4. **Buzz**: AC hum (50/60 Hz additive)

### 3. Apply Bandwidth Filter

```typescript
samples = applyBandwidthFilter(samples, centerFrequency, bandwidth, sampleRate);
```

**CRITICAL**: The bandwidth filter simulates receiver selectivity. It's centered on `centerFrequency` (not the station's frequency). Stations off-center are attenuated.

### 4. Apply Signal Strength

```typescript
const gain = Math.pow(10, signalStrength / 20);  // dB to linear
for (let i = 0; i < samples.length; i++) {
  samples[i] *= gain;
}
```

Signal strength is in dB relative to S9. Typical values: -30 to +20 dB.

---

## Critical Implementation Details

### AudioBuffer Creation

Web Audio requires `AudioBuffer` for sample playback:

```typescript
const audioBuffer = audioContext.createBuffer(1, samples.length, sampleRate);
audioBuffer.getChannelData(0).set(samples);  // Copy samples to buffer

const source = audioContext.createBufferSource();
source.buffer = audioBuffer;
source.connect(destinationNode);
source.start();
```

**Why `getChannelData(0).set()` instead of `copyToChannel()`?**

TypeScript has strict typing for `Float32Array<ArrayBuffer>` vs `Float32Array<ArrayBufferLike>`. Using `.set()` avoids type errors without casting.

### Source Node Lifecycle

`AudioBufferSourceNode` is **single-use**:
- Can only call `.start()` once
- After playback ends, the node is done
- Must create new node for each playback

This is why we track active stations in a Map and create new source nodes for each transmission.

### Handling Completion

```typescript
source.onended = () => {
  this.activeStations.delete(id);
  this.callbacks.onStationComplete?.(id);
  options.onComplete?.();
};
```

The `onended` event fires when playback completes naturally or when `.stop()` is called.

---

## Common Pitfalls

### 1. Bandwidth Filter Argument Order

**WRONG:**
```typescript
applyBandwidthFilter(samples, sampleRate, centerFrequency, bandwidth);
```

**RIGHT:**
```typescript
applyBandwidthFilter(samples, centerFrequency, bandwidth, sampleRate);
```

The function signature is:
```typescript
applyBandwidthFilter(samples, centerFreq, bandwidth, sampleRate, stages?)
```

Getting this wrong causes stations to be completely filtered out (silent).

### 2. Rhythmic QRN Modulation

**WRONG:** Using 2 simple sine waves at regular frequencies
```typescript
const mod = 0.7 + 0.3 * (
  0.6 * Math.sin(2 * Math.PI * 0.5 * time) +
  0.4 * Math.sin(2 * Math.PI * 1.0 * time)
);
```

**RIGHT:** Using multiple non-harmonic frequencies
```typescript
// Frequencies chosen to avoid harmonic relationships
this.modFreq1 = 0.08 + random * 0.15;  // ~0.08-0.23 Hz
this.modFreq2 = 0.15 + random * 0.25;  // ~0.15-0.4 Hz
this.modFreq3 = 0.3 + random * 0.4;    // ~0.3-0.7 Hz
this.modFreq4 = 0.5 + random * 1.0;    // ~0.5-1.5 Hz
```

Simple harmonic ratios create audible periodic patterns. Real atmospheric noise has chaotic, non-repeating character.

### 3. Sidetone Should Not Go Through Receiver

Sidetone represents YOUR transmitter's local oscillator. It should:
- Be clean (no QRN)
- Be loud (higher gain)
- Have no propagation effects

Route sidetone to `sidetoneGain`, not `receiverGain`.

### 4. AudioContext User Gesture Requirement

```typescript
// This will fail without user interaction:
const ctx = new AudioContext();  // Suspended!

// Must be in response to click/tap:
button.onclick = async () => {
  await ctx.resume();  // Now it works
};
```

### 5. Farnsworth WPM Handling

The `translate()` function requires `fwpm` as a number, not optional:

```typescript
// WRONG: translate(text, wpm, undefined)
// RIGHT: translate(text, wpm, fwpm ?? wpm)
```

When fwpm is not specified, default to wpm.

### 6. Effect Function Signatures

Each effect function has a specific signature. Don't guess - check the source:

| Function | Signature |
|----------|-----------|
| `applyRayleighFading` | `(samples, options, sampleRate, seed?)` |
| `applyFlutter` | `(samples, options, sampleRate, seed?)` |
| `applyChirp` | `(samples, envelope, baseFrequency, options, sampleRate)` |
| `applyBuzz` | `(samples, options, sampleRate)` |
| `applyBandwidthFilter` | `(samples, centerFreq, bandwidth, sampleRate, stages?)` |

Note that `applyChirp` needs the envelope and base frequency because it re-synthesizes the tone with varying frequency.

---

## React Integration

### useContestAudio Hook

The hook provides a clean React interface:

```typescript
const {
  start,
  stop,
  isRunning,
  playStation,
  playSidetone,
  setQRN,
  setBandwidth,
  activeStations,
  isSending,
} = useContestAudio({
  qrn: { snr: 15 },
  bandwidth: 500,
  onStationComplete: (id) => console.log('Done:', id),
});
```

### Engine Lifecycle

1. **Creation**: Engine created in `useEffect`, stored in ref
2. **Start**: User clicks button → `await start()` → AudioContext created
3. **Running**: QRN plays, stations can be injected
4. **Stop**: `stop()` → all nodes disconnected, context closed
5. **Cleanup**: On unmount, engine is stopped automatically

### State Synchronization

The hook maintains React state that mirrors engine state:
- `status`: Engine status ('stopped', 'starting', 'running', 'error')
- `activeStations`: Array of currently playing station info
- `isSending`: True while sidetone is playing

Callbacks from the engine update React state, triggering re-renders.

---

## File Structure

```
packages/morse-audio/src/streaming/
├── index.ts                    # Module exports
├── types.ts                    # TypeScript interfaces
├── contest-audio-engine.ts     # Main engine class
└── qrn-worklet.ts             # AudioWorklet code for QRN

packages/react-morse-audio/src/
└── useContestAudio.ts         # React hook wrapper
```

---

## Testing Checklist

When modifying the streaming system, verify:

- [ ] Engine starts without errors
- [ ] QRN plays continuously (no gaps/clicks)
- [ ] QRN sounds organic (not rhythmic)
- [ ] Stations play through receiver with effects
- [ ] Stations at different offsets have correct beat notes
- [ ] Bandwidth filter attenuates off-frequency stations
- [ ] Sidetone plays clean and loud
- [ ] Sidetone doesn't have QRN mixed in
- [ ] Multiple stations can play simultaneously
- [ ] Stop/start works cleanly
- [ ] No memory leaks (check worklet URL cleanup)

---

## Summary

The streaming contest simulator uses Web Audio API to create real-time, mixed audio:

1. **QRN Worklet** generates continuous atmospheric noise in a separate thread
2. **Station audio** is pre-rendered with effects and played through AudioBufferSourceNode
3. **Sidetone** bypasses the receiver chain for clean, loud playback
4. **Gain nodes** provide mixing and volume control

Key principles:
- Sidetone is local (clean), stations are remote (noisy)
- Bandwidth filter is centered on receiver, not stations
- QRN modulation uses non-harmonic frequencies for organic sound
- All sample rates must match (44100 Hz for streaming)
