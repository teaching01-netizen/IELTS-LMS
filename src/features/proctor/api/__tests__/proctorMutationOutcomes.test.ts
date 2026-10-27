import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberAttemptSchedule } from '@services/backendBridge';
import { examDeliveryService } from '@services/examDeliveryService';
import { proctorMutations } from '../proctorMutations';

const originalFetch = global.fetch;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('proctor command outcome through the delivery service', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('treats a lost student-command response as uncertain and sends it only once', async () => {
    rememberAttemptSchedule('attempt-outcome-1', 'sched-1');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Connection lost'));
    global.fetch = fetchMock as typeof fetch;

    const outcome = await proctorMutations.warnStudent('attempt-outcome-1', 'Warning', 'Proctor');

    expect(outcome.kind).toBe('uncertain');
    expect(outcome).toMatchObject({ error: expect.stringContaining('may have been applied') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an explicit HTTP 200 business rejection as rejected', async () => {
    rememberAttemptSchedule('attempt-outcome-2', 'sched-1');
    global.fetch = vi.fn().mockResolvedValue(json({ success: false, error: { code: 'REJECTED', message: 'No permission' } })) as typeof fetch;

    const outcome = await proctorMutations.warnStudent('attempt-outcome-2', 'Warning', 'Proctor');

    expect(outcome).toEqual({ kind: 'rejected', error: 'No permission' });
  });

  it('reports a confirmed completion separately when its subsequent runtime read fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ success: true, data: { ok: true } }));
    global.fetch = fetchMock as typeof fetch;
    vi.spyOn(examDeliveryService, 'getRuntimeSnapshot').mockResolvedValue(null);

    const outcome = await proctorMutations.completeRuntime('sched-1', 'Proctor');

    expect(outcome.kind).toBe('confirmed_refresh_failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps recovery fences and resolution identity when the response is lost', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Connection lost'));
    global.fetch = fetchMock as typeof fetch;
    const outcome = await proctorMutations.resolveRecovery({
      scheduleId: 'sched-1', attemptId: 'attempt-1', resolutionId: 'resolution-1',
      moduleAttemptId: 'module-attempt-1', expectedBoundaryRevision: 4,
      action: 'activate_entry', reason: 'Device was checked.',
    });

    expect(outcome.kind).toBe('uncertain');
    expect(outcome).toMatchObject({ error: expect.stringContaining('may have been applied') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/proctor/sessions/sched-1/attempts/attempt-1/recovery/resolve');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      resolutionId: 'resolution-1', moduleAttemptId: 'module-attempt-1', expectedBoundaryRevision: 4,
      action: 'activate_entry', reason: 'Device was checked.',
    });
  });
});
