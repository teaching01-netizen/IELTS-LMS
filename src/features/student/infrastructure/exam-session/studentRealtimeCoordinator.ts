import { STUDENT_EXAM_PHASE, type StudentExamPhase } from '../../domain/exam-session/studentExamPhase';

export interface StudentRealtimeCache {
  invalidateLiveSession(): void | Promise<void>;
  updateLiveRuntime(runtime: unknown, revision: number | null): void | Promise<void>;
}

export interface StudentRealtimeCoordinatorInput {
  readonly scheduleId: string;
  readonly candidateId: string;
  readonly cache: StudentRealtimeCache;
}

export interface StudentRealtimeEvent {
  readonly kind: string;
  readonly id: string;
  readonly revision: number;
  readonly event: string;
  readonly scheduleId?: string;
}

export interface StudentRuntimeSnapshotFrame {
  readonly runtime: unknown;
  readonly revision: number | null;
  readonly scheduleId?: string;
}

export interface StudentPollingPolicy {
  readonly intervalMs: number;
  readonly maxIntervalMs: number;
}

export interface StudentPollingContext {
  /**
   * The attempt's phase, consulted only when there is no runtime row
   * (`runtimeStatus === null`), which is ambiguous on its own: a cohort
   * waiting on Start (lobby / pre-check) or a self-paced attempt that never
   * gets a runtime row and is already in its exam.
   */
  readonly attemptPhase?: StudentExamPhase | null;
}

export type RuntimeSnapshotResult = 'applied' | 'ignored';

export interface StudentRealtimeCoordinator {
  handleSocketConnected(): void;
  handleSocketDisconnected(): void;
  handleRuntimeSnapshot(frame: StudentRuntimeSnapshotFrame): RuntimeSnapshotResult;
  handleEvent(event: StudentRealtimeEvent): 'invalidated' | 'ignored';
  getPollingPolicy(
    runtimeStatus: 'not_started' | 'live' | 'paused' | 'completed' | 'cancelled' | null,
    context?: StudentPollingContext,
  ): StudentPollingPolicy;
}

/**
 * A self-paced attempt (no runtime row, ever) that has moved past the waiting
 * phases has no proctor transition left for the poll to catch: Start never
 * comes, and pause/resume/extend arrive on the attempt itself.
 */
function isSelfPacedPastWaiting(phase: StudentExamPhase | null | undefined): boolean {
  return (
    phase === STUDENT_EXAM_PHASE.EXAM ||
    phase === STUDENT_EXAM_PHASE.POST_EXAM ||
    phase === STUDENT_EXAM_PHASE.SUBMITTED
  );
}

function isNewerRevision(incoming: number | null, applied: number | null): boolean {
  if (incoming === null) {
    return applied === null;
  }
  if (applied === null) {
    return true;
  }
  return incoming > applied;
}

export function createStudentRealtimeCoordinator(
  input: StudentRealtimeCoordinatorInput,
): StudentRealtimeCoordinator {
  let socketConnected = false;
  let appliedRuntimeRevision: number | null = null;

  return {
    handleSocketConnected() {
      socketConnected = true;
      void input.cache.invalidateLiveSession();
    },
    handleSocketDisconnected() {
      socketConnected = false;
    },
    handleRuntimeSnapshot(frame) {
      if (frame.scheduleId && frame.scheduleId !== input.scheduleId) {
        return 'ignored';
      }
      if (!isNewerRevision(frame.revision, appliedRuntimeRevision)) {
        return 'ignored';
      }
      appliedRuntimeRevision = frame.revision;
      void input.cache.updateLiveRuntime(frame.runtime, frame.revision);
      return 'applied';
    },
    handleEvent(event) {
      if (event.scheduleId && event.scheduleId !== input.scheduleId) {
        return 'ignored';
      }
      // Runtime revisions are monotonic: a schedule_runtime frame naming a
      // revision the client already applied carries no new state, so it must
      // not start another authoritative refresh (a reconnect replay or a
      // re-delivered bus row would otherwise re-refresh identical state).
      //
      // Only runtime frames are gated: `attempt` revisions are a different
      // sequence owned by the attempt, and comparing them against the runtime
      // revision would silently drop real answer updates.
      if (
        event.kind === 'schedule_runtime' &&
        appliedRuntimeRevision !== null &&
        Number.isFinite(event.revision) &&
        event.revision <= appliedRuntimeRevision
      ) {
        return 'ignored';
      }
      void input.cache.invalidateLiveSession();
      return 'invalidated';
    },
    getPollingPolicy(runtimeStatus, context) {
      // A cancelled runtime has no transition left for the student poll.
      if (runtimeStatus === 'cancelled') {
        return { intervalMs: 15_000, maxIntervalMs: 25_000 };
      }
      if (socketConnected) {
        // The socket carries every transition; the poll is only recovery.
        return runtimeStatus === 'live'
          ? { intervalMs: 20_000, maxIntervalMs: 30_000 }
          : { intervalMs: 15_000, maxIntervalMs: 25_000 };
      }
      // No socket and no runtime row: before Start a runtime-backed cohort
      // looks exactly like this too, so `null` alone cannot decide. A
      // self-paced attempt already in (or past) its exam never gets a runtime
      // row, and polling it every 1.5s for a three-hour paper would buy
      // nothing — rest lazily there and only there.
      if (runtimeStatus === null && isSelfPacedPastWaiting(context?.attemptPhase)) {
        return { intervalMs: 15_000, maxIntervalMs: 25_000 };
      }
      // Without a socket, IELTS/ACT completion and pre-start transitions must
      // be observed quickly so the student does not sit on a stale exam
      // surface after an authoritative runtime command or timeout. When the
      // socket is healthy, the branch above deliberately keeps polling lazy.
      if (runtimeStatus === 'not_started' || runtimeStatus === 'completed') {
        return { intervalMs: 1_500, maxIntervalMs: 3_000 };
      }
      // No socket: the poll IS the live channel, and that is as true for a
      // cohort waiting on Start (no runtime row yet, so `null`, or
      // `not_started`) or on Resume (`paused`) as for one mid-exam. These
      // bounds used to apply only to `live`, so a waiting student without a
      // socket sat on a 15-25s cadence and the server's 2s fast lane was
      // clamped away — the proctor pressed Start and the room learned of it
      // up to 25s later.
      return { intervalMs: 1_500, maxIntervalMs: 3_000 };
    },
  };
}
