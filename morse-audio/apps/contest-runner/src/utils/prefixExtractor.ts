/**
 * Extract WPX prefix from a callsign
 *
 * WPX Rules:
 * - Prefix = letter(s) + digit(s)
 * - For calls like W1ABC, prefix is W1
 * - For calls like DL1ABC, prefix is DL1
 * - For calls like UA0FDX, prefix is UA0
 * - Portable indicators (/P, /M, /QRP) are ignored
 * - /1, /2, etc. replace the district number: W1ABC/3 = W3
 */
export function extractWpxPrefix(callsign: string): string {
  // Remove any /P, /M, /QRP suffixes
  let call = callsign.toUpperCase().replace(/\/(P|M|QRP|A|MM)$/i, '');

  // Check for portable district indicator (/digit)
  const portableMatch = call.match(/^(.+)\/(\d)$/);
  if (portableMatch) {
    // Replace the district number in the base call
    const baseCall = portableMatch[1];
    const newDistrict = portableMatch[2];

    // Find where the digit is and replace it
    const digitMatch = baseCall.match(/^([A-Z]+)(\d+)(.*)$/);
    if (digitMatch) {
      call = digitMatch[1] + newDistrict + digitMatch[3];
    }
  }

  // Handle prefix/call format (e.g., W1/DL1ABC -> W1)
  if (call.includes('/')) {
    const parts = call.split('/');
    // If first part looks like a prefix (ends with digit), use it
    if (/\d$/.test(parts[0])) {
      return parts[0];
    }
    // Otherwise use the main call
    call = parts.find(p => p.length > 3) || parts[0];
  }

  // Standard prefix extraction: letters followed by digits
  // Match: optional digit(s), letter(s), digit(s)
  const match = call.match(/^(\d?[A-Z]{1,2}\d+)/);

  if (match) {
    return match[1];
  }

  // Fallback: try to find any letter-digit combination
  const fallback = call.match(/^([A-Z]+\d+)/);
  return fallback ? fallback[1] : call.slice(0, 3);
}

/**
 * Determine continent from prefix
 * This is a simplified version - real contests use more complex rules
 */
export function getContinentFromPrefix(prefix: string): 'NA' | 'SA' | 'EU' | 'AS' | 'OC' | 'AF' {
  const firstTwo = prefix.slice(0, 2);

  // North America
  if (/^[KWN]\d/.test(prefix)) return 'NA';
  if (/^(VE|VA|VO|VY)/.test(prefix)) return 'NA';
  if (firstTwo === 'XE' || firstTwo === 'XF') return 'NA';

  // South America
  if (/^(PY|PP|PR|PS|PT|PU|PV|PW|PX)/.test(prefix)) return 'SA';
  if (/^(LU|LO|LP|LQ|LR|LS|LT|LV|LW)/.test(prefix)) return 'SA';
  if (/^(CE|CA|CB|CC|CD|XQ|XR)/.test(prefix)) return 'SA';
  if (firstTwo === 'CX') return 'SA';
  if (firstTwo === 'HC') return 'SA';
  if (firstTwo === 'OA') return 'SA';
  if (firstTwo === 'YV') return 'SA';

  // Asia
  if (/^(JA|JB|JC|JD|JE|JF|JG|JH|JI|JJ|JK|JL|JM|JN|JO|JP|JQ|JR|JS)/.test(prefix)) return 'AS';
  if (/^(UA9|UA0|RV9|RZ0|RW9|RX9)/.test(prefix)) return 'AS';
  if (/^(BV|BW|BX|BY)/.test(prefix)) return 'AS';
  if (/^(HL|DS|DT)/.test(prefix)) return 'AS';
  if (/^(VU|VT|VW)/.test(prefix)) return 'AS';
  if (/^(9V|9W)/.test(prefix)) return 'AS';

  // Oceania
  if (/^(VK)/.test(prefix)) return 'OC';
  if (/^(ZL|ZM)/.test(prefix)) return 'OC';
  if (/^(KH|KL|KP)/.test(prefix)) return 'OC'; // Simplified

  // Africa
  if (/^(ZS|ZR|ZT|ZU)/.test(prefix)) return 'AF';
  if (/^(5H|5I)/.test(prefix)) return 'AF';
  if (/^(EA8|EA9)/.test(prefix)) return 'AF';
  if (/^(CN|SU|ST)/.test(prefix)) return 'AF';

  // Default to Europe
  return 'EU';
}
