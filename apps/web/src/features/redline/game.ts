// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pure game logic for Redline: scoring, the adaptive-speed curve, and the
// run state machine. Everything here is deterministic and side-effect free so
// it can be unit-tested without audio or the DOM. The page layer owns audio,
// callsign generation, and the wall clock.

import {
  DEFAULT_REDLINE_SETTINGS,
  type RedlineAttempt,
  type RedlineSettings,
  type RedlineSpeedMode,
  type RedlineState,
  type RedlineStats,
  SPEED_MAX,
  SPEED_MIN,
} from './types';

/** Strip to the comparable callsign alphabet: uppercase A–Z and 0–9. */
export function normalizeCallsign(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface CallScore {
  /** Characters copied correctly (positional match within the reference). */
  correct: number;
  /** Reference length. */
  length: number;
  /** Substitutions + missing + extra characters. */
  errors: number;
  /** Every reference character correct and the typed length matches. */
  perfect: boolean;
}

/**
 * Diff the typed copy against the reference, position by position. Mismatches
 * and missing characters within the reference count as errors, as do extra
 * characters typed past the reference length.
 */
export function scoreCall(reference: string, typed: string): CallScore {
  const ref = normalizeCallsign(reference);
  const got = normalizeCallsign(typed);

  let correct = 0;
  for (let i = 0; i < ref.length; i++) {
    if (got[i] === ref[i]) correct++;
  }

  const extra = Math.max(0, got.length - ref.length);
  const errors = ref.length - correct + extra;

  return {
    correct,
    length: ref.length,
    errors,
    perfect: errors === 0 && got.length === ref.length,
  };
}

/**
 * Points for a call. A perfect copy earns the full `length × speed × 1.2`;
 * an imperfect copy earns partial credit `correct × speed × 0.4`. A replayed
 * call is halved either way.
 */
export function callPoints(
  score: CallScore,
  speedWpm: number,
  replayed: boolean
): { max: number; gained: number } {
  const max = Math.round(score.length * speedWpm * 1.2);
  const raw = score.perfect ? max : Math.round(score.correct * speedWpm * 0.4);
  const gained = replayed ? Math.round(raw * 0.5) : raw;
  return { max, gained };
}

/**
 * Adaptive-speed curve. A perfect copy pushes the speed up (+2 WPM, +3 once a
 * streak is hot); anything less eases off (−2 WPM). Fixed mode never moves.
 * Clamped to the trainer's WPM range.
 */
export function nextSpeed(
  speed: number,
  perfect: boolean,
  streak: number,
  mode: RedlineSpeedMode
): number {
  if (mode === 'fixed') return speed;
  const delta = perfect ? (streak >= 3 ? 3 : 2) : -2;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed + delta));
}

export function calculateStats(attempts: RedlineAttempt[]): RedlineStats {
  const score = attempts.reduce((sum, a) => sum + a.points, 0);
  const perfect = attempts.filter((a) => a.perfect).length;
  const topSpeed = attempts.reduce((max, a) => Math.max(max, a.speed), 0);
  const totalErrors = attempts.reduce((sum, a) => sum + a.errors, 0);
  return {
    score,
    attempts: attempts.length,
    perfect,
    accuracy: attempts.length ? (perfect / attempts.length) * 100 : 0,
    topSpeed,
    totalErrors,
  };
}

export function createInitialState(
  settings: RedlineSettings = DEFAULT_REDLINE_SETTINGS
): RedlineState {
  return {
    phase: 'setup',
    settings,
    index: 0,
    total: 0,
    current: '',
    speed: settings.startSpeed,
    typed: '',
    replayed: false,
    reviewing: false,
    callStartedAt: null,
    attempts: [],
    score: 0,
    streak: 0,
    topSpeed: settings.startSpeed,
    last: null,
  };
}

/** Begin a run with a freshly generated first callsign. */
export function startRun(
  settings: RedlineSettings,
  firstCallsign: string,
  now: number
): RedlineState {
  return {
    ...createInitialState(settings),
    phase: 'playing',
    total: settings.callsignCount,
    current: firstCallsign,
    speed: settings.startSpeed,
    topSpeed: settings.startSpeed,
    callStartedAt: now,
  };
}

/**
 * Score the current call and fold it into the run. This does NOT advance to the
 * next callsign — the page generates the next call and calls `beginNext` (or,
 * in practice mode, waits for the operator to continue via `advance`). In
 * continuous mode the run transitions straight to `done` after the last call.
 */
export function submitAttempt(state: RedlineState, now: number): RedlineState {
  if (state.phase !== 'playing' || state.reviewing) return state;

  const score = scoreCall(state.current, state.typed);
  const { max, gained } = callPoints(score, state.speed, state.replayed);

  const attempt: RedlineAttempt = {
    index: state.index,
    sent: state.current,
    received: normalizeCallsign(state.typed),
    speed: state.speed,
    maxPoints: max,
    points: gained,
    errors: score.errors,
    perfect: score.perfect,
    replayed: state.replayed,
    timeMs: state.callStartedAt ? now - state.callStartedAt : 0,
  };

  const streak = score.perfect ? state.streak + 1 : 0;
  const isLast = state.index + 1 >= state.total;
  const practice = state.settings.practiceMode;

  return {
    ...state,
    attempts: [...state.attempts, attempt],
    score: state.score + gained,
    streak,
    last: attempt,
    speed: nextSpeed(
      state.speed,
      score.perfect,
      streak,
      state.settings.speedMode
    ),
    typed: '',
    replayed: false,
    // Practice mode reviews every call (even the last) before continuing.
    reviewing: practice,
    phase: isLast && !practice ? 'done' : 'playing',
  };
}

/**
 * Move to the next callsign after a submit (continuous mode) or after a
 * practice-mode review. `nextCallsign` is generated by the page.
 */
export function beginNext(
  state: RedlineState,
  nextCallsign: string,
  now: number
): RedlineState {
  return {
    ...state,
    index: state.index + 1,
    current: nextCallsign,
    typed: '',
    replayed: false,
    reviewing: false,
    callStartedAt: now,
  };
}

/**
 * Practice-mode continue: either advance to the next call or, if the reviewed
 * call was the last one, finish the run.
 */
export function advanceFromReview(
  state: RedlineState,
  nextCallsign: string,
  now: number
): RedlineState {
  if (!state.reviewing) return state;
  if (state.index + 1 >= state.total) {
    return { ...state, reviewing: false, phase: 'done' };
  }
  return beginNext(state, nextCallsign, now);
}

/** Mark the current call replayed (halves its points). One replay per call. */
export function markReplayed(state: RedlineState): RedlineState {
  if (state.phase !== 'playing' || state.replayed) return state;
  return { ...state, replayed: true };
}

export function setTyped(state: RedlineState, typed: string): RedlineState {
  return { ...state, typed: normalizeCallsign(typed) };
}

/**
 * Abort the run. Once at least one call has been attempted the run ends on the
 * summary screen; aborting before any attempt returns to setup.
 */
export function abortRun(state: RedlineState): RedlineState {
  if (state.attempts.length > 0) {
    return { ...state, phase: 'done', reviewing: false };
  }
  return createInitialState(state.settings);
}
