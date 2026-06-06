/**
 * Calculate points for a callsign attempt using RufzXP algorithm
 *
 * Formula: speed² × length × errorPenalty × replayPenalty
 *
 * - Quadratic speed influence: points scale with speed²
 * - Linear length influence: points scale linearly with callsign length
 * - Error penalties:
 *   - 0 errors: full points (1/1)
 *   - 1 error: 1/4 of max
 *   - 2 errors: 1/9 of max
 *   - 3+ errors: 1/(errors+1)² of max
 *
 * @param speedWpm - Speed in words per minute
 * @param callsignLength - Length of the callsign
 * @param errors - Number of character errors
 * @param replayed - Whether the callsign was replayed
 * @returns Calculated points (rounded)
 */
export function calculatePoints(
  speedWpm: number,
  callsignLength: number,
  errors: number,
  replayed: boolean
): number {
  // Quadratic speed influence (using CPM)
  const speedCpm = speedWpm * 5;
  const basePoints = (speedCpm * speedCpm * callsignLength) / 1000; // Scaled down to keep scores reasonable

  // Error penalty: 1/(errors+1)²
  // 0 errors = 1/1 = 100%
  // 1 error = 1/4 = 25%
  // 2 errors = 1/9 = 11%
  // 3 errors = 1/16 = 6%
  const errorPenalty = 1 / Math.pow(errors + 1, 2);

  let points = basePoints * errorPenalty;

  if (replayed) {
    points *= 0.5;
  }

  return Math.round(points);
}

/**
 * Calculate summary statistics from attempt results
 */
export function calculateStats(results: { points: number; correct: boolean; speed: number }[]) {
  const totalScore = results.reduce((sum, r) => sum + r.points, 0);
  const correctCount = results.filter(r => r.correct).length;
  const accuracy = results.length > 0 ? (correctCount / results.length) * 100 : 0;
  const speeds = results.map(r => r.speed);
  const startSpeed = speeds[0] ?? 0;
  const peakSpeed = Math.max(...speeds, 0);
  const endSpeed = speeds[speeds.length - 1] ?? 0;

  return {
    totalScore,
    correctCount,
    totalCount: results.length,
    accuracy,
    startSpeed,
    peakSpeed,
    endSpeed,
  };
}
