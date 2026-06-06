import { useState } from 'react';
import { HighScoreEntry, GameMode } from '../types';

interface HighScoresProps {
  scores: HighScoreEntry[];
  onClose: () => void;
  onClear: () => void;
}

export function HighScores({ scores, onClose, onClear }: HighScoresProps) {
  const [modeFilter, setModeFilter] = useState<GameMode>('original');

  const filtered = scores.filter(s => (s.mode || 'original') === modeFilter);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal high-scores-modal" onClick={(e) => e.stopPropagation()}>
        <h2>High Scores</h2>

        <div className="mode-filter">
          <button
            className={`mode-filter-button ${modeFilter === 'original' ? 'active' : ''}`}
            onClick={() => setModeFilter('original')}
          >
            Original
          </button>
          <button
            className={`mode-filter-button ${modeFilter === 'mobile' ? 'active' : ''}`}
            onClick={() => setModeFilter('mobile')}
          >
            Mobile
          </button>
        </div>

        {filtered.length === 0 ? (
          <p className="no-scores">No high scores yet. Play a game to set one!</p>
        ) : (
          <table className="high-scores-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Score</th>
                <th>Call</th>
                <th>Peak WPM</th>
                <th>Accuracy</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr key={i} className={!entry.complete ? 'incomplete' : ''}>
                  <td>{i + 1}</td>
                  <td className="score">{entry.score.toLocaleString()}</td>
                  <td>{entry.callsign || '-'}</td>
                  <td>{entry.peakSpeed}</td>
                  <td>{entry.accuracy.toFixed(0)}%</td>
                  <td>{new Date(entry.date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="modal-actions">
          <button className="primary-button" onClick={onClose}>
            Close
          </button>
          {scores.length > 0 && (
            <button
              className="danger-button"
              onClick={() => {
                if (confirm('Clear all high scores?')) {
                  onClear();
                }
              }}
            >
              Clear All
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
