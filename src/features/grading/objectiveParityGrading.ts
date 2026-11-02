import type { StudentQuestionDescriptor } from '../exam-authoring/api/examAuthoringGateway';
import type { StudentAnswerValue } from '../../types/answers';
import { getCorrectAnswerDisplay, getStudentAnswerDisplay } from '../../components/admin/gradingAnswerUtils';
import { scoreObjectiveDescriptors, type ObjectiveScoringOverride } from './objectiveScoring';

export interface ParityQuestionResult {
  questionId: string;
  correctness: boolean | null;
  status: 'verified_correct' | 'verified_incorrect' | 'verified_unanswered' | 'invalid';
  awardedScore: number | null;
  maxScore: number | null;
  studentAnswer: string;
  correctAnswer: string;
  scoringRule: string;
}

export interface ParitySectionResult {
  section: 'listening' | 'reading';
  totalScore: number;
  maxScore: number;
  percentage: number;
  questions: ParityQuestionResult[];
}

/**
 * The website half of the grading parity harness. It is deliberately built on
 * the same scorer the review page and export use, so a change to website
 * grading shows up as a parity mismatch instead of drifting silently.
 */
export function gradeSectionForParity(
  section: 'listening' | 'reading',
  descriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  overrides?: Record<string, ObjectiveScoringOverride>,
): ParitySectionResult {
  const scoring = scoreObjectiveDescriptors(descriptors, answerMap, overrides);
  const questions: ParityQuestionResult[] = descriptors.map((descriptor) => {
    const score = scoring.byId.get(descriptor.id);
    return {
      questionId: descriptor.id,
      correctness: score?.correctness ?? null,
      status: score?.status ?? 'invalid',
      awardedScore: score?.awardedScore ?? null,
      maxScore: score?.maxScore ?? null,
      studentAnswer: getStudentAnswerDisplay(descriptor, answerMap),
      correctAnswer: getCorrectAnswerDisplay(descriptor),
      scoringRule: descriptor.block.type,
    };
  });

  return {
    section,
    totalScore: scoring.totalScore,
    maxScore: scoring.maxScore,
    percentage: scoring.percentage,
    questions,
  };
}
