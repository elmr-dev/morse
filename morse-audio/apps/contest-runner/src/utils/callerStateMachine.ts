/**
 * Caller State Machine - DxOperator logic from MorseRunner
 *
 * State Transitions:
 * osNeedPrevEnd --CQ--> osNeedQso
 * osNeedQso --HisCall(exact)--> osNeedNr
 * osNeedQso --HisCall(almost)--> osNeedCall (ask "?")
 * osNeedNr --NR--> osNeedEnd
 * osNeedEnd --TU--> osDone
 * Any state --timeout--> retry or osFailed
 */

import type { Caller, OperatorState, ContestSettings, CwtExchange } from '../types';
import type { CwtCallerData } from './cwopsPool';
import { matchCall, type MatchResult } from './callMatch';
import {
  generateCallerWpm,
  generatePitchOffset,
  generateSendDelay,
  generateReplyTimeout,
  generatePatience,
  generateSignalStrength,
  generateQsbBandwidth,
} from 'morse-audio';

/**
 * Generate skill level with weighted distribution
 * Most callers are medium skill
 */
function generateSkillLevel(): 'low' | 'medium' | 'high' {
  const r = Math.random();
  if (r < 0.15) return 'low';
  if (r < 0.85) return 'medium';
  return 'high';
}

/**
 * Determine if a caller should be a "lid" (makes mistakes)
 * About 10% of callers are lids when enabled
 */
function generateIsLid(lidsEnabled: boolean): boolean {
  if (!lidsEnabled) return false;
  return Math.random() < 0.1;
}

// Message types the operator can send
export type OperatorMessage =
  | { type: 'CQ' }
  | { type: 'HIS_CALL'; call: string }
  | { type: 'EXCHANGE'; call: string; serial: number }
  | { type: 'TU' }
  | { type: 'AGN' }
  | { type: 'NR_QUERY' }  // "NR?"
  | { type: 'TIMEOUT' };

// Caller reply types
export type CallerReply =
  | { type: 'CALL_ONLY'; text: string }           // Just sends callsign
  | { type: 'CALL_EXCHANGE'; text: string }       // Callsign + exchange
  | { type: 'EXCHANGE_ONLY'; text: string }       // Just exchange (R 5NN xxx)
  | { type: 'QUERY'; text: string }               // "?" or "AGN"
  | { type: 'DE_CALL'; text: string }             // "DE <call>"
  | { type: 'TU'; text: string }                  // Final "TU"
  | { type: 'SILENT' };                           // No reply

export interface CallerEntry {
  call: string;
  prefix: string;
  continent: 'NA' | 'SA' | 'EU' | 'AS' | 'OC' | 'AF';
}

/**
 * Create a new caller with full state machine
 * For WPX contests, uses standard callsign entry
 * For CWT contests, uses CwtCallerData with name/number exchange
 */
export function createCaller(
  entry: CallerEntry,
  operatorWpm: number,
  settings: ContestSettings,
  cwtData?: CwtCallerData
): Caller {
  const skill = generateSkillLevel();
  const isLid = generateIsLid(settings.lids);

  const caller: Caller = {
    id: crypto.randomUUID(),
    call: entry.call,
    prefix: entry.prefix,
    wpm: generateCallerWpm(operatorWpm),
    frequencyOffset: generatePitchOffset(),
    signalStrength: generateSignalStrength(15), // Default SNR
    serial: Math.floor(Math.random() * 500) + 1,
    heard: false,

    // State machine
    state: 'osNeedPrevEnd',
    patience: generatePatience(),
    retryCount: 0,

    // Timing
    sendDelay: generateSendDelay(),
    replyTimeout: generateReplyTimeout(skill),
    lastActivityTime: Date.now(),

    // Characteristics
    skill,
    isLid,
  };

  // Add CWT exchange data if provided
  if (cwtData) {
    caller.cwtExchange = {
      name: cwtData.name,
      number: cwtData.number,
      isMember: cwtData.isMember,
    };
  }

  // Add QSB parameters if enabled
  if (settings.qsb) {
    caller.qsbBandwidth = generateQsbBandwidth(settings.flutter);
    caller.qsbDepth = 0.6 + Math.random() * 0.2; // 0.6-0.8
  }

  return caller;
}

/**
 * Process an operator message and determine state transition
 */
