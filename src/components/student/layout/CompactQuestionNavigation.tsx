import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import {
  countQuestionSlots,
  getQuestionNumberLabel,
  type StudentQuestionDescriptor,
} from '@services/examAdapterService';
import { getStudentNavigableQuestions } from './studentQuestionNavigation';

interface CompactQuestionNavigationProps {
  readonly questions: StudentQuestionDescriptor[];
  readonly currentQuestionId: string | null;
  readonly onNavigate: (id: string) => void;
  readonly onOpenNavigator?: (() => void) | undefined;
  readonly onSubmit: () => void;
  readonly showSubmitButton: boolean;
}

const navigationButtonClassName =
  'flex min-h-12 min-w-12 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';

export function CompactQuestionNavigation({
  questions,
  currentQuestionId,
  onNavigate,
  onOpenNavigator,
  onSubmit,
  showSubmitButton,
}: CompactQuestionNavigationProps) {
  const navigableQuestions = getStudentNavigableQuestions(questions);
  const currentIndex = Math.max(
    0,
    navigableQuestions.findIndex((question) => question.id === currentQuestionId),
  );
  const currentQuestion = navigableQuestions[currentIndex];
  const totalQuestions = countQuestionSlots(questions);
  const currentLabel = currentQuestion ? getQuestionNumberLabel(questions, currentQuestion.id) : '—';
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex >= 0 && currentIndex < navigableQuestions.length - 1;

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
          const previousQuestion = navigableQuestions[currentIndex - 1];
          if (previousQuestion) onNavigate(previousQuestion.id);
        }}
        data-student-primary-touch-target
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-sm px-2 text-sm font-bold text-gray-900 hover:bg-gray-50"
        onClick={onOpenNavigator}
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
          const nextQuestion = navigableQuestions[currentIndex + 1];
          if (nextQuestion) onNavigate(nextQuestion.id);
        }}
        data-student-primary-touch-target
      >
        <ChevronRight size={20} aria-hidden="true" />
      </button>

      {showSubmitButton ? (
        <button
          type="button"
          className="min-h-12 rounded-sm bg-blue-800 px-3 text-sm font-bold text-white hover:bg-blue-700"
          onClick={onSubmit}
          data-student-primary-touch-target
        >
          Finish
        </button>
      ) : null}
    </nav>
  );
}
