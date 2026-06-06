import { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import { useContestAudio } from 'react-morse-audio';
import { useContestState } from './hooks/useContestState';
import { useQsoFlow } from './hooks/useQsoFlow';
import { useKeyboard } from './hooks/useKeyboard';
import { Header } from './components/Header';
import { QsoEntry } from './components/QsoEntry';
import { LogDisplay } from './components/LogDisplay';
import { BandControls } from './components/BandControls';
import { KeyboardHelp } from './components/KeyboardHelp';
import { ContestSetup } from './components/ContestSetup';
import { loadCWOpsPool } from './utils/cwopsPool';

function App() {
  // Setup phase state - show setup screen first
  const [isSetupComplete, setIsSetupComplete] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null!);
  const nrInputRef = useRef<HTMLInputElement>(null!);
  const sidetoneCompleteRef = useRef<() => void>(() => {});
  const { state, actions, computed } = useContestState();

  // Load CWOps pool when CWT is selected
  useEffect(() => {
    if (state.contestType === 'cwt') {
      loadCWOpsPool();
    }
  }, [state.contestType]);

  // QRN options for the audio engine
  const qrnOptions = useMemo(
    () => (state.qrnEnabled ? { snr: state.snr } : undefined),
    [state.qrnEnabled, state.snr]
  );

  // Audio engine
  const audio = useContestAudio({
    qrn: qrnOptions,
    bandwidth: state.bandwidth,
    onStationComplete: (id) => {
      actions.markCallerHeard(id);
    },
    onSidetoneComplete: () => {
      sidetoneCompleteRef.current();
    },
  });

  // QSO flow logic
  const qsoFlow = useQsoFlow({
    state,
    audio,
    onStateChange: actions.setQsoState,
    onSetCurrentCall: actions.setCurrentCall,
    onCallerSelect: actions.selectCaller,
    onAddCallers: actions.addCallers,
    onClearCallers: actions.clearCallers,
    onUpdateCaller: actions.updateCaller,
    onLogQso: actions.logQso,
    onClearSelection: actions.clearSelection,
  });

  // Start/stop contest
  const handleStartStop = useCallback(async () => {
    if (state.isRunning) {
      audio.stop();
      actions.stopContest();
    } else {
      await audio.start();
      actions.startContest();
      // Focus the input
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [state.isRunning, audio, actions]);

  // Keep sidetone complete handler ref up to date
  useEffect(() => {
    sidetoneCompleteRef.current = qsoFlow.handleSidetoneComplete;
  }, [qsoFlow.handleSidetoneComplete]);

  // Focus input when running
  useEffect(() => {
    if (state.isRunning && inputRef.current) {
      inputRef.current.focus();
    }
  }, [state.isRunning, state.qsoState]);

  // Keyboard shortcuts (N1MM style)
  useKeyboard({
    isRunning: state.isRunning,
    onF1: qsoFlow.handleF1,
    onF2: qsoFlow.handleF2,
    onF3: qsoFlow.handleF3,
    onF4: qsoFlow.handleF4,
    onF5: qsoFlow.handleF5,
    onF8: qsoFlow.handleF8,
    onEnter: qsoFlow.handleEnter,
    onInsert: qsoFlow.handleInsert,
    onTab: qsoFlow.handleTab,
    onEscape: qsoFlow.handleEscape,
  });

  // Update audio settings when they change
  const handleSnrChange = useCallback(
    (snr: number) => {
      actions.setSnr(snr);
      if (state.qrnEnabled) {
        audio.setQRN({ snr });
      }
    },
    [actions, audio, state.qrnEnabled]
  );

  const handleQrnToggle = useCallback(
    (enabled: boolean) => {
      actions.setQrnEnabled(enabled);
      audio.setQRN(enabled ? { snr: state.snr } : null);
    },
    [actions, audio, state.snr]
  );

  const handleBandwidthChange = useCallback(
    (bandwidth: number) => {
      actions.setBandwidth(bandwidth);
      audio.setBandwidth(bandwidth);
    },
    [actions, audio]
  );

  // Show setup screen if setup is not complete
  if (!isSetupComplete) {
    return (
      <ContestSetup
        userCall={state.userCall}
        myName={state.myName}
        myNumber={state.myNumber}
        contestType={state.contestType}
        onUserCallChange={actions.setUserCall}
        onMyNameChange={actions.setMyName}
        onMyNumberChange={actions.setMyNumber}
        onContestTypeChange={actions.setContestType}
        onStart={() => setIsSetupComplete(true)}
      />
    );
  }

  return (
    <div className="app">
      <Header
        isRunning={state.isRunning}
        startTime={state.startTime}
        contestType={state.contestType}
        qsos={computed.totalQsos}
        multipliers={computed.totalMultipliers}
        rawScore={computed.rawScore}
        verifiedQsos={computed.verifiedQsos}
        verifiedMultipliers={computed.verifiedMultipliers}
        verifiedScore={computed.verifiedScore}
        dupeCount={computed.dupeCount}
        bustedCount={computed.bustedCount}
        bustedNameCount={computed.bustedNameCount}
        bustedNumberCount={computed.bustedNumberCount}
        userCall={state.userCall}
        onUserCallChange={actions.setUserCall}
      />

      <main className="main-layout">
        <div className="start-controls">
          <button
            className={`start-button ${state.isRunning ? 'running' : ''}`}
            onClick={handleStartStop}
          >
            {state.isRunning ? 'Stop' : 'Run'}
          </button>
          {audio.isSending && <span className="sending-indicator">TX</span>}
        </div>

        <div className="contest-area">
          <div className="entry-panel">
            <QsoEntry
              qsoState={state.qsoState}
              contestType={state.contestType}
              currentCall={state.currentCall}
              selectedCaller={state.selectedCaller}
              nextSerial={state.nextSerial}
              enteredRst={state.enteredRst}
              enteredNr={state.enteredNr}
              enteredName={state.enteredName}
              enteredNumber={state.enteredNumber}
              myName={state.myName}
              myNumber={state.myNumber}
              onCallChange={actions.setCurrentCall}
              onRstChange={actions.setEnteredRst}
              onNrChange={actions.setEnteredNr}
              onNameChange={actions.setEnteredName}
              onNumberChange={actions.setEnteredNumber}
              onEnter={qsoFlow.handleEnter}
              inputRef={inputRef}
              nrInputRef={nrInputRef}
              isSending={audio.isSending}
            />
          </div>
        </div>

        <LogDisplay log={state.log} contestType={state.contestType} />

        <div className="bottom-controls">
          <BandControls
            qrnEnabled={state.qrnEnabled}
            snr={state.snr}
            bandwidth={state.bandwidth}
            wpm={state.wpm}
            contestSettings={state.contestSettings}
            onQrnToggle={handleQrnToggle}
            onSnrChange={handleSnrChange}
            onBandwidthChange={handleBandwidthChange}
            onWpmChange={actions.setWpm}
            onActivityChange={actions.setActivity}
            onQsbToggle={actions.setQsbEnabled}
            onQrmToggle={actions.setQrmEnabled}
            onFlutterToggle={actions.setFlutterEnabled}
            onLidsToggle={actions.setLidsEnabled}
          />
          <KeyboardHelp />
        </div>
      </main>
    </div>
  );
}

export default App;
