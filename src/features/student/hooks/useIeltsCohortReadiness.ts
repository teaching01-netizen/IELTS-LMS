import { useEffect, useRef, useState } from 'react';
import { backendPost, tryBuildAttemptAuthorizationHeader } from '../api/studentAttemptGateway';
import { clearDurableDraft, loadDurableDraft, saveDurableDraft } from '../../../utils/durableDraftStore';

interface Readiness {
  startedAt: string | null;
  serverNow: string;
  remainingStudents: number;
  status?: 'preparing' | 'active' | 'completed' | 'unable';
  message?: string;
}

async function verifyAnswerStorage(attemptId: string): Promise<boolean> {
  const key = `ielts-readiness-probe:${attemptId}:${crypto.randomUUID()}`;
  const probe = { value: key };
  try {
    await saveDurableDraft(key, probe);
    const stored = await loadDurableDraft<typeof probe>(key);
    await clearDurableDraft(key);
    return stored?.value === key;
  } catch {
    try {
      await clearDurableDraft(key);
    } catch {
      // The exam is blocked below until its durable store can accept writes.
    }
    return false;
  }
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
}) {
  const refreshRef = useRef(input.refreshRuntime);
  refreshRef.current = input.refreshRuntime;
  const [error, setError] = useState<string | null>(null);
  const { scheduleId, attemptId, clientSessionId, sectionKey, pending, contentAvailable, audioRequired = true } = input;
  useEffect(() => {
    if (!pending || !scheduleId || !attemptId || !clientSessionId || !sectionKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let roundTripMs: number | undefined;
    let retry = 0;
    let storageCheck: Promise<boolean> | undefined;
    const endpoint = `/v1/student/sessions/${encodeURIComponent(scheduleId)}/sections/${encodeURIComponent(sectionKey)}/ready`;
    const poll = async () => {
      const sentAt = performance.now();
      try {
        storageCheck ??= verifyAnswerStorage(attemptId);
        const localStorageReady = await storageCheck;
        if (!localStorageReady) storageCheck = undefined;
        const audioReady = sectionKey === 'listening' ? listeningAudioReady(audioRequired) : true;
        const contentReady = requiredContentReady(contentAvailable);
        const view = await backendPost<Readiness>(endpoint, {
          attemptId, clientSessionId,
          ...(roundTripMs === undefined ? {} : { roundTripMs }),
          contentReady,
          localStorageReady,
          audioReady,
        }, { headers: tryBuildAttemptAuthorizationHeader(scheduleId, attemptId) ?? {} });
        if (stopped) return;
        if (view.status === 'unable') {
          setError(view.message ?? 'Could not start this section. Your saved work is preserved. Contact the proctor for help.');
          return;
        }
        if (view.status === 'completed') {
          setError(null);
          await refreshRef.current?.();
          return;
        }
        if (view.startedAt) {
          retry = 0;
          setError(null);
          await refreshRef.current?.();
          if (stopped) return;
          // A failed refresh is retried through the same idempotent endpoint.
          return;
        }
        if (!contentReady) {
          setError('Section content is still loading. Your section time has not started.');
        } else if (!localStorageReady) {
          setError('Unable to save answers on this device. Your section will not start until answer storage is working.');
        } else if (!audioReady) {
          setError('Listening audio is still loading. Your section time has not started.');
        } else {
          setError(null);
        }
        if (roundTripMs === undefined) {
          roundTripMs = Math.min(10_000, Math.max(1, Math.ceil(performance.now() - sentAt)));
        }
      } catch {
        if (stopped) return;
        setError('Connection interrupted while preparing. Your exam time has not started; reconnecting automatically.');
      }
      if (!stopped) {
        const delay = Math.round(Math.min(8_000, 1_000 * 2 ** retry) * (0.8 + Math.random() * 0.4));
        retry = Math.min(retry + 1, 4);
        timer = setTimeout(() => { void poll(); }, delay);
      }
    };
    // Let the prepared section mount and paint before declaring this tab ready.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { void poll(); });
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [pending, scheduleId, attemptId, clientSessionId, sectionKey, contentAvailable, audioRequired]);
  return error;
}
