import { calculatePileupDuration, generatePileupAudio, type PileupStation } from 'morse-audio'

export interface ContestLane {
  id: string
  label: string
  toneHz: number
  offsetHz: number
  wpm: number
  snrDb: number
  callsign: string
  exchange: string
  message: string
}

export interface ContestHelperSample {
  dataUri: string
  duration: number
  sampleRate: number
  centerFrequency: number
  lanes: ContestLane[]
}

const CENTER_FREQUENCY = 730
const TARGET_DURATION_MS = 30_000
const CALLSIGN_POOL = [
  'KD4ABC', 'W2DEF', 'N0CAL', 'VE3XYZ', 'AA5MD', 'K7QRM',
  'N6TR', 'W9RE', 'K3LR', 'VE7CC', 'N2IC', 'K5ZD',
  'W1AW', 'N4ZZ', 'K9CT', 'VA2WA', 'K0RF', 'W6YX',
  'N7TU', 'K4RO', 'VE5MX', 'N3BB', 'W0AIH', 'K8AZ',
]
const SECTIONS = ['GA', 'TX', 'CA', 'OH', 'IL', 'VA', 'NC', 'CO', 'AZ', 'WA', 'ON', 'BC']

export function generateContestHelperSample(seed = 20260605): ContestHelperSample {
  const rng = createPrng(seed)
  const lanes: ContestLane[] = [
    makeLane('lane-low', 'Low', -140, 18, -10, rng),
    makeLane('lane-mid', 'Mid', 0, 23, -7, rng),
    makeLane('lane-high', 'High', 150, 28, -4, rng),
  ]
  const stations = lanes.map<PileupStation>((lane) => ({
    id: lane.id,
    text: lane.message,
    wpm: lane.wpm,
    frequencyOffset: lane.offsetHz,
    signalStrength: lane.snrDb,
    startDelay: Math.round(rng() * 450),
  }))

  const generated = generatePileupAudio({
    stations,
    receiver: {
      centerFrequency: CENTER_FREQUENCY,
      bandwidth: 1200,
      qrn: { snr: 0 },
    },
    preDelay: 400,
    postDelay: 400,
  })

  return {
    dataUri: generated.dataUri,
    duration: generated.duration,
    sampleRate: generated.sampleRate,
    centerFrequency: CENTER_FREQUENCY,
    lanes: lanes.map((lane) => ({ ...lane, toneHz: CENTER_FREQUENCY + lane.offsetHz })),
  }
}

function makeLane(
  id: string,
  label: string,
  offsetHz: number,
  wpm: number,
  snrDb: number,
  rng: () => number,
): ContestLane {
  const callsign = CALLSIGN_POOL[Math.floor(rng() * CALLSIGN_POOL.length)]
  const section = SECTIONS[Math.floor(rng() * SECTIONS.length)]
  const exchange = `599 599 ${section} ${section}`
  const repeat = `${callsign} ${callsign} ${exchange}`
  const repeats: string[] = []
  let message = ''

  while (repeats.length < 2 || stationDuration(message, wpm) < TARGET_DURATION_MS) {
    repeats.push(repeat)
    message = repeats.join(' ')
    if (repeats.length >= 12) break
  }

  return {
    id,
    label,
    toneHz: CENTER_FREQUENCY + offsetHz,
    offsetHz,
    wpm,
    snrDb,
    callsign,
    exchange,
    message,
  }
}

function stationDuration(text: string, wpm: number): number {
  return calculatePileupDuration(
    [{ id: 'estimate', text, wpm, frequencyOffset: 0, signalStrength: 0, startDelay: 0 }],
    0,
    0,
  )
}

function createPrng(seed: number): () => number {
  return function next() {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