export function processMessage(
  caller: Caller,
  message: OperatorMessage
): { newState: OperatorState; shouldReply: boolean } {
  const currentState = caller.state;

  switch (message.type) {
    case 'CQ':
      // CQ triggers callers who are waiting to call
      if (currentState === 'osNeedPrevEnd' || currentState === 'osNeedQso') {
        return { newState: 'osNeedQso', shouldReply: true };
      }
      // Already in QSO, ignore CQ
      return { newState: currentState, shouldReply: false };

    case 'HIS_CALL':
      // Operator sent a callsign
      const matchResult = matchCall(message.call, caller.call, caller.isLid);
      return processCallMatch(caller, matchResult);

    case 'EXCHANGE':
      // Operator sent exchange (call + serial)
      if (currentState === 'osNeedQso' || currentState === 'osNeedCall') {
        const exchangeMatch = matchCall(message.call, caller.call, caller.isLid);
        if (exchangeMatch === 'exact') {
          // Got our call and exchange, we're good
          return { newState: 'osNeedEnd', shouldReply: true };
        } else if (exchangeMatch === 'almost') {
          // Partial match, need clarification
          return { newState: 'osNeedCallNr', shouldReply: true };
        }
      } else if (currentState === 'osNeedNr') {
        // We already confirmed call, just needed exchange
        return { newState: 'osNeedEnd', shouldReply: true };
      }
      return { newState: currentState, shouldReply: false };

    case 'TU':
      // Operator sent TU, QSO complete
      if (currentState === 'osNeedEnd') {
        return { newState: 'osDone', shouldReply: true };
      }
      return { newState: currentState, shouldReply: false };

    case 'AGN':
    case 'NR_QUERY':
      // Operator asking for repeat
      if (currentState === 'osNeedEnd' || currentState === 'osNeedNr') {
        // Re-send our exchange
        return { newState: currentState, shouldReply: true };
      }
      return { newState: currentState, shouldReply: false };

    case 'TIMEOUT':
      // Caller timed out waiting for response
      return processTimeout(caller);

    default:
      return { newState: currentState, shouldReply: false };
  }
}

/**
 * Process a call match result
 */
function processCallMatch(
  caller: Caller,
  matchResult: MatchResult
): { newState: OperatorState; shouldReply: boolean } {
  const currentState = caller.state;

  if (matchResult === 'exact') {
    // Operator got our call right
    if (currentState === 'osNeedQso' || currentState === 'osNeedCall') {
      // Now we need to receive exchange
      return { newState: 'osNeedNr', shouldReply: false };
    }
  } else if (matchResult === 'almost') {
    // Operator got our call partially right
    if (currentState === 'osNeedQso' || currentState === 'osNeedCall') {
      // Ask for clarification
      return { newState: 'osNeedCall', shouldReply: true };
    }
  }

  // No match or already in different state
  return { newState: currentState, shouldReply: false };
}

/**
 * Process a timeout - caller may retry or give up
 */
function processTimeout(
  caller: Caller
): { newState: OperatorState; shouldReply: boolean } {
  if (caller.patience <= 0) {
    // Out of patience, give up
    return { newState: 'osFailed', shouldReply: false };
  }

  // Retry based on current state
  const currentState = caller.state;
  if (currentState === 'osNeedQso' || currentState === 'osNeedCall') {
    // Re-call
    return { newState: currentState, shouldReply: true };
  } else if (currentState === 'osNeedNr' || currentState === 'osNeedCallNr') {
    // Ask for exchange again
    return { newState: currentState, shouldReply: true };
  } else if (currentState === 'osNeedEnd') {
    // Re-send TU or just wait
    return { newState: currentState, shouldReply: true };
  }

  return { newState: currentState, shouldReply: false };
}

/**
 * Get the reply message for a caller based on their current state
 */
export function getCallerReply(
  caller: Caller,
  wasPartialMatch: boolean = false
): CallerReply {
  const { state, call, serial, isLid } = caller;

  // 10% chance of lid making a copy error in their response
  const makeError = isLid && Math.random() < 0.1;

  switch (state) {
    case 'osNeedQso':
      // Initial call - just send callsign
      // 10% chance of double-calling for eager callers
      const doubleCall = Math.random() < 0.1;
      const callText = doubleCall ? `${call} ${call}` : call;
      return { type: 'CALL_ONLY', text: callText };

    case 'osNeedCall':
      // Need to re-send callsign after partial match
      if (wasPartialMatch) {
        // Send "DE <call>" pattern
        return { type: 'DE_CALL', text: `DE ${call} ${call}` };
      }
      // Just callsign
      return { type: 'CALL_ONLY', text: call };

    case 'osNeedNr':
      // Operator asked for our exchange, just send it
      return { type: 'QUERY', text: 'NR?' };

    case 'osNeedCallNr':
      // Need to send both call and exchange
      const exchange = formatCallerExchange(serial, makeError);
      return { type: 'CALL_EXCHANGE', text: `${call} ${exchange}` };

    case 'osNeedEnd':
      // Send our exchange, waiting for TU
      const finalExchange = formatCallerExchange(serial, makeError);
      return { type: 'EXCHANGE_ONLY', text: `R ${finalExchange}` };

    case 'osDone':
      // Send final TU
      return { type: 'TU', text: 'TU' };

    case 'osFailed':
    case 'osNeedPrevEnd':
    default:
      return { type: 'SILENT' };
  }
}

/**
 * Get the reply message for a CWT caller based on their current state
 * CWT format: NAME NUMBER (e.g., "BOB 2381" or "BOB CA")
 */
