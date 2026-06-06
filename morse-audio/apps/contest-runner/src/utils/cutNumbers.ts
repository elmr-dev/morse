/**
 * Cut numbers are abbreviated Morse code numbers used in contests
 * to reduce transmission time.
 *
 * Standard cut numbers:
 * 0 -> T (dah instead of dah-dah-dah-dah-dah)
 * 9 -> N (dah-dit instead of dah-dah-dah-dah-dit)
 *
 * Some operators also use:
 * 1 -> A
 * 5 -> E (but this is less common and we won't use it)
 */

/**
 * Encode a number using cut numbers (0->T, 9->N)
 * 599 -> 5NN
 * 100 -> 1TT
 */
export function encodeCutNumber(n: number): string {
  return n.toString()
    .replace(/0/g, 'T')
    .replace(/9/g, 'N');
}

/**
 * Decode cut numbers back to digits
 * 5NN -> 599
 * 1TT -> 100
 */
export function decodeCutNumber(s: string): number {
  const decoded = s.toUpperCase()
    .replace(/T/g, '0')
    .replace(/N/g, '9');
  return parseInt(decoded, 10);
}

/**
 * Format an RST report (always 599 for CW, sent as 5NN)
 */
export function formatRst(): string {
  return '5NN';
}

/**
 * Format a serial number with cut numbers
 * Pads to 3 digits minimum
 */
export function formatSerial(serial: number): string {
  const padded = serial.toString().padStart(3, '0');
  return encodeCutNumber(parseInt(padded, 10));
}

/**
 * Format the full exchange: RST + serial
 */
export function formatExchange(serial: number): string {
  return `${formatRst()} ${formatSerial(serial)}`;
}
