export interface StudentRealtimePort {
  connect(): void;
  disconnect(): void;
  onConnected(listener: () => void): () => void;
  onDisconnected(listener: () => void): () => void;
  onRuntimeSnapshot(listener: (frame: StudentRuntimeSnapshotFrame) => void): () => void;
  onEvent(listener: (event: StudentRealtimeEvent) => void): () => void;
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
