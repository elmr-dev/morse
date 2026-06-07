// Random amateur-radio callsign generator, weighted by region.
//
// The Beat-the-Bot demo plays callsigns specifically (not random alphanumeric
// strings) because that's the realistic real-world copying task — call-area
// letters + digit + suffix is the structure ham operators are listening for.
//
// Weighting: US > Canada > rest of world, matching the relative density of
// licensed amateurs and the user-base demographics of a North-America-hosted
// demo. Rough percentages: 60% US, 25% Canada, 15% world.

export interface CallsignOptions {
  /** Weights for each region. Defaults to 60/25/15 US/CA/world. */
  weights?: { us: number; canada: number; world: number };
  /** Optional fixed PRNG for deterministic test output. Returns [0, 1). */
  rng?: () => number;
}

const DEFAULT_WEIGHTS = { us: 0.6, canada: 0.25, world: 0.15 };

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// US prefixes — FCC issues 1×1 (K/W/N), 1×2 (Kx/Wx/Nx), and 2×1 (Ax) for
// amateur. 1×1 are oldest/rarest historically but uniformly distributed
// when sampling from current call books. We bias toward 1×1 + 1×2 because
// they're the most common on the air.
const US_PREFIXES_1L = ['K', 'W', 'N']; // weight ~3
const US_PREFIXES_2L = [
  // K + letter
  'KA',
  'KB',
  'KC',
  'KD',
  'KE',
  'KF',
  'KG',
  'KI',
  'KJ',
  'KK',
  'KM',
  'KN',
  'KO',
  'KQ',
  'KR',
  'KS',
  'KT',
  'KU',
  'KV',
  'KW',
  'KX',
  'KY',
  'KZ',
  // W + letter
  'WA',
  'WB',
  'WD',
  'WE',
  'WF',
  'WG',
  'WI',
  'WJ',
  'WK',
  'WM',
  'WN',
  'WO',
  'WQ',
  'WR',
  'WS',
  'WT',
  'WU',
  'WV',
  'WW',
  'WX',
  'WY',
  'WZ',
  // N + letter
  'NA',
  'NB',
  'NC',
  'ND',
  'NE',
  'NF',
  'NG',
  'NI',
  'NJ',
  'NK',
  'NM',
  'NO',
  'NP',
  'NQ',
  'NR',
  'NS',
  'NT',
  'NU',
  'NV',
  'NW',
  'NX',
  'NY',
  'NZ',
  // 2x1 Extra-class: AA-AL
  'AA',
  'AB',
  'AC',
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AJ',
  'AK',
  'AL',
];

// Canadian prefixes — VE is by far the most common (issued in all provinces
// since 1970); VA is the recent expansion. VO is Newfoundland/Labrador,
// VY is Yukon/NWT/Nunavut. Weight VE strongly.
const CA_PREFIXES_VE_HEAVY = [
  'VE',
  'VE',
  'VE',
  'VE',
  'VE',
  'VE', // 6× VE
  'VA',
  'VA',
  'VA', // 3× VA
  'VO',
  'VY',
  'VC',
  'VG',
];

// World — pick a pool of common ham prefixes by country. We don't try to
// be globally representative; we want plausibility, not statistical accuracy.
// The pool is biased toward Europe + East Asia + Oceania, which are the
// most active CW regions outside North America.
const WORLD_PREFIXES = [
  // UK + dependencies
  'G',
  'M',
  'GW',
  'GM',
  'GI',
  'GU',
  'GD',
  'GJ',
  // Germany / Austria / Switzerland
  'DL',
  'DK',
  'DH',
  'DJ',
  'DF',
  'DG',
  'OE',
  'HB9',
  // Italy / France / Spain / Portugal
  'I',
  'IK',
  'IZ',
  'F',
  'EA',
  'EB',
  'CT',
  // Netherlands / Belgium / Scandinavia
  'PA',
  'PD',
  'ON',
  'OZ',
  'SM',
  'LA',
  'OH',
  // Eastern Europe
  'OK',
  'OM',
  'SP',
  'HA',
  'YO',
  'YU',
  '9A',
  'S5',
  'LZ',
  // Russia / Ukraine
  'RA',
  'RW',
  'RV',
  'RZ',
  'UR',
  'UT',
  'UA',
  // Asia / Oceania / South America
  'JA',
  'JE',
  'JF',
  'JH',
  'JR',
  'BG',
  'BH',
  'HL',
  'BV',
  'VK',
  'ZL',
  'PY',
  'LU',
  'CE',
  'CX',
];

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randomLetters(n: number, rng: () => number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += pick(ALPHA, rng);
  return s;
}

function randomDigit(rng: () => number, allowZero = true): string {
  // Avoid leading zeros in some prefixes — call-area zero exists (e.g. K0)
  // but is rarer. Allow it by default; callers can opt out.
  const min = allowZero ? 0 : 1;
  return String(min + Math.floor(rng() * (10 - min)));
}

/** Generate a US-style callsign. */
export function randomUsCallsign(rng: () => number = Math.random): string {
  // Bias slightly toward 1-letter prefixes (more common on the air).
  const pool = rng() < 0.55 ? US_PREFIXES_1L : US_PREFIXES_2L;
  const prefix = pick(pool, rng);
  const digit = randomDigit(rng);
  // Suffix 2-3 letters; 2-letter calls are Extras only, so mix.
  const suffix = randomLetters(rng() < 0.3 ? 2 : 3, rng);
  return `${prefix}${digit}${suffix}`;
}

/** Generate a Canadian-style callsign. */
export function randomCanadianCallsign(
  rng: () => number = Math.random
): string {
  const prefix = pick(CA_PREFIXES_VE_HEAVY, rng);
  const digit = randomDigit(rng, false); // VEx where x in 1-9
  const suffix = randomLetters(rng() < 0.3 ? 2 : 3, rng);
  return `${prefix}${digit}${suffix}`;
}

/** Generate a callsign from somewhere else in the world. */
export function randomWorldCallsign(rng: () => number = Math.random): string {
  const prefix = pick(WORLD_PREFIXES, rng);
  const digit = randomDigit(rng);
  // World suffixes vary 1-3 letters; 2-3 is most common for ham calls.
  const suffix = randomLetters(rng() < 0.2 ? 2 : 3, rng);
  return `${prefix}${digit}${suffix}`;
}

/**
 * Generate a random callsign weighted by region (US > Canada > world).
 * Default weights: 60% US, 25% Canada, 15% world.
 */
export function randomCallsign(opts: CallsignOptions = {}): string {
  const rng = opts.rng ?? Math.random;
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const total = w.us + w.canada + w.world;
  const r = rng() * total;
  if (r < w.us) return randomUsCallsign(rng);
  if (r < w.us + w.canada) return randomCanadianCallsign(rng);
  return randomWorldCallsign(rng);
}

/**
 * Returns the region label that produced a callsign — useful for UI display
 * after the round resolves. Best-effort prefix matching, not a real callsign
 * registrar; good enough for "show the user where the call is from".
 */
export function callsignRegion(call: string): 'US' | 'Canada' | 'World' {
  const upper = call.toUpperCase();
  // Canada
  for (const p of ['VA', 'VE', 'VO', 'VY', 'VC', 'VG', 'CY']) {
    if (upper.startsWith(p)) return 'Canada';
  }
  // US — K/W/N at start, OR 2-letter A[A-L] start
  if (/^[KWN]\d/.test(upper) || /^[KWN][A-Z]\d/.test(upper)) return 'US';
  if (/^A[A-L]\d/.test(upper)) return 'US';
  return 'World';
}
