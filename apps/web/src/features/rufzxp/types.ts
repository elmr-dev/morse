// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export type RufzxpPhase = 'setup' | 'playing' | 'results';
export type RufzxpSpeedMode = 'adaptive' | 'fixed';

export interface RufzxpSettings {
  userCall: string;
  startSpeed: number;
  toneFrequency: number;
  callsignsPerAttempt: number;
  speedMode: RufzxpSpeedMode;
}

export interface RufzxpAttempt {
  index: number;
  sent: string;
  received: string;
  speed: number;
  points: number;
  correct: boolean;
  errors: number;
  replayed: boolean;
  responseTimeMs: number;
}

export interface RufzxpState {
  phase: RufzxpPhase;
  callsigns: string[];
  callsignIndex: number;
  currentCallsign: string;
  currentSpeed: number;
  userAnswer: string;
  hasReplayed: boolean;
  isPlaying: boolean;
  startedAt: number | null;
  callsignStartedAt: number | null;
  results: RufzxpAttempt[];
  settings: RufzxpSettings;
}

export interface RufzxpStats {
  totalScore: number;
  correctCount: number;
  totalCount: number;
  accuracy: number;
  startSpeed: number;
  peakSpeed: number;
  endSpeed: number;
}

export const DEFAULT_RUFZXP_SETTINGS: RufzxpSettings = {
  userCall: '',
  startSpeed: 20,
  toneFrequency: 600,
  callsignsPerAttempt: 50,
  speedMode: 'adaptive',
};
