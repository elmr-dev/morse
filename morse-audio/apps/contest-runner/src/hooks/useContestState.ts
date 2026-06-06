import { useReducer, useCallback } from 'react';
import type { ContestState, ContestAction, Caller, QsoState, ContestType } from '../types';
import { extractWpxPrefix, getContinentFromPrefix } from '../utils/prefixExtractor';
import { validateCwtExchange, validateCwtName } from '../utils/cwopsPool';

// Initial state
const initialState: ContestState = {
  isRunning: false,
  startTime: null,
  contestType: 'wpx',
  qsoState: 'idle',
  currentCall: '',
  selectedCaller: null,
  enteredRst: '599',
  enteredNr: '',
  // CWT-specific entry fields
  enteredName: '',
  enteredNumber: '',
  callers: [],
  log: [],
  nextSerial: 1,
  workedPrefixes: new Set(),
  workedCalls: new Set(),
  userCall: 'KC4T',
  wpm: 25,
  // CWT-specific settings
  myName: '',
  myNumber: '',
  qrnEnabled: false,  // MorseRunner default: OFF
  snr: 30,            // MorseRunner default: 30 dB when enabled
  bandwidth: 500,
  contestSettings: {
    activity: 3,      // MorseRunner default: 3
    qsb: false,       // MorseRunner default: OFF
    qrm: false,       // MorseRunner default: OFF
    flutter: false,   // MorseRunner default: OFF
    lids: false,      // MorseRunner default: OFF
  },
};

