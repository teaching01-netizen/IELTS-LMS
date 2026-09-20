/**
 * Student realtime transport rollout (Phase 3).
 *
 * The student channel used to be poll-only: `useLiveUpdates` short-circuited
 * `role: 'student'` to disconnected, hard-coded, with no way to turn it on from
 * the client even when the server admitted student sockets (STUDENT_WS=allow).
 * That left every waiting student blind until their next poll, so a proctor's
 * Start reached them up to a poll window late.
 *
 * This module owns the one switch that decides the transport. It is a pure
 * function of a raw env value so the decision can be tested without a bundler,
 * and it defaults to `poll` — today's behavior is the rollback position, so a
 * missing, misspelled, or partially deployed flag can never open a socket
 * fleet. Server-side rollback stays `STUDENT_WS=gone`; the two are independent
 * switches for the same seam.
 */
export type StudentRealtimeTransport = 'websocket' | 'poll';

/** Env var read by the student session route (`VITE_STUDENT_REALTIME`). */
export const STUDENT_REALTIME_ENV_KEY = 'VITE_STUDENT_REALTIME';

/**
 * `websocket` -> WS primary with poll recovery.
 * anything else (incl. undefined) -> poll only.
 */
export function resolveStudentRealtimeTransport(raw: unknown): StudentRealtimeTransport {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'websocket'
    ? 'websocket'
    : 'poll';
}
