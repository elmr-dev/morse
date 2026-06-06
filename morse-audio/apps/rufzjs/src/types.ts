export type GamePhase = 'start' | 'playing' | 'results';
export type GameMode = 'original' | 'mobile';

export interface GameState {
  phase: GamePhase;
  callsignIndex: number;
  currentCallsign: string;
  userAnswer: string;
  currentSpeed: number;
  isPlaying: boolean;
  hasReplayed: boolean;
  results: AttemptResult[];
  startTime: number | null;
  callsignStartTime: number | null;
}

export interface AttemptResult {
  index: number;
  sent: string;
  received: string;
  speed: number;
  points: number;
  correct: boolean;
  replayed: boolean;
  responseTimeMs: number;
}

export interface Settings {
  userCall: string;
  startSpeed: number;
  toneFrequency: number;
  callsignsPerAttempt: number;
  speedMode: 'adaptive' | 'fixed';
  speedIncrement: number;
  gameMode: GameMode;
}

export interface HighScoreEntry {
  callsign: string;
  score: number;
  date: string;
  numCallsigns: number;
  startSpeed: number;
  peakSpeed: number;
  accuracy: number;
  complete: boolean;
  mode?: GameMode;
}

export const DEFAULT_SETTINGS: Settings = {
  userCall: '',
  startSpeed: 20,
  toneFrequency: 600,
  callsignsPerAttempt: 50,
  speedMode: 'adaptive',
  speedIncrement: 2,
  gameMode: 'original',
};
