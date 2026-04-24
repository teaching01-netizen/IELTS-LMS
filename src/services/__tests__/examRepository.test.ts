import { afterEach, describe, expect, it, vi } from 'vitest';
import { examRepository } from '../examRepository';
import { rememberScheduleRevision } from '../backendBridge';

describe('examRepository backend API', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('loads exams from the backend API', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: '11111111-1111-1111-1111-111111111111',
              slug: 'mock-exam',
              title: 'Mock Exam',
              examType: 'Academic',
              status: 'draft',
              visibility: 'organization',
              ownerId: 'owner-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              currentDraftVersionId: null,
              currentPublishedVersionId: null,
              schemaVersion: 3,
              revision: 4,
            },
          ],
          metadata: {
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    const exams = await examRepository.getAllExams();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/exams',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(exams).toEqual([
      expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        type: 'Academic',
        owner: 'owner-1',
        canEdit: true,
        canPublish: true,
        canDelete: true,
      }),
    ]);
  });

  it('creates schedules through the backend API', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_SCHEDULING', 'true');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: '22222222-2222-2222-2222-222222222222',
            examId: 'exam-1',
            examTitle: 'Mock Exam',
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
            revision: 1,
          },
          metadata: {
            requestId: 'req-2',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await examRepository.saveSchedule({
      id: 'sched-local',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      publishedVersionId: 'ver-1',
      cohortName: 'Cohort A',
      institution: 'Center',
      startTime: '2026-01-01T09:00:00.000Z',
      endTime: '2026-01-01T12:00:00.000Z',
      plannedDurationMinutes: 180,
      deliveryMode: 'proctor_start',
      autoStart: false,
      autoStop: false,
      status: 'scheduled',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'Admin',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/schedules',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({
        examId: 'exam-1',
        cohortName: 'Cohort A',
        publishedVersionId: 'ver-1',
      }),
    );
  });

  it('updates schedules with publishedVersionId through the backend API', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_SCHEDULING', 'true');
    rememberScheduleRevision('sched-local', 2);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'sched-local',
            examId: 'exam-1',
            examTitle: 'Mock Exam',
            publishedVersionId: 'ver-2',
            cohortName: 'Cohort A (Updated)',
            institution: 'Center',
            startTime: '2026-01-02T09:00:00.000Z',
            endTime: '2026-01-02T12:00:00.000Z',
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
            revision: 3,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await examRepository.saveSchedule({
      id: 'sched-local',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      publishedVersionId: 'ver-2',
      cohortName: 'Cohort A (Updated)',
      institution: 'Center',
      startTime: '2026-01-02T09:00:00.000Z',
      endTime: '2026-01-02T12:00:00.000Z',
      plannedDurationMinutes: 180,
      deliveryMode: 'proctor_start',
      autoStart: false,
      autoStop: false,
      status: 'scheduled',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'Admin',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/schedules/sched-local',
      expect.objectContaining({
        method: 'PATCH',
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({
        publishedVersionId: 'ver-2',
        cohortName: 'Cohort A (Updated)',
        revision: 2,
      }),
    );
  });

  it('surfaces backend API failures instead of silently returning null', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'builder unavailable' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch;

    await expect(examRepository.getExamById('missing')).rejects.toThrow('builder unavailable');
  });
});
