/**
 * Callsign matching algorithm for contest simulation
 * Based on MorseRunner's DxOper matching logic
 */

export type MatchResult = 'exact' | 'almost' | 'none';

/**
 * Compare two callsigns using dynamic programming
 * Returns the type of match found
 * @param sent The callsign sent by the operator
 * @param actual The actual callsign of the station
 * @param isLid Whether the station is a "lid" (makes mistakes)
 */
export function matchCall(
  sent: string,
  actual: string,
  isLid: boolean = false
): MatchResult {
  if (!sent || !actual) return 'none';

  const sentUpper = sent.toUpperCase().trim();
  const actualUpper = actual.toUpperCase().trim();

  // Exact match
  if (sentUpper === actualUpper) {
    // Lids occasionally don't recognize correct call (5% chance)
    if (isLid && Math.random() < 0.05) {
      return 'almost';
    }
    return 'exact';
  }

  // Check for partial/almost match
  const similarity = calculateSimilarity(sentUpper, actualUpper);

  // Lid operators accept wrong calls sometimes (10% chance at 50% similarity)
  if (isLid && similarity > 0.5 && Math.random() < 0.1) {
    return 'exact';
  }

  // Almost match threshold: at least 70% similar
  if (similarity >= 0.7) {
    return 'almost';
  }

  // Check for common partial match patterns
  if (isPartialMatch(sentUpper, actualUpper)) {
    return 'almost';
  }

  return 'none';
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in matrix
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Calculate similarity ratio between two strings (0-1)
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  return 1 - distance / maxLength;
}

/**
 * Check for common partial match patterns
 * E.g., operator copies suffix but not prefix, or vice versa
 */
function isPartialMatch(sent: string, actual: string): boolean {
  // Minimum length for partial match
  if (sent.length < 2 || actual.length < 3) return false;

  // Prefix match (first N characters match)
  const prefixLen = Math.min(3, sent.length);
  if (actual.startsWith(sent.slice(0, prefixLen))) {
    return true;
  }

  // Suffix match (last N characters match)
  const suffixLen = Math.min(3, sent.length);
  if (actual.endsWith(sent.slice(-suffixLen))) {
    return true;
  }

  // Contains match (sent is substring of actual)
  if (actual.includes(sent) && sent.length >= 3) {
    return true;
  }

  // Handle wildcard pattern (? marks unknown character)
  if (sent.includes('?')) {
    return matchWildcard(sent, actual);
  }

  return false;
}

/**
 * Match with wildcard pattern where ? matches any single character
 */
function matchWildcard(pattern: string, text: string): boolean {
  if (pattern.length !== text.length) return false;

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '?' && pattern[i] !== text[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Find best matching caller from a list
 * Returns the caller with best match, or null if no match found
 */
export function findBestMatch<T extends { call: string; isLid?: boolean }>(
  input: string,
  callers: T[]
): { caller: T; matchType: MatchResult } | null {
  if (!input || !callers.length) return null;

  let bestMatch: { caller: T; matchType: MatchResult } | null = null;
  let bestSimilarity = 0;

  for (const caller of callers) {
    const matchType = matchCall(input, caller.call, caller.isLid);

    if (matchType === 'exact') {
      return { caller, matchType: 'exact' };
    }

    if (matchType === 'almost') {
      const similarity = calculateSimilarity(
        input.toUpperCase(),
        caller.call.toUpperCase()
      );
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { caller, matchType: 'almost' };
      }
    }
  }

  return bestMatch;
}

/**
 * Generate a corrupted version of a callsign (for lid behavior)
 * Simulates copying errors
 */
export function corruptCallsign(call: string): string {
  if (call.length < 2) return call;

  const corruption = Math.random();
  const chars = call.split('');

  if (corruption < 0.3) {
    // Swap two adjacent characters
    const i = Math.floor(Math.random() * (chars.length - 1));
    [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
  } else if (corruption < 0.6) {
    // Change one character
    const i = Math.floor(Math.random() * chars.length);
    const isLetter = /[A-Z]/.test(chars[i]);
    if (isLetter) {
      // Replace with similar-sounding letter
      const similar: Record<string, string[]> = {
        'A': ['E', 'N'],
        'B': ['D', 'P'],
        'C': ['K', 'S'],
        'D': ['B', 'T'],
        'E': ['A', 'I'],
        'F': ['S', 'V'],
        'G': ['J', 'Q'],
        'I': ['E', 'Y'],
        'K': ['C', 'Q'],
        'M': ['N', 'W'],
        'N': ['A', 'M'],
        'O': ['0', 'Q'],
        'P': ['B', 'T'],
        'Q': ['G', 'K'],
        'R': ['W', 'K'],
        'S': ['C', 'F'],
        'T': ['D', 'P'],
        'U': ['V', 'W'],
        'V': ['F', 'U'],
        'W': ['M', 'R'],
        'Y': ['I', 'U'],
      };
      const options = similar[chars[i]] || ['X'];
      chars[i] = options[Math.floor(Math.random() * options.length)];
    } else if (/[0-9]/.test(chars[i])) {
      // Replace digit with similar
      const similarDigits: Record<string, string[]> = {
        '0': ['9', 'O'],
        '1': ['7', 'A'],
        '5': ['9', 'S'],
        '6': ['0', 'G'],
        '9': ['0', '5', 'N'],
      };
      const options = similarDigits[chars[i]] || [String((parseInt(chars[i]) + 1) % 10)];
      chars[i] = options[Math.floor(Math.random() * options.length)];
    }
  } else if (corruption < 0.8) {
    // Drop a character
    const i = Math.floor(Math.random() * chars.length);
    chars.splice(i, 1);
  } else {
    // Add an extra character
    const i = Math.floor(Math.random() * chars.length);
    const extra = chars[i];
    chars.splice(i, 0, extra);
  }

  return chars.join('');
}
