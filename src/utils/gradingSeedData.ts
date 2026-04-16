/**
 * Seed Data for Grading Workflow
 * 
 * This file provides mock data to populate the grading repository for testing.
 * Call seedGradingData() to populate the repository with sample sessions and submissions.
 */

import { gradingRepository } from '../services/gradingRepository';
import { gradingService } from '../services/gradingService';
import { examRepository } from '../services/examRepository';
import { ExamSchedule } from '../types/domain';
import { logger } from './logger';

const MOCK_SCHEDULE_ID = 'sched-mock-1';
const MOCK_STUDENT_ID = 'STU-MOCK-001';

/**
 * Seed the grading repository with mock data
 */
export async function seedGradingData() {
  logger.info('Seeding grading data...');

  // First, ensure we have exam schedules to build sessions from
  let schedules = await examRepository.getAllSchedules();
  
  if (schedules.length === 0) {
    logger.info('No schedules found. Creating a mock schedule...');
    await createMockSchedule();
    // Reload schedules after creating
    schedules = await examRepository.getAllSchedules();
  }

  const targetSchedule = schedules.find(schedule => schedule.id === MOCK_SCHEDULE_ID) || schedules[0];
  if (!targetSchedule) {
    throw new Error('Unable to determine a schedule for grading seed data');
  }

  // Build grading sessions from schedules
  const sessionResult = await gradingService.buildGradingSessions();
  if (sessionResult.success && sessionResult.data) {
    logger.info(`Created ${sessionResult.data.length} grading sessions`);
  } else {
    logger.error('Failed to build sessions:', sessionResult.error);
  }

  // Create mock student submission
  await createMockStudentSubmission(targetSchedule);

  logger.info('Grading data seeded successfully');
}

/**
 * Create a mock exam schedule
 */
async function createMockSchedule(): Promise<ExamSchedule> {
  const schedule: ExamSchedule = {
    id: MOCK_SCHEDULE_ID,
    examId: 'exam-1',
    examTitle: 'Academic Practice Test 1',
    publishedVersionId: 'ver-mock-1',
    cohortName: 'Elite 2025-A',
    institution: 'IELTS Excellence Center',
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    endTime: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // 1 hour from now
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    status: 'live' as const,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    createdBy: 'Admin',
    updatedAt: new Date().toISOString(),
    autoStart: true,
    autoStop: true
  };

  await examRepository.saveSchedule(schedule);
  logger.info('Created mock schedule:', schedule.id);
  return schedule;
}

/**
 * Create a mock student submission with section data
 */
