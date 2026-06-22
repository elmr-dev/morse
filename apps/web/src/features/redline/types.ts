// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export type RedlinePhase = 'setup' | 'playing' | 'done';
export type RedlineSpeedMode = 'adaptive' | 'fixed';

export interface RedlineSettings {
  /** Operator callsign — labels the leaderboard row. Optional. */
  userCall: string;
  /** Starting send speed, WPM. */
  startSpeed: number;
  /** Sidetone frequency, Hz. */
  toneFrequency: number;
  /** Callsigns sent per run. */
  callsignCount: number;
  /** Adaptive raises/lowers speed; fixed never changes. */
  speedMode: RedlineSpeedMode;
  /** Learner mode: pause and reveal each call before the next one sends. */
  practiceMode: boolean;
}

/** A single scored callsign attempt, appended to the copy log. */
export interface RedlineAttempt {
  index: number;
  /** The reference callsign that was sent. */
  sent: string;
  /** What the operator typed (normalized). */
  received: string;
  /** Speed (WPM) the call was sent at. */
  speed: number;
  /** Points possible for a perfect copy of this call. */
  maxPoints: number;
  /** Points actually earned (after any replay penalty). */
  points: number;
  /** Substitution + missing + extra-character count. */
  errors: number;
  /** True only when every character matched and the lengths are equal. */
  perfect: boolean;
  /** Whether the operator used their one replay (halves points). */
  replayed: boolean;
  /** Milliseconds from the call starting to the operator submitting. */
  timeMs: number;
}

export interface RedlineState {
  phase: RedlinePhase;
  settings: RedlineSettings;
  /** Index of the current call, 0-based. */
  index: number;
  /** Total calls in this run. */
  total: number;
  /** The callsign currently being copied. */
  current: string;
  /** Speed (WPM) the current/next call is sent at. */
  speed: number;
  /** Live input contents. */
  typed: string;
  /** Whether the current call has been replayed. */
  replayed: boolean;
  /** Practice mode: true while the just-scored call is being reviewed. */
  reviewing: boolean;
  /** Wall-clock the current call started playing (for response time). */
  callStartedAt: number | null;
  attempts: RedlineAttempt[];
  /** Cumulative score across the run. */
  score: number;
  /** Consecutive perfect copies. */
  streak: number;
  /** Highest speed reached this run. */
  topSpeed: number;
  /** The last completed call, for the passive "Last callsign" strip. */
  last: RedlineAttempt | null;
}

export interface RedlineStats {
  score: number;
  attempts: number;
  /** Perfect copies. */
  perfect: number;
  /** perfect / attempts, as a percentage. */
  accuracy: number;
  topSpeed: number;
  totalErrors: number;
}

export const SPEED_MIN = 5;
export const SPEED_MAX = 70;

export const DEFAULT_REDLINE_SETTINGS: RedlineSettings = {
  userCall: '',
  startSpeed: 20,
  toneFrequency: 600,
  callsignCount: 50,
  speedMode: 'adaptive',
  practiceMode: false,
};