// Reducer
function contestReducer(state: ContestState, action: ContestAction): ContestState {
  switch (action.type) {
    case 'START_CONTEST':
      return {
        ...state,
        isRunning: true,
        startTime: Date.now(),
        qsoState: 'idle',
      };

    case 'STOP_CONTEST':
      return {
        ...state,
        isRunning: false,
        qsoState: 'idle',
        callers: [],
        selectedCaller: null,
        currentCall: '',
        enteredRst: '599',
        enteredNr: '',
        enteredName: '',
        enteredNumber: '',
      };

    case 'SET_QSO_STATE':
      return {
        ...state,
        qsoState: action.state,
      };

    case 'SET_CURRENT_CALL':
      return {
        ...state,
        currentCall: action.call.toUpperCase(),
      };

    case 'SELECT_CALLER':
      return {
        ...state,
        selectedCaller: action.caller,
        currentCall: action.caller.call,
        qsoState: 'working',
      };

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedCaller: null,
        currentCall: '',
        enteredRst: '599',
        enteredNr: '',
        enteredName: '',
        enteredNumber: '',
        qsoState: state.isRunning ? 'listening' : 'idle',
      };

    case 'SET_ENTERED_RST':
      return {
        ...state,
        enteredRst: action.rst,
      };

    case 'SET_ENTERED_NR':
      return {
        ...state,
        enteredNr: action.nr,
      };

    case 'ADD_CALLERS':
      return {
        ...state,
        callers: action.callers,
      };

    case 'CLEAR_CALLERS':
      return {
        ...state,
        callers: [],
      };

    case 'MARK_CALLER_HEARD':
      return {
        ...state,
        callers: state.callers.map(c =>
          c.id === action.id ? { ...c, heard: true } : c
        ),
      };

    case 'LOG_QSO': {
      const caller = state.selectedCaller;
      if (!caller) return state;

      // CWT contest logging
      if (state.contestType === 'cwt') {
        // Need name and number entered for CWT
        if (!state.enteredName || !state.enteredNumber) {
          return state;
        }

        const cwtExchange = caller.cwtExchange;
        if (!cwtExchange) return state;

        // Check for duplicate (by callsign)
        const isDupe = state.log.some(q => q.call === caller.call);

        // Validate name and number separately
        const isBustedName = !validateCwtName(state.enteredName, cwtExchange.name);
        const isBustedNumber = !validateCwtExchange(state.enteredNumber, cwtExchange.number, cwtExchange.isMember);
        const isBustedExchange = isBustedName || isBustedNumber;

        const prefix = caller.prefix;
        // CWT multipliers = unique callsigns worked
        const isMultiplier = !isDupe && !state.workedCalls.has(caller.call);

        // CWT scoring: 1 point per QSO
        const rawPoints = 1;
        const verifiedPoints = (isDupe || isBustedExchange) ? 0 : rawPoints;

        const newEntry = {
          id: crypto.randomUUID(),
          call: caller.call,
          sentRst: '599',
          sentSerial: state.nextSerial,
          rcvdRst: '599',
          rcvdSerial: 0, // Not used for CWT
          actualSerial: 0, // Not used for CWT
          prefix,
          isMultiplier: isMultiplier && !isBustedExchange,
          isDupe,
          isBustedExchange,
          timestamp: Date.now(),
          points: rawPoints,
          verifiedPoints,
          // CWT-specific fields
          rcvdName: state.enteredName.toUpperCase(),
          rcvdNumber: state.enteredNumber.toUpperCase(),
          actualName: cwtExchange.name,
          actualNumber: cwtExchange.number,
          isBustedName,
          isBustedNumber,
        };

        const newWorkedCalls = new Set(state.workedCalls);
        if (!isDupe && !isBustedExchange) {
          newWorkedCalls.add(caller.call);
        }

        return {
          ...state,
          log: [newEntry, ...state.log],
          nextSerial: state.nextSerial + 1,
          workedCalls: newWorkedCalls,
          selectedCaller: null,
          currentCall: '',
          enteredName: '',
          enteredNumber: '',
          callers: [],
          qsoState: 'idle',
        };
      }

      // WPX contest logging (original logic)
      // Need a serial number entered
      if (!state.enteredNr) {
        return state;
      }

      // Parse the entered serial number (handle cut numbers)
      const rcvdSerial = parseInt(
        state.enteredNr
          .toUpperCase()
          .replace(/T/g, '0')
          .replace(/N/g, '9')
          .replace(/A/g, '1')
          .replace(/E/g, '5'),
        10
      ) || 0;

      const actualSerial = caller.serial;

      // Check for duplicate
      const isDupe = state.log.some(q => q.call === caller.call);

      // Check if exchange was copied correctly
      const isBustedExchange = rcvdSerial !== actualSerial;

      const prefix = caller.prefix;
      // Only a multiplier if not a dupe and prefix is new
      const isMultiplier = !isDupe && !state.workedPrefixes.has(prefix);
      const myContinent = getContinentFromPrefix(extractWpxPrefix(state.userCall));
      const theirContinent = getContinentFromPrefix(prefix);
      const rawPoints = myContinent === theirContinent ? 1 : 3;

      // Verified points: 0 if dupe or busted exchange
      const verifiedPoints = (isDupe || isBustedExchange) ? 0 : rawPoints;

      const newEntry = {
        id: crypto.randomUUID(),
        call: caller.call,
        sentRst: '599',
        sentSerial: state.nextSerial,
        rcvdRst: state.enteredRst || '599',
        rcvdSerial,
        actualSerial,
        prefix,
        isMultiplier: isMultiplier && !isBustedExchange, // No mult credit if busted
        isDupe,
        isBustedExchange,
        timestamp: Date.now(),
        points: rawPoints,
        verifiedPoints,
      };

      const newWorkedPrefixes = new Set(state.workedPrefixes);
      if (!isDupe && !isBustedExchange) {
        newWorkedPrefixes.add(prefix);
      }

      return {
        ...state,
        log: [newEntry, ...state.log],
        nextSerial: state.nextSerial + 1,
        workedPrefixes: newWorkedPrefixes,
        selectedCaller: null,
        currentCall: '',
        enteredRst: '599',
        enteredNr: '',
        callers: [],
        qsoState: 'idle',
      };
    }

    case 'SET_USER_CALL':
      return {
        ...state,
        userCall: action.call.toUpperCase(),
      };

    case 'SET_WPM':
      return {
        ...state,
        wpm: Math.max(15, Math.min(40, action.wpm)),
      };

    case 'SET_QRN_ENABLED':
      return {
        ...state,
        qrnEnabled: action.enabled,
      };

    case 'SET_SNR':
      return {
        ...state,
        snr: Math.max(3, Math.min(30, action.snr)),
      };

    case 'SET_BANDWIDTH':
      return {
        ...state,
        bandwidth: action.bandwidth,
      };

    case 'UPDATE_CALLER':
      return {
        ...state,
        callers: state.callers.map(c =>
          c.id === action.id ? { ...c, ...action.updates } : c
        ),
      };

    case 'REMOVE_CALLER':
      return {
        ...state,
        callers: state.callers.filter(c => c.id !== action.id),
      };

    case 'SET_ACTIVITY':
      return {
        ...state,
        contestSettings: {
          ...state.contestSettings,
          activity: Math.max(1, Math.min(9, action.activity)),
        },
      };

    case 'SET_QSB_ENABLED':
      return {
        ...state,
        contestSettings: {
          ...state.contestSettings,
          qsb: action.enabled,
        },
      };

    case 'SET_QRM_ENABLED':
      return {
        ...state,
        contestSettings: {
          ...state.contestSettings,
          qrm: action.enabled,
        },
      };

    case 'SET_FLUTTER_ENABLED':
      return {
        ...state,
        contestSettings: {
          ...state.contestSettings,
          flutter: action.enabled,
        },
      };

    case 'SET_LIDS_ENABLED':
      return {
        ...state,
        contestSettings: {
          ...state.contestSettings,
          lids: action.enabled,
        },
      };

    // CWT-specific actions
    case 'SET_CONTEST_TYPE':
      return {
        ...state,
        contestType: action.contestType,
        // Reset log and multipliers when changing contest type
        log: [],
        nextSerial: 1,
        workedPrefixes: new Set(),
        workedCalls: new Set(),
      };

    case 'SET_MY_NAME':
      return {
        ...state,
        myName: action.name.toUpperCase().slice(0, 10),
      };

    case 'SET_MY_NUMBER':
      return {
        ...state,
        myNumber: action.number.toUpperCase().slice(0, 10),
      };

    case 'SET_ENTERED_NAME':
      return {
        ...state,
        enteredName: action.name.toUpperCase(),
      };

    case 'SET_ENTERED_NUMBER':
      return {
        ...state,
        enteredNumber: action.number.toUpperCase(),
      };

    default:
      return state;
  }
}

