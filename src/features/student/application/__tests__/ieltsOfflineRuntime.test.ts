import { describe, expect, it } from 'vitest';
import type { ExamSessionRuntime } from '../../../../types/domain';
import { estimateIeltsServerNow, newestIeltsSchedule, projectIeltsSharedRuntime } from '../ieltsOfflineRuntime';
import type { IeltsSharedSchedule } from '../../domain/exam-session/ieltsSharedSchedule';

const T = (iso: string) => Date.parse(iso);
const schedule: IeltsSharedSchedule = {
  schemaVersion: 1,
  scheduleRevision: 2,
  status: 'active',
  windows: [
    { sectionKey: 'reading', order: 0, startAt: '2026-10-30T10:00:00Z', deadlineAt: '2026-10-30T11:00:00Z', saveUntil: '2026-10-30T11:00:03Z' },
    { sectionKey: 'writing', order: 1, startAt: '2026-10-30T11:00:03Z', deadlineAt: '2026-10-30T12:00:03Z', saveUntil: '2026-10-30T12:00:06Z' },
  ],
};
const section = (sectionKey: string, status: string) => ({
  sectionKey, label: sectionKey, order: 0, plannedDurationMinutes: 60, gapAfterMinutes: 0, status,
  availableAt: null, actualStartAt: status === 'live' ? '2026-10-30T10:00:00Z' : null, actualEndAt: null, pausedAt: null,
  accumulatedPausedSeconds: 0, extensionMinutes: 0, projectedStartAt: null, projectedEndAt: null,
});
const snapshot = {
  id: 'rt', scheduleId: 's', examId: 'e', providerKey: 'ielts', examTitle: 'x', cohortName: 'c', deliveryMode: 'proctor_start',
  status: 'live', timingModel: 'ielts_shared_schedule_v1', actualStartAt: null, actualEndAt: null,
  activeSectionKey: 'reading', currentSectionKey: 'reading', currentSectionRemainingSeconds: 2, currentSectionDeadlineAt: '2026-10-30T11:00:00Z',
  waitingForNextSection: false, isOverrun: false, totalPausedSeconds: 0, revision: 7, createdAt: '', updatedAt: '',
  sections: [section('reading', 'live'), section('writing', 'locked')],
} as unknown as ExamSessionRuntime;

describe('IELTS anchored clock', () => {
  const anchor = { serverNowMs: T('2026-10-30T10:59:58Z'), receivedWallMs: 1_000, monotonicAtReceiptMs: 50, lastEstimatedServerNowMs: 0 };

  it('advances with monotonic time and never awards a backward wall clock', () => {
    expect(estimateIeltsServerNow(anchor, 6_000, 5_050)).toEqual({ serverNowMs: T('2026-10-30T11:00:03Z'), confidence: 'verified' });
    const back = estimateIeltsServerNow(anchor, -60_000, 5_050);
    expect(back.serverNowMs).toBe(T('2026-10-30T11:00:03Z'));
    expect(back.confidence).toBe('uncertain');
  });

  it('counts OS sleep (wall ahead of monotonic) instead of granting it', () => {
    const slept = estimateIeltsServerNow(anchor, 601_000, 1_050);
    expect(slept.serverNowMs).toBe(T('2026-10-30T11:09:58Z'));
    expect(slept.confidence).toBe('uncertain');
  });

  it('is provisional after a restart and never moves backward', () => {
    const restarted = estimateIeltsServerNow({ ...anchor, monotonicAtReceiptMs: null, lastEstimatedServerNowMs: T('2026-10-30T11:05:00Z') }, 2_000, null);
    expect(restarted).toEqual({ serverNowMs: T('2026-10-30T11:05:00Z'), confidence: 'provisional' });
  });
});

describe('projectIeltsSharedRuntime', () => {
  const at = (iso: string) => ({ serverNowMs: T(iso), confidence: 'verified' as const });

  it('opens the next section at the committed instant without a server read', () => {
    const projected = projectIeltsSharedRuntime(snapshot, schedule, at('2026-10-30T11:00:03Z'));
    expect(projected.currentSectionKey).toBe('writing');
    expect(projected.currentSectionDeadlineAt).toBe('2026-10-30T12:00:03Z');
    expect(projected.sections.map((s) => s.status)).toEqual(['completed', 'live']);
    expect(projected.revision).toBe(7);
    expect(projected.ieltsLocalProjection.editableSectionKey).toBe('writing');
  });

  it('stops editing in the save-only drain', () => {
    const projected = projectIeltsSharedRuntime(snapshot, schedule, at('2026-10-30T11:00:01Z'));
    expect(projected.ieltsLocalProjection).toMatchObject({ positionKind: 'save_only', editableSectionKey: null });
  });

  it('restarts with the remaining time, never a fresh duration', () => {
    const projected = projectIeltsSharedRuntime(snapshot, schedule, at('2026-10-30T11:05:03Z'));
    expect(projected.currentSectionRemainingSeconds).toBe(55 * 60);
  });

  it('lets a known terminal state outrank the cached timetable', () => {
    const projected = projectIeltsSharedRuntime({ ...snapshot, status: 'completed' }, schedule, at('2026-10-30T11:30:00Z'));
    expect(projected.status).toBe('completed');
    expect(projected.ieltsLocalProjection.editableSectionKey).toBeNull();
  });

  it('completes locally after the last drain', () => {
    expect(projectIeltsSharedRuntime(snapshot, schedule, at('2026-10-30T12:00:06Z')).status).toBe('completed');
  });

  it('never lets an older revision replace a newer timetable', () => {
    expect(newestIeltsSchedule({ ...schedule, scheduleRevision: 1 }, schedule)?.scheduleRevision).toBe(2);
    expect(newestIeltsSchedule(schedule, { ...schedule, scheduleRevision: 1 })?.scheduleRevision).toBe(2);
  });
});