export function getCallerReplyForCwt(
  caller: Caller,
  wasPartialMatch: boolean = false
): CallerReply {
  const { state, call, isLid, cwtExchange } = caller;

  if (!cwtExchange) {
    // Fallback to WPX format if no CWT data
    return getCallerReply(caller, wasPartialMatch);
  }

  // 10% chance of lid making a copy error in their response
  const makeError = isLid && Math.random() < 0.1;

  switch (state) {
    case 'osNeedQso':
      // Initial call - just send callsign
      const doubleCall = Math.random() < 0.1;
      const callText = doubleCall ? `${call} ${call}` : call;
      return { type: 'CALL_ONLY', text: callText };

    case 'osNeedCall':
      // Need to re-send callsign after partial match
      if (wasPartialMatch) {
        return { type: 'DE_CALL', text: `DE ${call} ${call}` };
      }
      return { type: 'CALL_ONLY', text: call };

    case 'osNeedNr':
      // Operator asked for our exchange, just send it
      return { type: 'QUERY', text: 'NR?' };

    case 'osNeedCallNr':
      // Need to send both call and exchange
      const cwtExchangeWithCall = formatCwtExchange(cwtExchange, makeError);
      return { type: 'CALL_EXCHANGE', text: `${call} ${cwtExchangeWithCall}` };

    case 'osNeedEnd':
      // Send our exchange, waiting for TU
      const finalExchange = formatCwtExchange(cwtExchange, makeError);
      return { type: 'EXCHANGE_ONLY', text: finalExchange };

    case 'osDone':
      // Send final TU
      return { type: 'TU', text: 'TU' };

    case 'osFailed':
    case 'osNeedPrevEnd':
    default:
      return { type: 'SILENT' };
  }
}

/**
 * Format CWT exchange: NAME NUMBER
 * Applies cut numbers to numeric member numbers
 */
function formatCwtExchange(exchange: CwtExchange, makeError: boolean): string {
  let { name, number, isMember } = exchange;

  // Apply cut numbers if it's a member number (numeric)
  if (isMember && /^\d+$/.test(number)) {
    number = number
      .replace(/0/g, 'T')
      .replace(/9/g, 'N');

    if (makeError) {
      // Corrupt the number
      const chars = number.split('');
      const i = Math.floor(Math.random() * chars.length);
      if (/[0-9TNE]/.test(chars[i])) {
        const replacements = ['T', 'N', 'E', 'A', '1', '5'];
        chars[i] = replacements[Math.floor(Math.random() * replacements.length)];
      }
      number = chars.join('');
    }
  }

  return `${name} ${number}`;
}

/**
 * Format caller's exchange with cut numbers (WPX format)
 * @param serial The serial number
 * @param makeError Whether to introduce a copy error
 */
function formatCallerExchange(serial: number, makeError: boolean): string {
  let rst = '5NN';
  let serialStr = formatSerial(serial);

  if (makeError) {
    // Randomly corrupt the serial
    const chars = serialStr.split('');
    const i = Math.floor(Math.random() * chars.length);
    if (/[0-9TNE]/.test(chars[i])) {
      const replacements = ['T', 'N', 'E', 'A', '1', '5'];
      chars[i] = replacements[Math.floor(Math.random() * replacements.length)];
    }
    serialStr = chars.join('');
  }

  return `${rst} ${serialStr}`;
}

/**
 * Format serial number with cut numbers (0->T, 9->N)
 */
function formatSerial(serial: number): string {
  return serial
    .toString()
    .padStart(3, '0')
    .replace(/0/g, 'T')
    .replace(/9/g, 'N');
}

/**
 * Determine if caller should double-call based on skill
 */
export function shouldDoubleCall(caller: Caller): boolean {
  // High skill rarely double-calls, low skill often does
  switch (caller.skill) {
    case 'high':
      return Math.random() < 0.05;
    case 'medium':
      return Math.random() < 0.1;
    case 'low':
      return Math.random() < 0.2;
  }
}

/**
 * Check if caller should give up based on timeout
 */
export function checkTimeout(caller: Caller, currentTime: number): boolean {
  const elapsed = currentTime - caller.lastActivityTime;
  return elapsed > caller.replyTimeout;
}

/**
 * Decrement caller patience after a timeout
 */
export function decrementPatience(caller: Caller): Caller {
  return {
    ...caller,
    patience: caller.patience - 1,
    retryCount: caller.retryCount + 1,
    lastActivityTime: Date.now(),
  };
}

/**
 * Update caller state after processing a message
 */
export function updateCallerState(
  caller: Caller,
  newState: OperatorState
): Caller {
  return {
    ...caller,
    state: newState,
    lastActivityTime: Date.now(),
  };
}

/**
 * Get callers that are ready to reply
 * Filters based on state and adds appropriate delays
 */
export function getReadyCallers(
  callers: Caller[],
  currentTime: number
): Caller[] {
  return callers.filter(caller => {
    if (caller.state === 'osDone' || caller.state === 'osFailed') {
      return false;
    }
    // Check if enough time has passed since last activity
    const elapsed = currentTime - caller.lastActivityTime;
    return elapsed >= caller.sendDelay;
  });
}
