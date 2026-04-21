import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveStudentAuditEvent } from '../studentAuditService';

describe('studentAuditService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    window.sessionStorage.clear();
  });

  it('posts audit logs to the backend with attempt auth', async () => {
    window.sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          attemptToken: 'token-1',
          expiresAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: null,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await saveStudentAuditEvent(
      'sched-1',
      'VIOLATION_DETECTED',
      { violationType: 'TAB_SWITCH', severity: 'critical', message: 'Tab switch.' },
      'attempt-1',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/student/sessions/sched-1/audit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
        }),
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((requestInit as RequestInit).body));
    expect(body).toEqual(
      expect.objectContaining({
        actionType: 'VIOLATION_DETECTED',
        clientTimestamp: expect.any(String),
        payload: expect.objectContaining({
          event: 'VIOLATION_DETECTED',
          violationType: 'TAB_SWITCH',
          severity: 'critical',
          message: 'Tab switch.',
        }),
      }),
    );
  });
});

