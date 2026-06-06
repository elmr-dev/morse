# react-morse-audio

React components and hooks for morse code audio playback. Built on top of [`morse-audio`](https://www.npmjs.com/package/morse-audio).

> **Not using React?** Use [`morse-audio`](https://www.npmjs.com/package/morse-audio) directly for vanilla JS, Vue, Angular, or Node.js.

## Features

- **Component API**: Drop-in `<MorseAudio>` component with ref support
- **Hook API**: `useMorseAudio` for full programmatic control
- **Contest Simulator**: `useContestAudio` for real-time streaming with pileups
- **Radio Effects**: QRN (static), QSB (fading), and realistic HF simulation
- **TypeScript**: Full type definitions included

## Installation

```bash
npm install react-morse-audio
```

## Quick Start

### Component (Simplest)

```tsx
import { MorseAudio } from 'react-morse-audio';

function App() {
  return <MorseAudio text="CQ CQ CQ" wpm={20} autoPlay />;
}
```

### Hook (Programmatic Control)

```tsx
import { useMorseAudio } from 'react-morse-audio';

function MorsePlayer() {
  const { play, stop, status } = useMorseAudio({
    text: 'HELLO WORLD',
    wpm: 25,
  });

  return (
    <div>
      <button onClick={play} disabled={status === 'playing'}>Play</button>
      <button onClick={stop}>Stop</button>
    </div>
  );
}
```

### Contest Simulator (Real-time Streaming)

```tsx
import { useContestAudio } from 'react-morse-audio';

function ContestSimulator() {
  const {
    start,
    stop,
    isRunning,
    playStation,
    playSidetone,
    setQRN,
  } = useContestAudio({
    qrn: { snr: 15 },
    bandwidth: 500,
  });

  const handlePileup = async () => {
    // Play stations through the "receiver" (with noise/effects)
    await playStation({
      text: 'W1ABC',
      wpm: 25,
      frequencyOffset: -100,
      signalStrength: -6,
    });
  };

  const handleSend = async () => {
    // Play your sidetone (clean, loud)
    await playSidetone({ text: 'W1?', wpm: 25 });
  };

  return (
    <div>
      <button onClick={isRunning ? stop : start}>
        {isRunning ? 'Stop' : 'Start'}
      </button>
      <button onClick={handlePileup} disabled={!isRunning}>
        Generate Pileup
      </button>
      <button onClick={handleSend} disabled={!isRunning}>
        Send
      </button>
    </div>
  );
}
```

## API Reference

### `<MorseAudio>` Component

```tsx
import { MorseAudio, MorseAudioRef } from 'react-morse-audio';

<MorseAudio
  ref={morseRef}
  text="CQ CQ CQ"
  wpm={20}
  fwpm={15}                    // Farnsworth spacing (optional)
  frequency={700}              // Tone Hz (400-1200)
  preDelay={300}               // Silence before (ms)
  postDelay={100}              // Silence after (ms)
  radioEffects={{
    qrn: { snr: 15 },          // Static noise
    qsb: { depth: 0.5, rate: 0.2 },  // Fading
  }}
  autoPlay={true}
  onPlay={() => {}}
  onComplete={() => {}}
  onError={(err) => {}}
  onStatusChange={(status) => {}}
/>
```

#### Ref Methods

```typescript
interface MorseAudioRef {
  play(): void;
  stop(): void;
  replay(): void;
  status: MorsePlaybackStatus;
  duration: number | null;
}
```

### `useMorseAudio` Hook

```typescript
const {
  play,      // Start playback
  stop,      // Stop playback
  replay,    // Restart from beginning
  status,    // 'idle' | 'loading' | 'ready' | 'playing' | 'completed' | 'error'
  duration,  // Audio duration in seconds
} = useMorseAudio({
  text: 'HELLO',
  wpm: 20,
  autoPlay: false,
  onComplete: () => console.log('Done!'),
});
```

### `useContestAudio` Hook

Real-time streaming audio for contest simulation.

```typescript
const {
  // Engine state
  status,           // 'stopped' | 'starting' | 'running' | 'error'
  isRunning,        // boolean
  activeStations,   // Currently playing station info
  isSending,        // True while sidetone plays

  // Lifecycle
  start,            // Start the audio engine
  stop,             // Stop everything

  // Receiver controls
  setQRN,           // setQRN({ snr: 15 }) or setQRN(null) to disable
  setBandwidth,     // setBandwidth(500)
  setCenterFrequency,
  setReceiverVolume,
  setSidetoneFrequency,
  setSidetoneVolume,

  // Playback
  playStation,      // Play a station through the receiver
  playSidetone,     // Play your own sending (clean, loud)
  stopStation,      // Stop a specific station
  stopSidetone,
  stopAllStations,
} = useContestAudio({
  qrn: { snr: 15 },
  bandwidth: 500,
  sidetoneVolume: 0.8,
  receiverVolume: 0.5,
  onStationComplete: (id) => console.log('Station done:', id),
  onSidetoneComplete: () => console.log('Sidetone done'),
});
```

#### Playing Stations

```typescript
await playStation({
  id: 'w1abc',                  // Optional unique ID
  text: 'W1ABC',
  wpm: 25,
  fwpm: 20,                     // Optional Farnsworth
  frequencyOffset: -100,        // Hz from center (-500 to +500)
  signalStrength: -6,           // dB relative to S9 (-30 to +20)
  effects: {
    rayleigh: { bandwidth: 0.5, depth: 0.5 },  // HF fading
    flutter: { rate: 15, depth: 0.3 },         // Auroral
    chirp: { deviation: 20, timeConstant: 30 }, // Freq drift
    buzz: { frequency: 60, amplitude: 0.1 },   // AC hum
  },
  onComplete: () => {},
});
```

#### Playing Sidetone

```typescript
await playSidetone({
  text: 'TU 73',
  wpm: 25,
  frequency: 700,    // Optional override
  volume: 0.9,       // Optional override
  onComplete: () => {},
});
```

## Playback Status

```typescript
type MorsePlaybackStatus =
  | 'idle'       // No audio loaded
  | 'loading'    // Generating audio
  | 'ready'      // Ready to play
  | 'playing'    // Currently playing
  | 'completed'  // Finished
  | 'error';     // Error occurred
```

## Constants

Re-exported from `morse-audio` for convenience:

```typescript
import {
  MIN_WPM, MAX_WPM, DEFAULT_WPM,
  MIN_FREQUENCY, MAX_FREQUENCY, DEFAULT_FREQUENCY,
  MIN_SNR, MAX_SNR, DEFAULT_SNR,
  MIN_FADE_DEPTH, MAX_FADE_DEPTH, DEFAULT_FADE_DEPTH,
  MIN_FADE_RATE, MAX_FADE_RATE, DEFAULT_FADE_RATE,
} from 'react-morse-audio';
```

## Examples

### Quick Play Buttons

```tsx
function QuickPlay() {
  const [phrase, setPhrase] = useState('');

  return (
    <div>
      {['SOS', 'CQ', '73'].map(p => (
        <button key={p} onClick={() => setPhrase(p)}>{p}</button>
      ))}
      {phrase && (
        <MorseAudio
          text={phrase}
          wpm={20}
          autoPlay
          onComplete={() => setPhrase('')}
        />
      )}
    </div>
  );
}
```

### With Radio Effects UI

```tsx
function RadioDemo() {
  const [snr, setSnr] = useState(20);

  return (
    <div>
      <label>
        SNR: {snr} dB
        <input
          type="range"
          min={-6}
          max={40}
          value={snr}
          onChange={e => setSnr(+e.target.value)}
        />
      </label>
      <MorseAudio
        text="TEST"
        wpm={20}
        radioEffects={{ qrn: { snr } }}
      />
    </div>
  );
}
```

### Farnsworth Learning Mode

```tsx
<MorseAudio
  text="PARIS"
  wpm={25}    // Fast character speed
  fwpm={10}   // Slow spacing
/>
```

## Browser Support

- **useMorseAudio / MorseAudio**: All modern browsers
- **useContestAudio**: Requires AudioWorklet (Chrome 66+, Firefox 76+, Safari 14.1+)

## TypeScript

```typescript
import type {
  MorseAudioProps,
  MorseAudioRef,
  MorsePlaybackStatus,
  UseMorseAudioOptions,
  UseContestAudioOptions,
  UseContestAudioReturn,
  PlayStationOptions,
  PlaySidetoneOptions,
  RadioEffectsOptions,
  StationEffectsOptions,
} from 'react-morse-audio';
```

## Related

- [`morse-audio`](https://www.npmjs.com/package/morse-audio) - Core library (no React dependency)

## License

MIT
