import type { ContestSettings } from '../types';

interface BandControlsProps {
  qrnEnabled: boolean;
  snr: number;
  bandwidth: number;
  wpm: number;
  contestSettings: ContestSettings;
  onQrnToggle: (enabled: boolean) => void;
  onSnrChange: (snr: number) => void;
  onBandwidthChange: (bandwidth: number) => void;
  onWpmChange: (wpm: number) => void;
  onActivityChange: (activity: number) => void;
  onQsbToggle: (enabled: boolean) => void;
  onQrmToggle: (enabled: boolean) => void;
  onFlutterToggle: (enabled: boolean) => void;
  onLidsToggle: (enabled: boolean) => void;
}

const BANDWIDTH_OPTIONS = [
  { value: 250, label: '250 Hz' },
  { value: 500, label: '500 Hz' },
  { value: 1000, label: '1 kHz' },
  { value: 2000, label: '2 kHz' },
];

export function BandControls({
  qrnEnabled,
  snr,
  bandwidth,
  wpm,
  contestSettings,
  onQrnToggle,
  onSnrChange,
  onBandwidthChange,
  onWpmChange,
  onActivityChange,
  onQsbToggle,
  onQrmToggle,
  onFlutterToggle,
  onLidsToggle,
}: BandControlsProps) {
  return (
    <div className="band-controls">
      {/* Activity Level */}
      <div className="control-group">
        <label htmlFor="activity">Activity: {contestSettings.activity}</label>
        <input
          id="activity"
          type="range"
          min={1}
          max={9}
          value={contestSettings.activity}
          onChange={(e) => onActivityChange(parseInt(e.target.value, 10))}
        />
      </div>

      {/* WPM */}
      <div className="control-group">
        <label htmlFor="wpm">WPM: {wpm}</label>
        <input
          id="wpm"
          type="range"
          min={15}
          max={40}
          value={wpm}
          onChange={(e) => onWpmChange(parseInt(e.target.value, 10))}
        />
      </div>

      {/* Bandwidth */}
      <div className="control-group">
        <label htmlFor="bandwidth">BW:</label>
        <select
          id="bandwidth"
          value={bandwidth}
          onChange={(e) => onBandwidthChange(parseInt(e.target.value, 10))}
        >
          {BANDWIDTH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* QRN (Noise) */}
      <div className="control-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={qrnEnabled}
            onChange={(e) => onQrnToggle(e.target.checked)}
          />
          QRN
        </label>
      </div>

      {/* SNR */}
      <div className="control-group">
        <label htmlFor="snr">SNR: {snr} dB</label>
        <input
          id="snr"
          type="range"
          min={3}
          max={30}
          value={snr}
          onChange={(e) => onSnrChange(parseInt(e.target.value, 10))}
          disabled={!qrnEnabled}
        />
      </div>

      {/* QSB (Fading) */}
      <div className="control-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={contestSettings.qsb}
            onChange={(e) => onQsbToggle(e.target.checked)}
          />
          QSB
        </label>
      </div>

      {/* Flutter */}
      <div className="control-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={contestSettings.flutter}
            onChange={(e) => onFlutterToggle(e.target.checked)}
            disabled={!contestSettings.qsb}
          />
          Flutter
        </label>
      </div>

      {/* QRM (Interference) */}
      <div className="control-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={contestSettings.qrm}
            onChange={(e) => onQrmToggle(e.target.checked)}
          />
          QRM
        </label>
      </div>

      {/* Lids (Mistakes) */}
      <div className="control-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={contestSettings.lids}
            onChange={(e) => onLidsToggle(e.target.checked)}
          />
          Lids
        </label>
      </div>
    </div>
  );
}
