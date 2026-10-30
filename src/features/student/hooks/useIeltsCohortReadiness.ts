import { useEffect, useRef, useState } from 'react';
import { backendPost, tryBuildAttemptAuthorizationHeader } from '../api/studentAttemptGateway';
import { verifyAnswerStorage } from '../application/ieltsSectionPreparation';
import { ApiError } from '../../../shared/api-client/errors';
import { emitStudentObservabilityMetric } from '../../../utils/studentObservability';

interface Readiness {
  startedAt: string | null;
  serverNow: string;
  remainingStudents: number;
  status?: 'preparing' | 'active' | 'completed' | 'unable';
  message?: string;
  expectedStartAt?: string | null;
  preparationEndsAt?: string | null;
  deadlineAt?: string | null;
}

/** Healthy-but-pending cadence for the fast (V2) path. */
const FAST_PENDING_RETRY_MS = 1_000;
const TERMINAL_CATEGORIES = new Set([
  'authentication', 'authorization', 'not-found', 'fenced', 'validation', 'conflict',
]);

function jitter(ms: number): number {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}

function requiredContentReady(contentAvailable: boolean): boolean {
  return contentAvailable && document.readyState !== 'loading' &&
    Boolean(document.querySelector('.student-exam-shell')) &&
    Boolean(document.querySelector('#main-content'));
}

