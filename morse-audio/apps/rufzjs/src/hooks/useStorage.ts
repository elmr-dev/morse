import { useCallback, useEffect, useState } from 'react';
import { Settings, HighScoreEntry, DEFAULT_SETTINGS } from '../types';

const STORAGE_KEYS = {
  settings: 'rufzweb_settings',
  highScores: 'rufzweb_highscores',
};

const MAX_HIGH_SCORES = 20;

export function useStorage() {
  const [settings, setSettingsState] = useState<Settings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.settings);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_SETTINGS;
  });

  const [highScores, setHighScoresState] = useState<HighScoreEntry[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.highScores);
      if (stored) {
        const parsed: HighScoreEntry[] = JSON.parse(stored);
        // Migrate entries without mode field to 'original'
        let migrated = false;
        const entries = parsed.map(entry => {
          if (!entry.mode) {
            migrated = true;
            return { ...entry, mode: 'original' as const };
          }
          return entry;
        });
        if (migrated) {
          localStorage.setItem(STORAGE_KEYS.highScores, JSON.stringify(entries));
        }
        return entries;
      }
    } catch {
      // Ignore parse errors
    }
    return [];
  });

  const setSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettingsState((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, []);

  const addHighScore = useCallback((entry: HighScoreEntry): boolean => {
    let isNewHighScore = false;
    setHighScoresState((prev) => {
      const updated = [...prev, entry]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_HIGH_SCORES);

      isNewHighScore = updated.indexOf(entry) === 0;

      try {
        localStorage.setItem(STORAGE_KEYS.highScores, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
    return isNewHighScore;
  }, []);

  const clearHighScores = useCallback(() => {
    setHighScoresState([]);
    try {
      localStorage.removeItem(STORAGE_KEYS.highScores);
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Sync settings on mount (in case another tab changed them)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.settings && e.newValue) {
        try {
          setSettingsState({ ...DEFAULT_SETTINGS, ...JSON.parse(e.newValue) });
        } catch {
          // Ignore parse errors
        }
      }
      if (e.key === STORAGE_KEYS.highScores && e.newValue) {
        try {
          setHighScoresState(JSON.parse(e.newValue));
        } catch {
          // Ignore parse errors
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return {
    settings,
    setSettings,
    highScores,
    addHighScore,
    clearHighScores,
  };
}
