import type { CallsignEntry } from '../types';
import { extractWpxPrefix, getContinentFromPrefix } from './prefixExtractor';
import { initCallsignDatabase, getCallsigns, shuffle as sharedShuffle } from '../../../shared/callsigns';

// Static seed pool of realistic callsigns (used as fallback)
const SEED_CALLSIGNS: CallsignEntry[] = [
  // USA (30 calls)
  { call: 'W1ABC', prefix: 'W1', continent: 'NA' },
  { call: 'K1TTT', prefix: 'K1', continent: 'NA' },
  { call: 'N1MM', prefix: 'N1', continent: 'NA' },
  { call: 'W2GD', prefix: 'W2', continent: 'NA' },
  { call: 'K2MK', prefix: 'K2', continent: 'NA' },
  { call: 'N2NT', prefix: 'N2', continent: 'NA' },
  { call: 'W3LPL', prefix: 'W3', continent: 'NA' },
  { call: 'K3LR', prefix: 'K3', continent: 'NA' },
  { call: 'DL1ABC', prefix: 'DL1', continent: 'EU' },
  { call: 'G3SXW', prefix: 'G3', continent: 'EU' },
  { call: 'JA1YXP', prefix: 'JA1', continent: 'AS' },
  { call: 'VK2IA', prefix: 'VK2', continent: 'OC' },
  { call: 'PY2YU', prefix: 'PY2', continent: 'SA' },
];

let loadedPool: CallsignEntry[] | null = null;
let loadPromise: Promise<CallsignEntry[]> | null = null;

/**
 * Convert raw callsign strings to CallsignEntry objects
 */
function toCallsignEntries(calls: string[]): CallsignEntry[] {
  return calls.map(call => {
    const prefix = extractWpxPrefix(call);
    const continent = getContinentFromPrefix(prefix);
    return { call, prefix, continent };
  });
}

/**
 * Initialize the callsign pool from the shared database
 */
export function initCallsignPool(): Promise<CallsignEntry[]> {
  if (loadedPool) {
    return Promise.resolve(loadedPool);
  }
  if (!loadPromise) {
    loadPromise = initCallsignDatabase('.').then(() => {
      const rawCalls = getCallsigns();
      loadedPool = toCallsignEntries(rawCalls);
      console.log(`Callsign pool initialized with ${loadedPool.length} entries`);
      return loadedPool;
    });
  }
  return loadPromise;
}

/**
 * Get the callsign pool (loaded or fallback)
 */
export function getCallsignPool(): CallsignEntry[] {
  return loadedPool ?? SEED_CALLSIGNS;
}

// Legacy export for compatibility
export const CALLSIGN_POOL = SEED_CALLSIGNS;

// Shuffle an array using Fisher-Yates
export function shuffle<T>(array: T[]): T[] {
  return sharedShuffle(array);
}

// Random integer between min and max (inclusive)
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Start loading on module init
initCallsignPool();
