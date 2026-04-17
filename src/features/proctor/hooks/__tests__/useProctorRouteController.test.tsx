import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { examRepository } from '../../../../services/examRepository';
import { studentAttemptRepository } from '../../../../services/studentAttemptRepository';
import type { StudentHeartbeatEvent } from '../../../../types/studentAttempt';
import type { ExamEntity, ExamSchedule, ExamVersion } from '../../../../types/domain';
import { SCHEMA_VERSION } from '../../../../types/domain';
import { useProctorRouteController } from '../useProctorRouteController';

async function seedSchedule() {
  const config = createDefaultConfig('Academic', 'Academic');
  const exam: ExamEntity = {
    id: 'exam-1',
    slug: 'mock-ielts-exam',
    title: 'Mock IELTS Exam',
    type: 'Academic',
    status: 'published',
    visibility: 'organization',
    owner: 'Author',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    currentDraftVersionId: null,
    currentPublishedVersionId: 'ver-1',
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: SCHEMA_VERSION,
  };

  const version: ExamVersion = {
    id: 'ver-1',
    examId: 'exam-1',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    isDraft: false,
    isPublished: true,
  };

  const schedule: ExamSchedule = {
    id: 'sched-1',
    examId: 'exam-1',
    examTitle: 'Mock IELTS Exam',
    publishedVersionId: 'ver-1',
    cohortName: 'Cohort A',
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T03:00:00.000Z',
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    autoStart: false,
    autoStop: false,
    status: 'live',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'Admin',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  await examRepository.saveExam(exam);
  await examRepository.saveVersion(version);
  await examRepository.saveSchedule(schedule);

  return schedule;
}

describe('useProctorRouteController', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('hydrates real roster sessions and targeted alerts from persisted attempts', async () => {
    const schedule = await seedSchedule();
    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: schedule.id,
      studentKey: 'student-sched-1-alice',
      examId: schedule.examId,
      examTitle: schedule.examTitle,
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      currentModule: 'reading',
      phase: 'exam',
    });

    await studentAttemptRepository.saveAttempt({
      ...attempt,
      violations: [
        {
          id: 'warning-1',
          type: 'PROCTOR_WARNING',
          severity: 'medium',
          timestamp: '2026-01-01T00:01:00.000Z',
          description: 'Please keep your eyes on the screen.',
        },
      ],
      proctorStatus: 'warned',
      lastWarningId: 'warning-1',
      updatedAt: '2026-01-01T00:01:00.000Z',
    });

    const heartbeatEvent: StudentHeartbeatEvent = {
      id: 'heartbeat-1',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: '2026-01-01T00:02:00.000Z',
      type: 'heartbeat',
    };
    await studentAttemptRepository.saveHeartbeatEvent(heartbeatEvent);

    await examRepository.saveAuditLog({
      id: 'audit-1',
      timestamp: '2026-01-01T00:03:00.000Z',
      actor: 'student-system',
      actionType: 'VIOLATION_DETECTED',
      targetStudentId: attempt.id,
      sessionId: schedule.id,
      payload: {
        message: 'Tab switch detected.',
        severity: 'high',
        violationType: 'TAB_SWITCH',
      },
    });

    const { result } = renderHook(() => useProctorRouteController());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.sessions).toHaveLength(1);
    });

    expect(result.current.sessions[0]).toMatchObject({
      id: attempt.id,
      studentId: 'alice',
      name: 'Alice Roe',
      email: 'alice@example.com',
      warnings: 1,
      status: 'warned',
    });
    expect(
      new Date(result.current.sessions[0]!.lastActivity).getTime(),
    ).toBeGreaterThanOrEqual(new Date('2026-01-01T00:03:00.000Z').getTime());

    expect(result.current.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: 'alice',
          studentName: 'Alice Roe',
          severity: 'high',
          message: 'Tab switch detected.',
        }),
      ]),
    );
  });
});
