import { useState } from 'react';
import type { ContestType } from '../types';

interface ContestSetupProps {
  userCall: string;
  myName: string;
  myNumber: string;
  contestType: ContestType;
  onUserCallChange: (call: string) => void;
  onMyNameChange: (name: string) => void;
  onMyNumberChange: (number: string) => void;
  onContestTypeChange: (type: ContestType) => void;
  onStart: () => void;
}

export function ContestSetup({
  userCall,
  myName,
  myNumber,
  contestType,
  onUserCallChange,
  onMyNameChange,
  onMyNumberChange,
  onContestTypeChange,
  onStart,
}: ContestSetupProps) {
  const [errors, setErrors] = useState<string[]>([]);

  const handleStart = () => {
    const newErrors: string[] = [];

    if (!userCall.trim()) {
      newErrors.push('Please enter your callsign');
    }

    if (contestType === 'cwt') {
      if (!myName.trim()) {
        newErrors.push('Please enter your name for CWT');
      }
      if (!myNumber.trim()) {
        newErrors.push('Please enter your CWOps number or state/country');
      }
    }

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors([]);
    onStart();
  };

  return (
    <div className="contest-setup">
      <div className="setup-container">
        <h1>Contest Runner</h1>
        <p className="setup-subtitle">Practice your CW contesting skills</p>

        <div className="setup-section">
          <h2>Select Contest</h2>
          <div className="contest-type-selector">
            <button
              className={`contest-type-btn ${contestType === 'wpx' ? 'active' : ''}`}
              onClick={() => onContestTypeChange('wpx')}
            >
              <span className="contest-name">CQ WPX</span>
              <span className="contest-desc">Exchange: 5NN + Serial Number</span>
            </button>
            <button
              className={`contest-type-btn ${contestType === 'cwt' ? 'active' : ''}`}
              onClick={() => onContestTypeChange('cwt')}
            >
              <span className="contest-name">CWT</span>
              <span className="contest-desc">Exchange: Name + Number/State</span>
            </button>
          </div>
        </div>

        <div className="setup-section">
          <h2>Your Station</h2>
          <div className="setup-field">
            <label htmlFor="setupUserCall">Callsign</label>
            <input
              id="setupUserCall"
              type="text"
              value={userCall}
              onChange={(e) => onUserCallChange(e.target.value.toUpperCase())}
              placeholder="W1ABC"
              className="setup-input"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
            />
          </div>

          {contestType === 'cwt' && (
            <>
              <div className="setup-field">
                <label htmlFor="setupMyName">Your Name</label>
                <input
                  id="setupMyName"
                  type="text"
                  value={myName}
                  onChange={(e) => onMyNameChange(e.target.value.toUpperCase())}
                  placeholder="JOHN"
                  className="setup-input"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  maxLength={10}
                />
                <span className="field-hint">Your first name or nickname</span>
              </div>

              <div className="setup-field">
                <label htmlFor="setupMyNumber">Your Number</label>
                <input
                  id="setupMyNumber"
                  type="text"
                  value={myNumber}
                  onChange={(e) => onMyNumberChange(e.target.value.toUpperCase())}
                  placeholder="1234 or CA"
                  className="setup-input"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  maxLength={10}
                />
                <span className="field-hint">
                  CWOps member number (e.g., 1234) or state/country (e.g., CA, G)
                </span>
              </div>
            </>
          )}
        </div>

        {errors.length > 0 && (
          <div className="setup-errors">
            {errors.map((error, i) => (
              <p key={i} className="error-message">{error}</p>
            ))}
          </div>
        )}

        <button className="start-contest-btn" onClick={handleStart}>
          Start Contest
        </button>
      </div>
    </div>
  );
}
