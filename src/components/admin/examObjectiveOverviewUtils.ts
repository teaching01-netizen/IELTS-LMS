import type { ExamState, QuestionType } from '../../types';
import type {
  ObjectiveManualOverride,
  ObjectiveQuestionResult,
  SectionSubmission,
  StudentSubmission,
} from '../../types/grading';
import { getStudentQuestionsForModule } from '../../services/examAdapterService';
import { getCorrectAnswerDisplay } from './gradingAnswerUtils';

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

export interface ExamObjectiveOverviewOptions {
  readonly examState?: ExamState | null;
}

type ExamObjectiveAnswerKind = 'text' | 'choice';

const TEXT_ANSWER_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set([
  'CLOZE',
  'SHORT_ANSWER',
  'SENTENCE_COMPLETION',
  'NOTE_COMPLETION',
  'DIAGRAM_LABELING',
  'FLOW_CHART',
  'TABLE_COMPLETION',
]);

const TEXT_SCORING_RULES: ReadonlySet<string> = new Set([
  'exact_match',
  'one_word',
  'two_words',
  'three_words',
  'sub_answer_tree',
  'diagram_label',
  'flow_chart',
  'table_completion',
  'text',
  'word',
]);

function isTextScoringRule(scoringRule: string): boolean {
  return TEXT_SCORING_RULES.has(scoringRule.trim().toLowerCase());
}

function normalizeCaseAndWhitespace(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function textAnswersMatch(studentAnswer: string, correctAnswer: string): boolean {
  const normalizedStudentAnswer = normalizeCaseAndWhitespace(studentAnswer);
  if (!normalizedStudentAnswer) return false;

  return correctAnswer
    .split('|')
    .map((answer) => normalizeCaseAndWhitespace(answer))
    .some((answer) => answer === normalizedStudentAnswer);
}

function answersDifferOnlyByCaseOrWhitespace(studentAnswer: string, correctAnswer: string): boolean {
  if (!studentAnswer || !correctAnswer) return false;

  return correctAnswer
    .split('|')
    .map((answer) => answer.trim())
    .some((answer) => (
      studentAnswer !== answer
      && normalizeCaseAndWhitespace(studentAnswer) === normalizeCaseAndWhitespace(answer)
  ));
}

function buildQuestionAnswerKindLookup(examState: ExamState | null | undefined): Map<string, ExamObjectiveAnswerKind> {
  const lookup = new Map<string, ExamObjectiveAnswerKind>();
  if (!examState) return lookup;

  for (const section of ['reading', 'listening'] as const) {
    for (const descriptor of getStudentQuestionsForModule(examState, section)) {
      const answerKind = descriptor.isSubAnswerTreeLeaf || TEXT_ANSWER_QUESTION_TYPES.has(descriptor.block.type)
        ? 'text'
        : 'choice';
      lookup.set(`${section}:${descriptor.id}`, answerKind);
    }
  }

  return lookup;
}

function buildQuestionDescriptorLookup(examState: ExamState | null | undefined) {
  const lookup = new Map<string, ReturnType<typeof getStudentQuestionsForModule>[number]>();
  if (!examState) return lookup;

  for (const section of ['reading', 'listening'] as const) {
    for (const descriptor of getStudentQuestionsForModule(examState, section)) {
      lookup.set(`${section}:${descriptor.id}`, descriptor);
    }
  }

  return lookup;
}

function isTextAnswerResult(
  result: ObjectiveQuestionResult,
  section: 'reading' | 'listening',
  questionAnswerKinds: ReadonlyMap<string, ExamObjectiveAnswerKind>,
): boolean {
  const questionAnswerKind = questionAnswerKinds.get(`${section}:${result.questionId}`);
  return questionAnswerKind ? questionAnswerKind === 'text' : isTextScoringRule(result.scoringRule);
}

function resolveResultValues(
  result: ObjectiveQuestionResult,
  correctAnswer: string = result.correctAnswer,
): Pick<ExamObjectiveOverviewRow, 'isCorrect' | 'awardedScore'> {
  if (result.manualOverride) {
    return {
      isCorrect: result.manualOverride.isCorrect,
      awardedScore: result.manualOverride.awardedScore,
    };
  }

  const computedCorrectness = isTextScoringRule(result.scoringRule)
    ? textAnswersMatch(result.studentAnswer, correctAnswer)
    : result.isCorrect;

  return {
    isCorrect: computedCorrectness,
    awardedScore: isTextScoringRule(result.scoringRule)
      ? computedCorrectness ? result.maxScore : 0
      : result.awardedScore,
  };
}

function getOverviewCorrectAnswerDisplay(
  descriptor: ReturnType<typeof getStudentQuestionsForModule>[number] | undefined,
  result: ObjectiveQuestionResult,
): string {
  if (result.hasOverride && result.correctAnswer.trim() !== '') {
    return result.correctAnswer;
  }

  return descriptor ? getCorrectAnswerDisplay(descriptor) || result.correctAnswer : result.correctAnswer;
}

export function buildExamObjectiveOverviewRows(
  bundles: readonly ExamObjectiveOverviewBundle[],
  options: ExamObjectiveOverviewOptions = {},
): ExamObjectiveOverviewRow[] {
  const questionAnswerKinds = buildQuestionAnswerKindLookup(options.examState);
  const questionDescriptors = buildQuestionDescriptorLookup(options.examState);

  return bundles
    .flatMap(({ submission, sections }) => sections
      .filter((section): section is SectionSubmission & { section: 'reading' | 'listening' } =>
        section.section === 'reading' || section.section === 'listening',
      )
      .flatMap((section) => (section.autoGradingResults?.questionResults ?? [])
        .filter((result) => isTextAnswerResult(result, section.section, questionAnswerKinds))
        .map((result) => {
          const descriptor = questionDescriptors.get(`${section.section}:${result.questionId}`);
          const correctAnswer = getOverviewCorrectAnswerDisplay(descriptor, result);
          if (!answersDifferOnlyByCaseOrWhitespace(result.studentAnswer, correctAnswer)) {
            return null;
          }

          const resolved = resolveResultValues(result, correctAnswer);
          const row: ExamObjectiveOverviewRow = {
            rowId: `${submission.id}:${section.id}:${result.questionId}`,
            submissionId: submission.id,
            studentName: submission.studentName,
            section: section.section,
            questionId: result.questionId,
            studentAnswer: result.studentAnswer,
            correctAnswer,
            maxScore: result.maxScore,
            ...resolved,
            manualOverride: result.manualOverride ?? null,
          };
          return row;
        })
        .filter((row): row is ExamObjectiveOverviewRow => row !== null)))
    .sort((left, right) => {
      const studentOrder = left.studentName.localeCompare(right.studentName);
      if (studentOrder !== 0) return studentOrder;
      const sectionOrder = left.section.localeCompare(right.section);
      if (sectionOrder !== 0) return sectionOrder;
      return left.questionId.localeCompare(right.questionId, undefined, { numeric: true });
    });
}
