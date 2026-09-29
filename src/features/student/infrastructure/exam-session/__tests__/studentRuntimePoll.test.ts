import { describe, expect, it, vi } from 'vitest';
import { createStudentRuntimePoll } from '../studentRuntimePoll';

describe('student runtime poll (plan C1: replaces student WS)', () => {
  it('fetches the versioned poll view with sinceRevision', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      status: 200,
      json: { revision: 7, status: 'live', activeSection: 'reading', pollAfterSecs: 25 },
    });
    const poll = createStudentRuntimePoll({
      scheduleId: 'sched-1',
      fetchJson,
    });
    const view = await poll.poll(3);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining('/sched-1/runtime?sinceRevision=3'),
    );
    expect(view).toMatchObject({ revision: 7, notModified: false, pollAfterSecs: 25 });
  });

  it('maps HTTP 304 to notModified without a body', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ status: 304, json: null });
    const poll = createStudentRuntimePoll({ scheduleId: 'sched-1', fetchJson });
    const view = await poll.poll(7);
    expect(view.notModified).toBe(true);
  });

  it('rejects a non-runtime 200 response so the caller can use the snapshot fallback', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      status: 200,
      json: { attempt: { id: 'attempt-1' }, attemptCredential: { attemptToken: 'token' } },
    });
    const poll = createStudentRuntimePoll({ scheduleId: 'sched-1', fetchJson });

    await expect(poll.poll(0)).rejects.toMatchObject({ status: 404 });
  });

  it('treats HTTP 410 STUDENT_WS_RETIRED as terminal (no retry storm)', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      status: 410,
      json: { code: 'STUDENT_WS_RETIRED', details: { use: 'runtime-poll' } },
    });
    const poll = createStudentRuntimePoll({ scheduleId: 'sched-1', fetchJson });
    await expect(poll.poll(0)).rejects.toMatchObject({ terminal: true });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('honors pollAfterSecs from the server view (adaptive cadence)', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      status: 200,
      json: { revision: 8, status: 'live', activeSection: 'reading', pollAfterSecs: 2 },
    });
    const poll = createStudentRuntimePoll({ scheduleId: 'sched-1', fetchJson });
    const view = await poll.poll(7);
    expect(view.pollAfterSecs).toBe(2);
  });
});
