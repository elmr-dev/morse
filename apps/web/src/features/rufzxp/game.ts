// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DEFAULT_RUFZXP_SETTINGS,
  type RufzxpAttempt,
  type RufzxpSettings,
  type RufzxpState,
  type RufzxpStats,
} from './types';

export function normalizeCallsign(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

export function scoreAnswer(
  sent: string,
  received: string
): { correct: number; total: number; errors: number; isExact: boolean } {
  const s = normalizeCallsign(sent);
  const r = normalizeCallsign(received);

  if (s === r) {
    return { correct: s.length, total: s.length, errors: 0, isExact: true };
  }

  let correct = 0;
  const minLen = Math.min(s.length, r.length);
  for (let i = 0; i < minLen; i++) {
    if (s[i] === r[i]) correct++;
  }

  return {
    correct,
    total: s.length,
    errors: Math.max(s.length, r.length) - correct,
    isExact: false,
  };
}

export function calculatePoints(
  speedWpm: number,
  callsignLength: number,
  errors: number,
  replayed: boolean
): number {
  const speedCpm = speedWpm * 5;
  const basePoints = (speedCpm * speedCpm * callsignLength) / 1000;
  let points = basePoints / (errors + 1) ** 2;

  if (replayed) points *= 0.5;

  return Math.round(points);
}

export function nextSpeed(
  currentSpeed: number,
  correct: boolean,
  mode: RufzxpSettings['speedMode']
): number {
  if (mode === 'fixed') return currentSpeed;

  const step = Math.max(1, Math.round(currentSpeed * 0.03));
  return correct ? currentSpeed + step : Math.max(5, currentSpeed - step);
}

export function calculateStats(results: RufzxpAttempt[]): RufzxpStats {
  const totalScore = results.reduce((sum, r) => sum + r.points, 0);
  const correctCount = results.filter((r) => r.correct).length;
  const speeds = results.map((r) => r.speed);

  return {
    totalScore,
    correctCount,
    totalCount: results.length,
    accuracy: results.length ? (correctCount / results.length) * 100 : 0,
    startSpeed: speeds[0] ?? 0,
    peakSpeed: Math.max(...speeds, 0),
    endSpeed: speeds[speeds.length - 1] ?? 0,
  };
}

export function createInitialState(
  settings: RufzxpSettings = DEFAULT_RUFZXP_SETTINGS
): RufzxpState {
  return {
    phase: 'setup',
    callsigns: [],
    callsignIndex: 0,
    currentCallsign: '',
    currentSpeed: settings.startSpeed,
    userAnswer: '',
    hasReplayed: false,
    isPlaying: false,
    startedAt: null,
    callsignStartedAt: null,
    results: [],
    settings,
  };
}

export function startGame(
  callsigns: string[],
  settings: RufzxpSettings,
  now = Date.now()
): RufzxpState {
  return {
    ...createInitialState(settings),
    phase: 'playing',
    callsigns,
    currentCallsign: callsigns[0] ?? '',
    currentSpeed: settings.startSpeed,
    startedAt: now,
  };
}

export function submitAnswer(
  state: RufzxpState,
  now = Date.now()
): RufzxpState {
  if (state.phase !== 'playing' || !state.currentCallsign) return state;

  const scored = scoreAnswer(state.currentCallsign, state.userAnswer);
  const points = calculatePoints(
    state.currentSpeed,
    state.currentCallsign.length,
    scored.errors,
    state.hasReplayed
  );
  const result: RufzxpAttempt = {
    index: state.callsignIndex,
    sent: state.currentCallsign,
    received: normalizeCallsign(state.userAnswer),
    speed: state.currentSpeed,
    points,
    correct: scored.isExact,
    errors: scored.errors,
    replayed: state.hasReplayed,
    responseTimeMs: state.callsignStartedAt ? now - state.callsignStartedAt : 0,
  };

  const nextIndex = state.callsignIndex + 1;
  const complete = nextIndex >= state.callsigns.length;

  return {
    ...state,
    callsignIndex: nextIndex,
    currentCallsign: complete ? '' : state.callsigns[nextIndex],
    currentSpeed: nextSpeed(
      state.currentSpeed,
      scored.isExact,
      state.settings.speedMode
    ),
    userAnswer: '',
    hasReplayed: false,
    isPlaying: false,
    callsignStartedAt: null,
    results: [...state.results, result],
    phase: complete ? 'results' : 'playing',
  };
}