async function createMockStudentSubmission(schedule: ExamSchedule) {
  const studentId = MOCK_STUDENT_ID;
  const studentName = 'Wei Zhang';
  const studentEmail = 'wei.zhang@email.com';
  const existingSubmissions = await gradingRepository.getSubmissionsByStudent(studentId);
  const existingSubmission = existingSubmissions.find(submission => submission.scheduleId === schedule.id);

  if (existingSubmission) {
    logger.info('Mock student submission already exists:', existingSubmission.id);
    return;
  }

  const result = await gradingService.createStudentSubmission(
    schedule.id,
    schedule.examId,
    schedule.publishedVersionId,
    studentId,
    studentName,
    studentEmail,
    schedule.cohortName,
    {
      listening: {
        type: 'listening',
        parts: [
          {
            partId: 'l1',
            questions: [
              {
                questionId: 'q1',
                studentAnswer: 'A',
                correctAnswer: 'A',
                isCorrect: true,
                score: 1,
                maxScore: 1,
                scoringRule: 'exact_match'
              },
              {
                questionId: 'q2',
                studentAnswer: 'B',
                correctAnswer: 'C',
                isCorrect: false,
                score: 0,
                maxScore: 1,
                scoringRule: 'exact_match'
              }
            ]
          }
        ]
      },
      reading: {
        type: 'reading',
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
              },
              {
                questionId: 'rq2',
                studentAnswer: 'FALSE',
                correctAnswer: 'FALSE',
                isCorrect: true,
                score: 1,
                maxScore: 1,
                scoringRule: 'exact_match'
              },
              {
                questionId: 'rq3',
                studentAnswer: 'NOT GIVEN',
                correctAnswer: 'TRUE',
                isCorrect: false,
                score: 0,
                maxScore: 1,
                scoringRule: 'exact_match'
              }
            ]
          }
        ]
      },
      writing: {
        type: 'writing',
        tasks: [
          {
            taskId: 'task1',
            taskLabel: 'Task 1',
            text: `The chart illustrates the number of visitors to three museums in London between 2000 and 2020. Overall, the British Museum saw the highest number of visitors throughout the period, while the National Gallery experienced a significant decline in recent years.

In 2000, the British Museum attracted approximately 5 million visitors, which was the highest among the three museums. This number gradually increased to around 6 million by 2010, before reaching a peak of 7 million in 2015. The Tate Modern started with 3 million visitors in 2000 and showed steady growth, reaching 5 million by 2020.

The National Gallery had 4 million visitors in 2000, similar to the Tate Modern. However, unlike the other two museums which showed growth, the National Gallery experienced a gradual decline. By 2010, visitor numbers had dropped to 3.5 million, and by 2020, they had fallen further to just 2.5 million.

It is worth noting that all three museums saw a significant drop in 2020, likely due to the COVID-19 pandemic and associated lockdowns. Despite this, the British Museum maintained its position as the most popular museum, while the Tate Modern overtook the National Gallery to become the second most visited.`,
            wordCount: 178,
            prompt: 'The chart below shows the number of visitors to three museums in London between 2000 and 2020.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.'
          },
          {
            taskId: 'task2',
            taskLabel: 'Task 2',
            text: `The question of whether universities should prioritize practical skills for the workplace or provide access to knowledge for its own sake is a complex one. In my opinion, while practical skills are undoubtedly important, universities should maintain a balance between both approaches.

On one hand, there are compelling arguments for focusing on workplace skills. In today's competitive job market, graduates need specific technical abilities and soft skills such as communication, teamwork, and problem-solving. Universities that align their curricula with industry needs can help ensure their graduates are employable and can contribute effectively to the economy. Furthermore, the rising cost of higher education means that many students expect a tangible return on their investment in the form of better career prospects.

On the other hand, the pursuit of knowledge for its own sake has immense value. University education has traditionally been about developing critical thinking, intellectual curiosity, and a broad understanding of the world. These qualities are essential for personal growth and for creating informed citizens who can participate meaningfully in democratic society. Moreover, many of the most important innovations and discoveries have come from pure research driven by curiosity rather than immediate practical applications.

In conclusion, I believe universities should not have to choose between these two approaches. The ideal university education combines practical skills development with the pursuit of knowledge. Students should be equipped with the tools they need to succeed in their careers while also being encouraged to think deeply and broadly about the world around them.`,
            wordCount: 236,
            prompt: 'Some people believe that universities should focus on providing skills for the workplace. Others think the main function of a university should be to give access to knowledge for its own sake.\n\nDiscuss both views and give your own opinion.'
          }
        ]
      },
      speaking: {
        type: 'speaking',
        part1Answers: ['I work as a software engineer', 'I live in a small apartment in the city center'],
        part2Recording: 'mock-audio-url.mp3',
        part2Transcript: 'I would like to talk about my laptop, which is very important to me. I got it about three years ago when I started university. I use it every day for my studies, for programming, and for staying in touch with my family.',
        part3Answers: ['I think people value material possessions because they provide comfort and status', 'Consumerism has definitely changed in recent years with the rise of online shopping']
      }
    }
  );

  if (result.success) {
    logger.info('Created mock student submission:', result.data?.id);
  } else {
    logger.error('Failed to create mock submission:', result.error);
  }
}

/**
 * Clear all grading data (useful for testing)
 */
export async function clearGradingData() {
  logger.info('Clearing grading data...');
  
  // Clear all repositories through the repository layer
  await gradingRepository.clearAll();
  
  logger.info('Grading data cleared');
}
