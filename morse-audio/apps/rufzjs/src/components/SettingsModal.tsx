import { useState } from 'react';
import { Settings } from '../types';

interface SettingsModalProps {
  settings: Settings;
  onSave: (settings: Partial<Settings>) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState(settings);

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-form">
          <div className="form-group">
            <label htmlFor="toneFrequency">Tone Frequency:</label>
            <div className="input-with-unit">
              <input
                id="toneFrequency"
                type="number"
                min={400}
                max={1000}
                step={50}
                value={localSettings.toneFrequency}
                onChange={(e) =>
                  setLocalSettings((s) => ({
                    ...s,
                    toneFrequency: parseInt(e.target.value) || 600,
                  }))
                }
              />
              <span className="unit">Hz</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="callsignsPerAttempt">Callsigns per Attempt:</label>
            <input
              id="callsignsPerAttempt"
              type="number"
              min={10}
              max={100}
              value={localSettings.callsignsPerAttempt}
              onChange={(e) =>
                setLocalSettings((s) => ({
                  ...s,
                  callsignsPerAttempt: parseInt(e.target.value) || 50,
                }))
              }
            />
          </div>

          <div className="form-group">
            <label htmlFor="speedMode">Speed Mode:</label>
            <select
              id="speedMode"
              value={localSettings.speedMode}
              onChange={(e) =>
                setLocalSettings((s) => ({
                  ...s,
                  speedMode: e.target.value as 'adaptive' | 'fixed',
                }))
              }
            >
              <option value="adaptive">Adaptive (RufzXP style, ±3%)</option>
              <option value="fixed">Fixed (constant speed)</option>
            </select>
            {localSettings.speedMode === 'adaptive' && (
              <p className="help-text">
                Speed adjusts by 3% after each callsign (like RufzXP)
              </p>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
