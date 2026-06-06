import { AttemptResult, Settings } from '../types';
import { calculateStats } from '../utils/scoring';
import { ResultRow } from './ResultRow';

interface ResultsScreenProps {
  results: AttemptResult[];
  settings: Settings;
  isNewHighScore: boolean;
  onTryAgain: () => void;
  onShowHighScores: () => void;
}

export function ResultsScreen({
  results,
  settings,
  isNewHighScore,
  onTryAgain,
  onShowHighScores,
}: ResultsScreenProps) {
  const stats = calculateStats(results);
  const isComplete = results.length === settings.callsignsPerAttempt;

  return (
    <div className="results-screen">
      <h2>{isComplete ? 'Attempt Complete!' : 'Attempt Ended'}</h2>

      <div className="final-score">
        <div className="score-value">{stats.totalScore.toLocaleString()}</div>
        <div className="score-label">Total Score</div>
        {isNewHighScore && <div className="new-high-score">New High Score!</div>}
      </div>

      <div className="stats-grid">
        <div className="stat-box">
          <div className="stat-value">
            {stats.correctCount}/{stats.totalCount}
          </div>
          <div className="stat-label">Correct ({stats.accuracy.toFixed(0)}%)</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">
            {stats.startSpeed} → {stats.peakSpeed} → {stats.endSpeed}
          </div>
          <div className="stat-label">WPM (start → peak → end)</div>
        </div>
      </div>

      <div className="results-table-container full">
        <table className="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Sent</th>
              <th>Rcvd</th>
              <th>WPM</th>
              <th>Pts</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <ResultRow key={result.index} result={result} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="results-actions">
        <button className="primary-button" onClick={onTryAgain}>
          Try Again
        </button>
        <button className="secondary-button" onClick={onShowHighScores}>
          High Scores
        </button>
      </div>

      <div className="keyboard-hints">
        <p><kbd>Enter</kbd> or <kbd>F5</kbd> to try again</p>
      </div>
    </div>
  );
}
