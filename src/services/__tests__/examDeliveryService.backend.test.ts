import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExamDeliveryService } from '../examDeliveryService';
import { BackendExamRepository } from '../examRepository';

const originalFetch = global.fetch;

describe('ExamDeliveryService backend scheduling mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('starts a runtime through the backend runtime command endpoint', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_SCHEDULING', 'true');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'sched-1',
              examId: 'exam-1',
              examTitle: 'Mock Exam',
              proctorDisplayName: 'Mock Exam',
              gradingDisplayName: 'Mock Exam',
              publishedVersionId: 'ver-1',
              cohortName: 'Cohort A',
              institution: 'Center',
              startTime: '2026-01-01T09:00:00.000Z',
              endTime: '2026-01-01T12:00:00.000Z',
              plannedDurationMinutes: 180,
              deliveryMode: 'proctor_start',
              recurrenceType: 'none',
              recurrenceInterval: 1,
              autoStart: false,
              autoStop: false,
              status: 'scheduled',
              createdAt: '2026-01-01T00:00:00.000Z',
              createdBy: 'admin-1',
              updatedAt: '2026-01-01T00:00:00.000Z',
              revision: 0,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'runtime-1',
              scheduleId: 'sched-1',
              examId: 'exam-1',
              status: 'live',
              planSnapshot: [],
              actualStartAt: '2026-01-01T09:00:00.000Z',
              actualEndAt: null,
              activeSectionKey: 'listening',
              currentSectionKey: 'listening',
              currentSectionRemainingSeconds: 1800,
              waitingForNextSection: false,
              isOverrun: false,
              totalPausedSeconds: 0,
              createdAt: '2026-01-01T09:00:00.000Z',
              updatedAt: '2026-01-01T09:00:00.000Z',
              revision: 0,
              sections: [
                {
                  id: 'section-1',
                  runtimeId: 'runtime-1',
                  sectionKey: 'listening',
                  label: 'Listening',
                  sectionOrder: 1,
                  plannedDurationMinutes: 30,
                  gapAfterMinutes: 0,
                  status: 'live',
                  availableAt: '2026-01-01T09:00:00.000Z',
                  actualStartAt: '2026-01-01T09:00:00.000Z',
                  actualEndAt: null,
                  pausedAt: null,
                  accumulatedPausedSeconds: 0,
                  extensionMinutes: 0,
                  completionReason: null,
                  projectedStartAt: '2026-01-01T09:00:00.000Z',
                  projectedEndAt: '2026-01-01T09:30:00.000Z',
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    const service = new ExamDeliveryService(new BackendExamRepository());
    const result = await service.startRuntime('sched-1', 'Proctor');

    expect(result.success).toBe(true);
    expect(result.runtime?.status).toBe('live');
    expect(result.runtime?.examTitle).toBe('Mock Exam');
    expect(result.runtime?.cohortName).toBe('Cohort A');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/schedules/sched-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/schedules/sched-1/runtime/commands',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('completes a runtime from the compatibility ack and re-reads the authoritative runtime', async () => {
    const schedule = {
      id: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      proctorDisplayName: 'Mock Exam',
      gradingDisplayName: 'Mock Exam',
      publishedVersionId: 'ver-1',
      cohortName: 'Cohort A',
      institution: 'Center',
      startTime: '2026-01-01T09:00:00.000Z',
      endTime: '2026-01-01T12:00:00.000Z',
      plannedDurationMinutes: 180,
      deliveryMode: 'proctor_start',
      recurrenceType: 'none',
      recurrenceInterval: 1,
      autoStart: false,
      autoStop: false,
      status: 'live',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 1,
    };
    const completedRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      providerKey: 'act',
      status: 'completed',
      actualStartAt: '2026-01-01T09:00:00.000Z',
      actualEndAt: '2026-01-01T10:00:00.000Z',
      activeSectionKey: null,
      currentSectionKey: null,
      currentSectionRemainingSeconds: 0,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      createdAt: '2026-01-01T09:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
      revision: 2,
      sections: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { ok: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: schedule }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: completedRuntime }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const service = new ExamDeliveryService(new BackendExamRepository());
    const result = await service.completeRuntime('sched-1', 'Proctor');

    expect(result).toMatchObject({ success: true, runtime: { status: 'completed' } });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/proctor/sessions/sched-1/control/complete-exam',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/schedules/sched-1/runtime',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
