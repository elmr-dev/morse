#!/usr/bin/env node
/**
 * Persistent worker for ML training data generation.
 *
 * Single process, reads newline-delimited JSON commands from stdin,
 * generates audio samples, writes WAVs, returns metadata on stdout.
 *
 * Protocol:
 *   Startup: {"status":"ready"}
 *   Request: {"cmd":"generate_batch","configs":[...]}
 *   Response: {"status":"ok","count":N,"metadata":[...]}
 *   Shutdown: {"cmd":"shutdown"}
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { createInterface } from 'readline';
import { createTrainingSampleGenerator } from './index';

interface BatchSampleConfig {
  text: string;
  wpm: number;
  frequency: number;
  sampleRate: 8000 | 16000;
  durationSec?: number;
  seed?: number;
  noise: {
    snrDb: number;
    usePinkBlend?: boolean;
    pinkBlendRatio?: number;
  };
  receiverBandwidth?: number;
  outputPath: string;
  fist?: { jitter?: number };
  ionosphericFading?: { depth: number; rate: number; components?: number };
  multipath?: { paths: Array<{ delayMs: number; amplitude: number }> };
  agc?: { attackMs: number; releaseMs: number; targetLevel: number };
  dopplerSpread?: { spreadHz: number; components?: number };
  pitchWobble?: { amplitude: number; rate: number; phase?: number };
  chirp?: { deviation: number; timeConstant: number };
  skipBandwidthFilter?: boolean;
}

function buildGenConfig(config: BatchSampleConfig): any {
  const genConfig: any = {
    text: config.text,
    wpm: config.wpm,
    frequency: config.frequency,
    sampleRate: config.sampleRate,
    noise: {
      snrDb: config.noise.snrDb,
      usePinkBlend: config.noise.usePinkBlend ?? false,
      pinkBlendRatio: config.noise.pinkBlendRatio ?? 0,
    },
    receiverBandwidth: config.receiverBandwidth ?? 300,
    durationSec: config.durationSec ?? 10,
    seed: config.seed ?? Date.now(),
  };

  if (config.skipBandwidthFilter) genConfig.skipBandwidthFilter = true;
  if (config.fist) genConfig.fist = config.fist;
  if (config.ionosphericFading) genConfig.ionosphericFading = config.ionosphericFading;
  if (config.multipath) genConfig.multipath = config.multipath;
  if (config.agc) genConfig.agc = config.agc;
  if (config.dopplerSpread) genConfig.dopplerSpread = config.dopplerSpread;
  if (config.pitchWobble) genConfig.pitchWobble = config.pitchWobble;
  if (config.chirp) genConfig.chirp = config.chirp;

  return genConfig;
}

async function main(): Promise<void> {
  const generator = createTrainingSampleGenerator();

  process.stdout.write(JSON.stringify({ status: 'ready' }) + '\n');

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let command: { cmd: string; configs?: BatchSampleConfig[] };
    try {
      command = JSON.parse(line);
    } catch (err) {
      process.stderr.write(`Worker: invalid JSON: ${err}\n`);
      process.stdout.write(JSON.stringify({ status: 'error', error: 'invalid JSON' }) + '\n');
      continue;
    }

    if (command.cmd === 'shutdown') {
      process.stderr.write('Worker: shutting down\n');
      break;
    }

    if (command.cmd === 'generate_batch') {
      const configs = command.configs ?? [];
      const metadata: any[] = [];

      for (const config of configs) {
        try {
          const genConfig = buildGenConfig(config);
          const sample = generator.generate(genConfig);

          const targetSamples = (config.durationSec ?? 10) * config.sampleRate;
          if (sample.audio.length > targetSamples) {
            sample.audio = sample.audio.slice(0, targetSamples);
            sample.metadata.actualDurationSec = config.durationSec ?? 10;
            sample.metadata.totalSamples = targetSamples;
            const maxMs = (config.durationSec ?? 10) * 1000;
            sample.metadata.characters = sample.metadata.characters.filter(c => c.startMs < maxMs);
          }

          const outputDir = dirname(config.outputPath);
          if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
          }

          const wavBuffer = generator.toWavBuffer(sample);
          writeFileSync(config.outputPath, Buffer.from(wavBuffer));

          metadata.push({
            outputPath: config.outputPath,
            fullText: sample.metadata.fullText,
            effectiveWpm: sample.metadata.effectiveWpm,
            actualDurationSec: sample.metadata.actualDurationSec,
            totalSamples: sample.metadata.totalSamples,
            characters: sample.metadata.characters.map(c => ({
              char: c.char,
              startMs: c.startMs,
              endMs: c.endMs,
            })),
          });
        } catch (err) {
          process.stderr.write(`Worker: error generating sample: ${err}\n`);
          metadata.push({ error: String(err) });
        }
      }

      process.stdout.write(JSON.stringify({ status: 'ok', count: metadata.length, metadata }) + '\n');
      continue;
    }

    process.stdout.write(JSON.stringify({ status: 'error', error: `unknown command: ${command.cmd}` }) + '\n');
  }

  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`Worker fatal: ${err}\n`);
  process.exit(1);
});
