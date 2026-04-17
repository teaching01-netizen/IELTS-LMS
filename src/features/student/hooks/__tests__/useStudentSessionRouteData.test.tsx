import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { examRepository } from '../../../../services/examRepository';
import { studentAttemptRepository } from '../../../../services/studentAttemptRepository';
import type { ExamEntity, ExamSchedule, ExamVersion } from '../../../../types/domain';
import { SCHEMA_VERSION } from '../../../../types/domain';
import { useStudentSessionRouteData } from '../useStudentSessionRouteData';

function createSeedData() {
  const examId = 'exam-1';
  const versionId = 'ver-1';
  const scheduleId = 'sched-1';
  const createdAt = '2026-01-01T00:00:00.000Z';
  const config = createDefaultConfig('Academic', 'Academic');

  const exam: ExamEntity = {
    id: examId,
    slug: 'mock-ielts-exam',
    title: 'Mock IELTS Exam',
    type: 'Academic',
    status: 'published',
    visibility: 'organization',
    owner: 'Author',
    createdAt,
    updatedAt: createdAt,
    currentDraftVersionId: null,
    currentPublishedVersionId: versionId,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: SCHEMA_VERSION,
  };

  const version: ExamVersion = {
    id: versionId,
    examId,
    versionNumber: 1,
    parentVersionId: null,
    contentSnapshot: {
      title: 'Mock IELTS Exam',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'p1',
      activeListeningPartId: 'l1',
      config,
      reading: { passages: [] },
      listening: { parts: [] },
      writing: {
        task1Prompt: 'Task 1',
        task2Prompt: 'Task 2',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    },
    configSnapshot: config,
    createdBy: 'Author',
    createdAt,
    isDraft: false,
    isPublished: true,
  };

  const schedule: ExamSchedule = {
    id: scheduleId,
    examId,
    examTitle: 'Mock IELTS Exam',
    publishedVersionId: versionId,
    cohortName: 'Cohort A',
    startTime: createdAt,
    endTime: '2026-01-01T03:00:00.000Z',
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    autoStart: false,
    autoStop: false,
    status: 'scheduled',
    createdAt,
    createdBy: 'Admin',
    updatedAt: createdAt,
  };

  return { exam, schedule, version };
}

describe('useStudentSessionRouteData', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();

    const { exam, schedule, version } = createSeedData();
    await examRepository.saveExam(exam);
    await examRepository.saveVersion(version);
    await examRepository.saveSchedule(schedule);
  });

  it('creates separate attempts for different candidates in the same cohort', async () => {
    const first = renderHook(() => useStudentSessionRouteData('sched-1', 'alice'));
    const second = renderHook(() => useStudentSessionRouteData('sched-1', 'bob'));

    await waitFor(() => {
      expect(first.result.current.attemptSnapshot).not.toBeNull();
      expect(second.result.current.attemptSnapshot).not.toBeNull();
    });

    expect(first.result.current.attemptSnapshot?.id).not.toBe(
      second.result.current.attemptSnapshot?.id,
    );
    expect(first.result.current.attemptSnapshot?.candidateId).toBe('alice');
    expect(second.result.current.attemptSnapshot?.candidateId).toBe('bob');

    const attempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    expect(attempts).toHaveLength(2);
  });

  it('reuses the same anonymous candidate identity across remounts', async () => {
    const first = renderHook(() => useStudentSessionRouteData('sched-1'));

    await waitFor(() => {
      expect(first.result.current.attemptSnapshot).not.toBeNull();
    });

    const firstAttemptId = first.result.current.attemptSnapshot?.id;
    const firstCandidateId = first.result.current.attemptSnapshot?.candidateId;

    first.unmount();

    const second = renderHook(() => useStudentSessionRouteData('sched-1'));

    await waitFor(() => {
      expect(second.result.current.attemptSnapshot).not.toBeNull();
    });

    expect(second.result.current.attemptSnapshot?.id).toBe(firstAttemptId);
    expect(second.result.current.attemptSnapshot?.candidateId).toBe(firstCandidateId);

    const attempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    expect(attempts).toHaveLength(1);
  });
});
