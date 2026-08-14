import type { ReactNode } from 'react';
import type { StoryObj } from '@storybook/react-vite';
import { gradingRepository } from '../../services/gradingRepository';
import { examRepository } from '../../services/examRepository';
import { gradingService } from '../../services/gradingService';
import { createInitialExamState } from '../../services/examAdapterService';
import type { SectionSubmission, StudentSubmission } from '../../types/grading';
import { ExamObjectiveOverviewPanel } from './ExamObjectiveOverviewPanel';

const examState = createInitialExamState('Academic Practice Test 1', 'Academic');
examState.reading.passages = [{
  id: 'passage-1',
  title: 'Passage 1',
  content: '',
  blocks: [{
    id: 'short-answer-block',
    type: 'SHORT_ANSWER',
    instruction: '',
    questions: [
      {
        id: 'reading-q17',
        prompt: 'Where is the college library located?',
        correctAnswer: 'GARDEN HALL',
        acceptedAnswers: ['GARDEN HALL'],
        answerRule: 'ONE_WORD',
      },
      {
        id: 'reading-q18',
        prompt: 'Where should visitors park?',
        correctAnswer: 'CAR PARK',
        acceptedAnswers: ['CAR PARK'],
        answerRule: 'TWO_WORDS',
      },
      {
        id: 'reading-q19',
        prompt: 'Which landmark is featured on the tour?',
        correctAnswer: 'Faces of China',
        acceptedAnswers: ['faces of china', 'FACES OF CHINA', 'Faces of China'],
        answerRule: 'ONE_WORD',
      },
    ],
  }],
}];

function makeReadingSection(
  submissionId: string,
  results: NonNullable<SectionSubmission['autoGradingResults']>['questionResults'],
): SectionSubmission {
  return {
    id: `section-reading-${submissionId}`,
    submissionId,
    section: 'reading',
    answers: { type: 'reading', passages: [] },
    autoGradingResults: {
      generatedAt: '2026-08-01T00:00:00.000Z',
      totalScore: 0,
      maxScore: 3,
      percentage: 0,
      questionResults: results,
    },
    gradingStatus: 'auto_graded',
    submittedAt: '2026-08-01T00:00:00.000Z',
  };
}

