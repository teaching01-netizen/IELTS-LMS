import { afterEach, describe, expect, it, vi } from 'vitest';
import { examRepository } from '../examRepository';

const jsonResponse = (data: unknown) =>
  new Response(
    JSON.stringify({
      success: true,
      data,
      metadata: { requestId: 'req-test', timestamp: '2026-01-01T00:00:00.000Z' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const versionPayload = (id: string) => ({
  id,
  examId: 'exam-1',
  versionNumber: 1,
  parentVersionId: null,
  contentSnapshot: { title: `Version ${id}` },
  configSnapshot: { general: { title: `Version ${id}` } },
  createdBy: 'owner-1',
  createdAt: '2026-01-01T00:00:01.000Z',
  isDraft: true,
  isPublished: false,
});

const schedulePayload = (id: string) => ({
  id,
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
  revision: 1,
});

describe('examRepository payload caches', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    examRepository.clearScheduleCache();
  });

  it('serves repeated version lookups from the payload cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(versionPayload('cache-ver-1')));
    global.fetch = fetchMock as typeof fetch;

    const first = await examRepository.getVersionById('cache-ver-1');
    const second = await examRepository.getVersionById('cache-ver-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('does not mix cached contents across distinct version ids', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(versionPayload('cache-ver-a')))
      .mockResolvedValueOnce(jsonResponse(versionPayload('cache-ver-b')));
    global.fetch = fetchMock as typeof fetch;

    const first = await examRepository.getVersionById('cache-ver-a');
    const second = await examRepository.getVersionById('cache-ver-b');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first?.id).toBe('cache-ver-a');
    expect(second?.id).toBe('cache-ver-b');
  });

  it('caches the full schedule list for repeated reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([schedulePayload('cache-sched-1')]));
    global.fetch = fetchMock as typeof fetch;

    await examRepository.getAllSchedules();
    const second = await examRepository.getAllSchedules();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual([expect.objectContaining({ id: 'cache-sched-1' })]);
  });

  it('invalidates the schedule cache after saving a schedule', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(schedulePayload('cache-sched-new')))
      .mockResolvedValueOnce(jsonResponse([schedulePayload('cache-sched-new')]));
    global.fetch = fetchMock as typeof fetch;

    await examRepository.getAllSchedules();
    await examRepository.saveSchedule({
      id: 'cache-sched-new',
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
      autoStart: false,
      autoStop: false,
      status: 'scheduled',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const afterSave = await examRepository.getAllSchedules();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(afterSave).toEqual([expect.objectContaining({ id: 'cache-sched-new' })]);
  });

  it('invalidates the schedule cache after deleting a schedule', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([schedulePayload('cache-sched-gone')]))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: null }))
      .mockResolvedValueOnce(jsonResponse([]));
    global.fetch = fetchMock as typeof fetch;

    await examRepository.getAllSchedules();
    await examRepository.deleteSchedule('cache-sched-gone');
    const afterDelete = await examRepository.getAllSchedules();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(afterDelete).toEqual([]);
  });
});