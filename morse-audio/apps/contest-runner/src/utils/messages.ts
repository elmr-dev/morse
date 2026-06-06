import { formatExchange } from './cutNumbers';

/**
 * Get CQ message
 * N1MM F1: CQ TEST {MYCALL} {MYCALL}
 */
export function getCqMessage(mycall: string): string {
  return `CQ TEST ${mycall} ${mycall}`;
}

// ============================================
// Caller message generation (MorseRunner style)
// ============================================

/**
 * Generate caller's initial call (just callsign, possibly doubled)
 */
export function msgMyCall(call: string, double: boolean = false): string {
  return double ? `${call} ${call}` : call;
}

/**
 * Generate "NR?" query when caller needs exchange
 */
export function msgNrQm(): string {
  return 'NR?';
}

/**
 * Generate "AGN" request for repeat
 */
export function msgAgn(): string {
  return 'AGN';
}

/**
 * Generate "?" query for partial match
 */
export function msgQuery(): string {
  return '?';
}

/**
 * Generate "DE <call>" pattern after partial match
 */
export function msgDeMyCall(call: string): string {
  return `DE ${call} ${call}`;
}

/**
 * Generate caller's full exchange: "R 5NN <serial>"
 * @param serial The caller's serial number
 * @param makeError Whether to introduce a copy error (lid behavior)
 */
export function msgRNr(serial: number, makeError: boolean = false): string {
  let serialStr = formatCallerSerial(serial);

  if (makeError) {
    serialStr = corruptSerial(serialStr);
  }

  return `R 5NN ${serialStr}`;
}

/**
 * Generate caller's callsign + exchange combo
 * Used when caller needs to confirm both
 */
export function msgCallAndExchange(call: string, serial: number, makeError: boolean = false): string {
  let serialStr = formatCallerSerial(serial);

  if (makeError) {
    serialStr = corruptSerial(serialStr);
  }

  return `${call} 5NN ${serialStr}`;
}

/**
 * Generate caller's TU (QSO complete acknowledgment)
 */
export function msgCallerTu(): string {
  return 'TU';
}

/**
 * Format serial number with cut numbers for caller transmission
 * Uses standard cut numbers: 0->T, 9->N, optionally 5->E, 1->A
 */
function formatCallerSerial(serial: number): string {
  const padded = serial.toString().padStart(3, '0');
  // Apply cut numbers
  return padded
    .replace(/0/g, 'T')
    .replace(/9/g, 'N');
}

/**
 * Corrupt a serial string to simulate lid copy errors
 */
function corruptSerial(serial: string): string {
  const chars = serial.split('');
  const i = Math.floor(Math.random() * chars.length);

  // Replace with similar-sounding character
  const similar: Record<string, string[]> = {
    'T': ['E', 'A', '0'],
    'N': ['M', 'A', '9'],
    'E': ['I', 'T', 'A'],
    'A': ['E', 'N', '1'],
    '1': ['A', 'T', '7'],
    '2': ['3', '1', 'U'],
    '3': ['2', 'E', 'S'],
    '4': ['5', 'H', 'V'],
    '5': ['E', 'S', '4'],
    '6': ['B', 'G', '0'],
    '7': ['1', 'G', 'T'],
    '8': ['D', 'B', '0'],
  };

  const options = similar[chars[i]];
  if (options) {
    chars[i] = options[Math.floor(Math.random() * options.length)];
  }

  return chars.join('');
}

/**
 * Get exchange message (sent to caller)
 * N1MM F2/Insert: {HISCALL} {RST} {SERIAL}
 */
export function getExchangeMessage(theircall: string, serial: number): string {
  return `${theircall} ${formatExchange(serial)}`;
}

/**
 * Get TU message (just TU)
 * N1MM F3: TU
 */
export function getTuMessage(): string {
  return 'TU';
}

/**
 * Get TU + CQ message (after logging)
 * N1MM: TU {MYCALL} TEST (or TU {MYCALL})
 */
export function getTuCqMessage(mycall: string): string {
  return `TU ${mycall}`;
}

/**
 * Generate the response a station sends after receiving your exchange
 * They send: R {RST} {their serial}
 */
export function getStationResponse(theirSerial: number): string {
  return `R ${formatExchange(theirSerial)}`;
}

/**
 * Generate the TU a station sends after you log them
 */
export function getStationTu(): string {
  return 'TU';
}

// ============================================
// CWT Contest message generation
// ============================================

/**
 * CWT: Caller's exchange response (name + number)
 * Example: "BOB 2381" or "BOB CA"
 */
export function msgCwtExchange(name: string, number: string, makeError: boolean = false): string {
  let numberStr = number;

  if (makeError && /^\d+$/.test(number)) {
    // Apply cut numbers and potentially corrupt for lid behavior
    numberStr = formatCwtNumber(number);
    numberStr = corruptSerial(numberStr);
  } else if (/^\d+$/.test(number)) {
    // Apply cut numbers to member numbers
    numberStr = formatCwtNumber(number);
  }

  return `${name} ${numberStr}`;
}

/**
 * CWT: Caller's call + exchange combo
 * Used when caller needs to confirm both
 * Example: "W1ABC BOB 2381"
 */
export function msgCwtCallAndExchange(call: string, name: string, number: string, makeError: boolean = false): string {
  let numberStr = number;

  if (makeError && /^\d+$/.test(number)) {
    numberStr = formatCwtNumber(number);
    numberStr = corruptSerial(numberStr);
  } else if (/^\d+$/.test(number)) {
    numberStr = formatCwtNumber(number);
  }

  return `${call} ${name} ${numberStr}`;
}

/**
 * CWT: User's exchange to caller
 * Format: {THEIR_CALL} {MY_NAME} {MY_NUMBER}
 * Example: "W1ABC JOHN 1234"
 */
export function getCwtExchangeMessage(theirCall: string, myName: string, myNumber: string): string {
  // Format the number with cut numbers if it's numeric
  const numberStr = /^\d+$/.test(myNumber) ? formatCwtNumber(myNumber) : myNumber;
  return `${theirCall} ${myName} ${numberStr}`;
}

/**
 * CWT: Get CQ message for CWT (same as WPX, just CQ TEST)
 */
export function getCwtCqMessage(mycall: string): string {
  return `CQ TEST ${mycall} ${mycall}`;
}

/**
 * CWT: TU + CQ message
 */
export function getCwtTuCqMessage(mycall: string): string {
  return `TU ${mycall}`;
}

/**
 * Format CWT member number with cut numbers (0->T, 9->N)
 */
function formatCwtNumber(number: string): string {
  return number
    .replace(/0/g, 'T')
    .replace(/9/g, 'N');
}
