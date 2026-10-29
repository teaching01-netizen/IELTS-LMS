import { peekClientSessionIdForStudentKey, restoreClientSessionIdForStudentKey, satWriterStudentKey } from '@services/studentAttemptRepository';
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

  it('preserves an ownership refusal for the route to block the old device', async () => {
    const poll = createStudentRuntimePoll({
      scheduleId: 'sched-1',
      fetchJson: vi.fn().mockResolvedValue({
        status: 409,
        json: { success: false, error: { code: 'SESSION_ALREADY_ACTIVE', message: 'Active on another device.' } },
      }),
    });
    await expect(poll.poll(7)).rejects.toMatchObject({ code: 'SESSION_ALREADY_ACTIVE', status: 409 });
  });

  it('presents the current browser identity on every poll without minting one', async () => {
    const scheduleId = 'transfer-poll-schedule';
    const candidateId = 'W123';
    const studentKey = satWriterStudentKey(scheduleId, candidateId);
    const fetchJson = vi.fn().mockResolvedValue({ status: 304, json: null });
    const poll = createStudentRuntimePoll({ scheduleId, candidateId, fetchJson });
    await poll.poll(9);
    expect(peekClientSessionIdForStudentKey(scheduleId, studentKey)).toBeNull();
    expect(fetchJson).toHaveBeenLastCalledWith(expect.stringContaining('candidateId=W123'));
    restoreClientSessionIdForStudentKey(scheduleId, studentKey, 'browser-old');
    await poll.poll(9);
    expect(fetchJson).toHaveBeenLastCalledWith(expect.stringContaining('clientSessionId=browser-old'));
    restoreClientSessionIdForStudentKey(scheduleId, studentKey, 'browser-new');
    await poll.poll(9);
    expect(fetchJson).toHaveBeenLastCalledWith(expect.stringContaining('clientSessionId=browser-new'));
    localStorage.clear();
    sessionStorage.clear();
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
