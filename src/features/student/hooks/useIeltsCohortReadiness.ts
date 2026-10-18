import { useEffect, useRef, useState } from 'react';
import { backendPost, tryBuildAttemptAuthorizationHeader } from '../api/studentAttemptGateway';

interface Readiness {
  startedAt: string | null;
  serverNow: string;
  remainingStudents: number;
}

export function useIeltsCohortReadiness(input: {
  scheduleId: string | undefined;
  attemptId: string | null;
  clientSessionId: string | null;
  sectionKey: string | null;
  pending: boolean;
  refreshRuntime: (() => Promise<void>) | undefined;
}) {
  const refreshRef = useRef(input.refreshRuntime);
  refreshRef.current = input.refreshRuntime;
  const [error, setError] = useState<string | null>(null);
  const { scheduleId, attemptId, clientSessionId, sectionKey, pending } = input;
  useEffect(() => {
    if (!pending || !scheduleId || !attemptId || !clientSessionId || !sectionKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let roundTripMs: number | undefined;
    const endpoint = `/v1/student/sessions/${encodeURIComponent(scheduleId)}/sections/${encodeURIComponent(sectionKey)}/ready`;
    const poll = async () => {
      const sentAt = performance.now();
      try {
        const view = await backendPost<Readiness>(endpoint, {
          attemptId, clientSessionId,
          ...(roundTripMs === undefined ? {} : { roundTripMs }),
        }, { headers: tryBuildAttemptAuthorizationHeader(scheduleId, attemptId) ?? {} });
        if (stopped) return;
        setError(null);
        if (view.startedAt) {
          await refreshRef.current?.();
          if (stopped) return;
          // A failed refresh is retried through the same idempotent endpoint.
          return;
        }
        if (roundTripMs === undefined) {
          roundTripMs = Math.min(10_000, Math.max(1, Math.ceil(performance.now() - sentAt)));
          void poll();
          return;
        }
      } catch {
        if (stopped) return;
        setError('Reconnecting to the exam. Please keep this page open.');
      }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 500);
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
  }, [pending, scheduleId, attemptId, clientSessionId, sectionKey]);
  return error;
}
