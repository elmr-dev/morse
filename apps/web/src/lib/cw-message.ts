// Realistic CW practice text for the decoder's "Random" button — actual on-air
// patterns (CQ calls, exchanges, sign-offs) built from real-looking call signs
// and ham abbreviations, instead of a meaningless letter salad. Everything
// stays within the decoder model's character set (A–Z, 0–9, and = / from CHARS)
// plus spaces (keyed as word breaks), and within the input's length limit.

import { randomCallsign } from '../inference/callsign';

/** Max keyed message length — mirrors the decode input's maxLength. */
export const MAX_CW_MESSAGE = 40;

const RST = ['599', '579', '559', '589', '569', '449', '339', '578'] as const;
const NAMES = [
  'JIM',
  'BOB',
  'TOM',
  'DAVE',
  'AL',
  'KEN',
  'JOE',
  'DAN',
  'RON',
  'RICK',
  'MARK',
  'PHIL',
  'ED',
  'SAM',
  'LOU',
  'PAT',
  'STAN',
  'GUS',
] as const;
const QTH = [
  'ATLANTA',
  'DENVER',
  'OHIO',
  'TEXAS',
  'BOSTON',
  'MIAMI',
  'SEATTLE',
  'GA',
  'FL',
  'CA',
  'TN',
  'NY',
  'VT',
  'AZ',
  'CO',
] as const;
const RIGS = ['IC7300', 'FT991', 'K3', 'KX2', 'FT857', 'TS590'] as const;
const PWR = ['5', '10', '20', '50', '100'] as const;
// ARRL sections / states for contest exchanges.
const SECTIONS = [
  'GA',
  'FL',
  'AL',
  'SC',
  'NC',
  'VA',
  'TN',
  'OH',
  'TX',
  'CA',
  'NY',
  'WA',
  'CO',
  'ME',
  'VT',
  'EPA',
  'EMA',
  'STX',
  'ON',
  'BC',
] as const;
// Field Day class: transmitters + entry category (A club, D home, E emergency).
const FD_CLASS = ['1A', '2A', '3A', '1D', '2E', '1B', '1C'] as const;

const pick = <T>(arr: readonly T[], rng: () => number): T =>
  arr[Math.floor(rng() * arr.length)];

/** Zero-padded contest serial number, 001–999. */
const serial = (rng: () => number): string =>
  String(1 + Math.floor(rng() * 999)).padStart(3, '0');
/** CQ zone, 01–40. */
const zone = (rng: () => number): string =>
  String(1 + Math.floor(rng() * 40)).padStart(2, '0');

// Each template returns a complete, plausible exchange. A function so the call
// sign / report / name is drawn fresh each time (and repeated where a real
// operator would repeat it, e.g. "CQ CQ DE <call> <call>").
const TEMPLATES: ReadonlyArray<(rng: () => number) => string> = [
  (r) => {
    const c = randomCallsign({ rng: r });
    return `CQ CQ DE ${c} ${c} K`;
  },
  (r) => {
    const c = randomCallsign({ rng: r });
    return `CQ DX DE ${c} ${c} K`;
  },
  (r) => `CQ CQ CQ DE ${randomCallsign({ rng: r })} K`,
  (r) => `73 ES GL DE ${randomCallsign({ rng: r })} SK`,
  (r) => `TU 73 DE ${randomCallsign({ rng: r })} SK`,
  (r) => `${randomCallsign({ rng: r })} DE ${randomCallsign({ rng: r })} K`,
  (r) => `${randomCallsign({ rng: r })} DE ${randomCallsign({ rng: r })} KN`,
  (r) => `UR RST ${pick(RST, r)} ${pick(RST, r)} = HR`,
  (r) => `${randomCallsign({ rng: r })} UR RST ${pick(RST, r)}`,
  (r) => `NAME ${pick(NAMES, r)} QTH ${pick(QTH, r)}`,
  (r) => `OP ${pick(NAMES, r)} QTH ${pick(QTH, r)} ES 73`,
  () => 'GM OM TNX FB QSO 73',
  () => 'GE DR OM TNX FER CALL',
  (r) => `R R FB ${pick(NAMES, r)} TU 73`,
  (r) => `RIG ${pick(RIGS, r)} PWR ${pick(PWR, r)}W`,
  () => 'WX HR FB ES SUNNY 73',
  (r) => `${pick(RST, r)} ${pick(RST, r)} TU OM`,
  () => 'PSE QSL VIA BURO TU 73',
  // Calling / working another station
  (r) => `QRZ DE ${randomCallsign({ rng: r })} K`,
  (r) =>
    `HW CPY? ${randomCallsign({ rng: r })} DE ${randomCallsign({ rng: r })}`,
  (r) => `AGN PSE ${randomCallsign({ rng: r })} KN`,
  (r) => `GA OM UR 599 NAME ${pick(NAMES, r)}`,
  (r) => `ANT DIPOLE PWR ${pick(PWR, r)}W ES 73`,
  (r) => `TNX QSO ${pick(NAMES, r)} 73 ES GL`,
  () => 'SRI QRM AGN PSE',
  (r) => `FB ${pick(NAMES, r)} HW? BK`,
  () => 'QRL? QRL?',
  // Contest / Field Day exchanges
  (r) => {
    const c = randomCallsign({ rng: r });
    return `CQ TEST DE ${c} ${c} K`;
  },
  (r) => `${randomCallsign({ rng: r })} 599 ${serial(r)} ${serial(r)}`,
  (r) => `TU 599 ${pick(SECTIONS, r)} ${pick(SECTIONS, r)}`,
  (r) => `5NN ${serial(r)} ${pick(SECTIONS, r)}`,
  (r) => `${randomCallsign({ rng: r })} 5NN ${zone(r)}`,
  (r) => `${pick(FD_CLASS, r)} ${pick(SECTIONS, r)} QSL?`,
  (r) =>
    `${randomCallsign({ rng: r })} ${pick(FD_CLASS, r)} ${pick(SECTIONS, r)}`,
];

/**
 * A random, realistic CW message ≤ MAX_CW_MESSAGE characters. Retries if a
 * template happens to produce something over the limit (long call signs), and
 * falls back to a guaranteed-short CQ.
 */
export function randomCwMessage(rng: () => number = Math.random): string {
  for (let i = 0; i < 50; i++) {
    const msg = pick(TEMPLATES, rng)(rng).toUpperCase();
    if (msg.length <= MAX_CW_MESSAGE) return msg;
  }
  return `CQ DE ${randomCallsign({ rng })} K`.toUpperCase();
}
