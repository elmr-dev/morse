/**
 * CWOps Member Pool for CWT Contest
 *
 * Loads and manages the CWOps member database for realistic CWT contest simulation.
 * Members send their CWOps number as exchange, non-members send state/DXCC.
 */

import { extractWpxPrefix, getContinentFromPrefix } from './prefixExtractor';

export interface CWOpsMember {
  call: string;
  name: string;
  number: string; // Numeric for members, DXCC prefix or state for non-members
  dxcc: string;
  state?: string; // For W/VE only
  isMember: boolean; // true if number is numeric
  prefix: string; // WPX prefix for multiplier tracking
  continent: 'NA' | 'SA' | 'EU' | 'AS' | 'OC' | 'AF';
}

// Region data for non-member exchange generation
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
];

const CA_PROVINCES = ['ON', 'BC', 'AB', 'QC', 'NS', 'MB', 'SK', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU'];

const COMMON_DX_PREFIXES = ['DL', 'G', 'F', 'I', 'SP', 'OK', 'ON', 'PA', 'HA', 'JA', 'VK', 'ZL', 'LU', 'PY', 'CE'];

let cwopsPool: CWOpsMember[] | null = null;
let loadPromise: Promise<CWOpsMember[]> | null = null;

/**
 * Parse the CWOps CSV file
 * CSV format (after 9 header rows):
 * Col 0: Paid status
 * Col 1: LIFE/year
 * Col 2: Callsign
 * Col 3: Number
 * Col 4: First/Nick Name
 * Col 5: Last Name
 * Col 6: DXCC
 * Col 7: W/VE State
 * Col 8+: Other fields
 */
function parseCWOpsCSV(csvText: string): CWOpsMember[] {
  const lines = csvText.split('\n');
  const members: CWOpsMember[] = [];

  // Skip first 9 header rows
  for (let i = 9; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV (handle quoted fields)
    const fields = parseCSVLine(line);

    const call = fields[2]?.trim();
    const numberRaw = fields[3]?.trim();
    const name = fields[4]?.trim();
    const dxcc = fields[6]?.trim();
    const state = fields[7]?.trim();

    // Skip invalid entries
    if (!call || !name || !numberRaw) continue;

    // Determine if this is a member (numeric number)
    const isMember = /^\d+$/.test(numberRaw);

    const prefix = extractWpxPrefix(call);
    const continent = getContinentFromPrefix(prefix);

    members.push({
      call,
      name: name.toUpperCase(),
      number: numberRaw,
      dxcc: dxcc || '',
      state: state && state !== '--' ? state : undefined,
      isMember,
      prefix,
      continent,
    });
  }

  return members;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);

  return fields;
}

/**
 * Load the CWOps pool from CSV file
 */
export async function loadCWOpsPool(): Promise<CWOpsMember[]> {
  if (cwopsPool) {
    return cwopsPool;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const response = await fetch('./data/cwops-2026-02-09.csv');
        if (!response.ok) {
          throw new Error(`Failed to load CWOps CSV: ${response.statusText}`);
        }
        const csvText = await response.text();
        cwopsPool = parseCWOpsCSV(csvText);
        console.log(`CWOps pool loaded with ${cwopsPool.length} members`);
        return cwopsPool;
      } catch (error) {
        console.error('Failed to load CWOps pool:', error);
        // Return empty array on failure
        cwopsPool = [];
        return cwopsPool;
      }
    })();
  }

  return loadPromise;
}

/**
 * Get the loaded CWOps pool (empty if not loaded)
 */
export function getCWOpsPool(): CWOpsMember[] {
  return cwopsPool ?? [];
}

/**
 * Check if the CWOps pool is loaded
 */
export function isCWOpsPoolLoaded(): boolean {
  return cwopsPool !== null && cwopsPool.length > 0;
}

/**
 * Pick a random element from an array
 */
function randomFrom<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Pick a region for non-member exchange based on caller's DXCC
 */
function pickNonMemberExchange(member: CWOpsMember): string {
  // If US station, use state
  if (member.dxcc === 'K' || member.dxcc === 'W' || member.dxcc === 'N') {
    return member.state || randomFrom(US_STATES);
  }

  // If Canadian station, use province
  if (member.dxcc === 'VE' || member.dxcc === 'VA' || member.dxcc === 'VY') {
    return member.state || randomFrom(CA_PROVINCES);
  }

  // For DX, use their DXCC prefix
  return member.dxcc || randomFrom(COMMON_DX_PREFIXES);
}

/**
 * Pick a CWT caller with 95% member / 5% non-member distribution
 * Returns caller data with appropriate exchange
 */
export interface CwtCallerData {
  call: string;
  name: string;
  number: string; // Member # or state/DXCC
  isMember: boolean;
  prefix: string;
  continent: 'NA' | 'SA' | 'EU' | 'AS' | 'OC' | 'AF';
}

export function pickCwtCaller(pool: CWOpsMember[]): CwtCallerData {
  if (pool.length === 0) {
    // Fallback if pool is empty
    return {
      call: 'W1AW',
      name: 'HIRAM',
      number: '1',
      isMember: true,
      prefix: 'W1',
      continent: 'NA',
    };
  }

  const member = randomFrom(pool);

  // 95% chance to use as member with their real number
  if (Math.random() < 0.95 && member.isMember) {
    return {
      call: member.call,
      name: member.name,
      number: member.number,
      isMember: true,
      prefix: member.prefix,
      continent: member.continent,
    };
  }

  // 5% chance to convert to non-member (or if they're already non-member)
  const nonMemberExchange = pickNonMemberExchange(member);
  return {
    call: member.call,
    name: member.name,
    number: nonMemberExchange,
    isMember: false,
    prefix: member.prefix,
    continent: member.continent,
  };
}

/**
 * Validate CWT exchange (handles cut numbers for member numbers)
 */
export function validateCwtExchange(entered: string, actual: string, isMember: boolean): boolean {
  if (!entered || !actual) return false;

  const enteredUpper = entered.toUpperCase().trim();
  const actualUpper = actual.toUpperCase().trim();

  // If actual is numeric (member #), allow cut number variations
  if (isMember && /^\d+$/.test(actualUpper)) {
    // Normalize cut numbers in entered value
    const normalized = enteredUpper
      .replace(/T/g, '0')
      .replace(/N/g, '9')
      .replace(/A/g, '1')
      .replace(/E/g, '5');

    // Compare as numbers
    const enteredNum = parseInt(normalized, 10);
    const actualNum = parseInt(actualUpper, 10);
    return !isNaN(enteredNum) && enteredNum === actualNum;
  }

  // For non-members (state/DXCC), exact case-insensitive match
  return enteredUpper === actualUpper;
}

/**
 * Validate CWT name
 */
export function validateCwtName(entered: string, actual: string): boolean {
  if (!entered || !actual) return false;
  return entered.toUpperCase().trim() === actual.toUpperCase().trim();
}

// Start loading on module init
loadCWOpsPool();