const submissions: StudentSubmission[] = [
  {
    id: 'submission-1',
    submissionId: 'submission-1',
    scheduleId: 'schedule-1',
    examId: 'exam-1',
    publishedVersionId: 'published-version-1',
    studentId: 'student-1',
    studentName: 'Wei Zhang',
    studentEmail: 'wei.zhang@email.com',
    cohortName: 'Elite 2026-A',
    submittedAt: '2026-08-01T00:00:00.000Z',
    gradingStatus: 'grading_complete',
    timeSpentSeconds: 6480,
    isFlagged: false,
    isOverdue: false,
    sectionStatuses: { reading: 'auto_graded', listening: 'auto_graded', writing: 'pending', speaking: 'pending' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'submission-2',
    submissionId: 'submission-2',
    scheduleId: 'schedule-1',
    examId: 'exam-1',
    publishedVersionId: 'published-version-1',
    studentId: 'student-2',
    studentName: 'Ananya Patel',
    studentEmail: 'ananya.patel@email.com',
    cohortName: 'Elite 2026-A',
    submittedAt: '2026-08-01T00:05:00.000Z',
    gradingStatus: 'grading_complete',
    timeSpentSeconds: 6120,
    isFlagged: false,
    isOverdue: false,
    sectionStatuses: { reading: 'auto_graded', listening: 'auto_graded', writing: 'pending', speaking: 'pending' },
    createdAt: '2026-08-01T00:05:00.000Z',
    updatedAt: '2026-08-01T00:05:00.000Z',
  },
  {
    id: 'submission-3',
    submissionId: 'submission-3',
    scheduleId: 'schedule-1',
    examId: 'exam-1',
    publishedVersionId: 'published-version-1',
    studentId: 'student-3',
    studentName: 'Sofia Rossi',
    studentEmail: 'sofia.rossi@email.com',
    cohortName: 'Elite 2026-A',
    submittedAt: '2026-08-01T00:12:00.000Z',
    gradingStatus: 'grading_complete',
    timeSpentSeconds: 5940,
    isFlagged: false,
    isOverdue: false,
    sectionStatuses: { reading: 'auto_graded', listening: 'auto_graded', writing: 'pending', speaking: 'pending' },
    createdAt: '2026-08-01T00:12:00.000Z',
    updatedAt: '2026-08-01T00:12:00.000Z',
  },
];

const sectionsBySubmission: Record<string, SectionSubmission[]> = {
  'submission-1': [makeReadingSection('submission-1', [
    {
      questionId: 'reading-q17',
      studentAnswer: 'Garden Hall',
      correctAnswer: 'GARDEN HALL',
      isCorrect: false,
      awardedScore: 0,
      maxScore: 1,
      scoringRule: 'exact_match',
      hasOverride: false,
    },
    {
      questionId: 'reading-q18',
      studentAnswer: 'car park',
      correctAnswer: 'CAR PARK',
      isCorrect: false,
      awardedScore: 0,
      maxScore: 1,
      scoringRule: 'exact_match',
      hasOverride: false,
    },
    {
      questionId: 'reading-q19',
      studentAnswer: 'Faces of China',
      correctAnswer: 'faces of china',
      isCorrect: false,
      awardedScore: 0,
      maxScore: 1,
      scoringRule: 'exact_match',
      hasOverride: false,
    },
  ])],
  'submission-2': [makeReadingSection('submission-2', [
    {
      questionId: 'reading-q17',
      studentAnswer: 'Garden Hall',
      correctAnswer: 'GARDEN HALL',
      isCorrect: false,
      awardedScore: 0,
      maxScore: 1,
      scoringRule: 'exact_match',
      hasOverride: false,
    },
    {
      questionId: 'reading-q18',
      studentAnswer: 'CAR PARK',
      correctAnswer: 'CAR PARK',
      isCorrect: true,
      awardedScore: 1,
      maxScore: 1,
      scoringRule: 'exact_match',
      hasOverride: false,
    },
  ])],
  'submission-3': [makeReadingSection('submission-3', [
    {
      questionId: 'reading-q17',
      studentAnswer: 'GARDEN HALL',
      correctAnswer: 'GARDEN HALL',
      isCorrect: true,
      awardedScore: 1,
      maxScore: 1,
      scoringRule: 'exact_match',
      hasOverride: false,
    },
    {
      questionId: 'reading-q18',
      studentAnswer: 'CARPARK',
      correctAnswer: 'CAR PARK',
      isCorrect: false,
      awardedScore: 0,
      maxScore: 1,
      scoringRule: 'exact_match',
      hasOverride: false,
    },
  ])],
};

gradingRepository.getSubmissionsBySession = async (sessionId: string) => (
  sessionId === 'session-1' ? submissions : []
);
gradingRepository.getSectionSubmissionsBySubmissionId = async (submissionId: string) => (
  sectionsBySubmission[submissionId] ?? []
);
examRepository.getVersionById = async () => ({ contentSnapshot: examState } as never);
gradingService.getObjectiveGradingSource = async () => ({ success: true, data: { draftVersionId: null } });
gradingService.getObjectiveIntegrityOverview = async () => ({
  success: true,
  data: {
    studentCount: 3,
    expectedAnswerCount: 9,
    verifiedCorrectCount: 6,
    verifiedIncorrectCount: 2,
    verifiedUnansweredCount: 1,
    needsRecheckCount: 0,
    invalidCount: 0,
    integrityStatus: 'verified',
    issues: [],
  },
});
gradingService.getObjectiveOverrides = async () => ({
  success: true,
  data: [
    {
      scheduleId: 'schedule-1',
      questionId: 'reading-q18',
      overrideJson: {
        correctAnswer: 'CAR PARK',
        acceptedAnswers: ['CAR PARK'],
        excludedAnswers: ['car park'],
        scoringRule: 'exact_match',
        maxScore: 1,
      },
      updatedByActorId: 'teacher-admin',
      updatedByActorName: 'Teacher Admin',
      updatedAt: '2026-08-02T09:15:00.000Z',
    },
    {
      scheduleId: 'schedule-1',
      questionId: 'reading-q19',
      overrideJson: {
        correctAnswer: 'Faces of China',
        acceptedAnswers: ['faces of china', 'FACES OF CHINA', 'Faces of China'],
        excludedAnswers: [],
        scoringRule: 'exact_match',
        maxScore: 1,
      },
      updatedByActorId: 'teacher-admin',
      updatedByActorName: 'Teacher Admin',
      updatedAt: '2026-08-01T14:30:00.000Z',
    },
  ],
});
gradingService.upsertObjectiveOverride = async () => ({
  success: true,
  data: { regradeReport: {} } as never,
});

const session = {
  id: 'session-1',
  scheduleId: 'schedule-1',
  examId: 'exam-1',
  examTitle: 'Academic Practice Test 1',
  cohortName: 'Elite 2026-A',
  publishedVersionId: 'published-version-1',
} as never;

export default {
  title: 'Admin/Grading/Overall answer check',
  component: ExamObjectiveOverviewPanel,
  parameters: {
    layout: 'fullscreen',
    options: { showPanel: false },
  },
  decorators: [
    (Story: () => ReactNode) => (
      <div style={{ background: '#F4F5F7', minHeight: '100vh', padding: '32px 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <Story />
        </div>
      </div>
    ),
  ],
};

type Story = StoryObj<typeof ExamObjectiveOverviewPanel>;

export const Populated: Story = {
  render: () => <ExamObjectiveOverviewPanel session={session} />,
};
