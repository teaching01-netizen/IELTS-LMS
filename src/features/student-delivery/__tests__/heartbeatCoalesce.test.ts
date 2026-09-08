import { describe, expect, it } from 'vitest';
import { shouldSkipHeartbeat } from '../heartbeatCoalesce';

// Plan C5: skip dedicated beats within nextHeartbeatSecs of any save/poll —
// the server echoes presence state on every write, so a standalone beat is
// pure write load. Lifecycle events (disconnect/reconnect) always send.
describe('heartbeat coalescing (plan C5)', () => {
  it('skips heartbeat beats inside the server window', () => {
    expect(shouldSkipHeartbeat({
      eventType: 'heartbeat',
      msSinceLastWrite: 5_000,
      nextHeartbeatSecs: 30,
    })).toBe(true);
  });

  it('sends heartbeat beats past the server window', () => {
    expect(shouldSkipHeartbeat({
      eventType: 'heartbeat',
      msSinceLastWrite: 31_000,
      nextHeartbeatSecs: 30,
    })).toBe(false);
  });

  it('never skips lifecycle events', () => {
    for (const eventType of ['disconnect', 'reconnect', 'lost'] as const) {
      expect(shouldSkipHeartbeat({ eventType, msSinceLastWrite: 0, nextHeartbeatSecs: 90 })).toBe(false);
    }
  });

  it('sends when no write has happened yet', () => {
    expect(shouldSkipHeartbeat({
      eventType: 'heartbeat',
      msSinceLastWrite: null,
      nextHeartbeatSecs: 30,
    })).toBe(false);
  });
});
