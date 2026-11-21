import { useCallback, useEffect, useRef, useState } from "react";
import { assessmentDeliveryApi, type SatStudentPauseState } from "../api/assessmentDeliveryApi";
import type { SatResponsePersistence } from "./useSatResponsePersistence";

export function useSatStudentPause(
  scheduleId: string,
  attemptId: string,
  ready: boolean,
  persistence: SatResponsePersistence,
  /** The live room-policy revision; a change rereads the control. */
  policyRevision?: number,
) {
  const key = JSON.stringify([scheduleId, attemptId]);
  const activeKey = useRef(key);
  activeKey.current = key;
  const [status, setStatus] = useState<{ key: string; state: SatStudentPauseState }>();
  const [action, setAction] = useState<{ key: string; pending: boolean; error?: string }>();
  const requestKey = useRef<string | null>(null);
  const readSequence = useRef(0);
  const state = status?.key === key ? status.state : undefined;

  const readState = useCallback(async () => {
    const mine = ++readSequence.current;
    try {
      const next = await assessmentDeliveryApi.studentPause(scheduleId, attemptId);
      // A policy reread may race the initial read; only the newest applies.
      if (activeKey.current === key && mine === readSequence.current) {
        setStatus({ key, state: next });
      }
    } catch {
      // The existing exam remains usable when the optional control is unavailable.
    }
  }, [attemptId, key, scheduleId]);

  useEffect(() => {
    if (!ready) return;
    void readState();
  }, [ready, readState]);

  useEffect(() => {
    if (!ready || policyRevision === undefined) return;
    void readState();
  }, [policyRevision, ready, readState]);

  async function setPaused(paused: boolean) {
    if (!state || requestKey.current === key) return;
    requestKey.current = key;
    setAction({ key, pending: true });
    try {
      if (paused) {
        await persistence.flush({ forceRetry: true });
        await persistence.assertBoundarySettled?.();
      }
      if (activeKey.current !== key) return;
      const current = await assessmentDeliveryApi.studentPause(scheduleId, attemptId);
      const next = await assessmentDeliveryApi.setStudentPause(scheduleId, attemptId, paused, current.controlEpoch);
      if (activeKey.current !== key) return;
      setStatus({ key, state: next });
      setAction({ key, pending: false });
      if (!next.paused) window.location.reload();
    } catch (cause) {
      if (activeKey.current !== key) return;
      // A dropped response can follow a successfully committed pause.
      const observed = await assessmentDeliveryApi.studentPause(scheduleId, attemptId).catch(() => null);
      if (activeKey.current !== key) return;
      if (observed) setStatus({ key, state: observed });
      if (observed?.paused === paused) {
        setAction({ key, pending: false });
        if (!paused) window.location.reload();
        return;
      }
      setAction({ key, pending: false, error: cause instanceof Error ? cause.message : "Could not update the timer. Try again." });
    } finally {
      if (requestKey.current === key) requestKey.current = null;
    }
  }

  return {
    state,
    setPaused,
    pending: action?.key === key && action.pending,
    error: action?.key === key ? action.error : undefined,
  };
}
