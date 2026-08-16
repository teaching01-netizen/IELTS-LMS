import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { StoryObj } from '@storybook/react-vite';
import { examRepository } from '../../services/examRepository';
import { gradingService } from '../../services/gradingService';
import { createInitialExamState } from '../../services/examAdapterService';
import { ObjectiveOverridesPanel } from './ObjectiveOverridesPanel';

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

examRepository.getVersionById = async () => ({ contentSnapshot: examState } as never);
gradingService.getObjectiveGradingSource = async () => ({ success: true, data: { draftVersionId: null } });
gradingService.getObjectiveOverrides = async () => ({
  success: true,
  data: [
    {
      scheduleId: 'schedule-1',
      questionId: 'reading-q17',
      overrideJson: {
        correctAnswer: 'GARDEN HALL',
        acceptedAnswers: ['GARDEN HALL', 'Garden Hall'],
        scoringRule: 'exact_match',
        maxScore: 1,
      },
      updatedByActorId: 'teacher-admin',
      updatedByActorName: 'Teacher Admin',
      updatedAt: '2026-08-02T09:15:00.000Z',
    },
  ],
});
gradingService.regradeObjectiveLatestDraft = async () => ({
  success: true,
  data: {
    draftVersionId: 'draft-1',
    regradeReport: {
      sectionsUpdated: 2,
      attemptsScanned: 4,
      submissionsMatched: 3,
      submissionsMissing: 0,
      sectionsChecked: 2,
      sectionsNeedingUpdate: 2,
      submissionsUpdated: 3,
    },
  },
});
gradingService.upsertObjectiveOverride = async () => ({
  success: true,
  data: { regradeReport: { sectionsUpdated: 1 } } as never,
});
gradingService.deleteObjectiveOverride = async () => ({
  success: true,
  data: { deleted: true, regradeReport: { sectionsUpdated: 1 } } as never,
});

function AutoOpenPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.querySelector('button')?.click();
  }, []);
  return (
    <div ref={containerRef}>
      <ObjectiveOverridesPanel
        scheduleId="schedule-1"
        examId="exam-1"
        publishedVersionId="published-version-1"
      />
    </div>
  );
}

export default {
  title: 'Admin/Grading/Objective overrides',
  component: ObjectiveOverridesPanel,
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

type Story = StoryObj<typeof ObjectiveOverridesPanel>;

export const Open: Story = {
  render: () => <AutoOpenPanel />,
};
