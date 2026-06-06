/**
 * CTC (Connectionist Temporal Classification) greedy decoder.
 *
 * Character set matches the Python model exactly:
 *   index 0     = blank
 *   index 1..41 = CHARS[0..40]
 */

export const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?=/";
export const BLANK_IDX = 0;

/**
 * Greedy CTC decode from log-probability array.
 *
 * @param logprobs - Float32Array of shape (T, numClasses), row-major.
 * @param numClasses - Number of output classes (42 for v11).
 * @returns Decoded string.
 */
export function ctcGreedyDecode(logprobs: Float32Array, numClasses: number): string {
  const T = logprobs.length / numClasses;
  let prevIdx = BLANK_IDX;
  let result = "";

  for (let t = 0; t < T; t++) {
    const offset = t * numClasses;

    // Argmax over classes
    let bestIdx = 0;
    let bestVal = logprobs[offset];
    for (let c = 1; c < numClasses; c++) {
      if (logprobs[offset + c] > bestVal) {
        bestVal = logprobs[offset + c];
        bestIdx = c;
      }
    }

    // CTC collapse: emit char if different from previous and not blank
    if (bestIdx !== BLANK_IDX && bestIdx !== prevIdx) {
      // Map class index to character (index 1 → CHARS[0], etc.)
      result += CHARS[bestIdx - 1];
    }

    prevIdx = bestIdx;
  }

  return result;
}
