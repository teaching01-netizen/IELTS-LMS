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

export type RuntimeSnapshotResult = 'applied' | 'ignored';

export interface StudentRealtimeCoordinator {
  handleSocketConnected(): void;
  handleSocketDisconnected(): void;
  handleRuntimeSnapshot(frame: StudentRuntimeSnapshotFrame): RuntimeSnapshotResult;
  handleEvent(event: StudentRealtimeEvent): 'invalidated' | 'ignored';
  getPollingPolicy(runtimeStatus: 'not_started' | 'live' | 'paused' | 'completed' | 'cancelled' | null): StudentPollingPolicy;
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
    getPollingPolicy(runtimeStatus) {
      if (runtimeStatus === 'live') {
        return socketConnected
          ? { intervalMs: 20_000, maxIntervalMs: 30_000 }
          : { intervalMs: 1_500, maxIntervalMs: 3_000 };
      }
      return { intervalMs: 15_000, maxIntervalMs: 25_000 };
    },
  };
}