export function useContestState() {
  const [state, dispatch] = useReducer(contestReducer, initialState);

  // Action creators
  const startContest = useCallback(() => dispatch({ type: 'START_CONTEST' }), []);
  const stopContest = useCallback(() => dispatch({ type: 'STOP_CONTEST' }), []);
  const setQsoState = useCallback((qsoState: QsoState) =>
    dispatch({ type: 'SET_QSO_STATE', state: qsoState }), []);
  const setCurrentCall = useCallback((call: string) =>
    dispatch({ type: 'SET_CURRENT_CALL', call }), []);
  const selectCaller = useCallback((caller: Caller) =>
    dispatch({ type: 'SELECT_CALLER', caller }), []);
  const clearSelection = useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), []);
  const setEnteredRst = useCallback((rst: string) =>
    dispatch({ type: 'SET_ENTERED_RST', rst }), []);
  const setEnteredNr = useCallback((nr: string) =>
    dispatch({ type: 'SET_ENTERED_NR', nr }), []);
  const addCallers = useCallback((callers: Caller[]) =>
    dispatch({ type: 'ADD_CALLERS', callers }), []);
  const clearCallers = useCallback(() => dispatch({ type: 'CLEAR_CALLERS' }), []);
  const markCallerHeard = useCallback((id: string) =>
    dispatch({ type: 'MARK_CALLER_HEARD', id }), []);
  const logQso = useCallback(() => dispatch({ type: 'LOG_QSO' }), []);
  const setUserCall = useCallback((call: string) =>
    dispatch({ type: 'SET_USER_CALL', call }), []);
  const setWpm = useCallback((wpm: number) => dispatch({ type: 'SET_WPM', wpm }), []);
  const setQrnEnabled = useCallback((enabled: boolean) =>
    dispatch({ type: 'SET_QRN_ENABLED', enabled }), []);
  const setSnr = useCallback((snr: number) => dispatch({ type: 'SET_SNR', snr }), []);
  const setBandwidth = useCallback((bandwidth: number) =>
    dispatch({ type: 'SET_BANDWIDTH', bandwidth }), []);
  const updateCaller = useCallback((id: string, updates: Partial<Caller>) =>
    dispatch({ type: 'UPDATE_CALLER', id, updates }), []);
  const removeCaller = useCallback((id: string) =>
    dispatch({ type: 'REMOVE_CALLER', id }), []);
  const setActivity = useCallback((activity: number) =>
    dispatch({ type: 'SET_ACTIVITY', activity }), []);
  const setQsbEnabled = useCallback((enabled: boolean) =>
    dispatch({ type: 'SET_QSB_ENABLED', enabled }), []);
  const setQrmEnabled = useCallback((enabled: boolean) =>
    dispatch({ type: 'SET_QRM_ENABLED', enabled }), []);
  const setFlutterEnabled = useCallback((enabled: boolean) =>
    dispatch({ type: 'SET_FLUTTER_ENABLED', enabled }), []);
  const setLidsEnabled = useCallback((enabled: boolean) =>
    dispatch({ type: 'SET_LIDS_ENABLED', enabled }), []);

  // CWT-specific action creators
  const setContestType = useCallback((contestType: ContestType) =>
    dispatch({ type: 'SET_CONTEST_TYPE', contestType }), []);
  const setMyName = useCallback((name: string) =>
    dispatch({ type: 'SET_MY_NAME', name }), []);
  const setMyNumber = useCallback((number: string) =>
    dispatch({ type: 'SET_MY_NUMBER', number }), []);
  const setEnteredName = useCallback((name: string) =>
    dispatch({ type: 'SET_ENTERED_NAME', name }), []);
  const setEnteredNumber = useCallback((number: string) =>
    dispatch({ type: 'SET_ENTERED_NUMBER', number }), []);

  // Computed values - Raw (what you logged)
  const totalQsos = state.log.length;
  const totalMultipliers = state.log.filter(q => q.isMultiplier).length;
  const totalPoints = state.log.reduce((sum, q) => sum + q.points, 0);
  const rawScore = totalPoints * totalMultipliers;

  // Computed values - Verified (after checking dupes and busted exchanges)
  const verifiedQsos = state.log.filter(q => !q.isDupe && !q.isBustedExchange).length;
  const verifiedMultipliers = state.log.filter(q => q.isMultiplier && !q.isBustedExchange).length;
  const verifiedPoints = state.log.reduce((sum, q) => sum + q.verifiedPoints, 0);
  const verifiedScore = verifiedPoints * verifiedMultipliers;

  // Error counts
  const dupeCount = state.log.filter(q => q.isDupe).length;
  const bustedCount = state.log.filter(q => q.isBustedExchange).length;

  // CWT-specific error counts
  const bustedNameCount = state.log.filter(q => q.isBustedName).length;
  const bustedNumberCount = state.log.filter(q => q.isBustedNumber).length;

  return {
    state,
    actions: {
      startContest,
      stopContest,
      setQsoState,
      setCurrentCall,
      selectCaller,
      clearSelection,
      setEnteredRst,
      setEnteredNr,
      addCallers,
      clearCallers,
      markCallerHeard,
      updateCaller,
      removeCaller,
      logQso,
      setUserCall,
      setWpm,
      setQrnEnabled,
      setSnr,
      setBandwidth,
      setActivity,
      setQsbEnabled,
      setQrmEnabled,
      setFlutterEnabled,
      setLidsEnabled,
      // CWT-specific
      setContestType,
      setMyName,
      setMyNumber,
      setEnteredName,
      setEnteredNumber,
    },
    computed: {
      // Raw scores
      totalQsos,
      totalMultipliers,
      totalPoints,
      rawScore,
      // Verified scores
      verifiedQsos,
      verifiedMultipliers,
      verifiedPoints,
      verifiedScore,
      // Errors
      dupeCount,
      bustedCount,
      // CWT-specific errors
      bustedNameCount,
      bustedNumberCount,
    },
  };
}
