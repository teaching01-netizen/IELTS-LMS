import type { ExamState, QuestionType } from '../../types';
import type {
  GradingScheduleObjectiveOverrideRow,
  ObjectiveManualOverride,
  ObjectiveQuestionResult,
  SectionSubmission,
  StudentSubmission,
} from '../../types/grading';
import {
  getQuestionNumberLabel,
  getStudentQuestionsForModule,
} from '../../features/exam-authoring/infrastructure/examAuthoringGateway';
import { formatAnswerValue, getCorrectAnswerDisplay, getCorrectAnswerValue } from './gradingAnswerUtils';

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
  readonly questionNumberLabel: string;
  readonly studentAnswer: string;
  readonly correctAnswer: string;
  readonly primaryCorrectAnswer: string;
  readonly isCorrect: boolean;
  readonly awardedScore: number;
  readonly maxScore: number;
  readonly scoringRule: string;
  readonly hasOverride: boolean;
  readonly manualOverride: ObjectiveManualOverride | null;
}

export type ExamObjectiveOverviewGroupStatus = 'correct' | 'incorrect';

export interface ExamObjectiveOverviewGroup {
  readonly groupId: string;
  readonly studentAnswer: string;
  readonly rows: readonly ExamObjectiveOverviewRow[];
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
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizeCaseInsensitiveAndWhitespace(value: string): string {
  return normalizeCaseAndWhitespace(value).toLowerCase();
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
      && normalizeCaseInsensitiveAndWhitespace(studentAnswer) === normalizeCaseInsensitiveAndWhitespace(answer)
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

function buildQuestionNumberLabelLookup(examState: ExamState | null | undefined): Map<string, string> {
  const lookup = new Map<string, string>();
  if (!examState) return lookup;

  for (const section of ['reading', 'listening'] as const) {
    const descriptors = getStudentQuestionsForModule(examState, section);
    for (const descriptor of descriptors) {
      const numberLabel = getQuestionNumberLabel(descriptors, descriptor.id);
      if (numberLabel) {
        lookup.set(`${section}:${descriptor.id}`, `q-${numberLabel}`);
      }
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

function getPrimaryCorrectAnswer(value: string): string {
  return value.split('|')[0]?.trim() ?? '';
}

function getOverviewPrimaryCorrectAnswer(
  descriptor: ReturnType<typeof getStudentQuestionsForModule>[number] | undefined,
  result: ObjectiveQuestionResult,
): string {
  if (result.hasOverride && result.correctAnswer.trim() !== '') {
    return getPrimaryCorrectAnswer(result.correctAnswer);
  }

  if (descriptor) {
    const descriptorAnswer = formatAnswerValue(getCorrectAnswerValue(descriptor)).trim();
    if (descriptorAnswer) return descriptorAnswer;
  }

  return getPrimaryCorrectAnswer(result.correctAnswer);
}

export function buildExamObjectiveOverviewRows(
  bundles: readonly ExamObjectiveOverviewBundle[],
  options: ExamObjectiveOverviewOptions = {},
): ExamObjectiveOverviewRow[] {
  const questionAnswerKinds = buildQuestionAnswerKindLookup(options.examState);
  const questionDescriptors = buildQuestionDescriptorLookup(options.examState);
  const questionNumberLabels = buildQuestionNumberLabelLookup(options.examState);

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
            questionNumberLabel: questionNumberLabels.get(`${section.section}:${result.questionId}`) ?? result.questionId,
            studentAnswer: result.studentAnswer,
            correctAnswer,
            primaryCorrectAnswer: getOverviewPrimaryCorrectAnswer(descriptor, result),
            maxScore: result.maxScore,
            scoringRule: result.scoringRule,
            hasOverride: result.hasOverride,
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

export interface ExamObjectiveOverrideDecision {
  readonly questionId: string;
  /** `true` when the answer was accepted for the exam, `false` when it was kept incorrect. */
  readonly isCorrect: boolean;
  readonly actorName: string;
  readonly updatedAt: string;
}

/**
 * Resolve the most recent overall-check decision that touched this answer group.
 * A decision exists when the group's raw answer appears in a schedule override's
 * accepted or excluded answers for one of the group's questions.
 */
export function resolveGroupOverrideDecision(
  group: ExamObjectiveOverviewGroup,
  overrides: readonly GradingScheduleObjectiveOverrideRow[],
): ExamObjectiveOverrideDecision | null {
  const rawAnswer = group.studentAnswer.trim();
  let latest: ExamObjectiveOverrideDecision | null = null;

  for (const row of group.rows) {
    const override = overrides.find((candidate) => candidate.questionId === row.questionId);
    if (!override) {
      continue;
    }

    const accepted = (override.overrideJson.acceptedAnswers ?? []).some(
      (answer) => answer.trim() === rawAnswer,
    );
    const excluded = (override.overrideJson.excludedAnswers ?? []).some(
      (answer) => answer.trim() === rawAnswer,
    );
    if (!accepted && !excluded) {
      continue;
    }

    const candidate: ExamObjectiveOverrideDecision = {
      questionId: row.questionId,
      isCorrect: accepted,
      actorName: override.updatedByActorName,
      updatedAt: override.updatedAt,
    };

    if (!latest || candidate.updatedAt > latest.updatedAt) {
      latest = candidate;
    }
  }

  return latest;
}

export function groupExamObjectiveOverviewRows(
  rows: readonly ExamObjectiveOverviewRow[],
): ExamObjectiveOverviewGroup[] {
  const grouped = new Map<string, ExamObjectiveOverviewGroup>();

  for (const row of rows) {
    const groupId = row.studentAnswer || `empty:${row.rowId}`;
    const existing = grouped.get(groupId);

    if (existing) {
      grouped.set(groupId, {
        ...existing,
        rows: [...existing.rows, row],
      });
      continue;
    }

    grouped.set(groupId, {
      groupId,
      studentAnswer: row.studentAnswer,
      rows: [row],
    });
  }

  return [...grouped.values()].sort((left, right) =>
    left.studentAnswer.localeCompare(right.studentAnswer, undefined, { numeric: true }),
  );
}
