import { useReducer, useCallback } from 'react';
import { GameState, AttemptResult, Settings } from '../types';
import { getGameCallsigns } from '../utils/callsignDatabase';
import { scoreAnswer } from '../utils/comparison';
import { calculatePoints } from '../utils/scoring';

type GameAction =
  | { type: 'START_GAME'; settings: Settings }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SET_ANSWER'; answer: string }
  | { type: 'SUBMIT_ANSWER' }
  | { type: 'REPLAY' }
  | { type: 'ABORT' }
  | { type: 'RESET' }
  | { type: 'NEXT_CALLSIGN' };

interface GameStateWithCallsigns extends GameState {
  callsigns: string[];
  settings: Settings;
}

const initialState: GameStateWithCallsigns = {
  phase: 'start',
  callsignIndex: 0,
  currentCallsign: '',
  userAnswer: '',
  currentSpeed: 20,
  isPlaying: false,
  hasReplayed: false,
  results: [],
  startTime: null,
  callsignStartTime: null,
  callsigns: [],
  settings: {
    userCall: '',
    startSpeed: 20,
    toneFrequency: 600,
    callsignsPerAttempt: 50,
    speedMode: 'adaptive',
    speedIncrement: 2,
    gameMode: 'original',
  },
};

function gameReducer(state: GameStateWithCallsigns, action: GameAction): GameStateWithCallsigns {
  switch (action.type) {
    case 'START_GAME': {
      const callsigns = getGameCallsigns(action.settings.callsignsPerAttempt);
      return {
        ...initialState,
        phase: 'playing',
        callsigns,
        currentCallsign: callsigns[0],
        currentSpeed: action.settings.startSpeed,
        startTime: Date.now(),
        callsignStartTime: null,
        settings: action.settings,
      };
    }

    case 'SET_PLAYING':
      return {
        ...state,
        isPlaying: action.isPlaying,
        callsignStartTime: action.isPlaying ? Date.now() : state.callsignStartTime,
      };

    case 'SET_ANSWER':
      return { ...state, userAnswer: action.answer };

    case 'REPLAY':
      if (state.hasReplayed || state.isPlaying) return state;
      return { ...state, hasReplayed: true };

    case 'SUBMIT_ANSWER': {
      const { correct, total, isExact } = scoreAnswer(
        state.currentCallsign,
        state.userAnswer
      );
      // Calculate errors for RufzXP scoring
      const errors = total - correct;
      const points = calculatePoints(
        state.currentSpeed,
        state.currentCallsign.length,
        errors,
        state.hasReplayed
      );

      const responseTimeMs = state.callsignStartTime
        ? Date.now() - state.callsignStartTime
        : 0;

      const result: AttemptResult = {
        index: state.callsignIndex,
        sent: state.currentCallsign,
        received: state.userAnswer.toUpperCase().trim(),
        speed: state.currentSpeed,
        points,
        correct: isExact,
        replayed: state.hasReplayed,
        responseTimeMs,
      };

      // RufzXP uses percentage-based speed adjustment (typically 3%)
      let newSpeed = state.currentSpeed;
      if (state.settings.speedMode === 'adaptive') {
        const speedAdjustment = state.currentSpeed * 0.03; // 3% adjustment
        if (isExact) {
          newSpeed = state.currentSpeed + Math.max(1, Math.round(speedAdjustment));
        } else {
          newSpeed = Math.max(5, state.currentSpeed - Math.max(1, Math.round(speedAdjustment)));
        }
      }

      const nextIndex = state.callsignIndex + 1;
      const isComplete = nextIndex >= state.callsigns.length;

      return {
        ...state,
        results: [...state.results, result],
        currentSpeed: newSpeed,
        callsignIndex: nextIndex,
        currentCallsign: isComplete ? '' : state.callsigns[nextIndex],
        userAnswer: '',
        hasReplayed: false,
        isPlaying: false,
        callsignStartTime: null,
        phase: isComplete ? 'results' : state.phase,
      };
    }

    case 'NEXT_CALLSIGN': {
      const nextIndex = state.callsignIndex;
      if (nextIndex >= state.callsigns.length) {
        return { ...state, phase: 'results' };
      }
      return {
        ...state,
        currentCallsign: state.callsigns[nextIndex],
        userAnswer: '',
        hasReplayed: false,
        isPlaying: false,
        callsignStartTime: null,
      };
    }

    case 'ABORT':
      return { ...state, phase: 'results' };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

export function useGameState() {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  const startGame = useCallback((settings: Settings) => {
    dispatch({ type: 'START_GAME', settings });
  }, []);

  const setPlaying = useCallback((isPlaying: boolean) => {
    dispatch({ type: 'SET_PLAYING', isPlaying });
  }, []);

  const setAnswer = useCallback((answer: string) => {
    dispatch({ type: 'SET_ANSWER', answer });
  }, []);

  const submitAnswer = useCallback(() => {
    dispatch({ type: 'SUBMIT_ANSWER' });
  }, []);

  const replay = useCallback(() => {
    dispatch({ type: 'REPLAY' });
  }, []);

  const abort = useCallback(() => {
    dispatch({ type: 'ABORT' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  return {
    state,
    startGame,
    setPlaying,
    setAnswer,
    submitAnswer,
    replay,
    abort,
    reset,
  };
}
