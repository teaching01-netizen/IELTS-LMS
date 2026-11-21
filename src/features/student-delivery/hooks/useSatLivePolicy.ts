import { useCallback, useEffect, useRef, useState } from "react";
import { assessmentDeliveryApi, type SatLivePolicy } from "../api/assessmentDeliveryApi";

/**
 * Foreground cadence for the student-safe policy read. The product target is a
 * p95 under 5 seconds from the database cutover to a connected foreground tab,
 * so one read every 3 seconds leaves room for one slow round trip. Hidden tabs
 * back off; on becoming visible again the hook reads immediately.
 */
export const SAT_LIVE_POLICY_POLL_MS = 3_000;
export const SAT_LIVE_POLICY_HIDDEN_POLL_MS = 15_000;

/** A stable identity for the visible controls; equal signatures mean no UI change. */
export function satPolicySignature(policy: SatLivePolicy | null | undefined): string {
  if (!policy) return "";
  return [
    policy.revision,
    policy.reportVisible,
    policy.includeAnswerKeyInPdf,
    policy.unlimitedRetakes,
    policy.pauseOnLeave,
  ].join(":");
}

/**
 * Polls one attempt's live Results and scoring policy. Responses are fenced by
 * request sequence: an older response that arrives after a newer one is
 * discarded, so a stale grant cannot restore a revoked control. A failed read
 * keeps the last accepted value rather than inventing a permissive one.
 */
export function useSatLivePolicy(
  scheduleId: string,
  attemptId: string,
  enabled: boolean,
) {
  const key = `${scheduleId}\u0000${attemptId}`;
  const [state, setState] = useState<{ key: string; policy: SatLivePolicy } | null>(null);
  const sequence = useRef(0);
  const policy = state?.key === key ? state.policy : undefined;

  const read = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const next = await assessmentDeliveryApi.satPolicy(scheduleId, attemptId);
      if (mine === sequence.current) setState({ key, policy: next });
    } catch {
      // Keep the last accepted policy. The next tick retries.
    }
  }, [attemptId, key, scheduleId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const tick = () => {
      if (cancelled) return;
      const delay = visible() ? SAT_LIVE_POLICY_POLL_MS : SAT_LIVE_POLICY_HIDDEN_POLL_MS;
      timer = window.setTimeout(run, delay);
    };
    const run = async () => {
      if (cancelled) return;
      if (visible()) await read();
      tick();
    };
    const onVisibility = () => {
      if (visible()) void read();
    };
    const onFocus = () => void read();
    void run();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, read]);

  return { policy, signature: satPolicySignature(policy), refresh: read };
}
