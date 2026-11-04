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
} from '../../features/exam-authoring/api/examAuthoringGateway';
import type { StudentQuestionDescriptor } from '../../features/exam-authoring/api/examAuthoringGateway';
import { answersMatchForEntry } from '../../utils/acceptedAnswers';
import { formatAnswerValue, getCorrectAnswerDisplay, getCorrectAnswerValue } from './gradingAnswerUtils';
import {
  descriptorHasRecheckableKey,
  resolveDisplayedObjectiveValues,
  scoreSectionForRecheck,
} from './gradingReviewUtils';

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
  /**
   * Website re-check only, never the official score. Null when a manual
   * override makes a re-check meaningless.
   */
  readonly websiteIsCorrect: boolean | null;
  /** True when the website re-check disagrees with the saved result (regrade warning). */
  readonly savedResultOutOfDate: boolean;
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

function buildQuestionDescriptorLookup(
  examState: ExamState | null | undefined,
): Map<string, StudentQuestionDescriptor> {
  const lookup = new Map<string, StudentQuestionDescriptor>();
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

/**
 * The saved result is the official score (ticket 11). A teacher override wins
 * over it; the website never substitutes its own verdict here.
 */
function resolveSavedResultValues(
  result: ObjectiveQuestionResult,
): Pick<ExamObjectiveOverviewRow, 'isCorrect' | 'awardedScore'> {
  if (result.manualOverride) {
    return {
      isCorrect: result.manualOverride.isCorrect,
      awardedScore: result.manualOverride.awardedScore,
    };
  }

  return { isCorrect: result.isCorrect, awardedScore: result.awardedScore };
}

/**
 * Best-effort recheck used only when exam content is unavailable (exam state
 * loading failed or the descriptor is missing from this version). The shared
 * scorer is always preferred when it can evaluate the question.
 */
function fallbackTextRecheck(studentAnswer: string, correctAnswer: string): boolean {
  const alternatives = correctAnswer.split('|').map((answer) => answer.trim()).filter(Boolean);
  if (alternatives.length === 0) return false;
  return alternatives.some((answer) => answersMatchForEntry(studentAnswer, answer, true));
}

function getOverviewCorrectAnswerDisplay(
  descriptor: StudentQuestionDescriptor | undefined,
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
  descriptor: StudentQuestionDescriptor | undefined,
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
      .flatMap((section) => {
        const candidates = (section.autoGradingResults?.questionResults ?? [])
          .filter((result) => isTextAnswerResult(result, section.section, questionAnswerKinds))
          .map((result) => {
            const descriptor = questionDescriptors.get(`${section.section}:${result.questionId}`);
            const correctAnswer = getOverviewCorrectAnswerDisplay(descriptor, result);
            return answersDifferOnlyByCaseOrWhitespace(result.studentAnswer, correctAnswer)
              ? { result, descriptor, correctAnswer }
              : null;
          })
          .filter((candidate): candidate is {
            result: ObjectiveQuestionResult;
            descriptor: StudentQuestionDescriptor | undefined;
            correctAnswer: string;
          } => candidate !== null);
        if (candidates.length === 0) return [];
        // One shared scorer pass per section submission. It owns grouped,
        // pooled and tree verdicts, so this warning cannot disagree with the
        // review page (and clears after a regrade).
        const recheck = scoreSectionForRecheck(options.examState ?? null, section, section.section);
        return candidates.map(({ result, descriptor, correctAnswer }) => {
          const savedResult = resolveSavedResultValues(result);
          const scoredRecheck = recheck?.byId.get(result.questionId);
          const websiteIsCorrect = result.manualOverride
            ? null
            : scoredRecheck?.correctness
              ?? (scoredRecheck === undefined
                ? fallbackTextRecheck(result.studentAnswer, correctAnswer)
                : null);
          // The displayed verdict follows the current exact-case rule when the
          // saved row is out of date: a stored `Correct` that the rule now says
          // is Incorrect must not be shown as Correct here. Saved overrides
          // stay authoritative, the snapshot must actually carry a readable key
          // for the re-check, and the saved score stays official until the
          // session is regraded (that is what the warning reports).
          const canCorrect = !result.manualOverride
            && result.hasOverride !== true
            && scoredRecheck !== undefined
            && descriptor !== undefined
            && descriptorHasRecheckableKey(descriptor);
          const resolved = canCorrect
            ? resolveDisplayedObjectiveValues(
                savedResult.isCorrect,
                savedResult.awardedScore,
                result.maxScore,
                scoredRecheck,
              )
            : null;
          const displayedIsCorrect = resolved?.correctness ?? savedResult.isCorrect;
          const displayedAwardedScore = resolved?.awardedScore ?? savedResult.awardedScore;
          const savedResultOutOfDate = canCorrect
            ? (resolved?.outOfDate ?? false)
            : !result.manualOverride
              && result.hasOverride !== true
              && (descriptor === undefined || descriptorHasRecheckableKey(descriptor))
              && websiteIsCorrect !== null
              && websiteIsCorrect !== savedResult.isCorrect;
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
            isCorrect: displayedIsCorrect,
            awardedScore: displayedAwardedScore,
            websiteIsCorrect,
            savedResultOutOfDate,
            manualOverride: result.manualOverride ?? null,
          };
          return row;
        });
      }))
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
