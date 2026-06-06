export function KeyboardHelp() {
  return (
    <div className="keyboard-help">
      <div className="key-group">
        <span className="key-hint"><kbd>Enter</kbd> ESM (CQ/Exch/Log)</span>
        <span className="key-hint"><kbd>Ins</kbd> Call+Exch</span>
        <span className="key-hint"><kbd>Tab</kbd> Complete</span>
        <span className="key-hint"><kbd>Esc</kbd> Stop</span>
      </div>
      <div className="key-group">
        <span className="key-hint"><kbd>F1</kbd> CQ</span>
        <span className="key-hint"><kbd>F2</kbd> Exch</span>
        <span className="key-hint"><kbd>F3</kbd> TU</span>
        <span className="key-hint"><kbd>F4</kbd> MyCall</span>
        <span className="key-hint"><kbd>F5</kbd> HisCall</span>
        <span className="key-hint"><kbd>F8</kbd> AGN?</span>
      </div>
    </div>
  );
}
