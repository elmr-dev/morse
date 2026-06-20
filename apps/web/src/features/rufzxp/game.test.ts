// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  calculatePoints,
  calculateStats,
  nextSpeed,
  scoreAnswer,
  startGame,
  submitAnswer,
} from './game';
import { DEFAULT_RUFZXP_SETTINGS } from './types';

describe('RufZXP scoring', () => {
  it('uses quadratic speed, callsign length, error penalty, and replay penalty', () => {
    expect(calculatePoints(20, 5, 0, false)).toBe(50);
    expect(calculatePoints(20, 5, 1, false)).toBe(13);
    expect(calculatePoints(20, 5, 1, true)).toBe(6);
  });

  it('scores exact and positional copy errors', () => {
    expect(scoreAnswer('K1ABC', 'k1abc')).toEqual({
      correct: 5,
      total: 5,
      errors: 0,
      isExact: true,
    });
    expect(scoreAnswer('K1ABC', 'K1AX')).toMatchObject({
      correct: 3,
      total: 5,
      errors: 2,
      isExact: false,
    });
  });

  it('adjusts adaptive speed by three percent with a one WPM floor', () => {
    expect(nextSpeed(20, true, 'adaptive')).toBe(21);
    expect(nextSpeed(20, false, 'adaptive')).toBe(19);
    expect(nextSpeed(50, true, 'adaptive')).toBe(52);
    expect(nextSpeed(5, false, 'adaptive')).toBe(5);
    expect(nextSpeed(20, true, 'fixed')).toBe(20);
  });
});

describe('RufZXP state transitions', () => {
  it('advances callsigns and ends at results', () => {
    let state = startGame(['K1ABC', 'N0CALL'], DEFAULT_RUFZXP_SETTINGS, 1000);

    state = { ...state, userAnswer: 'K1ABC', callsignStartedAt: 1100 };
    state = submitAnswer(state, 2100);

    expect(state.phase).toBe('playing');
    expect(state.currentCallsign).toBe('N0CALL');
    expect(state.currentSpeed).toBe(21);
    expect(state.results[0]).toMatchObject({
      sent: 'K1ABC',
      received: 'K1ABC',
      correct: true,
      points: 50,
      responseTimeMs: 1000,
    });

    state = { ...state, userAnswer: 'N0CA', callsignStartedAt: 2200 };
    state = submitAnswer(state, 3000);

    expect(state.phase).toBe('results');
    expect(calculateStats(state.results)).toMatchObject({
      totalScore: 57,
      correctCount: 1,
      totalCount: 2,
      startSpeed: 20,
      peakSpeed: 21,
      endSpeed: 21,
    });
  });
});
