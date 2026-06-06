import { useState } from 'react';
import { Settings, HighScoreEntry, GameMode } from '../types';

interface StartScreenProps {
  settings: Settings;
  onSettingsChange: (settings: Partial<Settings>) => void;
  onStart: () => void;
  highScores: HighScoreEntry[];
  onShowSettings: () => void;
  dbStatus: 'loading' | 'ready' | 'error';
  dbError: string | null;
  callsignCount: number;
}

export function StartScreen({
  settings,
  onSettingsChange,
  onStart,
  highScores,
  onShowSettings,
  dbStatus,
  dbError,
  callsignCount,
}: StartScreenProps) {
  const [localCall, setLocalCall] = useState(settings.userCall);
  const [localSpeed, setLocalSpeed] = useState(settings.startSpeed);

  const handleStart = () => {
    onSettingsChange({ userCall: localCall, startSpeed: localSpeed });
    onStart();
  };

  const filteredScores = highScores.filter(h => (h.mode || 'original') === settings.gameMode);
  const topScore = filteredScores[0];
  const bestSpeed = filteredScores.length > 0
    ? Math.max(...filteredScores.map(h => h.peakSpeed))
    : 0;

  const canStart = dbStatus === 'ready';

  return (
    <div className="start-screen">
      <h1>RufzXP Web</h1>
      <p className="subtitle">CW Callsign Trainer</p>

      <div className="mode-selector">
        <button
          className={`mode-button ${settings.gameMode === 'original' ? 'active' : ''}`}
          onClick={() => onSettingsChange({ gameMode: 'original' as GameMode })}
        >
          Original
        </button>
        <button
          className={`mode-button ${settings.gameMode === 'mobile' ? 'active' : ''}`}
          onClick={() => onSettingsChange({ gameMode: 'mobile' as GameMode })}
        >
          Mobile
        </button>
      </div>

      <div className="form-group">
        <label htmlFor="userCall">Your Call:</label>
        <input
          id="userCall"
          type="text"
          value={localCall}
          onChange={(e) => setLocalCall(e.target.value.toUpperCase())}
          placeholder="Enter your callsign"
          maxLength={10}
          autoComplete="off"
        />
      </div>

      <div className="form-group">
        <label htmlFor="startSpeed">Start Speed:</label>
        <div className="speed-input">
          <input
            id="startSpeed"
            type="number"
            min={5}
            max={60}
            value={localSpeed}
            onChange={(e) => setLocalSpeed(parseInt(e.target.value) || 20)}
          />
          <span className="unit">WPM</span>
          <span className="cpm">({localSpeed * 5} CPM)</span>
        </div>
      </div>

      <button className="start-button" onClick={handleStart} disabled={!canStart}>
        {dbStatus === 'loading' && 'Loading callsigns...'}
        {dbStatus === 'error' && 'Database Error'}
        {dbStatus === 'ready' && 'Start'}
      </button>

      {dbStatus === 'ready' && (
        <p className="db-status">{callsignCount.toLocaleString()} callsigns loaded</p>
      )}

      {dbStatus === 'error' && (
        <p className="db-error">Error: {dbError}</p>
      )}

      <button className="settings-button" onClick={onShowSettings}>
        Settings
      </button>

      {topScore && (
        <div className="high-score-summary">
          <div className="stat">
            <span className="label">High Score:</span>
            <span className="value">{topScore.score.toLocaleString()}</span>
          </div>
          {bestSpeed > 0 && (
            <div className="stat">
              <span className="label">Best Speed:</span>
              <span className="value">{bestSpeed} WPM</span>
            </div>
          )}
        </div>
      )}

      <div className="keyboard-hints">
        <p><kbd>Enter</kbd> or <kbd>F5</kbd> to start</p>
      </div>
    </div>
  );
}
