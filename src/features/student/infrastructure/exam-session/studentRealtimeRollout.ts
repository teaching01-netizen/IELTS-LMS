/**
 * Student realtime transport rollout (Phase 3).
 *
 * SAT students use the socket by default so staff controls appear without a
 * manual refresh. Other providers keep polling unless the global switch turns
 * sockets on for them too.
 *
 * This module owns the one switch that decides the transport. It is a pure
 * function of a raw env value so the decision can be tested without a bundler,
 * and it supports a provider-specific SAT default. Invalid values fail closed
 * to polling. Server-side rollback stays `STUDENT_WS=gone`; the two switches
 * are independent.
 */
export type StudentRealtimeTransport = 'websocket' | 'poll';

/** Env var read by the student session route (`VITE_STUDENT_REALTIME`). */
export const STUDENT_REALTIME_ENV_KEY = 'VITE_STUDENT_REALTIME';

/**
 * `websocket` -> WS primary with poll recovery for every provider.
 * `poll` -> polling for every provider. When unset, SAT uses WS and other
 * providers keep polling.
 */
export function resolveStudentRealtimeTransport(
  raw: unknown,
  providerKey?: 'sat' | 'ielts' | 'act' | 'unknown'
): StudentRealtimeTransport {
  if (raw == null) {
    return providerKey === 'sat' ? 'websocket' : 'poll';
  }
  if (typeof raw !== 'string') return 'poll';

  const value = raw.trim().toLowerCase();
  if (value === 'websocket') return 'websocket';
  if (value === 'poll') return 'poll';
  if (value === '' && providerKey === 'sat') return 'websocket';
  return 'poll';
}
