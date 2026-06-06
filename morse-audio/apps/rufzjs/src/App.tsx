import { useState, useCallback, useEffect, useRef } from 'react';
import { useContestAudio } from 'react-morse-audio';
import { useGameState } from './hooks/useGameState';
import { useStorage } from './hooks/useStorage';
import { useKeyboard } from './hooks/useKeyboard';
import { calculateStats } from './utils/scoring';
import { initCallsignDatabase, getCallsignCount } from './utils/callsignDatabase';
import { StartScreen } from './components/StartScreen';
import { GameScreen } from './components/GameScreen';
import { MobileGameScreen } from './components/MobileGameScreen';
import { ResultsScreen } from './components/ResultsScreen';
import { HighScores } from './components/HighScores';
import { SettingsModal } from './components/SettingsModal';
import { HighScoreEntry } from './types';

export default function App() {
  const { settings, setSettings, highScores, addHighScore, clearHighScores } = useStorage();
  const { state, startGame, setPlaying, setAnswer, submitAnswer, replay, abort, reset } = useGameState();

  const [showHighScores, setShowHighScores] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [dbStatus, setDbStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dbError, setDbError] = useState<string | null>(null);
  const [callsignCount, setCallsignCount] = useState(0);
  const [attemptNumber, setAttemptNumber] = useState(0);

  // Load callsign database on mount
  useEffect(() => {
    // Use Vite's BASE_URL for correct path in both dev and production
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
    initCallsignDatabase(basePath)
      .then(() => {
        const count = getCallsignCount();
        setCallsignCount(count);
        setDbStatus('ready');
        console.log(`[App] Database ready with ${count} callsigns`);
      })
      .catch((err) => {
        setDbError(err.message);
        setDbStatus('error');
        console.error('[App] Database failed to load:', err);
      });
  }, []);

  const audioStartedRef = useRef(false);
  const pendingReplayRef = useRef(false);

  const audio = useContestAudio({
    sidetoneFrequency: settings.toneFrequency,
    sidetoneVolume: 0.8,
    receiverVolume: 0.05,
    onSidetoneComplete: () => {
      setPlaying(false);
    },
  });

  // Start audio engine when game begins
  useEffect(() => {
    if (state.phase === 'playing' && !audioStartedRef.current) {
      audioStartedRef.current = true;
      audio.start().catch(console.error);
    }
    if (state.phase !== 'playing' && audioStartedRef.current) {
      audioStartedRef.current = false;
      audio.stop();
    }
  }, [state.phase, audio]);

  // Play callsign when it changes
  useEffect(() => {
    if (state.phase === 'playing' && state.currentCallsign && audio.isRunning && !state.isPlaying) {
      const playCallsign = async () => {
        setPlaying(true);
        try {
          await audio.playSidetone({
            text: state.currentCallsign,
            wpm: state.currentSpeed,
          });
        } catch (err) {
          console.error('Failed to play callsign:', err);
          setPlaying(false);
        }
      };
      // Small delay to ensure audio context is ready
      const timer = setTimeout(playCallsign, 100);
      return () => clearTimeout(timer);
    }
  }, [state.phase, state.currentCallsign, state.callsignIndex, audio.isRunning]);

  // Handle replay request
  useEffect(() => {
    if (pendingReplayRef.current && state.hasReplayed && !state.isPlaying && audio.isRunning) {
      pendingReplayRef.current = false;
      const playReplay = async () => {
        setPlaying(true);
        try {
          await audio.playSidetone({
            text: state.currentCallsign,
            wpm: state.currentSpeed,
          });
        } catch (err) {
          console.error('Failed to replay callsign:', err);
          setPlaying(false);
        }
      };
      playReplay();
    }
  }, [state.hasReplayed, state.isPlaying, audio.isRunning, state.currentCallsign, state.currentSpeed, setPlaying]);

  // Save high score when game ends
  useEffect(() => {
    if (state.phase === 'results' && state.results.length > 0) {
      const stats = calculateStats(state.results);
      const entry: HighScoreEntry = {
        callsign: settings.userCall,
        score: stats.totalScore,
        date: new Date().toISOString(),
        numCallsigns: state.results.length,
        startSpeed: settings.startSpeed,
        peakSpeed: stats.peakSpeed,
        accuracy: stats.accuracy,
        complete: state.results.length === settings.callsignsPerAttempt,
        mode: settings.gameMode,
      };
      const isNew = highScores.length === 0 || entry.score > highScores[0].score;
      addHighScore(entry);
      setIsNewHighScore(isNew);
    }
  }, [state.phase]);

  const handleStart = useCallback(() => {
    setIsNewHighScore(false);
    setAttemptNumber(prev => prev + 1);
    startGame(settings);
  }, [settings, startGame]);

  const handleReplay = useCallback(() => {
    if (!state.hasReplayed && !state.isPlaying) {
      pendingReplayRef.current = true;
      replay();
    }
  }, [state.hasReplayed, state.isPlaying, replay]);

  const handleSubmit = useCallback(() => {
    if (state.userAnswer.trim()) {
      // Stop any playing audio and submit immediately (type-ahead support)
      if (state.isPlaying) {
        audio.stopSidetone();
      }
      submitAnswer();
    }
  }, [state.isPlaying, state.userAnswer, submitAnswer, audio]);

  const handleMobileSubmit = useCallback((answer: string) => {
    if (state.isPlaying) {
      audio.stopSidetone();
    }
    setAnswer(answer);
    submitAnswer();
  }, [state.isPlaying, audio, setAnswer, submitAnswer]);

  const handleTryAgain = useCallback(() => {
    reset();
  }, [reset]);

  useKeyboard({
    phase: state.phase,
    onEnter: handleSubmit,
    onReplay: handleReplay,
    onAbort: abort,
    onStart: state.phase === 'results' ? handleTryAgain : handleStart,
    canReplay: !state.hasReplayed && !state.isPlaying,
  });

  return (
    <div className="app">
      {state.phase === 'start' && (
        <StartScreen
          settings={settings}
          onSettingsChange={setSettings}
          onStart={handleStart}
          highScores={highScores}
          onShowSettings={() => setShowSettings(true)}
          dbStatus={dbStatus}
          dbError={dbError}
          callsignCount={callsignCount}
        />
      )}

      {state.phase === 'playing' && settings.gameMode === 'original' && (
        <GameScreen
          state={state}
          settings={settings}
          userCall={settings.userCall}
          attemptNumber={attemptNumber}
          onAnswerChange={setAnswer}
          onSubmit={handleSubmit}
          onReplay={handleReplay}
          onAbort={abort}
        />
      )}

      {state.phase === 'playing' && settings.gameMode === 'mobile' && (
        <MobileGameScreen
          state={state}
          settings={settings}
          userCall={settings.userCall}
          attemptNumber={attemptNumber}
          onSubmitAnswer={handleMobileSubmit}
          onReplay={handleReplay}
          onAbort={abort}
        />
      )}

      {state.phase === 'results' && (
        <ResultsScreen
          results={state.results}
          settings={settings}
          isNewHighScore={isNewHighScore}
          onTryAgain={handleTryAgain}
          onShowHighScores={() => setShowHighScores(true)}
        />
      )}

      {showHighScores && (
        <HighScores
          scores={highScores}
          onClose={() => setShowHighScores(false)}
          onClear={clearHighScores}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
