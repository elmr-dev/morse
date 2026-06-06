import { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Settings } from '../types';
import { buildCallsignChallenge, SegmentChallenge } from '../utils/segmentSplitter';

interface MobileGameScreenProps {
  state: GameState;
  settings: Settings;
  userCall: string;
  attemptNumber: number;
  onSubmitAnswer: (answer: string) => void;
  onReplay: () => void;
  onAbort: () => void;
}

export function MobileGameScreen({
  state,
  settings,
  userCall,
  attemptNumber,
  onSubmitAnswer,
  onReplay,
  onAbort,
}: MobileGameScreenProps) {
  const [challenges, setChallenges] = useState<SegmentChallenge[]>([]);
  const [currentSegIdx, setCurrentSegIdx] = useState(0);
  const [segmentAnswers, setSegmentAnswers] = useState<(string | null)[]>([]);
  const [flashState, setFlashState] = useState<'correct' | 'wrong' | null>(null);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const prevCallsignRef = useRef<string>('');
  const prevCallsignIndexRef = useRef<number>(-1);

  // Generate challenges when callsign changes
  useEffect(() => {
    if (
      state.currentCallsign &&
      (state.currentCallsign !== prevCallsignRef.current ||
        state.callsignIndex !== prevCallsignIndexRef.current)
    ) {
      prevCallsignRef.current = state.currentCallsign;
      prevCallsignIndexRef.current = state.callsignIndex;
      const newChallenges = buildCallsignChallenge(state.currentCallsign);
      setChallenges(newChallenges);
      setCurrentSegIdx(0);
      setSegmentAnswers(new Array(newChallenges.length).fill(null));
      setFlashState(null);
      setFlashIndex(null);
    }
  }, [state.currentCallsign, state.callsignIndex]);

  const handleChoice = useCallback((choiceIdx: number) => {
    if (flashState !== null) return; // ignore taps during flash

    const challenge = challenges[currentSegIdx];
    if (!challenge) return;

    const chosen = challenge.choices[choiceIdx];
    const isCorrect = choiceIdx === challenge.correctIndex;

    // Flash feedback
    setFlashState(isCorrect ? 'correct' : 'wrong');
    setFlashIndex(choiceIdx);

    const newAnswers = [...segmentAnswers];
    newAnswers[currentSegIdx] = chosen;
    setSegmentAnswers(newAnswers);

    setTimeout(() => {
      setFlashState(null);
      setFlashIndex(null);

      const nextIdx = currentSegIdx + 1;
      if (nextIdx >= challenges.length) {
        // All segments answered — submit concatenated answer
        const finalAnswers = [...newAnswers];
        const fullAnswer = finalAnswers.join('');
        onSubmitAnswer(fullAnswer);
      } else {
        setCurrentSegIdx(nextIdx);
      }
    }, 200);
  }, [challenges, currentSegIdx, segmentAnswers, flashState, onSubmitAnswer]);

  const totalScore = state.results.reduce((sum, r) => sum + r.points, 0);
  const currentSpeedCpm = state.currentSpeed * 5;
  const initialSpeedCpm = settings.startSpeed * 5;
  const speeds = state.results.map(r => r.speed * 5);
  const maxSpeedCpm = speeds.length > 0 ? Math.max(...speeds) : initialSpeedCpm;
  const minSpeedCpm = speeds.length > 0 ? Math.min(...speeds) : initialSpeedCpm;
  const callsComplete = state.callsignIndex;
  const callsTotal = settings.callsignsPerAttempt;
  const progressPercent = (callsComplete / callsTotal) * 100;

  const currentChallenge = challenges[currentSegIdx];

  return (
    <div className="game-screen-classic">
      {/* Title bar */}
      <div className="classic-titlebar">
        Attempt #{attemptNumber} — {userCall || 'UNKNOWN'}
      </div>

      {/* Main content */}
      <div className="game-content">
        <div className="current-call-section">
          {/* Speed and score row */}
          <div className="callsign-area">
            <div className="radio-icon">📻</div>
            <div className="callsign-box">
              {state.isPlaying ? '...' : (
                challenges.length > 1
                  ? `Segment ${currentSegIdx + 1} of ${challenges.length}`
                  : 'Choose the callsign'
              )}
            </div>
            <div className="speed-badge">
              {currentSpeedCpm} CPM
            </div>
          </div>

          {/* Segment progress indicators */}
          {challenges.length > 1 && (
            <div className="segment-progress">
              {challenges.map((ch, i) => {
                const answer = segmentAnswers[i];
                let className = 'segment-dot';
                if (i === currentSegIdx) className += ' active';
                if (answer !== null) {
                  className += answer === ch.segment ? ' correct' : ' wrong';
                }
                return (
                  <span key={i} className={className}>
                    {answer !== null ? answer : ch.segment.replace(/./g, '·')}
                  </span>
                );
              })}
            </div>
          )}

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

          {/* Multiple choice buttons */}
          {currentChallenge && !state.isPlaying && (
            <div className="mobile-choices">
              {currentChallenge.choices.map((choice, i) => {
                let btnClass = 'mobile-choice-button';
                if (flashIndex === i && flashState === 'correct') btnClass += ' correct';
                if (flashIndex === i && flashState === 'wrong') btnClass += ' wrong';
                return (
                  <button
                    key={i}
                    className={btnClass}
                    onClick={() => handleChoice(i)}
                    disabled={flashState !== null}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>
          )}

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
                  <span className="result-received">{result.received}</span>
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
