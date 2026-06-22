// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Plausible amateur-radio callsigns for the trainer. The site already ships a
// region-weighted generator (the Beat-the-Bot demo plays callsigns too); we
// reuse it but tilt the mix toward the rest of the world so the operator hears
// EU / JA / VK prefixes alongside US/Canada, matching a real contest pile-up.

import { randomCallsign } from '@/inference/callsign';

// More world variety than the default 60/25/15 — Redline is about copying
// unfamiliar prefixes at speed, not just home-country calls.
const REDLINE_WEIGHTS = { us: 0.45, canada: 0.15, world: 0.4 };

/** A single random callsign. `rng` is injectable for deterministic tests. */
export function generateCallsign(rng: () => number = Math.random): string {
  return randomCallsign({ weights: REDLINE_WEIGHTS, rng });
}

/** A run's worth of callsigns, generated up front. */
export function generateCallsigns(
  count: number,
  rng: () => number = Math.random
): string[] {
  return Array.from({ length: count }, () => generateCallsign(rng));
}
