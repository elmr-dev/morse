import { useRef, useEffect } from 'react';
import { GameState, Settings } from '../types';

interface GameScreenProps {
  state: GameState;
  settings: Settings;
  userCall: string;
  attemptNumber: number;
  onAnswerChange: (answer: string) => void;
  onSubmit: () => void;
  onReplay: () => void;
  onAbort: () => void;
}

function HighlightedAnswer({ sent, received }: { sent: string; received: string }) {
  const s = sent.toUpperCase();
  const r = received.toUpperCase();
  const maxLen = Math.max(s.length, r.length);

  const chars: JSX.Element[] = [];
  for (let i = 0; i < maxLen; i++) {
    const sentChar = s[i] || '';
    const recvChar = r[i] || '';
    const isCorrect = sentChar === recvChar && sentChar !== '';

    chars.push(
      <span key={i} className={isCorrect ? 'char-correct' : 'char-wrong'}>
        {recvChar || '_'}
      </span>
    );
  }

  return <span className="answer-text">{chars}</span>;
}

export function GameScreen({
  state,
  settings,
  userCall,
  attemptNumber,
  onAnswerChange,
  onSubmit,
  onReplay,
  onAbort,
}: GameScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [state.callsignIndex]);

  const totalScore = state.results.reduce((sum, r) => sum + r.points, 0);
  const currentSpeedCpm = state.currentSpeed * 5;
  const initialSpeedCpm = settings.startSpeed * 5;
  const speeds = state.results.map(r => r.speed * 5);
  const maxSpeedCpm = speeds.length > 0 ? Math.max(...speeds) : initialSpeedCpm;
  const minSpeedCpm = speeds.length > 0 ? Math.min(...speeds) : initialSpeedCpm;
  const callsComplete = state.callsignIndex;
  const callsTotal = settings.callsignsPerAttempt;
  const progressPercent = (callsComplete / callsTotal) * 100;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="game-screen-classic">
      {/* Title bar */}
      <div className="classic-titlebar">
        Attempt #{attemptNumber} — {userCall || 'UNKNOWN'}
      </div>

      {/* Main content */}
      <div className="game-content">
        {/* Current callsign input area */}
        <div className="current-call-section">
          <div className="callsign-area">
            <div className="radio-icon">📻</div>
            <div className="callsign-box input-box">
              <input
                ref={inputRef}
                type="text"
                className="callsign-input"
                value={state.userAnswer}
                onChange={(e) => onAnswerChange(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                placeholder={state.isPlaying ? '...' : ''}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>
            <div className="speed-badge">
              {currentSpeedCpm} CPM
            </div>
          </div>

          {/* Speed stats */}
          <div className="speed-stats">
            <div className="speed-stat">
              <span className="speed-label">Start</span>
              <span className="speed-value">{initialSpeedCpm}</span>
            </div>
            <div className="speed-stat">
              <span className="speed-label">Min</span>
              <span className="speed-value">{minSpeedCpm}</span>
            </div>
            <div className="speed-stat">
              <span className="speed-label">Max</span>
              <span className="speed-value highlight">{maxSpeedCpm}</span>
            </div>
          </div>

          {/* Buttons */}
          <div className="button-row">
            <button
              className="classic-button"
              onClick={onReplay}
              disabled={state.hasReplayed || state.isPlaying}
            >
              Replay (F6)
            </button>
            <button className="classic-button danger" onClick={onAbort}>
              Abort
            </button>
          </div>
        </div>

        {/* Previous results list */}
        {state.results.length > 0 && (
          <div className="results-section">
            <div className="results-header">
              <span>Previous ({state.results.length})</span>
              <span className="score-total">Score: {totalScore}</span>
            </div>
            <div className="results-list">
              {[...state.results].reverse().map((result, i) => (
                <div key={state.results.length - 1 - i} className={`result-row ${result.correct ? 'correct' : 'incorrect'}`}>
                  <span className="result-num">#{result.index + 1}</span>
                  <span className="result-sent">{result.sent}</span>
                  <span className="result-received">
                    <HighlightedAnswer sent={result.sent} received={result.received} />
                  </span>
                  <span className="result-speed">{result.speed * 5}</span>
                  <span className="result-points">{result.correct ? '+' : ''}{result.points}</span>
                  <span className="result-status">{result.correct ? '✓' : '✗'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="progress-section">
        <div className="progress-bar-container">
          <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }}></div>
        </div>
        <div className="progress-text">{callsComplete} / {callsTotal}</div>
      </div>
    </div>
  );
}
