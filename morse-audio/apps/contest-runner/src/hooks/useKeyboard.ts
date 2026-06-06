import { useEffect, useCallback } from 'react';

interface UseKeyboardOptions {
  isRunning: boolean;
  onF1?: () => void;  // CQ
  onF2?: () => void;  // Exchange
  onF3?: () => void;  // TU
  onF4?: () => void;  // My call
  onF5?: () => void;  // His call
  onF8?: () => void;  // AGN?
  onEnter?: () => void;  // ESM
  onInsert?: () => void; // Send call + exchange
  onTab?: () => void;    // Auto-complete
  onEscape?: () => void; // Cancel/stop
}

export function useKeyboard({
  isRunning,
  onF1,
  onF2,
  onF3,
  onF4,
  onF5,
  onF8,
  onEnter,
  onInsert,
  onTab,
  onEscape,
}: UseKeyboardOptions) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isRunning) return;

    // Check if we're in a text input
    const target = e.target as HTMLElement;
    const isTextInput = target.tagName === 'INPUT' &&
      (target as HTMLInputElement).type === 'text';

    switch (e.key) {
      case 'F1':
        e.preventDefault();
        onF1?.();
        break;

      case 'F2':
        e.preventDefault();
        onF2?.();
        break;

      case 'F3':
        e.preventDefault();
        onF3?.();
        break;

      case 'F4':
        e.preventDefault();
        onF4?.();
        break;

      case 'F5':
        e.preventDefault();
        onF5?.();
        break;

      case 'F8':
        e.preventDefault();
        onF8?.();
        break;

      case 'Enter':
        e.preventDefault();
        onEnter?.();
        break;

      case 'Insert':
      case '`': // Backtick as alternative to Insert
        e.preventDefault();
        onInsert?.();
        break;

      case 'Tab':
        if (isTextInput) {
          e.preventDefault();
          onTab?.();
        }
        break;

      case 'Escape':
        e.preventDefault();
        onEscape?.();
        break;

      // Semicolon sends his call (F5)
      case ';':
        if (!isTextInput) {
          e.preventDefault();
          onF5?.();
        }
        break;

      // Apostrophe sends exchange (F2)
      case "'":
        if (!isTextInput) {
          e.preventDefault();
          onF2?.();
        }
        break;
    }
  }, [isRunning, onF1, onF2, onF3, onF4, onF5, onF8, onEnter, onInsert, onTab, onEscape]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
