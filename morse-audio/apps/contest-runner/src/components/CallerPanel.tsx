import type { Caller } from '../types';

interface CallerPanelProps {
  callers: Caller[];
  selectedCaller: Caller | null;
  onSelect: (caller: Caller) => void;
  isListening: boolean;
}

export function CallerPanel({
  callers,
  selectedCaller,
  onSelect,
  isListening,
}: CallerPanelProps) {
  // Only show callers that have been "heard" (their morse has finished)
  const visibleCallers = callers.filter(c => c.heard);

  return (
    <div className="caller-panel">
      <h2>Pileup ({visibleCallers.length})</h2>
      <div className="caller-list">
        {visibleCallers.length === 0 && (
          <p className="no-callers">
            {isListening ? 'Listening...' : 'Press Enter or F1 to call CQ'}
          </p>
        )}
        {visibleCallers.map((caller) => (
          <button
            key={caller.id}
            className={`caller-button ${selectedCaller?.id === caller.id ? 'selected' : ''}`}
            onClick={() => onSelect(caller)}
            disabled={!isListening}
            title={`${caller.wpm} WPM, ${caller.frequencyOffset > 0 ? '+' : ''}${caller.frequencyOffset} Hz`}
          >
            <span className="caller-call">{caller.call}</span>
            <span className="caller-info">
              {caller.wpm}w {caller.frequencyOffset > 0 ? '+' : ''}{caller.frequencyOffset}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
