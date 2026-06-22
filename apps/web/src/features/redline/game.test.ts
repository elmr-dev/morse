// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  abortRun,
  advanceFromReview,
  beginNext,
  calculateStats,
  callPoints,
  markReplayed,
  nextSpeed,
  scoreCall,
  startRun,
  submitAttempt,
} from './game';
import { DEFAULT_REDLINE_SETTINGS, type RedlineSettings } from './types';

const settings = (
  overrides: Partial<RedlineSettings> = {}
): RedlineSettings => ({
  ...DEFAULT_REDLINE_SETTINGS,
  callsignCount: 2,
  startSpeed: 20,
  ...overrides,
});

describe('scoreCall', () => {
  it('counts a case-insensitive perfect copy', () => {
    expect(scoreCall('K1ABC', 'k1abc')).toEqual({
      correct: 5,
      length: 5,
      errors: 0,
      perfect: true,
    });
  });

  it('ignores non-alphanumerics in the copy', () => {
    expect(scoreCall('DL1XYZ', 'dl1 xyz')).toMatchObject({
      perfect: true,
      errors: 0,
    });
  });

  it('counts substitutions and missing characters', () => {
    expect(scoreCall('K1ABC', 'K1AX')).toEqual({
      correct: 3,
      length: 5,
      errors: 2,
      perfect: false,
    });
  });

  it('counts extra typed characters as errors', () => {
    expect(scoreCall('W1AW', 'W1AWX')).toEqual({
      correct: 4,
      length: 4,
      errors: 1,
      perfect: false,
    });
  });
});

describe('callPoints', () => {
  it('awards full points for a perfect copy', () => {
    // round(5 * 20 * 1.2) = 120
    expect(callPoints(scoreCall('K1ABC', 'K1ABC'), 20, false)).toEqual({
      max: 120,
      gained: 120,
    });
  });

  it('awards partial credit for correct characters', () => {
    // round(3 * 20 * 0.4) = 24, max round(5 * 20 * 1.2) = 120
    expect(callPoints(scoreCall('K1ABC', 'K1AX'), 20, false)).toEqual({
      max: 120,
      gained: 24,
    });
  });

  it('halves points when the call was replayed', () => {
    expect(callPoints(scoreCall('K1ABC', 'K1ABC'), 20, true).gained).toBe(60);
  });
});

describe('nextSpeed', () => {
  it('rises +2 on a perfect copy and +3 on a hot streak', () => {
    expect(nextSpeed(20, true, 1, 'adaptive')).toBe(22);
    expect(nextSpeed(20, true, 3, 'adaptive')).toBe(23);
  });

  it('eases off -2 when imperfect and clamps to the range', () => {
    expect(nextSpeed(20, false, 0, 'adaptive')).toBe(18);
    expect(nextSpeed(6, false, 0, 'adaptive')).toBe(5);
    expect(nextSpeed(69, true, 5, 'adaptive')).toBe(70);
  });

  it('never moves in fixed mode', () => {
    expect(nextSpeed(20, true, 9, 'fixed')).toBe(20);
  });
});

describe('continuous run', () => {
  it('scores, advances, raises speed, and ends at done', () => {
    let state = startRun(settings(), 'K1ABC', 1000);
    expect(state.phase).toBe('playing');

    state = { ...state, typed: 'K1ABC', callStartedAt: 1000 };
    state = submitAttempt(state, 2000);

    expect(state.attempts[0]).toMatchObject({
      sent: 'K1ABC',
      perfect: true,
      points: 120,
      timeMs: 1000,
    });
    expect(state.score).toBe(120);
    expect(state.streak).toBe(1);
    expect(state.speed).toBe(22); // +2 after a perfect copy
    expect(state.phase).toBe('playing');

    state = beginNext(state, 'N0CALL', 3000);
    expect(state.index).toBe(1);
    expect(state.current).toBe('N0CALL');

    state = { ...state, typed: 'N0CA' };
    state = submitAttempt(state, 4000);

    expect(state.phase).toBe('done');
    expect(state.streak).toBe(0);
    expect(calculateStats(state.attempts)).toMatchObject({
      score: 120 + Math.round(4 * 22 * 0.4),
      attempts: 2,
      perfect: 1,
      topSpeed: 22,
    });
  });

  it('tracks top speed across the run', () => {
    let state = startRun(settings({ callsignCount: 1 }), 'K1ABC', 0);
    state = { ...state, typed: 'K1ABC' };
    state = submitAttempt(state, 0);
    expect(state.topSpeed).toBe(20);
  });
});

describe('practice mode', () => {
  it('reviews each call before continuing, including the last', () => {
    let state = startRun(
      settings({ practiceMode: true, callsignCount: 2 }),
      'K1ABC',
      0
    );

    state = { ...state, typed: 'K1ABC' };
    state = submitAttempt(state, 0);
    expect(state.reviewing).toBe(true);
    expect(state.phase).toBe('playing');

    state = advanceFromReview(state, 'N0CALL', 0);
    expect(state.reviewing).toBe(false);
    expect(state.current).toBe('N0CALL');

    state = { ...state, typed: 'N0CALL' };
    state = submitAttempt(state, 0);
    expect(state.reviewing).toBe(true);
    expect(state.phase).toBe('playing'); // last call still reviewed

    state = advanceFromReview(state, 'IGNORED', 0);
    expect(state.phase).toBe('done');
  });
});

describe('replay + abort', () => {
  it('marks a single replay and applies the penalty', () => {
    let state = startRun(settings({ callsignCount: 1 }), 'K1ABC', 0);
    state = markReplayed(state);
    state = markReplayed(state); // second call is a no-op
    expect(state.replayed).toBe(true);

    state = { ...state, typed: 'K1ABC' };
    state = submitAttempt(state, 0);
    expect(state.attempts[0].points).toBe(60); // 120 halved
    expect(state.attempts[0].replayed).toBe(true);
  });

  it('ends on the summary after an attempt, returns to setup before any', () => {
    const fresh = startRun(settings(), 'K1ABC', 0);
    expect(abortRun(fresh).phase).toBe('setup');

    let state = { ...fresh, typed: 'K1ABC' };
    state = submitAttempt(state, 0);
    state = beginNext(state, 'N0CALL', 0);
    expect(abortRun(state).phase).toBe('done');
  });
});
