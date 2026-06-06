/**
 * useCallerManager - Manages caller state machine, timing, and retries
 *
 * Handles:
 * - Caller timeouts and retry logic
 * - State machine transitions
 * - Patience exhaustion
 * - Reply scheduling
 */

import { useCallback, useRef, useEffect } from 'react';
import type { UseContestAudioReturn } from 'react-morse-audio';
import type { Caller, OperatorState } from '../types';
import {
  processMessage,
  getCallerReply,
  checkTimeout,
  decrementPatience,
  type OperatorMessage,
  type CallerReply,
} from '../utils/callerStateMachine';
import { matchCall } from '../utils/callMatch';

interface UseCallerManagerOptions {
  callers: Caller[];
  audio: UseContestAudioReturn;
  onUpdateCaller: (id: string, updates: Partial<Caller>) => void;
  onRemoveCaller: (id: string) => void;
}

export function useCallerManager({
  callers,
  audio,
  onUpdateCaller,
  onRemoveCaller,
}: UseCallerManagerOptions) {
  // Timer refs for timeout checking
  const timeoutCheckRef = useRef<number | null>(null);
  const pendingRepliesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /**
   * Broadcast a message to all callers and collect their replies
   */
  const broadcastMessage = useCallback(
    (message: OperatorMessage): Array<{ caller: Caller; reply: CallerReply }> => {
      const replies: Array<{ caller: Caller; reply: CallerReply }> = [];

      for (const caller of callers) {
        // Skip callers that are done or failed
        if (caller.state === 'osDone' || caller.state === 'osFailed') {
          continue;
        }

        const { newState, shouldReply } = processMessage(caller, message);

        // Update caller state
        if (newState !== caller.state) {
          onUpdateCaller(caller.id, {
            state: newState,
            lastActivityTime: Date.now(),
          });
        }

        if (shouldReply) {
          const wasPartialMatch =
            message.type === 'HIS_CALL' &&
            matchCall(message.call, caller.call, caller.isLid) === 'almost';

          const reply = getCallerReply(
            { ...caller, state: newState },
            wasPartialMatch
          );

          if (reply.type !== 'SILENT') {
            replies.push({ caller: { ...caller, state: newState }, reply });
          }
        }
      }

      return replies;
    },
    [callers, onUpdateCaller]
  );

  /**
   * Send a message to a specific caller
   */
  const sendToSingleCaller = useCallback(
    (
      caller: Caller,
      message: OperatorMessage
    ): { reply: CallerReply; newState: OperatorState } | null => {
      const { newState, shouldReply } = processMessage(caller, message);

      // Update caller state
      if (newState !== caller.state) {
        onUpdateCaller(caller.id, {
          state: newState,
          lastActivityTime: Date.now(),
        });
      }

      if (shouldReply) {
        const wasPartialMatch =
          message.type === 'HIS_CALL' &&
          matchCall(message.call, caller.call, caller.isLid) === 'almost';

        const reply = getCallerReply(
          { ...caller, state: newState },
          wasPartialMatch
        );

        return { reply, newState };
      }

      return { reply: { type: 'SILENT' }, newState };
    },
    [onUpdateCaller]
  );

  /**
   * Schedule a caller to send a reply after their send delay
   */
  const scheduleReply = useCallback(
    (
      caller: Caller,
      reply: CallerReply,
      onComplete?: () => void
    ) => {
      if (reply.type === 'SILENT') return;

      // Clear any existing pending reply for this caller
      const existing = pendingRepliesRef.current.get(caller.id);
      if (existing) {
        clearTimeout(existing);
      }

      // Schedule the reply
      const timeout = setTimeout(async () => {
        pendingRepliesRef.current.delete(caller.id);

        // Play the caller's response
        try {
          await audio.playStation({
            id: caller.id,
            text: reply.text,
            wpm: caller.wpm,
            frequencyOffset: caller.frequencyOffset,
            signalStrength: caller.signalStrength,
          });
          onComplete?.();
        } catch {
          // Audio engine may have stopped
        }
      }, caller.sendDelay);

      pendingRepliesRef.current.set(caller.id, timeout);
    },
    [audio]
  );

  /**
   * Schedule multiple caller replies with staggered timing
   */
  const scheduleReplies = useCallback(
    (
      replies: Array<{ caller: Caller; reply: CallerReply }>,
      baseDelay: number = 0
    ) => {
      replies.forEach(({ caller, reply }, index) => {
        if (reply.type === 'SILENT') return;

        const staggerDelay = index * 80 + Math.random() * 100;
        const totalDelay = baseDelay + caller.sendDelay + staggerDelay;

        const timeout = setTimeout(async () => {
          pendingRepliesRef.current.delete(caller.id);

          try {
            await audio.playStation({
              id: caller.id,
              text: reply.text,
              wpm: caller.wpm,
              frequencyOffset: caller.frequencyOffset,
              signalStrength: caller.signalStrength,
            });
          } catch {
            // Audio engine may have stopped
          }
        }, totalDelay);

        pendingRepliesRef.current.set(caller.id, timeout);
      });
    },
    [audio]
  );

  /**
   * Handle caller timeouts - check if any caller has waited too long
   */
  const checkCallerTimeouts = useCallback(() => {
    const now = Date.now();

    for (const caller of callers) {
      // Skip completed or failed callers
      if (caller.state === 'osDone' || caller.state === 'osFailed') {
        continue;
      }

      // Skip callers waiting for previous QSO
      if (caller.state === 'osNeedPrevEnd') {
        continue;
      }

      // Check if caller has timed out
      if (checkTimeout(caller, now)) {
        if (caller.patience <= 0) {
          // Caller gives up
          onUpdateCaller(caller.id, { state: 'osFailed' });
          // Remove after a delay
          setTimeout(() => onRemoveCaller(caller.id), 2000);
        } else {
          // Caller retries
          const updated = decrementPatience(caller);
          onUpdateCaller(caller.id, {
            patience: updated.patience,
            retryCount: updated.retryCount,
            lastActivityTime: updated.lastActivityTime,
          });

          // Schedule retry reply
          const reply = getCallerReply(caller, false);
          if (reply.type !== 'SILENT') {
            scheduleReply(caller, reply);
          }
        }
      }
    }
  }, [callers, onUpdateCaller, onRemoveCaller, scheduleReply]);

  /**
   * Start timeout checking interval
   */
  const startTimeoutChecking = useCallback(() => {
    if (timeoutCheckRef.current) {
      clearInterval(timeoutCheckRef.current);
    }
    timeoutCheckRef.current = window.setInterval(checkCallerTimeouts, 500);
  }, [checkCallerTimeouts]);

  /**
   * Stop timeout checking
   */
  const stopTimeoutChecking = useCallback(() => {
    if (timeoutCheckRef.current) {
      clearInterval(timeoutCheckRef.current);
      timeoutCheckRef.current = null;
    }
  }, []);

  /**
   * Cancel all pending replies
   */
  const cancelAllReplies = useCallback(() => {
    pendingRepliesRef.current.forEach((timeout) => clearTimeout(timeout));
    pendingRepliesRef.current.clear();
  }, []);

  /**
   * Trigger callers to respond to CQ
   */
  const triggerCqResponse = useCallback(() => {
    const replies = broadcastMessage({ type: 'CQ' });
    scheduleReplies(replies, 200); // Small delay after CQ ends
  }, [broadcastMessage, scheduleReplies]);

  /**
   * Notify callers that operator sent their call
   */
  const notifyCallSent = useCallback(
    (call: string) => {
      const replies = broadcastMessage({ type: 'HIS_CALL', call });
      return replies;
    },
    [broadcastMessage]
  );

  /**
   * Notify callers that operator sent exchange
   */
  const notifyExchangeSent = useCallback(
    (call: string, serial: number) => {
      const replies = broadcastMessage({
        type: 'EXCHANGE',
        call,
        serial,
      });
      return replies;
    },
    [broadcastMessage]
  );

  /**
   * Notify callers that operator sent TU
   */
  const notifyTuSent = useCallback(() => {
    const replies = broadcastMessage({ type: 'TU' });
    return replies;
  }, [broadcastMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimeoutChecking();
      cancelAllReplies();
    };
  }, [stopTimeoutChecking, cancelAllReplies]);

  return {
    broadcastMessage,
    sendToSingleCaller,
    scheduleReply,
    scheduleReplies,
    startTimeoutChecking,
    stopTimeoutChecking,
    cancelAllReplies,
    triggerCqResponse,
    notifyCallSent,
    notifyExchangeSent,
    notifyTuSent,
  };
}
