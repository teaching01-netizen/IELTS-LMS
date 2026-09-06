import { describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../app/api/apiClient', () => ({
  get,
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

import {
  backendGet,
  hasBackendStatusCode,
  mapBackendExamEntity,
  mapBackendExamEvent,
  mapBackendRuntime,
  mapBackendSchedule,
} from '../backendBridge';
import { ApiError } from '../../shared/api-client/errors';

describe('backendBridge contract mappings', () => {
  it('maps backend exam entity field renames and permissions', () => {
    const mapped = mapBackendExamEntity({
      id: 'exam-1',
      slug: 'slug-1',
      title: 'Exam',
      examType: 'Academic',
      status: 'draft',
      visibility: 'organization',
      ownerId: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
      canEdit: true,
      canPublish: false,
      canDelete: false,
      revision: 1,
    });

    expect(mapped.type).toBe('Academic');
    expect(mapped.owner).toBe('owner-1');
    expect(mapped.canEdit).toBe(true);
    expect(mapped.canPublish).toBe(false);
    expect(mapped.canDelete).toBe(false);
  });

  it('maps exam event actor and timestamp fields', () => {
    const mapped = mapBackendExamEvent({
      id: 'evt-1',
      examId: 'exam-1',
      versionId: 'ver-1',
      actorId: 'teacher-1',
      action: 'draft_saved',
      createdAt: '2026-01-03T00:00:00.000Z',
    });

    expect(mapped.actor).toBe('teacher-1');
    expect(mapped.timestamp).toBe('2026-01-03T00:00:00.000Z');
  });

  it('maps recurrence fields from flat backend payload into nested schedule recurrence', () => {
    const mapped = mapBackendSchedule({
      id: 'sched-1',
      examId: 'exam-1',
      providerKey: 'sat',
      examTitle: 'Exam',
      publishedVersionId: 'ver-1',
      cohortName: 'Cohort A',
      startTime: '2026-01-01T09:00:00.000Z',
      endTime: '2026-01-01T12:00:00.000Z',
      plannedDurationMinutes: 180,
      deliveryMode: 'proctor_start',
      recurrenceType: 'weekly',
      recurrenceInterval: 2,
      recurrenceEndDate: '2026-03-01T00:00:00.000Z',
      autoStart: false,
      autoStop: false,
      status: 'scheduled',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 3,
    });

    expect(mapped.providerKey).toBe('sat');
    expect(mapped.recurrence).toEqual({
      type: 'weekly',
      interval: 2,
      endDate: '2026-03-01T00:00:00.000Z',
    });
  });

  it('maps runtime sectionOrder to section order', () => {
    const mapped = mapBackendRuntime(
      {
        id: 'runtime-1',
        scheduleId: 'sched-1',
        examId: 'exam-1',
        providerKey: 'sat',
        status: 'live',
        currentSectionRemainingSeconds: 1800,
        waitingForNextSection: false,
        isOverrun: false,
        totalPausedSeconds: 0,
        createdAt: '2026-01-01T09:00:00.000Z',
        updatedAt: '2026-01-01T09:10:00.000Z',
        sections: [
          {
            sectionKey: 'reading',
            label: 'Reading',
            sectionOrder: 2,
            plannedDurationMinutes: 60,
            gapAfterMinutes: 10,
            status: 'live',
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
        ],
      },
      {
        providerKey: 'sat',
        examTitle: 'Exam',
        cohortName: 'Cohort A',
        deliveryMode: 'proctor_start',
      },
    );

    expect(mapped.providerKey).toBe('sat');
    expect(mapped.sections[0]?.order).toBe(2);
  });

  it('throws when backend envelope is successful but missing data', async () => {
    get.mockResolvedValueOnce({ data: { success: true } });
    await expect(backendGet('/v1/example')).rejects.toThrow('missing data payload');
  });

  it('throws ApiError when the backend envelope reports failure', async () => {
    get.mockResolvedValueOnce({
      data: { success: false, error: { code: 'CONFLICT', message: 'Conflict' } },
    });
    const failure = await backendGet('/v1/example').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: 'CONFLICT', message: 'Conflict' });
  });

  it('hasBackendStatusCode matches ApiError by status', () => {
    const error = new ApiError({ code: 'NOT_FOUND', message: 'missing', status: 404 });
    expect(hasBackendStatusCode(error, 404)).toBe(true);
    expect(hasBackendStatusCode(error, 409)).toBe(false);
  });
});
