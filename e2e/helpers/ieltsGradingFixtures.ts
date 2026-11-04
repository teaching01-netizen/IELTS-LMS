/**
 * Shared fixture builders for the IELTS grading-parity logic suites.
 *
 * `e2e/ielts-case-sensitive-note.spec.ts`, `e2e/ielts-question-type-matrices.spec.ts`
 * and `e2e/ielts-student-to-pdf-flow.spec.ts` all drive the real website
 * grading surface (exam state → descriptors → scorer → traceback/overview/
 * export/PDF) without a browser or server. Only that common *shape* lives
 * here: each spec keeps its own exam data and expectations local.
 */
import {
  getCorrectAnswerDisplay,
  getStudentAnswerDisplay,
} from '../../src/components/admin/gradingAnswerUtils';
import { getStudentQuestionsForModule } from '../../src/features/exam-authoring/api/examAuthoringGateway';
import type { ObjectiveScoringResult } from '../../src/features/grading/objectiveScoring';
import { createInitialExamState } from '../../src/services/examAdapterService';
import type { ExamState, QuestionBlock } from '../../src/types';
import type { StudentAnswerValue } from '../../src/types/answers';
import type { ObjectiveQuestionResult, SectionSubmission } from '../../src/types/grading';

/** Module every fixture in the three IELTS parity suites grades. */
export const READING_MODULE = 'reading' as const;

/** Deterministic auto-grading clock so export/PDF fixtures stay stable. */
export const AUTO_GRADING_TIMESTAMP = '2026-01-01T00:00:00.000Z';

/** Default scoring-rule label for text-entry question types. */
export const DEFAULT_SCORING_RULE = 'one_word';

const DEFAULT_SECTION_ID = 'section-1';
const DEFAULT_SUBMISSION_ID = 'submission-1';

export interface ReadingPassageOverrides {
  readonly id?: string;
  readonly title?: string;
  readonly content?: string;
}

/**
 * An `Academic` exam whose reading module is a single passage carrying
 * `blocks`. Specs pass only the blocks and the passage copy they care about;
 * the passage id/title default to the `passage-1` / `Passage 1` shape every
 * surface already renders.
 */
export function readingExam(
  title: string,
  blocks: QuestionBlock[],
  passage: ReadingPassageOverrides = {},
): ExamState {
  const state = createInitialExamState(title, 'Academic');
  state.reading.passages = [{
    id: passage.id ?? 'passage-1',
    title: passage.title ?? 'Passage 1',
    content: passage.content ?? '',
    blocks,
  }];
  return state;
}

/** Scoring-rule label for a block type, as the auto-grader persists it. */
export type ScoringRuleFor = (blockType: string) => string;

/**
 * The `SectionSubmission` the auto-grader would persist for `answers`: one
 * question result per descriptor, verdict/score taken from the website scorer
 * and display strings from the real export helpers. This is the fixture the
 * traceback / overview / wide-export / PDF audits all read.
 */
export function sectionFor(
  state: ExamState,
  answers: Record<string, unknown>,
  scoring: ObjectiveScoringResult,
  ruleFor: ScoringRuleFor = () => DEFAULT_SCORING_RULE,
): SectionSubmission {
  const descriptors = getStudentQuestionsForModule(state, READING_MODULE);
  const questionResults: ObjectiveQuestionResult[] = descriptors.map((descriptor) => {
    const score = scoring.byId.get(descriptor.id);
    return {
      questionId: descriptor.id,
      studentAnswer: getStudentAnswerDisplay(
        descriptor,
        answers as Record<string, StudentAnswerValue | undefined>,
      ),
      correctAnswer: getCorrectAnswerDisplay(descriptor),
      isCorrect: score?.correctness ?? false,
      awardedScore: score?.awardedScore ?? 0,
      maxScore: score?.maxScore ?? 1,
      scoringRule: ruleFor(descriptor.block.type),
      hasOverride: false,
    };
  });
  return {
    id: DEFAULT_SECTION_ID,
    submissionId: DEFAULT_SUBMISSION_ID,
    section: READING_MODULE,
    answers: { type: READING_MODULE, passages: [], answers },
    autoGradingResults: {
      generatedAt: AUTO_GRADING_TIMESTAMP,
      totalScore: scoring.totalScore,
      maxScore: scoring.maxScore,
      percentage: scoring.percentage,
      questionResults,
    },
    gradingStatus: 'auto_graded',
    submittedAt: AUTO_GRADING_TIMESTAMP,
  } as unknown as SectionSubmission;
}

export interface SingleResultSectionOptions {
  readonly questionId: string;
  readonly studentAnswer: string;
  readonly correctAnswer: string;
  readonly isCorrect: boolean;
  readonly id?: string;
  readonly submissionId?: string;
  readonly scoringRule?: string;
  readonly awardedScore?: number;
  readonly maxScore?: number;
}

/**
 * A section persisted with exactly one hand-authored question result. The
 * case-sensitive note suite uses it to model a *stored* result that the
 * overview / per-student export audit must recompute rather than trust.
 */
export function sectionWithSingleResult({
  questionId,
  studentAnswer,
  correctAnswer,
  isCorrect,
  id = DEFAULT_SECTION_ID,
  submissionId = DEFAULT_SUBMISSION_ID,
  scoringRule = DEFAULT_SCORING_RULE,
  awardedScore = isCorrect ? 1 : 0,
  maxScore = 1,
}: SingleResultSectionOptions): SectionSubmission {
  return {
    id,
    submissionId,
    section: READING_MODULE,
    answers: { type: READING_MODULE, passages: [] },
    autoGradingResults: {
      generatedAt: AUTO_GRADING_TIMESTAMP,
      totalScore: awardedScore,
      maxScore,
      percentage: maxScore > 0 ? Math.round((awardedScore / maxScore) * 100) : 0,
      questionResults: [{
        questionId,
        studentAnswer,
        correctAnswer,
        isCorrect,
        awardedScore,
        maxScore,
        scoringRule,
        hasOverride: false,
      }],
    },
    gradingStatus: 'auto_graded',
    submittedAt: AUTO_GRADING_TIMESTAMP,
  } as unknown as SectionSubmission;
}
