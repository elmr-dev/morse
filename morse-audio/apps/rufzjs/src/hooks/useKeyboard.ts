import { useEffect, useCallback } from 'react';
import { GamePhase } from '../types';

interface UseKeyboardOptions {
  phase: GamePhase;
  onEnter: () => void;
  onReplay: () => void;
  onAbort: () => void;
  onStart: () => void;
  canReplay: boolean;
}

export function useKeyboard({
  phase,
  onEnter,
  onReplay,
  onAbort,
  onStart,
  canReplay,
}: UseKeyboardOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if in an input field (unless it's a special key)
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      if (phase === 'start') {
        if (e.key === 'Enter' || e.key === 'F5') {
          e.preventDefault();
          onStart();
        }
        return;
      }

      if (phase === 'playing') {
        if (e.key === 'Enter' && isInput) {
          e.preventDefault();
          onEnter();
          return;
        }

        if (e.key === 'F6') {
          e.preventDefault();
          if (canReplay) {
            onReplay();
          }
          return;
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          onAbort();
          return;
        }
      }

      if (phase === 'results') {
        if (e.key === 'Enter' || e.key === 'F5') {
          e.preventDefault();
          onStart();
        }
      }
    },
    [phase, onEnter, onReplay, onAbort, onStart, canReplay]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
