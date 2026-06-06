import type { Caller, QsoState, ContestType } from '../types';
import { formatSerial } from '../utils/cutNumbers';

interface QsoEntryProps {
  qsoState: QsoState;
  contestType: ContestType;
  currentCall: string;
  selectedCaller: Caller | null;
  nextSerial: number;
  // User-entered received exchange (WPX)
  enteredRst: string;
  enteredNr: string;
  // User-entered received exchange (CWT)
  enteredName: string;
  enteredNumber: string;
  // User's exchange for CWT
  myName: string;
  myNumber: string;
  // Callbacks
  onCallChange: (call: string) => void;
  onRstChange: (rst: string) => void;
  onNrChange: (nr: string) => void;
  onNameChange: (name: string) => void;
  onNumberChange: (number: string) => void;
  onEnter: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  nrInputRef: React.RefObject<HTMLInputElement>;
  isSending: boolean;
}

function getStateLabel(state: QsoState, isSending: boolean): string {
  if (isSending) return 'Sending...';

  switch (state) {
    case 'idle':
      return 'Press Enter to CQ';
    case 'cqing':
      return 'CQing...';
    case 'listening':
      return 'Listening';
    case 'working':
      return 'Type call, Enter to send';
    case 'sending_exchange':
      return 'Sent exchange';
    case 'logging':
      return 'Enter to log';
    case 'sending_tu':
      return 'Logging...';
    default:
      return '';
  }
}

function getStateClass(state: QsoState): string {
  switch (state) {
    case 'idle':
      return 'idle';
    case 'cqing':
    case 'sending_exchange':
    case 'sending_tu':
      return 'sending';
    case 'listening':
      return 'listening';
    case 'working':
      return 'working';
    case 'logging':
      return 'logging';
    default:
      return '';
  }
}

export function QsoEntry({
  qsoState,
  contestType,
  currentCall,
  selectedCaller,
  nextSerial,
  enteredRst,
  enteredNr,
  enteredName,
  enteredNumber,
  myName,
  myNumber,
  onCallChange,
  onRstChange,
  onNrChange,
  onNameChange,
  onNumberChange,
  onEnter,
  inputRef,
  nrInputRef,
  isSending,
}: QsoEntryProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    }
  };

  const isCwt = contestType === 'cwt';

  return (
    <div className="qso-entry">
      <div className="qso-state">
        <span className={`state-indicator ${getStateClass(qsoState)}`}>
          {getStateLabel(qsoState, isSending)}
        </span>
      </div>

      <div className="qso-fields">
        {/* Call field - always shown */}
        <div className="field call-field-container">
          <label htmlFor="callInput">Call</label>
          <input
            ref={inputRef}
            id="callInput"
            type="text"
            value={currentCall}
            onChange={(e) => onCallChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder=""
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="call-field"
          />
        </div>

        {isCwt ? (
          // CWT: Name + Number fields
          <>
            <div className="field name-field-container">
              <label htmlFor="nameInput">Name</label>
              <input
                id="nameInput"
                type="text"
                value={enteredName}
                onChange={(e) => onNameChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder=""
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="name-field"
                maxLength={10}
              />
            </div>

            <div className="field number-field-container">
              <label htmlFor="numberInput">Nr</label>
              <input
                ref={nrInputRef}
                id="numberInput"
                type="text"
                value={enteredNumber}
                onChange={(e) => onNumberChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder=""
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="number-field"
                maxLength={10}
              />
            </div>

            {/* Your sent exchange for CWT */}
            <div className="field sent-field-container">
              <label>Sent</label>
              <div className="exchange-value sent">{myName} {myNumber}</div>
            </div>
          </>
        ) : (
          // WPX: RST + Serial fields
          <>
            <div className="field rst-field-container">
              <label htmlFor="rstInput">RST</label>
              <input
                id="rstInput"
                type="text"
                value={enteredRst}
                onChange={(e) => onRstChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="599"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="rst-field"
                maxLength={3}
              />
            </div>

            <div className="field nr-field-container">
              <label htmlFor="nrInput">Nr.</label>
              <input
                ref={nrInputRef}
                id="nrInput"
                type="text"
                value={enteredNr}
                onChange={(e) => onNrChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder=""
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="nr-field"
              />
            </div>

            <div className="field sent-field-container">
              <label>Sent</label>
              <div className="exchange-value sent">{formatSerial(nextSerial)}</div>
            </div>
          </>
        )}
      </div>

      {selectedCaller && (
        <div className="working-info">
          <span className="working-call">{selectedCaller.call}</span>
          <span className="working-details">
            {selectedCaller.wpm} WPM
            {selectedCaller.frequencyOffset !== 0 && (
              <> / {selectedCaller.frequencyOffset > 0 ? '+' : ''}{selectedCaller.frequencyOffset} Hz</>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
