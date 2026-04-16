import { beforeEach, describe, expect, it } from 'vitest';
import { gradingService } from '../gradingService';
import { gradingRepository } from '../gradingRepository';
import { examRepository } from '../examRepository';
import { seedGradingData } from '../../utils/gradingSeedData';
import { ExamSchedule } from '../../types/domain';

const createSchedule = (id = 'sched-existing-1'): ExamSchedule => {
  const now = new Date().toISOString();

  return {
    id,
    examId: 'exam-1',
    examTitle: 'Academic Practice Test 1',
    publishedVersionId: 'ver-1',
    cohortName: 'Elite 2025-A',
    institution: 'IELTS Excellence Center',
    startTime: now,
    endTime: now,
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    status: 'live',
    createdAt: now,
    createdBy: 'Test Runner',
    updatedAt: now,
    autoStart: true,
    autoStop: true
  };
};

const sectionAnswers = {
  listening: {
    type: 'listening' as const,
    parts: [
      {
        partId: 'l1',
        questions: [
          {
            questionId: 'lq1',
            studentAnswer: 'A',
            correctAnswer: 'A',
            isCorrect: true,
            score: 1,
            maxScore: 1,
            scoringRule: 'exact_match'
          }
        ]
      }
    ]
  },
  reading: {
    type: 'reading' as const,
    passages: [
      {
        passageId: 'p1',
        questions: [
          {
            questionId: 'rq1',
            studentAnswer: 'TRUE',
            correctAnswer: 'TRUE',
            isCorrect: true,
            score: 1,
            maxScore: 1,
            scoringRule: 'exact_match'
          }
        ]
      }
    ]
  },
  writing: {
    type: 'writing' as const,
    tasks: [
      {
        taskId: 'task1',
        taskLabel: 'Task 1',
        text: 'Task 1 response',
        wordCount: 3,
        prompt: 'Summarise the chart.'
      },
      {
        taskId: 'task2',
        taskLabel: 'Task 2',
        text: 'Task 2 response',
        wordCount: 3,
        prompt: 'Discuss both views.'
      }
    ]
  },
  speaking: {
    type: 'speaking' as const,
    part1Answers: ['Sample answer']
  }
};

describe('GradingService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('links session rows by scheduleId and answer payloads by submission id', async () => {
    const schedule = createSchedule();
    await examRepository.saveSchedule(schedule);
    await gradingService.buildGradingSessions();

    const result = await gradingService.createStudentSubmission(
      schedule.id,
      schedule.examId,
      schedule.publishedVersionId,
      'STU-001',
      'Alice Example',
      'alice@example.com',
      schedule.cohortName,
      sectionAnswers
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const submission = result.data!;
    const sessionSubmissions = await gradingService.getSessionStudentSubmissions(schedule.id);
    expect(sessionSubmissions.success).toBe(true);
    expect(sessionSubmissions.data).toHaveLength(1);
    expect(sessionSubmissions.data?.[0].id).toBe(submission.id);

    const sectionSubmissions = await gradingRepository.getSectionSubmissionsBySubmissionId(submission.id);
    expect(sectionSubmissions).toHaveLength(4);
    expect(sectionSubmissions.map(section => section.section).sort()).toEqual([
      'listening',
      'reading',
      'speaking',
      'writing'
    ]);

    const writingSubmissions = (await gradingRepository.getAllWritingSubmissions()).filter(
      writing => writing.submissionId === submission.id
    );
    expect(writingSubmissions).toHaveLength(2);
  });

  it('seeds against an existing schedule without duplicating the mock student', async () => {
    const schedule = createSchedule('sched-seeded-1');
    await examRepository.saveSchedule(schedule);

    await seedGradingData();
    await seedGradingData();

    const sessions = await gradingRepository.getAllSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(schedule.id);

    const seededSubmissions = await gradingService.getSessionStudentSubmissions(schedule.id);
    expect(seededSubmissions.success).toBe(true);
    expect(seededSubmissions.data).toHaveLength(1);
    expect(seededSubmissions.data?.[0].studentId).toBe('STU-MOCK-001');

    const seededSections = await gradingRepository.getSectionSubmissionsBySubmissionId(
      seededSubmissions.data![0].id
    );
    expect(seededSections).toHaveLength(4);

    const seededWriting = (await gradingRepository.getAllWritingSubmissions()).filter(
      writing => writing.submissionId === seededSubmissions.data![0].id
    );
    expect(seededWriting).toHaveLength(2);
  });
});
