# morse-audio

> Generate morse code audio in JavaScript/TypeScript

A zero-dependency library for generating morse code audio, with optional React bindings.

## Core Library (morse-audio)

The core library works in browsers and Node.js with no dependencies.

### Installation

```bash
npm install morse-audio
```

### Quick Start

```typescript
import { generateMorseAudio } from 'morse-audio';

const { dataUri, timings } = generateMorseAudio({
  text: 'HELLO WORLD',
  wpm: 20,
});

// Play in browser
const audio = new Audio(dataUri);
audio.play();
```

### Real-time Streaming (Contest Simulation)

```typescript
import { createContestAudioEngine } from 'morse-audio';

const engine = createContestAudioEngine({
  qrn: { snr: 15 },
  bandwidth: 500,
});

await engine.start();

// Inject a station through the "receiver"
await engine.playStation({
  text: 'W1ABC',
  wpm: 25,
  frequencyOffset: -100,
  signalStrength: -6,
  effects: { rayleigh: { bandwidth: 0.5, depth: 0.5 } },
});

// Play your sidetone (clean, loud)
await engine.playSidetone({ text: 'TU', wpm: 25 });

engine.stop();
```

### Node.js Usage

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

See the [morse-audio README](./packages/morse-audio/README.md) for full API documentation.

---

## React Bindings (react-morse-audio)

Optional React components and hooks for morse playback.

### Installation

```bash
npm install react-morse-audio
```

### Component API

```tsx
import { MorseAudio } from 'react-morse-audio';

function App() {
  return <MorseAudio text="CQ CQ CQ" wpm={20} autoPlay />;
}
```

### Hook API

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

### Contest Simulator Hook

```tsx
import { useContestAudio } from 'react-morse-audio';

function ContestSimulator() {
  const { start, stop, isRunning, playStation, playSidetone } = useContestAudio({
    qrn: { snr: 15 },
    bandwidth: 500,
  });

  return (
    <div>
      <button onClick={isRunning ? stop : start}>
        {isRunning ? 'Stop' : 'Start'}
      </button>
      <button onClick={() => playStation({ text: 'W1ABC', wpm: 25 })}>
        Play Station
      </button>
    </div>
  );
}
```

See the [react-morse-audio README](./packages/react-morse-audio/README.md) for full API documentation.

---

## Features

- **Pre-rendered audio**: Generate complete WAV files as base64 data URIs
- **Real-time streaming**: Web Audio API engine for live contest simulation
- **Radio effects**: QRN (static), QSB (fading), Rayleigh fading, flutter, chirp, AC hum
- **Pileup simulation**: Mix multiple stations with different frequencies and signal strengths
- **Farnsworth timing**: Adjustable character vs word spacing for learning
- **Prosign support**: `<AR>`, `<SK>`, `<BT>`, `<SOS>`, etc.
- **Zero dependencies**: Core library has no external dependencies

---

## Architecture

```
morse-audio (core library, zero dependencies)
  |
  +-- react-morse-audio (optional React bindings)
  |
  +-- Direct usage (Vue, Angular, Node.js, vanilla JS)
```

| Package | Description | Install |
|---------|-------------|---------|
| [`morse-audio`](./packages/morse-audio) | Core library for generating morse code audio | `npm install morse-audio` |
| [`react-morse-audio`](./packages/react-morse-audio) | React components and hooks for morse playback | `npm install react-morse-audio` |

---

## Applications

This repository includes several applications built with morse-audio:

| App | Description | Location |
|-----|-------------|----------|
| **Demo** | Interactive playground for testing morse audio generation | [`apps/demo`](./apps/demo) |
| **Contest Runner** | CW contest simulation with pileups and real-time scoring | [`apps/contest-runner`](./apps/contest-runner) |
| **RufzJS** | Callsign training app for improving copy speed | [`apps/rufzjs`](./apps/rufzjs) |

---

## Streaming Architecture

The streaming engine provides real-time audio for contest simulation:

```
+-------------------------------------------------------------+
|                   Web Audio API Graph                       |
+-------------------------------------------------------------+
|  +------------+                                             |
|  | QRN Worklet|--+                                          |
|  | (continuous)  |    +-----------+                         |
|  +------------+  +-->|receiverGain|--+                      |
|                  |    +-----------+  |  +----------+        |
|  +------------+  |                   +->|masterGain|-> Out  |
|  |Station Audio|-+                   |  +----------+        |
|  +------------+                      |                      |
|                      +-----------+   |                      |
|  +------------+      |sidetoneGain|--+                      |
|  |  Sidetone  |----> | (clean)   |                          |
|  +------------+      +-----------+                          |
+-------------------------------------------------------------+
```

The sidetone bypasses the receiver path because in a real radio, your own sending comes from the local oscillator - not through the receiver with all its noise.

See [STREAMING_ARCHITECTURE.md](./packages/morse-audio/STREAMING_ARCHITECTURE.md) for detailed technical documentation.

---

## Development

```bash
# Clone and install
git clone <repo>
cd morse-audio
pnpm install

# Run demo app
pnpm dev

# Run tests
pnpm test

# Build all packages
pnpm build
```

---

## License

MIT (c) 2026 Mark Percival <m@mdp.im>
