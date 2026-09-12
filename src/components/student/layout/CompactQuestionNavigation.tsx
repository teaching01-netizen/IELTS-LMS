import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import {
  countQuestionSlots,
  type StudentQuestionDescriptor,
} from '@student/application/studentExamContentFacade';
import {
  getStudentQuestionNavigationViewModel,
} from './studentQuestionNavigation';
import type { StudentAnswer } from '../providers/StudentRuntimeProvider';

interface CompactQuestionNavigationProps {
  readonly questions: StudentQuestionDescriptor[];
  readonly currentQuestionId: string | null;
  readonly onNavigate: (id: string) => void;
  readonly onOpenNavigator?: (() => void) | undefined;
  readonly onSubmit: () => void;
  readonly showSubmitButton: boolean;
  /** P3.5: answers/flags feed the shared view model (aria states, future badge). */
  readonly answers?: Record<string, StudentAnswer | undefined> | undefined;
  readonly flags?: Record<string, boolean> | undefined;
}

const navigationButtonClassName = `student-touch-target flex items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-900 transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700`;

export function CompactQuestionNavigation({
  questions,
  currentQuestionId,
  onNavigate,
  onOpenNavigator,
  onSubmit,
  showSubmitButton,
  answers,
  flags,
}: CompactQuestionNavigationProps) {
  // P3.5: same derived view model as footer chips and the question sheet.
  const viewModel = getStudentQuestionNavigationViewModel({
    questions,
    answers: answers ?? {},
    flags: flags ?? {},
    currentQuestionId,
  });
  const { items, currentIndex, canGoPrevious, canGoNext } = viewModel;
  const activeItem = items[currentIndex];
  const totalQuestions = countQuestionSlots(questions);
  const currentLabel = activeItem ? activeItem.label : '—';
  const previousItem = canGoPrevious ? items[currentIndex - 1] : undefined;
  const nextItem = canGoNext ? items[currentIndex + 1] : undefined;

  return (
    <nav
      className="student-exam-footer student-compact-question-navigation"
      aria-label="Question navigation and progress"
      data-testid="student-compact-question-navigation"
    >
      <button
        type="button"
        className={navigationButtonClassName}
        disabled={!canGoPrevious}
        aria-label="Previous question"
        onClick={() => {
          if (previousItem) onNavigate(previousItem.navigationId);
        }}
        data-student-primary-touch-target
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="student-touch-target flex min-w-0 flex-1 items-center justify-center gap-2 rounded-sm px-2 text-sm font-semibold text-gray-900 transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        onClick={(event) => {
          event.currentTarget.focus();
          onOpenNavigator?.();
        }}
        aria-label={`Open question navigator, question ${currentLabel} of ${totalQuestions}`}
        disabled={!onOpenNavigator}
        data-student-primary-touch-target
      >
        <span className="truncate">Q {currentLabel} / {totalQuestions}</span>
        {onOpenNavigator ? <LayoutGrid size={16} aria-hidden="true" /> : null}
      </button>

      <button
        type="button"
        className={navigationButtonClassName}
        disabled={!canGoNext}
        aria-label="Next question"
        onClick={() => {
          if (nextItem) onNavigate(nextItem.navigationId);
        }}
        data-student-primary-touch-target
      >
        <ChevronRight size={20} aria-hidden="true" />
      </button>

      {showSubmitButton ? (
        <button
          type="button"
          className="student-touch-target rounded-sm bg-primary px-3 text-sm font-semibold text-primary-foreground transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          onClick={onSubmit}
          data-student-primary-touch-target
        >
          Finish
        </button>
      ) : null}
    </nav>
  );
}
