import { useCallback, useRef } from 'react';
import type { UseContestAudioReturn } from 'react-morse-audio';
import type { ContestState, Caller, OperatorState } from '../types';
import { getCallsignPool, shuffle } from '../utils/callsignPool';
import { getCWOpsPool, pickCwtCaller } from '../utils/cwopsPool';
import {
  getCqMessage,
  getExchangeMessage,
  getTuCqMessage,
  msgRNr,
  getCwtExchangeMessage,
  msgCwtExchange,
} from '../utils/messages';
import { rndPoisson } from 'morse-audio';
import { createCaller, processMessage, getCallerReply, getCallerReplyForCwt } from '../utils/callerStateMachine';

interface UseQsoFlowOptions {
  state: ContestState;
  audio: UseContestAudioReturn;
  onStateChange: (state: ContestState['qsoState']) => void;
  onSetCurrentCall: (call: string) => void;
  onCallerSelect: (caller: Caller) => void;
  onAddCallers: (callers: Caller[]) => void;
  onClearCallers: () => void;
  onUpdateCaller: (id: string, updates: Partial<Caller>) => void;
  onLogQso: () => void;
  onClearSelection: () => void;
}

export function useQsoFlow({
  state,
  audio,
  onStateChange,
  onSetCurrentCall,
  onCallerSelect,
  onAddCallers,
  onClearCallers,
  onUpdateCaller,
  onLogQso,
  onClearSelection,
}: UseQsoFlowOptions) {
  // Refs for managing pending caller replies
  const pendingRepliesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Generate a pileup of callers using Poisson distribution
  const generatePileup = useCallback((): Caller[] => {
    // Filter out already worked calls
    const workedCallsSet = new Set(state.log.map(q => q.call));

    // Poisson distribution based on activity level (1-9)
    // Activity/2 gives mean pileup size of 0.5-4.5
    const activity = state.contestSettings.activity;
    const count = Math.max(1, rndPoisson(activity / 2));

    // CWT mode - use CWOps pool
    if (state.contestType === 'cwt') {
      const cwopsPool = getCWOpsPool();
      const availableMembers = cwopsPool.filter(m => !workedCallsSet.has(m.call));

      if (availableMembers.length === 0) {
        return [];
      }

      // Pick random callers from CWOps pool
      const callers: Caller[] = [];
      const shuffledMembers = shuffle(availableMembers);

      for (let i = 0; i < Math.min(count, shuffledMembers.length); i++) {
        // Use pickCwtCaller for 95/5 member/non-member distribution
        const cwtData = pickCwtCaller(availableMembers);
        const entry = {
          call: cwtData.call,
          prefix: cwtData.prefix,
          continent: cwtData.continent,
        };
        callers.push(createCaller(entry, state.wpm, state.contestSettings, cwtData));
      }

      return callers;
    }

    // WPX mode - use standard callsign pool
    const pool = getCallsignPool();
    const availableCalls = pool.filter(c => !workedCallsSet.has(c.call));

    // Create callers with full state machine
    return shuffle(availableCalls).slice(0, count).map(entry =>
      createCaller(entry, state.wpm, state.contestSettings)
    );
  }, [state.wpm, state.log, state.contestSettings, state.contestType]);

  // Cancel all pending replies
  const cancelPendingReplies = useCallback(() => {
    pendingRepliesRef.current.forEach(timeout => clearTimeout(timeout));
    pendingRepliesRef.current.clear();
  }, []);

  // Schedule a caller reply with their send delay
  const scheduleCallerReply = useCallback((
    caller: Caller,
    text: string,
    additionalDelay: number = 0
  ) => {
    // Clear any existing pending reply
    const existing = pendingRepliesRef.current.get(caller.id);
    if (existing) clearTimeout(existing);

    const totalDelay = caller.sendDelay + additionalDelay;
    const timeout = setTimeout(async () => {
      pendingRepliesRef.current.delete(caller.id);
      try {
        await audio.playStation({
          id: caller.id,
          text,
          wpm: caller.wpm,
          frequencyOffset: caller.frequencyOffset,
          signalStrength: caller.signalStrength,
        });
      } catch {
        // Audio engine may have stopped
      }
    }, totalDelay);

    pendingRepliesRef.current.set(caller.id, timeout);
  }, [audio]);

  // Play a pileup with staggered timing - callers respond to CQ
  const playPileup = useCallback((callers: Caller[]) => {
    // Transition all callers to osNeedQso and have them send their calls
    callers.forEach((caller, i) => {
      // Update caller state to ready to call
      onUpdateCaller(caller.id, {
        state: 'osNeedQso' as OperatorState,
        lastActivityTime: Date.now(),
      });

      // Stagger the calls slightly for realism
      const staggerDelay = i * 80 + Math.random() * 200;

      // Get what the caller will send (just their call initially)
      const reply = getCallerReply({ ...caller, state: 'osNeedQso' }, false);
      if (reply.type !== 'SILENT') {
        scheduleCallerReply(caller, reply.text, staggerDelay);
      }
    });
  }, [onUpdateCaller, scheduleCallerReply]);

  // Send CQ
  const sendCq = useCallback(async () => {
    if (audio.isSending || !audio.isRunning) return;

    // Cancel any pending replies and clear state
    cancelPendingReplies();
    onClearCallers();
    onClearSelection();
    onStateChange('cqing');

    const message = getCqMessage(state.userCall);
    await audio.playSidetone({ text: message, wpm: state.wpm });

    // CQ finished - generate and play pileup
    if (!audio.isRunning) return;

    const callers = generatePileup();
    onAddCallers(callers);
    onStateChange('listening');

    // Small delay before pileup starts
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
    playPileup(callers);
  }, [audio, state.userCall, state.wpm, onStateChange, onClearCallers, onClearSelection, generatePileup, onAddCallers, playPileup, cancelPendingReplies]);

  // Called when sidetone finishes (kept for TU handling)
  const handleSidetoneComplete = useCallback(() => {
    // This is now mainly used for the TU -> auto-CQ flow
    // since sendCq and sendExchange handle their own completion
  }, []);

  // Find best matching caller for partial input
  const findMatchingCaller = useCallback((partial: string): Caller | null => {
    if (!partial || partial.length < 2) return null;
    const upper = partial.toUpperCase();

    // First try exact prefix match
    const exactMatch = state.callers.find(c =>
      c.call.toUpperCase().startsWith(upper)
    );
    if (exactMatch) return exactMatch;

    // Try suffix match
    const suffixMatch = state.callers.find(c =>
      c.call.toUpperCase().endsWith(upper)
    );
    if (suffixMatch) return suffixMatch;

    // Try contains match
    const containsMatch = state.callers.find(c =>
      c.call.toUpperCase().includes(upper)
    );
    return containsMatch || null;
  }, [state.callers]);

  // Send exchange to caller (Insert key or after selecting)
  const sendExchange = useCallback(async (caller?: Caller) => {
    const targetCaller = caller || state.selectedCaller || findMatchingCaller(state.currentCall);

    if (!targetCaller || audio.isSending || !audio.isRunning) return;

    // Stop any playing stations and pending replies
    audio.stopAllStations();
    cancelPendingReplies();

    // Select the caller if not already selected
    if (!state.selectedCaller || state.selectedCaller.id !== targetCaller.id) {
      onCallerSelect(targetCaller);
    }

    onStateChange('sending_exchange');

    // Send exchange based on contest type
    let message: string;
    if (state.contestType === 'cwt') {
      // CWT: {theircall} {myname} {mynumber}
      message = getCwtExchangeMessage(targetCaller.call, state.myName, state.myNumber);
    } else {
      // WPX: {theircall} 5NN {serial}
      message = getExchangeMessage(targetCaller.call, state.nextSerial);
    }

    await audio.playSidetone({ text: message, wpm: state.wpm });

    // Sidetone finished - process caller state machine
    if (!audio.isRunning) return;

    // Process caller state machine
    const { newState, shouldReply } = processMessage(targetCaller, {
      type: 'EXCHANGE',
      call: targetCaller.call,
      serial: state.nextSerial,
    });

    // Update caller state
    onUpdateCaller(targetCaller.id, {
      state: newState,
      lastActivityTime: Date.now(),
    });

    // Small delay before station responds
    await new Promise(resolve => setTimeout(resolve, 200 + targetCaller.sendDelay));

    // Get and play caller's response based on state and contest type
    const updatedCaller = { ...targetCaller, state: newState };

    if (state.contestType === 'cwt' && targetCaller.cwtExchange) {
      // CWT response: NAME NUMBER
      const reply = getCallerReplyForCwt(updatedCaller, false);

      if (reply.type !== 'SILENT' && shouldReply) {
        await audio.playStation({
          id: `response-${targetCaller.id}`,
          text: reply.text,
          wpm: targetCaller.wpm,
          frequencyOffset: targetCaller.frequencyOffset,
          signalStrength: targetCaller.signalStrength,
        });
      } else {
        // Fallback CWT response
        const cwtExchange = targetCaller.cwtExchange;
        await audio.playStation({
          id: `response-${targetCaller.id}`,
          text: msgCwtExchange(cwtExchange.name, cwtExchange.number, targetCaller.isLid),
          wpm: targetCaller.wpm,
          frequencyOffset: targetCaller.frequencyOffset,
          signalStrength: targetCaller.signalStrength,
        });
      }
    } else {
      // WPX response: R 5NN SERIAL
      const reply = getCallerReply(updatedCaller, false);

      if (reply.type !== 'SILENT' && shouldReply) {
        await audio.playStation({
          id: `response-${targetCaller.id}`,
          text: reply.text,
          wpm: targetCaller.wpm,
          frequencyOffset: targetCaller.frequencyOffset,
          signalStrength: targetCaller.signalStrength,
        });
      } else {
        // Fallback to standard response
        await audio.playStation({
          id: `response-${targetCaller.id}`,
          text: msgRNr(targetCaller.serial, targetCaller.isLid),
          wpm: targetCaller.wpm,
          frequencyOffset: targetCaller.frequencyOffset,
          signalStrength: targetCaller.signalStrength,
        });
      }
    }

    // Station finished responding - user needs to copy and enter the exchange
    onStateChange('logging');
  }, [state.selectedCaller, state.currentCall, state.nextSerial, state.wpm, state.contestType,
      state.myName, state.myNumber, audio,
      findMatchingCaller, onCallerSelect, onStateChange, onUpdateCaller, cancelPendingReplies]);

  // Log QSO and send TU (+ CQ if auto-CQ enabled)
  const logAndTu = useCallback(async (withCq: boolean = true) => {
    // Check if we have the required data for the contest type
    if (!state.selectedCaller || audio.isSending) return;

    // CWT needs name and number, WPX needs serial number
    if (state.contestType === 'cwt') {
      if (!state.enteredName || !state.enteredNumber) return;
    } else {
      if (!state.enteredNr) return;
    }

    // Log the QSO first
    onLogQso();

    // Send TU {mycall}
    onStateChange('sending_tu');
    const message = getTuCqMessage(state.userCall);
    await audio.playSidetone({ text: message, wpm: state.wpm });

    // TU finished - if auto-CQ, start next CQ cycle
    if (!audio.isRunning) return;

    if (withCq) {
      // Small pause then CQ again
      await new Promise(resolve => setTimeout(resolve, 200));
      await sendCq();
    } else {
      onStateChange('idle');
    }
  }, [state.selectedCaller, state.enteredNr, state.enteredName, state.enteredNumber,
      state.userCall, state.wpm, state.contestType, audio,
      onLogQso, onStateChange, sendCq]);

  // ESM: Enter Sends Message (context-sensitive)
  const handleEnter = useCallback(async () => {
    if (!audio.isRunning || audio.isSending) return;

    switch (state.qsoState) {
      case 'idle':
        // Empty call = CQ
        if (!state.currentCall.trim()) {
          await sendCq();
        }
        break;

      case 'listening':
      case 'working':
        // Have a call entered = send exchange
        if (state.currentCall.trim()) {
          const caller = findMatchingCaller(state.currentCall);
          if (caller) {
            await sendExchange(caller);
          }
        }
        break;

      case 'logging':
        // Ready to log = log + TU + CQ
        // For CWT, check if name and number are entered
        // For WPX, check if serial number is entered
        if (state.contestType === 'cwt') {
          if (state.enteredName && state.enteredNumber) {
            await logAndTu(true);
          }
        } else {
          if (state.enteredNr) {
            await logAndTu(true);
          }
        }
        break;

      default:
        break;
    }
  }, [audio, state.qsoState, state.currentCall, state.contestType, state.enteredNr,
      state.enteredName, state.enteredNumber, sendCq, sendExchange, logAndTu, findMatchingCaller]);

  // Insert key: send call + exchange immediately
  const handleInsert = useCallback(async () => {
    if (!audio.isRunning || audio.isSending) return;

    if (state.qsoState === 'listening' || state.qsoState === 'working') {
      const caller = findMatchingCaller(state.currentCall);
      if (caller) {
        await sendExchange(caller);
      }
    }
  }, [audio, state.qsoState, state.currentCall, findMatchingCaller, sendExchange]);

  // Select a caller (clicking or Tab completion)
  const selectCaller = useCallback((caller: Caller) => {
    audio.stopAllStations();
    onCallerSelect(caller);
    onSetCurrentCall(caller.call);
    onStateChange('working');
  }, [audio, onCallerSelect, onSetCurrentCall, onStateChange]);

  // Tab: auto-complete callsign
  const handleTab = useCallback(() => {
    const caller = findMatchingCaller(state.currentCall);
    if (caller) {
      selectCaller(caller);
    }
  }, [state.currentCall, findMatchingCaller, selectCaller]);

  // Escape: stop and clear
  const handleEscape = useCallback(() => {
    audio.stopSidetone();
    audio.stopAllStations();
    cancelPendingReplies();

    onClearSelection();
    onClearCallers();
    onStateChange('idle');
  }, [audio, onClearSelection, onClearCallers, onStateChange, cancelPendingReplies]);

  // F1: CQ
  const handleF1 = useCallback(() => sendCq(), [sendCq]);

  // F2: Send exchange only
  const handleF2 = useCallback(async () => {
    if (!audio.isRunning || audio.isSending || !state.selectedCaller) return;

    let message: string;
    if (state.contestType === 'cwt') {
      message = getCwtExchangeMessage(state.selectedCaller.call, state.myName, state.myNumber);
    } else {
      message = getExchangeMessage(state.selectedCaller.call, state.nextSerial);
    }

    await audio.playSidetone({ text: message, wpm: state.wpm });
  }, [audio, state.selectedCaller, state.nextSerial, state.wpm, state.contestType, state.myName, state.myNumber]);

  // F3: TU only
  const handleF3 = useCallback(async () => {
    if (!audio.isRunning || audio.isSending) return;
    await audio.playSidetone({ text: 'TU', wpm: state.wpm });
  }, [audio, state.wpm]);

  // F4: My call
  const handleF4 = useCallback(async () => {
    if (!audio.isRunning || audio.isSending) return;
    await audio.playSidetone({ text: state.userCall, wpm: state.wpm });
  }, [audio, state.userCall, state.wpm]);

  // F5: His call
  const handleF5 = useCallback(async () => {
    if (!audio.isRunning || audio.isSending || !state.currentCall.trim()) return;
    await audio.playSidetone({ text: state.currentCall, wpm: state.wpm });
  }, [audio, state.currentCall, state.wpm]);

  // F8: AGN?
  const handleF8 = useCallback(async () => {
    if (!audio.isRunning || audio.isSending) return;
    await audio.playSidetone({ text: 'AGN?', wpm: state.wpm });
  }, [audio, state.wpm]);

  return {
    sendCq,
    sendExchange,
    selectCaller,
    logAndTu,
    handleEnter,
    handleInsert,
    handleTab,
    handleEscape,
    handleSidetoneComplete,
    handleF1,
    handleF2,
    handleF3,
    handleF4,
    handleF5,
    handleF8,
    findMatchingCaller,
  };
}
