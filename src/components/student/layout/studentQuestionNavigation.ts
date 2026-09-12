import type { StudentQuestionDescriptor } from '@student/application/studentExamContentFacade';
import {
  countAnsweredQuestions,
  countQuestionSlots,
  getQuestionNumberLabel,
  isQuestionAnswered,
  isQuestionFullyAnswered,
} from '@student/application/studentExamContentFacade';
import type { StudentAnswer } from '../providers/StudentRuntimeProvider';

export function getStudentQuestionNavigationKey(question: StudentQuestionDescriptor): string {
  return question.rootId?.includes('::group::') ? question.rootId : question.id;
}

export function getStudentNavigableQuestions(
  questions: readonly StudentQuestionDescriptor[],
): StudentQuestionDescriptor[] {
  const seen = new Set<string>();

  return questions.filter((question) => {
    const key = getStudentQuestionNavigationKey(question);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** Derived state of one navigable item, shared by every presentation. */
export interface StudentQuestionNavigationItem {
  /** Stable navigation target id (group root id for grouped slots). */
  readonly navigationId: string;
  /** Stable target id of the first slot inside the item. */
  readonly targetId: string;
  /** Display label from the content facade's number labels. */
  readonly label: string;
  /** Display group (passage/part) identity for chip/sheet grouping. */
  readonly groupId: string;
  readonly groupLabel: string;
  readonly current: boolean;
  readonly answered: boolean;
  readonly partial: boolean;
  readonly flagged: boolean;
}

/** Per-presentation totals, identical across chips/nav/sheet. */
export interface StudentQuestionNavigationSummary {
  readonly totalSlots: number;
  readonly answeredSlots: number;
  readonly fullyAnswered: number;
  readonly partiallyAnswered: number;
  readonly flagged: number;
  readonly unanswered: number;
}

export interface StudentQuestionNavigationViewModel {
  readonly items: readonly StudentQuestionNavigationItem[];
  readonly summary: StudentQuestionNavigationSummary;
  readonly currentIndex: number;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
}

export interface StudentQuestionNavigationInput {
  readonly questions: readonly StudentQuestionDescriptor[];
  readonly answers: Record<string, StudentAnswer | undefined>;
  readonly flags: Record<string, boolean>;
  readonly currentQuestionId: string | null;
}

/** Facade counters require mutable arrays; copy once at the boundary. */
function toFacadeQuestions(questions: readonly StudentQuestionDescriptor[]): StudentQuestionDescriptor[] {
  return [...questions];
}

/**
 * P3.5 — ONE derived view model for footer chips, compact previous/current/
 * next, and the question sheet. Grouped-root deduplication stays here (never
 * duplicated per presentation); status is computed from the content facade.
 */
export function getStudentQuestionNavigationViewModel({
  questions,
  answers,
  flags,
  currentQuestionId,
}: StudentQuestionNavigationInput): StudentQuestionNavigationViewModel {
  const facadeQuestions = toFacadeQuestions(questions);
  const navigable = getStudentNavigableQuestions(facadeQuestions);
  const currentQuestion = facadeQuestions.find((question) => question.id === currentQuestionId);
  const currentNavigationKey = currentQuestion
    ? getStudentQuestionNavigationKey(currentQuestion)
    : currentQuestionId;

  const items = navigable.map((question, index) => {
    const answered = isQuestionAnswered(question, answers);
    const fully = isQuestionFullyAnswered(question, answers);
    return {
      navigationId: question.id,
      targetId: question.id,
      label: getQuestionNumberLabel(facadeQuestions, question.id) || String(index + 1),
      groupId: question.groupId,
      groupLabel: question.groupLabel,
      current:
        currentNavigationKey !== null &&
        getStudentQuestionNavigationKey(question) === currentNavigationKey,
      answered,
      partial: answered && !fully,
      flagged: flags[question.id] === true,
    } satisfies StudentQuestionNavigationItem;
  });

  const totalSlots = countQuestionSlots(facadeQuestions);
  const answeredSlots = countAnsweredQuestions(facadeQuestions, answers);
  const partiallyAnswered = facadeQuestions.reduce(
    (count, question) =>
      count +
      (isQuestionAnswered(question, answers) && !isQuestionFullyAnswered(question, answers) ? 1 : 0),
    0,
  );
  const flagged = Object.values(flags).filter(Boolean).length;

  const summary: StudentQuestionNavigationSummary = {
    totalSlots,
    answeredSlots,
    fullyAnswered: Math.max(0, answeredSlots - partiallyAnswered),
    partiallyAnswered,
    flagged,
    unanswered: Math.max(0, totalSlots - answeredSlots),
  };

  const currentIndex = Math.max(
    0,
    items.findIndex((item) => item.current),
  );

  return {
    items,
    summary,
    currentIndex,
    canGoPrevious: items.length > 0 && currentIndex > 0,
    canGoNext: items.length > 0 && currentIndex < items.length - 1,
  };
}
