/**
 * Score a user's answer against the sent callsign
 *
 * @param sent - The callsign that was sent
 * @param received - The user's answer
 * @returns Object with correct character count, total, and exact match flag
 */
export function scoreAnswer(
  sent: string,
  received: string
): { correct: number; total: number; isExact: boolean } {
  const s = sent.toUpperCase().trim();
  const r = received.toUpperCase().trim();

  if (s === r) {
    return { correct: s.length, total: s.length, isExact: true };
  }

  let correct = 0;
  const minLen = Math.min(s.length, r.length);

  for (let i = 0; i < minLen; i++) {
    if (s[i] === r[i]) {
      correct++;
    }
  }

  return { correct, total: s.length, isExact: false };
}

/**
 * Highlight differences between sent and received callsigns
 * Returns HTML-safe string with correct chars and errors marked
 */
export function highlightDifferences(
  sent: string,
  received: string
): { sentHighlight: string; receivedHighlight: string } {
  const s = sent.toUpperCase();
  const r = received.toUpperCase();

  let sentHighlight = '';
  let receivedHighlight = '';

  const maxLen = Math.max(s.length, r.length);

  for (let i = 0; i < maxLen; i++) {
    const sChar = s[i] || '';
    const rChar = r[i] || '';

    if (sChar === rChar) {
      sentHighlight += sChar;
      receivedHighlight += rChar;
    } else {
      sentHighlight += sChar ? `[${sChar}]` : '';
      receivedHighlight += rChar ? `[${rChar}]` : '_';
    }
  }

  return { sentHighlight, receivedHighlight };
}
