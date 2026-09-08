import { describe, expect, it, vi } from 'vitest';
import { createStudentRuntimePollLoop } from '../studentRuntimePollLoop';

// Plan C1: the poll loop is the student live channel. pollAfterSecs from the
// server drives cadence (adaptive); 304 = steady (no refresh); revision
// change = refresh once.
describe('student runtime poll loop', () => {
  it('refreshes only on revision change, honoring pollAfterSecs', async () => {
    vi.useFakeTimers();
    try {
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
        schedule: (ms) => { void ms; },
      });
      const first = await loop.tick();
      expect(first.notModified).toBe(true);
      expect(onRevision).not.toHaveBeenCalled();
      expect(loop.nextDelayMs()).toBe(25_000);
      const second = await loop.tick();
      expect(second.notModified).toBe(false);
      expect(onRevision).toHaveBeenCalledWith(8);
      expect(loop.nextDelayMs()).toBe(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops on terminal errors (410) instead of retry-storming', async () => {
    const terminal = Object.assign(new Error('retired'), { terminal: true });
    const poll = vi.fn().mockRejectedValue(terminal);
    const loop = createStudentRuntimePollLoop({
      poll: () => poll(0),
      sinceRevision: 0,
      onRevision: () => {},
      schedule: () => {},
    });
    await expect(loop.tick()).rejects.toMatchObject({ terminal: true });
    expect(loop.stopped()).toBe(true);
  });
});
