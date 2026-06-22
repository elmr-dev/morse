#!/usr/bin/env node

/**
 * CLI tool for generating ML training data
 *
 * Generates realistic CW audio samples for training ML decoders,
 * following the distribution requirements from SYNTHETIC_DATA.md
 */

import { execSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import {
  createTrainingSampleGenerator,
  DEFAULT_DISTRIBUTIONS,
  getFistOptions,
} from './index';
import type {
  FistProfile,
  ParameterDistributions,
  TrainingSampleMetadata,
} from './types';

// ============================================================================
// Constants
// ============================================================================

// WPM bucket definitions
const WPM_BUCKETS = {
  slow: { min: 12, max: 20, durationSec: 30, weight: 0.3 },
  medium: { min: 20, max: 30, durationSec: 15, weight: 0.5 },
  fast: { min: 30, max: 40, durationSec: 10, weight: 0.2 },
} as const;

type WpmBucketName = keyof typeof WPM_BUCKETS;

// Fixed sample rate per spec
const SAMPLE_RATE = 16000;

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  count: number;
  split: 'train' | 'val' | 'test_clean' | 'test_hard' | 'phase0';
  output: string;
  seed: number;
  verbose: boolean;
  help: boolean;
  fromJson: string | null; // Path to JSON config for single sample generation
  fromJsonl: string | null; // Path to JSONL config for batch generation
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    count: 1000,
    split: 'train',
    output: './ml/training_data',
    seed: Date.now(),
    verbose: false,
    help: false,
    fromJson: null,
    fromJsonl: null,
  };

  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--count' || arg === '-n') {
      args.count = parseInt(argv[++i], 10);
    } else if (arg === '--split' || arg === '-s') {
      const split = argv[++i];
      if (
        ['train', 'val', 'test_clean', 'test_hard', 'phase0'].includes(split)
      ) {
        args.split = split as CliArgs['split'];
      } else {
        console.error(`Invalid split: ${split}`);
        process.exit(1);
      }
    } else if (arg === '--output' || arg === '-o') {
      args.output = argv[++i];
    } else if (arg === '--seed') {
      args.seed = parseInt(argv[++i], 10);
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg === '--from-json') {
      args.fromJson = argv[++i];
    } else if (arg === '--from-jsonl') {
      args.fromJsonl = argv[++i];
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
ML Training Data Generator

Usage: generate-ml-data [options]

Options:
  -n, --count <number>       Number of samples to generate (default: 1000)
  -s, --split <name>         Split name: train, val, test_clean, test_hard, phase0 (default: train)
  -o, --output <path>        Output directory/file path (default: ./ml/training_data)
  --seed <number>            Random seed for reproducibility (default: current timestamp)
  --from-json <path>         Generate single sample from JSON config file
  -v, --verbose              Verbose output
  -h, --help                 Show this help message

WPM Buckets (fixed durations):
  12-20 WPM (slow):   30 second samples, 30% of dataset
  20-30 WPM (medium): 15 second samples, 50% of dataset
  30-40 WPM (fast):   10 second samples, 20% of dataset

Output Format:
  - FLAC audio at 16 kHz mono
  - Gzipped JSONL labels with wpm_bucket field

Examples:
  # Generate 10000 training samples
  pnpm run generate:ml -- --count 10000 --split train

  # Generate validation set
  pnpm run generate:ml -- --count 1000 --split val

  # Generate single sample from JSON config (for Python orchestration)
  pnpm exec tsx src/ml-training/generate-cli.ts --from-json config.json --output sample.flac

Directory Structure Created:
  <output>/
    <split>/
      audio/
        sample_000001.flac
        ...
      labels.jsonl.gz
    metadata.json
`);
}

// ============================================================================
// Text Content Generation
// ============================================================================

// Callsign formats by region
const CALLSIGN_FORMATS: Record<string, string[]> = {
  US: [
    'W{d}{L}{L}{L}',
    'K{d}{L}{L}{L}',
    'N{d}{L}{L}',
    'AA{d}{L}{L}',
    'WA{d}{L}{L}{L}',
    'KB{d}{L}{L}{L}',
  ],
  UK: ['G{d}{L}{L}{L}', 'M{d}{L}{L}{L}', 'G{d}{L}{L}'],
  Japan: ['JA{d}{L}{L}{L}', 'JH{d}{L}{L}{L}', 'JR{d}{L}{L}{L}'],
  Germany: ['DL{d}{L}{L}{L}', 'DK{d}{L}{L}{L}', 'DF{d}{L}{L}{L}'],
  EU_generic: [
    '{L}{L}{d}{L}{L}{L}',
    'OH{d}{L}{L}{L}',
    'SM{d}{L}{L}{L}',
    'PA{d}{L}{L}{L}',
  ],
};

// Regional distribution: NA 40%, EU 35%, JA 10%, other 15%
const REGION_DISTRIBUTION = [
  { region: 'US', weight: 0.4 },
  { region: 'UK', weight: 0.1 },
  { region: 'Germany', weight: 0.1 },
  { region: 'EU_generic', weight: 0.15 },
  { region: 'Japan', weight: 0.1 },
  { region: 'US', weight: 0.15 },
];

// RST values
const RST_VALUES = ['599', '579', '559', '539', '449', '339'];

// US States and CQ zones for contest exchanges
const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];
const CQ_ZONES = Array.from({ length: 40 }, (_, i) =>
  String(i + 1).padStart(2, '0')
);

// Word list for random text
const RANDOM_WORDS = [
  'THE',
  'AND',
  'FOR',
  'ARE',
  'BUT',
  'NOT',
  'YOU',
  'ALL',
  'CAN',
  'HAD',
  'HER',
  'WAS',
  'ONE',
  'OUR',
  'OUT',
  'DAY',
  'GET',
  'HAS',
  'HIM',
  'HIS',
  'HOW',
  'ITS',
  'MAY',
  'NEW',
  'NOW',
  'OLD',
  'SEE',
  'WAY',
  'WHO',
  'BOY',
  'DID',
  'OWN',
  'SAY',
  'SHE',
  'TOO',
  'USE',
  'GOOD',
  'VERY',
  'JUST',
  'KNOW',
  'TAKE',
  'COME',
  'MADE',
  'FIND',
  'GIVE',
  'LOOK',
  'ONLY',
  'OVER',
  'SUCH',
  'THAN',
];

const NAMES = [
  'JIM',
  'BOB',
  'TOM',
  'MIKE',
  'DAVE',
  'JOHN',
  'BILL',
  'JOE',
  'AL',
  'ED',
  'MARY',
  'SUE',
  'ANN',
  'PAT',
  'DAN',
];
const QTHS = [
  'NY',
  'CA',
  'TX',
  'FL',
  'OH',
  'PA',
  'IL',
  'MI',
  'GA',
  'NC',
  'VA',
  'WA',
  'AZ',
  'CO',
  'MN',
];

type ContentCategory =
  | 'cq_call'
  | 'qso_exchange'
  | 'contest_exchange'
  | 'beacon'
  | 'random_text'
  | 'callsign';

class TextGenerator {
  private prng: () => number;

  constructor(seed: number) {
    this.prng = this.createPrng(seed);
  }

  private createPrng(seed: number): () => number {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.prng() * arr.length)];
  }

  private pickWeighted<T extends { weight: number }>(items: T[]): T {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let r = this.prng() * total;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  generateCallsign(): string {
    const { region } = this.pickWeighted(REGION_DISTRIBUTION);
    const formats = CALLSIGN_FORMATS[region];
    const format = this.pick(formats);

    return format
      .replace(/\{d\}/g, () => String(Math.floor(this.prng() * 10)))
      .replace(/\{L\}/g, () =>
        String.fromCharCode(65 + Math.floor(this.prng() * 26))
      );
  }

  private generateGridLocator(): string {
    const f1 = String.fromCharCode(65 + Math.floor(this.prng() * 18));
    const f2 = String.fromCharCode(65 + Math.floor(this.prng() * 18));
    const n1 = Math.floor(this.prng() * 10);
    const n2 = Math.floor(this.prng() * 10);
    return `${f1}${f2}${n1}${n2}`;
  }

  /**
   * Generate a single content unit of the given category
   */
  generateContentUnit(category: ContentCategory): string {
    switch (category) {
      case 'cq_call': {
        const callsign = this.generateCallsign();
        const repeats = this.prng() < 0.5 ? 2 : 3;
        const cqs = Array(repeats).fill('CQ').join(' ');
        const calls = Array(repeats - 1)
          .fill(callsign)
          .join(' ');
        return `${cqs} DE ${calls} ${callsign} K`;
      }

      case 'qso_exchange': {
        const myCall = this.generateCallsign();
        const theirCall = this.generateCallsign();
        const rst = this.pick(RST_VALUES);
        const name = this.pick(NAMES);
        const qth = this.pick(QTHS);

        const parts = [`${theirCall} DE ${myCall}`, `UR RST ${rst} ${rst}`];
        if (this.prng() < 0.7) parts.push(`NAME ${name} ${name}`);
        if (this.prng() < 0.5) parts.push(`QTH ${qth}`);
        parts.push(this.pick(['BK', 'KN', 'K']));
        return parts.join(' ');
      }

      case 'contest_exchange': {
        const myCall = this.generateCallsign();
        const theirCall = this.generateCallsign();
        const serial = String(Math.floor(this.prng() * 1000) + 1).padStart(
          3,
          '0'
        );
        const exchangeType = this.prng();

        let exchange: string;
        if (exchangeType < 0.4) {
          exchange = `5NN ${serial} ${this.pick(US_STATES)}`;
        } else if (exchangeType < 0.7) {
          exchange = `5NN ${this.pick(CQ_ZONES)}`;
        } else {
          exchange = `5NN ${serial}`;
        }

        return this.prng() < 0.5
          ? `${theirCall} ${exchange} ${myCall}`
          : `${myCall} ${exchange}`;
      }

      case 'beacon': {
        const callsign = this.generateCallsign();
        const locator = this.generateGridLocator();
        return `VVV ${callsign} ${callsign} ${locator}`;
      }

      case 'random_text': {
        const words: string[] = [];
        const count = 3 + Math.floor(this.prng() * 5);
        for (let i = 0; i < count; i++) {
          words.push(this.pick(RANDOM_WORDS));
        }
        return words.join(' ');
      }

      case 'callsign': {
        const callsign = this.generateCallsign();
        const r = this.prng();
        if (r < 0.3) return callsign;
        if (r < 0.6) return `${callsign} ${callsign}`;
        return `DE ${callsign} ${callsign}`;
      }
    }
  }

  /**
   * Select a content category based on distribution:
   * CQ calls: 15%, QSO: 35%, Contest: 20%, Beacon: 5%, Random: 10%, Callsign: 15%
   */
  selectCategory(): ContentCategory {
    const r = this.prng();
    if (r < 0.15) return 'cq_call';
    if (r < 0.5) return 'qso_exchange';
    if (r < 0.7) return 'contest_exchange';
    if (r < 0.75) return 'beacon';
    if (r < 0.85) return 'random_text';
    return 'callsign';
  }

  /**
   * Generate content that fits within a target duration at the given WPM.
   * Loops/concatenates if too short, trims at word boundary if too long.
   */
  generateContentForDuration(
    wpm: number,
    targetDurationSec: number
  ): { text: string; category: ContentCategory } {
    const category = this.selectCategory();

    // Estimate characters per second at this WPM
    // PARIS = 50 units, at W WPM we do W words/minute = W*50 units/minute
    // So units/sec = W*50/60, and avg char ≈ 10 units, so chars/sec ≈ W*50/60/10 = W/12
    const charsPerSec = wpm / 12;
    const targetChars = Math.floor(charsPerSec * targetDurationSec * 0.85); // 85% to leave margin

    let text = '';
    let attempts = 0;
    const maxAttempts = 50;

    // Build up content by concatenating units
    while (text.length < targetChars && attempts < maxAttempts) {
      const unit = this.generateContentUnit(category);
      if (text.length === 0) {
        text = unit;
      } else {
        text = `${text} ${unit}`;
      }
      attempts++;
    }

    // Trim at word boundary if too long
    // Estimate actual duration using morse timing
    let estimatedDuration = this.estimateDuration(text, wpm);

    while (estimatedDuration > targetDurationSec && text.includes(' ')) {
      // Remove last word
      const lastSpace = text.lastIndexOf(' ');
      if (lastSpace === -1) break;
      text = text.substring(0, lastSpace);
      estimatedDuration = this.estimateDuration(text, wpm);
    }

    return { text, category };
  }

  /**
   * Estimate duration of text in seconds at given WPM
   */
  private estimateDuration(text: string, wpm: number): number {
    // Use the actual calculateDuration from morse-audio if available
    // Fallback: PARIS timing estimate
    // 1 PARIS word at W WPM = 60/W seconds
    // Estimate words as chars/5
    const words = text.length / 5;
    return (words * 60) / wpm;
  }

  /**
   * Generate short text for phase0 - unique callsign each time
   */
  generateShortText(): { text: string; category: ContentCategory } {
    const text = this.generateCallsign();
    return { text, category: 'callsign' };
  }
}

// ============================================================================
// WPM and SNR Sampling
// ============================================================================

/**
 * Sample a WPM bucket and WPM value according to distribution
 */
function sampleWpmBucket(prng: () => number): {
  bucket: WpmBucketName;
  wpm: number;
  durationSec: number;
} {
  const r = prng();
  let bucket: WpmBucketName;

  if (r < WPM_BUCKETS.slow.weight) {
    bucket = 'slow';
  } else if (r < WPM_BUCKETS.slow.weight + WPM_BUCKETS.medium.weight) {
    bucket = 'medium';
  } else {
    bucket = 'fast';
  }

  const config = WPM_BUCKETS[bucket];
  const wpm = Math.round(config.min + prng() * (config.max - config.min));

  return { bucket, wpm, durationSec: config.durationSec };
}

/**
 * SNR distribution per spec
 */
function sampleSnr(prng: () => number, split: CliArgs['split']): number {
  if (split === 'phase0') {
    return 15; // Fixed +15 dB SNR
  }

  if (split === 'test_clean') {
    return 10 + prng() * 10;
  }

  if (split === 'test_hard') {
    const r = prng();
    if (r < 0.05) return 5 + prng() * 15;
    if (r < 0.3) return -5 + prng() * 5;
    if (r < 0.7) return -10 + prng() * 5;
    return -15 + prng() * 5;
  }

  const r = prng();
  if (r < 0.1) return 10 + prng() * 10;
  if (r < 0.35) return prng() * 10;
  if (r < 0.65) return -5 + prng() * 5;
  if (r < 0.9) return -10 + prng() * 5;
  return -15 + prng() * 5;
}

/**
 * Create distributions modified for the split type
 */
function getDistributionsForSplit(
  split: CliArgs['split']
): ParameterDistributions {
  const base = { ...DEFAULT_DISTRIBUTIONS };
  base.wpmRange = [12, 40]; // Enforce minimum 12 WPM

  if (split === 'test_clean') {
    return {
      ...base,
      snrRange: [10, 20],
      ionosphericFadingProbability: 0.1,
      multipathProbability: 0.05,
      dopplerSpreadProbability: 0.05,
      cwQrmProbability: 0.05,
      broadbandInterferenceProbability: 0.02,
      fistDistribution: {
        machine: 0.5,
        good: 0.4,
        average: 0.1,
        poor: 0,
        very_poor: 0,
      },
    };
  }

  if (split === 'test_hard') {
    return {
      ...base,
      snrRange: [-15, 5],
      ionosphericFadingProbability: 0.9,
      multipathProbability: 0.5,
      dopplerSpreadProbability: 0.4,
      cwQrmProbability: 0.5,
      multipleQrmProbability: 0.2,
      broadbandInterferenceProbability: 0.3,
      fistDistribution: {
        machine: 0.05,
        good: 0.15,
        average: 0.3,
        poor: 0.3,
        very_poor: 0.2,
      },
    };
  }

  if (split === 'phase0') {
    // Phase 0: Clean, constrained samples for data pipeline verification
    // Fixed 20 WPM, +15 dB SNR, no augmentations, short messages
    return {
      ...base,
      wpmRange: [20, 20],
      snrRange: [15, 15],
      ionosphericFadingProbability: 0,
      multipathProbability: 0,
      dopplerSpreadProbability: 0,
      cwQrmProbability: 0,
      broadbandInterferenceProbability: 0,
      agcProbability: 0,
      pitchWobbleProbability: 0,
      chirpProbability: 0,
      qsbProbability: 0,
      qrnProbability: 0,
      powerLineProbability: 0,
      fistDistribution: {
        machine: 1.0, // Perfect timing
        good: 0,
        average: 0,
        poor: 0,
        very_poor: 0,
      },
    };
  }

  return base;
}

// ============================================================================
// Label Format
// ============================================================================

interface LabelRecord {
  audio_file: string;
  text: string;
  wpm: number;
  wpm_bucket: WpmBucketName;
  duration_sec: number;
  tone_freq_hz: number;
  snr_db: number;
  content_category: string;
  augmentations: {
    fading_profile: string | null;
    fading_depth: number | null;
    fading_rate_hz: number | null;
    jitter_pct: number | null;
    qrm_present: boolean;
    qrm_separation_hz: number | null;
    impulse_rate: number | null;
    multipath: boolean;
    agc_applied: boolean;
    filter_bw_hz: number | null;
  };
  char_timestamps: Array<{
    char: string;
    start_ms: number;
    end_ms: number;
  }>;
}

function metadataToLabel(
  filename: string,
  metadata: TrainingSampleMetadata,
  contentCategory: string,
  wpmBucket: WpmBucketName
): LabelRecord {
  const config = metadata.config;

  let fadingProfile: string | null = null;
  if (config.ionosphericFading) {
    const depth = config.ionosphericFading.depth;
    if (depth < 0.3) fadingProfile = 'mild';
    else if (depth < 0.6) fadingProfile = 'moderate';
    else fadingProfile = 'severe';
  }

  return {
    audio_file: filename,
    text: metadata.fullText,
    wpm: Math.round(metadata.effectiveWpm * 10) / 10,
    wpm_bucket: wpmBucket,
    duration_sec: Math.round(metadata.actualDurationSec * 100) / 100,
    tone_freq_hz: config.frequency,
    snr_db: Math.round(config.noise.snrDb * 10) / 10,
    content_category: contentCategory,
    augmentations: {
      fading_profile: fadingProfile,
      fading_depth: config.ionosphericFading?.depth ?? null,
      fading_rate_hz: config.ionosphericFading?.rate ?? null,
      jitter_pct: config.fist?.jitter ?? null,
      qrm_present: (config.cwQrm?.length ?? 0) > 0,
      qrm_separation_hz: config.cwQrm?.[0]?.frequencySeparation ?? null,
      impulse_rate: config.noise.qrn?.rate ?? null,
      multipath: config.multipath !== undefined,
      agc_applied: config.agc !== undefined,
      filter_bw_hz: null,
    },
    char_timestamps: metadata.characters.map((c) => ({
      char: c.char,
      start_ms: Math.round(c.startMs * 10) / 10,
      end_ms: Math.round(c.endMs * 10) / 10,
    })),
  };
}

// ============================================================================
// Audio Output (WAV format - no external dependencies)
// ============================================================================

// ============================================================================
// Single Sample Generation (for Python orchestration)
// ============================================================================

interface SingleSampleConfig {
  text: string;
  wpm: number;
  frequency: number;
  sampleRate: 8000 | 16000;
  durationSec?: number;
  seed?: number;
  noise: {
    snrDb: number;
    /** Slow QSB amplitude modulation of noise floor */
    qsb?: { depth: number; freqHz: number };
    /** Poisson impulse QRN */
    qrn?: { rate: number; amplitudeMultiplier: number };
    /** Power-line interference (sawtooth + AM + corona) */
    powerLine?: {
      baseHz: 50 | 60;
      level: number;
      buzzDepth: number;
      coronaLevel?: number;
    };
  };
  fist?: {
    jitter?: number;
  };
  ionosphericFading?: {
    depth: number;
    rate: number;
    components?: number;
  };
  multipath?: {
    paths: Array<{ delayMs: number; amplitude: number }>;
  };
  agc?: {
    attackMs: number;
    releaseMs: number;
    targetLevel: number;
  };
  dopplerSpread?: {
    spreadHz: number;
    components?: number;
  };
  pitchWobble?: {
    amplitude: number;
    rate: number;
    phase?: number;
  };
  chirp?: {
    deviation: number;
    timeConstant: number;
  };
}

async function generateSingleSample(
  configPath: string,
  outputPath: string
): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Read config
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config: SingleSampleConfig = JSON.parse(configContent);

  // Build full generation config
  const generator = createTrainingSampleGenerator();

  // biome-ignore lint/suspicious/noExplicitAny: built incrementally from optional config fields
  const genConfig: any = {
    text: config.text,
    wpm: config.wpm,
    frequency: config.frequency,
    sampleRate: config.sampleRate,
    noise: {
      snrDb: config.noise.snrDb,
      ...(config.noise.qsb ? { qsb: config.noise.qsb } : {}),
      ...(config.noise.qrn ? { qrn: config.noise.qrn } : {}),
      ...(config.noise.powerLine ? { powerLine: config.noise.powerLine } : {}),
    },
    durationSec: config.durationSec ?? 10,
    seed: config.seed ?? Date.now(),
  };

  // Add optional augmentations
  if (config.fist) {
    genConfig.fist = config.fist;
  }
  if (config.ionosphericFading) {
    genConfig.ionosphericFading = config.ionosphericFading;
  }
  if (config.multipath) {
    genConfig.multipath = config.multipath;
  }
  if (config.agc) {
    genConfig.agc = config.agc;
  }
  if (config.dopplerSpread) {
    genConfig.dopplerSpread = config.dopplerSpread;
  }
  if (config.pitchWobble) {
    genConfig.pitchWobble = config.pitchWobble;
  }
  if (config.chirp) {
    genConfig.chirp = config.chirp;
  }

  // Generate sample
  const sample = generator.generate(genConfig);

  // Truncate to target duration if needed
  const targetSamples = (config.durationSec ?? 10) * config.sampleRate;
  if (sample.audio.length > targetSamples) {
    sample.audio = sample.audio.slice(0, targetSamples);
    if (sample.noiseAudio) {
      sample.noiseAudio = sample.noiseAudio.slice(0, targetSamples);
    }
    sample.metadata.actualDurationSec = config.durationSec ?? 10;
    sample.metadata.totalSamples = targetSamples;

    // Filter timestamps
    const maxMs = (config.durationSec ?? 10) * 1000;
    sample.metadata.characters = sample.metadata.characters.filter(
      (c) => c.startMs < maxMs
    );
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write WAV file directly (no FLAC conversion needed)
  const wavBuffer = generator.toWavBuffer(sample);
  fs.writeFileSync(outputPath, Buffer.from(wavBuffer));

  // Output metadata to stdout (for Python to parse)
  const metadata = {
    fullText: sample.metadata.fullText,
    effectiveWpm: sample.metadata.effectiveWpm,
    actualDurationSec: sample.metadata.actualDurationSec,
    totalSamples: sample.metadata.totalSamples,
    characters: sample.metadata.characters.map((c) => ({
      char: c.char,
      startMs: c.startMs,
      endMs: c.endMs,
    })),
  };

  console.log(JSON.stringify(metadata));
}

// ============================================================================
// Batch Generation (JSONL mode for Python orchestration)
// ============================================================================

interface BatchSampleConfig extends SingleSampleConfig {
  outputPath: string; // Where to write this sample's WAV
  outputNoisePath?: string; // If set, write noise-only WAV here
}

async function generateBatchSamples(
  jsonlPath: string,
  metadataOutputPath: string
): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const readline = await import('node:readline');

  const generator = createTrainingSampleGenerator();

  // Read JSONL file line by line
  const fileStream = fs.createReadStream(jsonlPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  // biome-ignore lint/suspicious/noExplicitAny: aggregated metadata of mixed sample shapes
  const allMetadata: any[] = [];
  let count = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    const config: BatchSampleConfig = JSON.parse(line);
    count++;

    // Build generation config
    // biome-ignore lint/suspicious/noExplicitAny: built incrementally from optional config fields
    const genConfig: any = {
      text: config.text,
      wpm: config.wpm,
      frequency: config.frequency,
      sampleRate: config.sampleRate,
      noise: {
        snrDb: config.noise.snrDb,
        ...(config.noise.qsb ? { qsb: config.noise.qsb } : {}),
        ...(config.noise.qrn ? { qrn: config.noise.qrn } : {}),
      },
      durationSec: config.durationSec ?? 10,
      seed: config.seed ?? Date.now(),
    };

    if (config.outputNoisePath)
      genConfig.outputNoisePath = config.outputNoisePath;

    // Add optional augmentations
    if (config.fist) genConfig.fist = config.fist;
    if (config.ionosphericFading)
      genConfig.ionosphericFading = config.ionosphericFading;
    if (config.multipath) genConfig.multipath = config.multipath;
    if (config.agc) genConfig.agc = config.agc;
    if (config.dopplerSpread) genConfig.dopplerSpread = config.dopplerSpread;
    if (config.pitchWobble) genConfig.pitchWobble = config.pitchWobble;
    if (config.chirp) genConfig.chirp = config.chirp;

    // Generate sample
    const sample = generator.generate(genConfig);

    // Truncate to target duration if needed
    const targetSamples = (config.durationSec ?? 10) * config.sampleRate;
    if (sample.audio.length > targetSamples) {
      sample.audio = sample.audio.slice(0, targetSamples);
      if (sample.noiseAudio) {
        sample.noiseAudio = sample.noiseAudio.slice(0, targetSamples);
      }
      sample.metadata.actualDurationSec = config.durationSec ?? 10;
      sample.metadata.totalSamples = targetSamples;

      const maxMs = (config.durationSec ?? 10) * 1000;
      sample.metadata.characters = sample.metadata.characters.filter(
        (c) => c.startMs < maxMs
      );
    }

    // Ensure output directory exists
    const outputDir = path.dirname(config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write WAV file directly (no FLAC conversion needed)
    const wavBuffer = generator.toWavBuffer(sample);
    fs.writeFileSync(config.outputPath, Buffer.from(wavBuffer));

    // Write noise-only WAV if requested
    if (config.outputNoisePath && sample.noiseAudio) {
      const noiseSample = {
        audio: sample.noiseAudio,
        metadata: sample.metadata,
      };
      const noiseWavBuffer = generator.toWavBuffer(noiseSample);
      const noiseDir = path.dirname(config.outputNoisePath);
      if (!fs.existsSync(noiseDir)) fs.mkdirSync(noiseDir, { recursive: true });
      fs.writeFileSync(config.outputNoisePath, Buffer.from(noiseWavBuffer));
    }

    // Collect metadata
    allMetadata.push({
      outputPath: config.outputPath,
      noisePath: config.outputNoisePath ?? null,
      fullText: sample.metadata.fullText,
      effectiveWpm: sample.metadata.effectiveWpm,
      actualDurationSec: sample.metadata.actualDurationSec,
      totalSamples: sample.metadata.totalSamples,
      characters: sample.metadata.characters.map((c) => ({
        char: c.char,
        startMs: c.startMs,
        endMs: c.endMs,
      })),
      elements: sample.metadata.elements?.map((e) => ({
        char: e.char,
        elementType: e.elementType,
        startMs: e.startMs,
        endMs: e.endMs,
      })),
    });

    // Progress indicator to stderr (so it doesn't interfere with stdout)
    if (count % 100 === 0) {
      process.stderr.write(`Generated ${count} samples\n`);
    }
  }

  // Write all metadata to output file
  fs.writeFileSync(metadataOutputPath, JSON.stringify(allMetadata));
  process.stderr.write(
    `Done: generated ${count} samples, metadata written to ${metadataOutputPath}\n`
  );
}

// ============================================================================
// FLAC encoding helpers
// ============================================================================

function checkFlacAvailable(): boolean {
  try {
    execSync('flac --version', { stdio: 'ignore' });
    return true;
  } catch {}
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {}
  return false;
}

function wavToFlac(wavPath: string, flacPath: string): void {
  try {
    execSync(`flac --silent --force -o "${flacPath}" "${wavPath}"`);
    return;
  } catch {}
  execSync(`ffmpeg -y -i "${wavPath}" "${flacPath}"`, { stdio: 'ignore' });
}

// ============================================================================
// Main Generation Logic
// ============================================================================

async function generateDataset(args: CliArgs): Promise<void> {
  const startTime = Date.now();

  // Check for FLAC encoder
  if (!checkFlacAvailable()) {
    console.error(
      'Error: Neither flac nor ffmpeg found. Please install one of them for FLAC encoding.'
    );
    console.error('  macOS: brew install flac');
    console.error('  Ubuntu: apt install flac');
    process.exit(1);
  }

  // Create directory structure
  const splitDir = join(args.output, args.split);
  const audioDir = join(splitDir, 'audio');

  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true });
  }

  console.log(`Generating ${args.count} samples for split: ${args.split}`);
  console.log(`Output directory: ${splitDir}`);
  console.log(`Sample rate: ${SAMPLE_RATE} Hz, Format: FLAC`);
  console.log(`Seed: ${args.seed}`);
  console.log('');
  if (args.split === 'phase0') {
    console.log(
      'Phase0 mode: Fixed 20 WPM, +15 dB SNR, no augmentations, unique callsigns'
    );
    console.log('');
  } else {
    console.log('WPM Buckets:');
    console.log('  slow (12-20 WPM):   30s, 30% of samples');
    console.log('  medium (20-30 WPM): 15s, 50% of samples');
    console.log('  fast (30-40 WPM):   10s, 20% of samples');
    console.log('');
  }

  const generator = createTrainingSampleGenerator();
  const textGen = new TextGenerator(args.seed);
  const distributions = getDistributionsForSplit(args.split);

  // Create seeded PRNG
  let seed = args.seed;
  const prng = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Prepare labels file
  const labelsPath = join(splitDir, 'labels.jsonl.gz');
  const labelsStream = createWriteStream(labelsPath);
  const gzipStream = createGzip();
  gzipStream.pipe(labelsStream);

  // Track statistics
  const stats = {
    wpmBuckets: { slow: 0, medium: 0, fast: 0 },
    snrBuckets: { veryLow: 0, low: 0, mid: 0, high: 0, veryHigh: 0 },
    contentCategories: {} as Record<string, number>,
    fadingApplied: 0,
    qrmApplied: 0,
    multipathApplied: 0,
    totalDurationSec: 0,
  };

  // Generate samples
  const batchSize = 100;
  let generated = 0;

  while (generated < args.count) {
    const batchCount = Math.min(batchSize, args.count - generated);

    for (let i = 0; i < batchCount; i++) {
      const sampleIndex = generated + i;
      const sampleNum = String(sampleIndex + 1).padStart(6, '0');
      const wavFilename = `sample_${sampleNum}.wav`;
      const flacFilename = `sample_${sampleNum}.flac`;

      // Sample WPM bucket (phase0 uses fixed 20 WPM with short duration)
      let bucket: WpmBucketName;
      let wpm: number;
      let durationSec: number;

      if (args.split === 'phase0') {
        bucket = 'medium';
        wpm = 20;
        durationSec = 5; // Short duration for short messages
      } else {
        const sampled = sampleWpmBucket(prng);
        bucket = sampled.bucket;
        wpm = sampled.wpm;
        durationSec = sampled.durationSec;
      }
      stats.wpmBuckets[bucket]++;

      // Generate content appropriate for duration (phase0 uses short texts)
      const { text, category } =
        args.split === 'phase0'
          ? textGen.generateShortText()
          : textGen.generateContentForDuration(wpm, durationSec);
      stats.contentCategories[category] =
        (stats.contentCategories[category] || 0) + 1;

      // Sample SNR
      const snrDb = sampleSnr(prng, args.split);

      // Track SNR stats
      if (snrDb < -10) stats.snrBuckets.veryLow++;
      else if (snrDb < -5) stats.snrBuckets.low++;
      else if (snrDb < 5) stats.snrBuckets.mid++;
      else if (snrDb < 15) stats.snrBuckets.high++;
      else stats.snrBuckets.veryHigh++;

      // Generate sample with all augmentations via generate() directly for sample rate control
      const frequency = 400 + Math.floor(prng() * 500); // 400-900 Hz
      const sampleSeed = Math.floor(prng() * 2147483647);

      // Build noise config with optional QSB/QRN/power-line augmentations
      const noiseConfig: {
        snrDb: number;
        qsb?: { depth: number; freqHz: number };
        qrn?: { rate: number; amplitudeMultiplier: number };
        powerLine?: {
          baseHz: 50 | 60;
          level: number;
          buzzDepth: number;
          coronaLevel?: number;
        };
      } = { snrDb };
      if (args.split !== 'phase0') {
        if (prng() < distributions.qsbProbability) {
          noiseConfig.qsb = {
            depth: 0.04 + prng() * 0.1,
            freqHz: 0.1 + prng() * 0.6,
          };
        }
        if (prng() < distributions.qrnProbability) {
          noiseConfig.qrn = {
            rate: 2 + prng() * 6,
            amplitudeMultiplier: 3 + prng() * 5,
          };
        }
        if (prng() < distributions.powerLineProbability) {
          noiseConfig.powerLine = {
            baseHz: prng() < 0.7 ? 60 : 50,
            level: 8 + prng() * 14,
            buzzDepth: 0.25 + prng() * 0.45,
            coronaLevel: 0.1 + prng() * 0.4,
          };
        }
      }

      // biome-ignore lint/suspicious/noExplicitAny: built incrementally from optional config fields
      const config: any = {
        text,
        wpm,
        frequency,
        sampleRate: SAMPLE_RATE as 8000 | 16000,
        noise: noiseConfig,
        durationSec: durationSec + 1, // Generate slightly longer, then truncate
        seed: sampleSeed,
      };

      // Apply augmentations based on distributions (skip all for phase0)
      if (args.split !== 'phase0') {
        if (prng() < distributions.ionosphericFadingProbability) {
          const depth = 0.1 + prng() * 0.8;
          const rate = 0.06 + prng() * 0.29;
          const components = prng() < 0.65 ? 2 : 3;
          config.ionosphericFading = { depth, rate, components };
        }

        if (prng() < distributions.multipathProbability) {
          config.multipath = {
            paths: [
              { delayMs: 1 + prng() * 4, amplitude: 0.3 + prng() * 0.4 },
              { delayMs: 3 + prng() * 7, amplitude: 0.1 + prng() * 0.3 },
            ],
          };
        }

        if (prng() < distributions.dopplerSpreadProbability) {
          config.dopplerSpread = {
            spreadHz: 1 + prng() * 19,
            components: 3 + Math.floor(prng() * 4),
          };
        }

        if (prng() < distributions.agcProbability) {
          config.agc = {
            attackMs: 5 + prng() * 15,
            releaseMs: 50 + prng() * 150,
            targetLevel: 0.5 + prng() * 0.3,
          };
        }

        if (prng() < distributions.pitchWobbleProbability) {
          config.pitchWobble = {
            amplitude: prng() * 3,
            rate: 0.01 + prng() * 0.09,
            phase: prng() * 2 * Math.PI,
          };
        }

        if (prng() < distributions.chirpProbability) {
          config.chirp = {
            deviation: 5 + prng() * 25,
            timeConstant: 10,
          };
        }

        // Fist model based on distribution
        const fistRoll = prng();
        let cumulative = 0;
        for (const [profile, prob] of Object.entries(
          distributions.fistDistribution
        )) {
          cumulative += prob ?? 0;
          if (fistRoll < cumulative) {
            config.fist = getFistOptions(profile as FistProfile, prng);
            break;
          }
        }
      }
      // phase0: no fist jitter, perfect machine timing (default)

      const sample = generator.generate(config);

      // Truncate audio to exact bucket duration
      const targetSamples = durationSec * SAMPLE_RATE;
      if (sample.audio.length > targetSamples) {
        sample.audio = sample.audio.slice(0, targetSamples);
        if (sample.noiseAudio) {
          sample.noiseAudio = sample.noiseAudio.slice(0, targetSamples);
        }
        sample.metadata.actualDurationSec = durationSec;
        sample.metadata.totalSamples = targetSamples;
        // Filter out char_timestamps that exceed the duration
        const maxMs = durationSec * 1000;
        sample.metadata.characters = sample.metadata.characters.filter(
          (c) => c.startMs < maxMs
        );
      }

      // Track augmentation stats
      if (sample.metadata.config.ionosphericFading) stats.fadingApplied++;
      if (sample.metadata.config.cwQrm?.length) stats.qrmApplied++;
      if (sample.metadata.config.multipath) stats.multipathApplied++;
      stats.totalDurationSec += sample.metadata.actualDurationSec;

      // Write WAV file temporarily
      const wavBuffer = generator.toWavBuffer(sample);
      const wavPath = join(audioDir, wavFilename);
      const flacPath = join(audioDir, flacFilename);
      writeFileSync(wavPath, Buffer.from(wavBuffer));

      // Convert to FLAC
      try {
        wavToFlac(wavPath, flacPath);
        unlinkSync(wavPath); // Remove temp WAV
      } catch (err) {
        console.error(`\nFailed to convert ${wavFilename} to FLAC:`, err);
        // Keep WAV as fallback
      }

      // Write label to JSONL
      const label = metadataToLabel(
        existsSync(flacPath) ? flacFilename : wavFilename,
        sample.metadata,
        category,
        bucket
      );
      gzipStream.write(`${JSON.stringify(label)}\n`);
    }

    generated += batchCount;

    // Progress update
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = generated / elapsed;
    const remaining = (args.count - generated) / rate;

    process.stdout.write(
      `\rGenerated ${generated}/${args.count} samples (${rate.toFixed(1)}/s, ~${Math.ceil(remaining)}s remaining)`
    );
  }

  // Finalize labels file
  gzipStream.end();
  await new Promise<void>((resolve) => labelsStream.on('finish', resolve));

  console.log('\n\nGeneration complete!');
  console.log('');
  console.log('Statistics:');
  console.log(`  WPM bucket distribution:`);
  console.log(
    `    slow (12-20 WPM, 30s):   ${stats.wpmBuckets.slow} (${((stats.wpmBuckets.slow / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `    medium (20-30 WPM, 15s): ${stats.wpmBuckets.medium} (${((stats.wpmBuckets.medium / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `    fast (30-40 WPM, 10s):   ${stats.wpmBuckets.fast} (${((stats.wpmBuckets.fast / args.count) * 100).toFixed(1)}%)`
  );
  console.log(`  SNR distribution:`);
  console.log(
    `    -15 to -10 dB: ${stats.snrBuckets.veryLow} (${((stats.snrBuckets.veryLow / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `    -10 to -5 dB:  ${stats.snrBuckets.low} (${((stats.snrBuckets.low / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `    -5 to +5 dB:   ${stats.snrBuckets.mid} (${((stats.snrBuckets.mid / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `    +5 to +15 dB:  ${stats.snrBuckets.high} (${((stats.snrBuckets.high / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `    +15 to +20 dB: ${stats.snrBuckets.veryHigh} (${((stats.snrBuckets.veryHigh / args.count) * 100).toFixed(1)}%)`
  );
  console.log(`  Content categories:`);
  for (const [cat, count] of Object.entries(stats.contentCategories).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(
      `    ${cat}: ${count} (${((count / args.count) * 100).toFixed(1)}%)`
    );
  }
  console.log(`  Augmentations:`);
  console.log(
    `    Fading applied: ${stats.fadingApplied} (${((stats.fadingApplied / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `    QRM applied:    ${stats.qrmApplied} (${((stats.qrmApplied / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `    Multipath:      ${stats.multipathApplied} (${((stats.multipathApplied / args.count) * 100).toFixed(1)}%)`
  );
  console.log(
    `  Total audio duration: ${(stats.totalDurationSec / 3600).toFixed(2)} hours`
  );

  // Write metadata file
  const metadataPath = join(args.output, 'metadata.json');
  const metadata = {
    version: '1.1',
    generated: new Date().toISOString(),
    sampleRate: SAMPLE_RATE,
    format: 'flac',
    wpmBuckets: WPM_BUCKETS,
    splits: {
      [args.split]: {
        count: args.count,
        seed: args.seed,
        statistics: stats,
      },
    },
  };

  // Merge with existing metadata if present
  if (existsSync(metadataPath)) {
    try {
      const existing = JSON.parse(
        require('node:fs').readFileSync(metadataPath, 'utf-8')
      );
      metadata.splits = { ...existing.splits, ...metadata.splits };
    } catch {
      // Ignore parse errors
    }
  }

  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  const totalTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log(`Total time: ${totalTime.toFixed(1)}s`);
  console.log(`Output: ${splitDir}`);
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Handle single sample generation from JSON config
  if (args.fromJson) {
    try {
      await generateSingleSample(args.fromJson, args.output);
    } catch (error) {
      console.error('Single sample generation failed:', error);
      process.exit(1);
    }
    return;
  }

  // Handle batch generation from JSONL config
  if (args.fromJsonl) {
    try {
      // Output path is used as metadata output path for batch mode
      await generateBatchSamples(args.fromJsonl, args.output);
    } catch (error) {
      console.error('Batch generation failed:', error);
      process.exit(1);
    }
    return;
  }

  if (args.count <= 0) {
    console.error('Count must be positive');
    process.exit(1);
  }

  try {
    await generateDataset(args);
  } catch (error) {
    console.error('Generation failed:', error);
    process.exit(1);
  }
}

main();
