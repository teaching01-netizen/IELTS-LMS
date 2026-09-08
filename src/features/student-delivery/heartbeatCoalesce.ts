// Heartbeat coalescing (plan C5/D2): the server echoes presence state
// (presence heartbeat fields) on every write — save, poll, autosave. A
// standalone heartbeat inside nextHeartbeatSecs of any write is pure
// write load with zero new information, so skip it. Lifecycle events
// (disconnect/reconnect/lost) always send: they carry state transitions
// the server cannot infer from a write.

export type HeartbeatEventType = 'heartbeat' | 'disconnect' | 'reconnect' | 'lost';

export interface HeartbeatSkipInput {
  readonly eventType: HeartbeatEventType;
  /** ms since the last successful write (save/poll/autosave), null = none yet. */
  readonly msSinceLastWrite: number | null;
  /** Server-echoed window: skip beats inside it. <=0 = always send. */
  readonly nextHeartbeatSecs: number;
}

export function shouldSkipHeartbeat(input: HeartbeatSkipInput): boolean {
  if (input.eventType !== 'heartbeat') {
    return false;
  }
  if (input.nextHeartbeatSecs <= 0) {
    return false;
  }
  if (input.msSinceLastWrite === null) {
    return false;
  }
  return input.msSinceLastWrite < input.nextHeartbeatSecs * 1000;
}
