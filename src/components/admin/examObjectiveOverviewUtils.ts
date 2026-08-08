import type {
  ObjectiveManualOverride,
  ObjectiveQuestionResult,
  SectionSubmission,
  StudentSubmission,
} from '../../types/grading';
import { normalizeAnswerForMatching } from '../../utils/acceptedAnswers';

export interface ExamObjectiveOverviewBundle {
  readonly submission: Pick<StudentSubmission, 'id' | 'studentName'>;
  readonly sections: readonly SectionSubmission[];
}

export interface ExamObjectiveOverviewRow {
  readonly rowId: string;
  readonly submissionId: string;
  readonly studentName: string;
  readonly section: 'reading' | 'listening';
  readonly questionId: string;
  readonly studentAnswer: string;
  readonly correctAnswer: string;
  readonly isCorrect: boolean;
  readonly awardedScore: number;
  readonly maxScore: number;
  readonly manualOverride: ObjectiveManualOverride | null;
}

function isTextScoringRule(scoringRule: string): boolean {
  const normalized = scoringRule.toLowerCase();
  return normalized.includes('word') || normalized.includes('text') || normalized.includes('exact');
}

function textAnswersMatch(studentAnswer: string, correctAnswer: string): boolean {
  const normalizedStudentAnswer = normalizeAnswerForMatching(studentAnswer);
  if (!normalizedStudentAnswer) return false;

  return correctAnswer
    .split('|')
    .map((answer) => normalizeAnswerForMatching(answer))
    .some((answer) => answer === normalizedStudentAnswer);
}

function resolveResultValues(result: ObjectiveQuestionResult): Pick<ExamObjectiveOverviewRow, 'isCorrect' | 'awardedScore'> {
  if (result.manualOverride) {
    return {
      isCorrect: result.manualOverride.isCorrect,
      awardedScore: result.manualOverride.awardedScore,
    };
  }

  const computedCorrectness = isTextScoringRule(result.scoringRule)
    ? textAnswersMatch(result.studentAnswer, result.correctAnswer)
    : result.isCorrect;

  return {
    isCorrect: computedCorrectness,
    awardedScore: isTextScoringRule(result.scoringRule)
      ? computedCorrectness ? result.maxScore : 0
      : result.awardedScore,
  };
}

export function buildExamObjectiveOverviewRows(
  bundles: readonly ExamObjectiveOverviewBundle[],
): ExamObjectiveOverviewRow[] {
  return bundles
    .flatMap(({ submission, sections }) => sections
      .filter((section): section is SectionSubmission & { section: 'reading' | 'listening' } =>
        section.section === 'reading' || section.section === 'listening',
      )
      .flatMap((section) => (section.autoGradingResults?.questionResults ?? []).map((result) => {
        const resolved = resolveResultValues(result);
        const row: ExamObjectiveOverviewRow = {
          rowId: `${submission.id}:${section.id}:${result.questionId}`,
          submissionId: submission.id,
          studentName: submission.studentName,
          section: section.section,
          questionId: result.questionId,
          studentAnswer: result.studentAnswer,
          correctAnswer: result.correctAnswer,
          maxScore: result.maxScore,
          ...resolved,
          manualOverride: result.manualOverride ?? null,
        };
        return row;
      })))
    .sort((left, right) => {
      const studentOrder = left.studentName.localeCompare(right.studentName);
      if (studentOrder !== 0) return studentOrder;
      const sectionOrder = left.section.localeCompare(right.section);
      if (sectionOrder !== 0) return sectionOrder;
      return left.questionId.localeCompare(right.questionId, undefined, { numeric: true });
    });
}