function listeningAudioReady(required: boolean): boolean {
  if (!required) return true;
  const audio = document.querySelector<HTMLAudioElement>('audio[aria-label="Listening audio"]');
  return Boolean(audio && !audio.error && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
}

export function useIeltsCohortReadiness(input: {
  scheduleId: string | undefined;
  attemptId: string | null;
  clientSessionId: string | null;
  sectionKey: string | null;
  contentAvailable: boolean;
  pending: boolean;
  audioRequired?: boolean;
  refreshRuntime: (() => Promise<void>) | undefined;
  /** The room can start while this device is still preparing or offline. */
  sharedClock?: boolean;
  /** V2 fast path: single in-flight request, coalesced triggers, ~1s pending
   *  cadence, failure-only backoff, and terminal-error stop. */
  fastRetry?: boolean;
  /** V2: the outgoing section's answer barrier has settled (or none exists).
   *  No /ready request is sent until this is true. */
  activationAllowed?: boolean;
  /** V2: local preparation already proved answer storage for this context. */
  storagePrepared?: boolean;
}) {
  const refreshRef = useRef(input.refreshRuntime);
  refreshRef.current = input.refreshRuntime;
  const [error, setError] = useState<string | null>(null);
  const {
    scheduleId, attemptId, clientSessionId, sectionKey, pending, contentAvailable,
    audioRequired = true, sharedClock = false, fastRetry = false, activationAllowed = true, storagePrepared = false,
  } = input;
  // Fast mode reads readiness inputs through a ref and is kicked on change,
  // so a change never restarts the loop with a second request in flight.
  const fastInputsRef = useRef({ contentAvailable, activationAllowed, storagePrepared });
  fastInputsRef.current = { contentAvailable, activationAllowed, storagePrepared };
  const kickRef = useRef<(() => void) | null>(null);
  const loopContentKey = fastRetry ? true : contentAvailable;
  const loopAudioKey = fastRetry ? true : audioRequired;
  const audioRequiredRef = useRef(audioRequired);
  audioRequiredRef.current = audioRequired;

  useEffect(() => {
    kickRef.current?.();
  }, [contentAvailable, activationAllowed, storagePrepared, audioRequired]);

  useEffect(() => {
    if (!pending || !scheduleId || !attemptId || !clientSessionId || !sectionKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let roundTripMs: number | undefined;
    let retry = 0;
    let storageCheck: Promise<boolean> | undefined;
    let inFlight = false;
    let queued = false;
    let firstRequestSent = false;
    const endpoint = `/v1/student/sessions/${encodeURIComponent(scheduleId)}/sections/${encodeURIComponent(sectionKey)}/ready`;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => { void run(); }, delay);
    };
    const failureDelay = () => {
      const delay = Math.round(Math.min(8_000, 1_000 * 2 ** retry) * (0.8 + Math.random() * 0.4));
      retry = Math.min(retry + 1, 4);
      return delay;
    };
    // Returns the next delay, or null to stop.
    const poll = async (): Promise<number | null> => {
      const fast = fastInputsRef.current;
      if (fastRetry && !fast.activationAllowed) {
        setError('Saving your answers from the previous section. Your next section has not started.');
        return null; // Kicked when the barrier settles.
      }
      const sentAt = performance.now();
      try {
        if (fastRetry && fast.storagePrepared && !storageCheck) storageCheck = Promise.resolve(true);
        storageCheck ??= verifyAnswerStorage(attemptId);
        const localStorageReady = await storageCheck;
        if (!localStorageReady) storageCheck = undefined;
        const audioReady = sectionKey === 'listening' ? listeningAudioReady(audioRequiredRef.current) : true;
        const contentReady = requiredContentReady(fastInputsRef.current.contentAvailable);
        if (stopped) return null;
        if (!firstRequestSent) {
          firstRequestSent = true;
          emitStudentObservabilityMetric('ielts_section_ready_request', { reason: sectionKey, attemptId, scheduleId });
        }
        const view = await backendPost<Readiness>(endpoint, {
          attemptId, clientSessionId,
          ...(roundTripMs === undefined ? {} : { roundTripMs }),
          contentReady,
          localStorageReady,
          audioReady,
        }, { headers: tryBuildAttemptAuthorizationHeader(scheduleId, attemptId) ?? {} });
        if (stopped) return null;
        if (view.status === 'unable') {
          setError(view.message ?? 'Could not start this section. Your saved work is preserved. Contact the proctor for help.');
          return null;
        }
        if (view.status === 'completed') {
          setError(null);
          await refreshRef.current?.();
          return null;
        }
        if (view.startedAt) {
          retry = 0;
          setError(null);
          emitStudentObservabilityMetric('ielts_section_activation_observed', {
            reason: sectionKey, attemptId, scheduleId, latencyMs: Math.round(performance.now() - sentAt),
          });
          if (fastRetry) await refreshRef.current?.().catch(() => undefined);
          else await refreshRef.current?.();
          if (stopped) return null;
          // Legacy: a failed refresh is retried through the same idempotent
          // endpoint. Fast: keep confirming until the snapshot shows the
          // activation (unmount via pending=false stops this loop).
          return fastRetry ? jitter(FAST_PENDING_RETRY_MS) : null;
        }
        if (!contentReady) {
          setError(sharedClock
            ? 'Section content is still loading. The shared room timer may continue; contact the proctor if this persists.'
            : 'Section content is still loading. Your section time has not started.');
        } else if (!localStorageReady) {
          setError(sharedClock
            ? 'Unable to save answers on this device. The shared room timer may continue; contact the proctor for help.'
            : 'Unable to save answers on this device. Your section will not start until answer storage is working.');
        } else if (!audioReady) {
          setError(sharedClock
            ? 'Listening audio is still loading. The shared room timer may continue; contact the proctor if this persists.'
            : 'Listening audio is still loading. Your section time has not started.');
        } else {
          setError(null);
        }
        if (roundTripMs === undefined) {
          roundTripMs = Math.min(10_000, Math.max(1, Math.ceil(performance.now() - sentAt)));
        }
        if (!fastRetry) return failureDelay();
        retry = 0;
        const expected = view.expectedStartAt ? Date.parse(view.expectedStartAt) : NaN;
        const serverNow = Date.parse(view.serverNow);
        if (Number.isFinite(expected) && Number.isFinite(serverNow) && expected > serverNow) {
          // Bounded: pause or a delayed release can move the expected start.
          return Math.max(100, Math.min(FAST_PENDING_RETRY_MS, expected - serverNow + 50));
        }
        return jitter(FAST_PENDING_RETRY_MS);
      } catch (caught) {
        if (stopped) return null;
        if (fastRetry && caught instanceof ApiError && TERMINAL_CATEGORIES.has(caught.category)) {
          setError('Could not start this section. Your saved work is preserved. Contact the proctor for help.');
          await refreshRef.current?.().catch(() => undefined);
          return null;
        }
        setError(sharedClock
          ? 'Connection interrupted while preparing. Reconnecting automatically. The shared room timer may continue; contact the proctor for help.'
          : 'Connection interrupted while preparing. Your exam time has not started; reconnecting automatically.');
        return failureDelay();
      }
    };
    const run = async () => {
      if (stopped) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      clearTimeout(timer);
      let next: number | null;
      try {
        next = await poll();
      } finally {
        inFlight = false;
      }
      if (stopped) return;
      if (queued) {
        queued = false;
        schedule(0);
      } else if (next !== null) {
        schedule(next);
      }
    };
    // Every declaration waits two frames so the mounted surface has painted.
    const afterPaint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => { void run(); });
      });
    };
    const kick = () => {
      if (fastRetry && !stopped) afterPaint();
    };
    if (fastRetry) kickRef.current = kick;
    const onVisibility = () => { if (document.visibilityState === 'visible') kick(); };
    if (fastRetry) {
      window.addEventListener('online', kick);
      document.addEventListener('visibilitychange', onVisibility);
    }
    afterPaint();
    return () => {
      stopped = true;
      if (kickRef.current === kick) kickRef.current = null;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (fastRetry) {
        window.removeEventListener('online', kick);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [pending, scheduleId, attemptId, clientSessionId, sectionKey, loopContentKey, loopAudioKey, sharedClock, fastRetry]);
  return error;
}
