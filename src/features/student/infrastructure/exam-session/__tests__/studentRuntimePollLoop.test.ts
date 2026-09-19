import { describe, expect, it, vi } from 'vitest';
import { createStudentRealtimeCoordinator } from '../studentRealtimeCoordinator';
import {
  clampStudentPollDelay,
  createStudentRuntimePollLoop,
  DEFAULT_STUDENT_POLL_CADENCE,
} from '../studentRuntimePollLoop';

// Plan C1: the poll loop is the student recovery channel. pollAfterSecs from
// the server drives cadence (adaptive); 304 = steady (no refresh); revision
// change = refresh once.
// Phase 6: the loop — not the React timer — owns the next delay, so the
// server's adaptive cadence is actually honored.
describe('student runtime poll loop', () => {
  it('refreshes only on revision change, honoring pollAfterSecs', async () => {
    const views = [
      { revision: 7, status: 'live', activeSection: 'reading', pollAfterSecs: 25, notModified: true },
      { revision: 8, status: 'live', activeSection: 'reading', pollAfterSecs: 2, notModified: false },
    ];
    let calls = 0;
    const poll = vi.fn().mockImplementation(async () => views[Math.min(calls++, 1)]);
    const onRevision = vi.fn();
    const loop = createStudentRuntimePollLoop({
      poll: (since) => poll(since),
      sinceRevision: 7,
      onRevision,
    });
    const first = await loop.tick();
    expect(first.notModified).toBe(true);
    expect(onRevision).not.toHaveBeenCalled();
    // Steady cadence, clamped by the default bounds.
    expect(loop.nextDelayMs()).toBe(25_000);
    const second = await loop.tick();
    expect(second.notModified).toBe(false);
    expect(onRevision).toHaveBeenCalledWith(8);
    // Fast lane (2s) is clamped UP to the default floor (2s).
    expect(loop.nextDelayMs()).toBe(2_000);
  });

  // Acceptance (CONC-001 residual): a student waiting on Start with no live
  // socket. The room's runtime revision is 7 (not started); the proctor presses
  // Start and the server exposes revision 8 with a 2s fast lane. The versioned
  // poll must be what observes it, exactly one refresh must follow, and the
  // cadence around it must be seconds — not the 15-25s a waiting cohort used
  // to be clamped to.
  it('lets a waiting student without a socket observe Start within the fast-lane bound', async () => {
    const coordinator = createStudentRealtimeCoordinator({
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      cache: { invalidateLiveSession: vi.fn(), updateLiveRuntime: vi.fn() },
    });
    coordinator.handleSocketDisconnected();
    // No runtime row exists before Start, so the hook resolves the status to
    // null; the coordinator policy is what the loop clamps into.
    let runtimeStatus: 'not_started' | 'live' | null = null;

    let started = false;
    const poll = vi.fn().mockImplementation(async (since: number) =>
      started
        ? { revision: 8, status: 'live', activeSection: 'reading-writing', pollAfterSecs: 2, notModified: false }
        : { revision: 7, status: 'not_started', activeSection: null, pollAfterSecs: 25, notModified: since === 7 },
    );
    const onRevision = vi.fn();
    const loop = createStudentRuntimePollLoop({
      poll,
      sinceRevision: 7,
      onRevision,
      cadence: () => {
        const policy = coordinator.getPollingPolicy(runtimeStatus);
        return { floorMs: policy.intervalMs, ceilingMs: policy.maxIntervalMs };
      },
    });

    // Waiting: the server's steady 25s is clamped down to the socket-less
    // ceiling, so the next look is seconds away rather than 15-25s.
    await loop.tick();
    expect(poll).toHaveBeenLastCalledWith(7);
    expect(onRevision).not.toHaveBeenCalled();
    expect(loop.nextDelayMs()).toBeLessThanOrEqual(3_000);

    // The proctor presses Start.
    started = true;
    await loop.tick();
    expect(poll).toHaveBeenLastCalledWith(7);
    // Exactly one live snapshot refresh, for revision 8.
    expect(onRevision).toHaveBeenCalledTimes(1);
    expect(onRevision).toHaveBeenCalledWith(8);
    // The server's 2s fast lane is honored, not the coordinator's old 15s floor.
    expect(loop.nextDelayMs()).toBe(2_000);

    // The refresh applied the live runtime; the loop's cursor advanced, so the
    // next poll is a 304-style no-op and nothing refreshes twice.
    runtimeStatus = 'live';
    poll.mockImplementation(async (since: number) => ({
      revision: 8, status: 'live', activeSection: 'reading-writing', pollAfterSecs: 2, notModified: since === 8,
    }));
    const steady = await loop.tick();
    expect(poll).toHaveBeenLastCalledWith(8);
    expect(steady.notModified).toBe(true);
    expect(onRevision).toHaveBeenCalledTimes(1);
    expect(loop.nextDelayMs()).toBe(2_000);
  });

  it('clamps the server cadence into the transport bounds', () => {
    // A healthy socket may rest lazily even if the server says 2s...
    expect(clampStudentPollDelay(2_000, { floorMs: 20_000, ceilingMs: 30_000 })).toBe(20_000);
    // ...and a missing socket may only go as lazy as its ceiling.
    expect(clampStudentPollDelay(25_000, { floorMs: 1_500, ceilingMs: 3_000 })).toBe(3_000);
    expect(clampStudentPollDelay(2_000, { floorMs: 1_500, ceilingMs: 3_000 })).toBe(2_000);
    expect(clampStudentPollDelay(Number.NaN, DEFAULT_STUDENT_POLL_CADENCE)).toBe(
      DEFAULT_STUDENT_POLL_CADENCE.ceilingMs,
    );
  });

  it('uses the caller cadence resolver on every tick', async () => {
    const view = { revision: 1, status: 'live', activeSection: null, pollAfterSecs: 25, notModified: true };
    const loop = createStudentRuntimePollLoop({
      poll: async () => view,
      sinceRevision: 1,
      onRevision: () => {},
      cadence: () => ({ floorMs: 20_000, ceilingMs: 30_000 }),
    });
    await loop.tick();
    expect(loop.nextDelayMs()).toBe(25_000);
  });

  it('backs off after a transport failure instead of retry-storming', async () => {
    const failing = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ revision: 3, status: 'live', activeSection: null, pollAfterSecs: 25, notModified: false });
    const loop = createStudentRuntimePollLoop({
      poll: () => failing(),
      sinceRevision: 3,
      onRevision: () => {},
      cadence: () => ({ floorMs: 2_000, ceilingMs: 25_000 }),
    });
    await expect(loop.tick()).rejects.toThrow('network down');
    expect(loop.nextDelayMs()).toBe(4_000);
    await expect(loop.tick()).rejects.toThrow('network down');
    expect(loop.nextDelayMs()).toBe(8_000);
    // A successful tick resets the window to the server cadence.
    await loop.tick();
    expect(loop.nextDelayMs()).toBe(25_000);
  });

  it('stops on terminal errors (410) instead of retry-storming', async () => {
    const terminal = Object.assign(new Error('retired'), { terminal: true });
    const poll = vi.fn().mockRejectedValue(terminal);
    const loop = createStudentRuntimePollLoop({
      poll: () => poll(0),
      sinceRevision: 0,
      onRevision: () => {},
    });
    await expect(loop.tick()).rejects.toMatchObject({ terminal: true });
    expect(loop.stopped()).toBe(true);
  });
});
