import { useEffect, useState } from 'react';
import type { ContestType } from '../types';

interface HeaderProps {
  isRunning: boolean;
  startTime: number | null;
  contestType: ContestType;
  // Raw scores
  qsos: number;
  multipliers: number;
  rawScore: number;
  // Verified scores
  verifiedQsos: number;
  verifiedMultipliers: number;
  verifiedScore: number;
  // Errors
  dupeCount: number;
  bustedCount: number;
  // CWT-specific errors
  bustedNameCount?: number;
  bustedNumberCount?: number;
  // User
  userCall: string;
  onUserCallChange: (call: string) => void;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const h = hours.toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');

  return `${h}:${m}:${s}`;
}

export function Header({
  isRunning,
  startTime,
  contestType,
  qsos,
  multipliers,
  rawScore,
  verifiedQsos,
  verifiedMultipliers,
  verifiedScore,
  dupeCount,
  bustedCount,
  bustedNameCount = 0,
  bustedNumberCount = 0,
  userCall,
  onUserCallChange,
}: HeaderProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRunning || !startTime) {
      setElapsed(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  const hasErrors = dupeCount > 0 || bustedCount > 0;

  return (
    <header className="contest-header">
      <div className="header-left">
        <h1>{contestType === 'cwt' ? 'CWT Simulator' : 'CQ WPX Simulator'}</h1>
        <div className="user-call">
          <label htmlFor="userCall">My Call:</label>
          <input
            id="userCall"
            type="text"
            value={userCall}
            onChange={(e) => onUserCallChange(e.target.value)}
            disabled={isRunning}
            className="call-input"
          />
        </div>
      </div>

      <div className="header-stats">
        <div className="stat">
          <span className="stat-label">Time</span>
          <span className="stat-value">{formatElapsed(elapsed)}</span>
        </div>

        {/* Raw vs Verified display like MorseRunner */}
        <div className="stat-group">
          <div className="stat-header">
            <span></span>
            <span className="raw-label">Raw</span>
            <span className="verified-label">Verified</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">QSOs</span>
            <span className="stat-value raw">{qsos}</span>
            <span className={`stat-value verified ${hasErrors ? 'has-errors' : ''}`}>{verifiedQsos}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Mults</span>
            <span className="stat-value raw">{multipliers}</span>
            <span className={`stat-value verified ${hasErrors ? 'has-errors' : ''}`}>{verifiedMultipliers}</span>
          </div>
          <div className="stat-row score">
            <span className="stat-label">Score</span>
            <span className="stat-value raw">{rawScore.toLocaleString()}</span>
            <span className={`stat-value verified ${hasErrors ? 'has-errors' : ''}`}>{verifiedScore.toLocaleString()}</span>
          </div>
        </div>

        {hasErrors && (
          <div className="error-stats">
            {dupeCount > 0 && <span className="error-stat dupe">{dupeCount} DUP</span>}
            {contestType === 'cwt' ? (
              // CWT-specific error display
              <>
                {bustedNameCount > 0 && <span className="error-stat busted">{bustedNameCount} NAME</span>}
                {bustedNumberCount > 0 && <span className="error-stat busted">{bustedNumberCount} NR</span>}
              </>
            ) : (
              bustedCount > 0 && <span className="error-stat busted">{bustedCount} NR?</span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
