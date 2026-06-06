/** Morse patterns for A-Z and 0-9 */
const MORSE_MAP: Record<string, string> = {
  A: '.-',    B: '-...',  C: '-.-.',  D: '-..',   E: '.',
  F: '..-.',  G: '--.',   H: '....',  I: '..',    J: '.---',
  K: '-.-',   L: '.-..',  M: '--',    N: '-.',    O: '---',
  P: '.--.',  Q: '--.-',  R: '.-.',   S: '...',   T: '-',
  U: '..-',   V: '...-',  W: '.--',   X: '-..-',  Y: '-.--',
  Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

/**
 * Levenshtein edit distance between two morse strings.
 */
export function morseDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Return `count` characters most similar to `char` in morse, excluding `char` itself.
 * Characters are sorted by ascending morse distance, with ties broken randomly.
 */
export function getConfusableCharacters(char: string, count: number): string[] {
  const upper = char.toUpperCase();
  const pattern = MORSE_MAP[upper];
  if (!pattern) return [];

  const candidates = Object.entries(MORSE_MAP)
    .filter(([c]) => c !== upper)
    .map(([c, p]) => ({ char: c, dist: morseDistance(pattern, p), rand: Math.random() }))
    .sort((a, b) => a.dist - b.dist || a.rand - b.rand);

  return candidates.slice(0, count).map(c => c.char);
}

export function getMorsePattern(char: string): string | undefined {
  return MORSE_MAP[char.toUpperCase()];
}
