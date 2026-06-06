# morse-audio

Generate morse code audio in JavaScript/TypeScript. Works in browsers and Node.js with zero dependencies.

> **Using React?** See [`react-morse-audio`](https://www.npmjs.com/package/react-morse-audio) for React components and hooks.

## Features

- **Pre-rendered audio**: Generate complete WAV files as base64 data URIs
- **Real-time streaming**: Web Audio API engine for live contest simulation
- **Radio effects**: QRN (static), QSB (fading), Rayleigh fading, flutter, chirp, buzz
- **Pileup simulation**: Mix multiple stations with different frequencies and signal strengths
- **Farnsworth timing**: Adjustable character vs word spacing for learning
- **Prosign support**: `<AR>`, `<SK>`, `<BT>`, `<SOS>`, etc.

## Installation

```bash
npm install morse-audio
```

## Quick Start

### Generate Audio (Pre-rendered WAV)

```typescript
import { generateMorseAudio } from 'morse-audio';

const { dataUri, timings, sampleRate } = generateMorseAudio({
  text: 'HELLO WORLD',
  wpm: 20,
});

// Play in browser
const audio = new Audio(dataUri);
audio.play();
```

### Real-time Streaming (Contest Simulator)

```typescript
import { createContestAudioEngine } from 'morse-audio';

const engine = createContestAudioEngine({
  qrn: { snr: 15 },
  bandwidth: 500,
});

await engine.start();

// Continuous noise plays...

// Inject a station through the "receiver"
await engine.playStation({
  text: 'W1ABC',
  wpm: 25,
  frequencyOffset: -100,  // 100 Hz below center
  signalStrength: -6,     // Slightly weak
  effects: {
    rayleigh: { bandwidth: 0.5, depth: 0.5 },
  },
});

// Play your own sidetone (clean, loud)
await engine.playSidetone({
  text: 'W1?',
  wpm: 25,
});

engine.stop();
```

## API Reference

### generateMorseAudio(options)

Generate a complete morse audio file.

```typescript
interface MorseGeneratorOptions {
  text: string;              // Text to convert
  wpm: number;               // Words per minute (5-60)
  fwpm?: number;             // Farnsworth WPM (defaults to wpm)
  frequency?: number;        // Tone frequency in Hz (400-1200, default: 700)
  preDelay?: number;         // Silence before audio in ms (default: 300)
  postDelay?: number;        // Silence after audio in ms (default: 100)
  radioEffects?: {
    qrn?: { snr?: number };  // Static noise (SNR in dB, default: 20)
    qsb?: {                   // Signal fading
      depth?: number;         // 0-0.9 (default: 0.5)
      rate?: number;          // Hz (default: 0.2)
    };
  };
}

interface GeneratedMorseAudio {
  dataUri: string;           // Base64 WAV data URI
  timings: number[];         // Timing array (positive=sound, negative=silence)
  sampleRate: number;        // Audio sample rate (22050 Hz)
}
```

### createContestAudioEngine(options)

Create a real-time streaming audio engine for contest simulation.

```typescript
interface ContestEngineOptions {
  sampleRate?: number;        // Default: 44100
  qrn?: { snr?: number };     // Initial noise settings
  bandwidth?: number;         // Receiver bandwidth in Hz (default: 500)
  centerFrequency?: number;   // Receiver center freq (default: 700)
  sidetoneFrequency?: number; // Your sidetone freq (default: 700)
  sidetoneVolume?: number;    // 0-1 (default: 0.8)
  receiverVolume?: number;    // 0-1 (default: 0.5)
}

interface IContestAudioEngine {
  // Lifecycle
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;

  // Receiver settings
  setQRN(options: { snr?: number } | null): void;
  setBandwidth(hz: number): void;
  setCenterFrequency(hz: number): void;

  // Play audio
  playStation(options: PlayStationOptions): Promise<string>;
  playSidetone(options: PlaySidetoneOptions): Promise<void>;

  // Control
  stopStation(id: string): void;
  stopSidetone(): void;
  stopAllStations(): void;
}
```

### generatePileupAudio(options)

Generate a pileup with multiple stations calling simultaneously.

```typescript
import { generatePileupAudio } from 'morse-audio';

const { dataUri, duration, stationOrder } = generatePileupAudio({
  stations: [
    {
      id: 'w1abc',
      text: 'W1ABC',
      wpm: 25,
      frequencyOffset: -100,
      signalStrength: -3,
      startDelay: 0,
      effects: {
        rayleigh: { bandwidth: 0.5, depth: 0.5 },
      },
    },
    {
      id: 'k2xyz',
      text: 'K2XYZ',
      wpm: 28,
      frequencyOffset: 150,
      signalStrength: -9,
      startDelay: 100,
    },
  ],
  receiver: {
    centerFrequency: 700,
    bandwidth: 500,
    qrn: { snr: 15 },
  },
});
```

## Low-Level Utilities

```typescript
import {
  // Morse translation
  translate,              // Text to timing array

  // Audio generation
  generateSamples,        // Timings to PCM samples
  getSampleRate,          // Get default sample rate (22050)

  // Effects
  applyRadioEffects,      // Add QRN/QSB to samples
  applyRayleighFading,    // HF propagation fading
  applyFlutter,           // Auroral distortion
  applyChirp,             // Frequency drift on keying
  applyBuzz,              // AC hum
  applyBandwidthFilter,   // Receiver selectivity

  // Encoding
  getWavData,             // Samples to WAV bytes
  getDataURI,             // Bytes to data URI
} from 'morse-audio';
```

## Constants

```typescript
import {
  // WPM
  MIN_WPM,           // 5
  MAX_WPM,           // 60
  DEFAULT_WPM,       // 20

  // Frequency
  MIN_FREQUENCY,     // 400 Hz
  MAX_FREQUENCY,     // 1200 Hz
  DEFAULT_FREQUENCY, // 700 Hz

  // SNR (noise)
  MIN_SNR,           // -6 dB (very noisy)
  MAX_SNR,           // 40 dB (clean)
  DEFAULT_SNR,       // 20 dB

  // Bandwidth
  MIN_BANDWIDTH,     // 100 Hz
  MAX_BANDWIDTH,     // 2400 Hz
  DEFAULT_BANDWIDTH, // 500 Hz

  // Validation functions
  validateWpm,
  validateFrequency,
  validateSnr,
  validateBandwidth,
  // ... and more
} from 'morse-audio';
```

## Radio Effects

### QRN (Atmospheric Noise)

Realistic HF static with pink noise, crackling, and heterodyne tones.

```typescript
generateMorseAudio({
  text: 'TEST',
  wpm: 20,
  radioEffects: {
    qrn: { snr: 10 },  // 10 dB SNR (noisy)
  },
});
```

### QSB (Signal Fading)

Ionospheric propagation fading using multi-sinusoid modulation.

```typescript
generateMorseAudio({
  text: 'TEST',
  wpm: 20,
  radioEffects: {
    qsb: {
      depth: 0.7,  // Deep fading
      rate: 0.1,   // Slow (10 second cycle)
    },
  },
});
```

### Per-Station Effects (Pileup/Streaming)

- **Rayleigh Fading**: True multipath fading using I/Q Gaussian noise
- **Flutter**: Auroral distortion (10-30 Hz modulation)
- **Chirp**: Frequency drift on keying (old transmitter simulation)
- **Buzz**: AC hum (50/60 Hz)

## Node.js Usage

Generate WAV files server-side:

```typescript
import { generateMorseAudio } from 'morse-audio';
import { writeFileSync } from 'fs';

const { dataUri } = generateMorseAudio({
  text: 'CQ CQ CQ DE W1AW',
  wpm: 20,
});

const base64 = dataUri.split(',')[1];
writeFileSync('morse.wav', Buffer.from(base64, 'base64'));
```

## Browser Compatibility

- **Pre-rendered audio**: All modern browsers
- **Streaming engine**: Requires Web Audio API and AudioWorklet support (Chrome 66+, Firefox 76+, Safari 14.1+)

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  MorseGeneratorOptions,
  GeneratedMorseAudio,
  RadioEffectsOptions,
  ContestEngineOptions,
  PlayStationOptions,
  PlaySidetoneOptions,
  StationEffectsOptions,
  PileupStation,
  PileupGeneratorOptions,
} from 'morse-audio';
```

## Related

- [`react-morse-audio`](https://www.npmjs.com/package/react-morse-audio) - React components and hooks

## License

MIT
