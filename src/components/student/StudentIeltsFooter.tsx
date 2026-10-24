import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  countAnsweredQuestions,
  countQuestionSlots,
  type StudentQuestionDescriptor,
} from '@student/application/studentExamContentFacade';
import {
  getStudentQuestionNavigationViewModel,
  type StudentQuestionNavigationItem,
} from './layout/studentQuestionNavigation';
import type { StudentAnswer } from './providers/StudentRuntimeProvider';

const pressClassName =
  'transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out';

const navButtonClassName = `${pressClassName} flex size-12 flex-shrink-0 items-center justify-center rounded-lg text-gray-900 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`;

interface StudentIeltsFooterProps {
  questions: StudentQuestionDescriptor[];
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  answers: Record<string, StudentAnswer | undefined>;
  flags?: Record<string, boolean>;
  onSubmit: () => void;
  showSubmitButton?: boolean | undefined;
}

/**
 * IELTS question footer for tablet widths. Row one holds the parts, position,
 * and Finish; row two shows every question number of the active part. Nothing
 * scrolls sideways: numbers wrap, so no question is hidden behind a rail.
 */
export function StudentIeltsFooter({
  questions,
  currentQuestionId,
  onNavigate,
  answers,
  flags = {},
  onSubmit,
  showSubmitButton = true,
}: StudentIeltsFooterProps) {
  const totalQuestions = countQuestionSlots(questions);
  const answeredCount = countAnsweredQuestions(questions, answers);
  const hasUnanswered = totalQuestions > 0 && answeredCount < totalQuestions;

  const { items, currentIndex, canGoPrevious, canGoNext } = getStudentQuestionNavigationViewModel({
    questions,
    answers,
    flags,
    currentQuestionId,
  });
  const currentItem = items.find((item) => item.current);
  const previousItem = canGoPrevious ? items[currentIndex - 1] : undefined;
  const nextItem = canGoNext ? items[currentIndex + 1] : undefined;

  const itemsByPart = new Map<string, StudentQuestionNavigationItem[]>();
  for (const item of items) {
    const partItems = itemsByPart.get(item.groupId);
    if (partItems) {
      partItems.push(item);
    } else {
      itemsByPart.set(item.groupId, [item]);
    }
  }
  const parts = Array.from(itemsByPart, ([groupId, partItems]) => ({ groupId, items: partItems }));
  const activeGroupId = currentItem?.groupId ?? null;
  const activePartIndex = parts.findIndex((part) => part.groupId === activeGroupId);
  const activeItems = activePartIndex >= 0 ? (parts[activePartIndex]?.items ?? []) : [];

  return (
    <footer
      className="student-exam-footer student-ielts-footer flex flex-col gap-2 px-2 py-2 md:px-3"
      role="contentinfo"
      aria-label="Question navigation and progress"
    >
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <div
          role="group"
          aria-label="Parts"
          className="flex min-w-0 flex-1 gap-1 rounded-xl bg-gray-100 p-1"
        >
          {parts.map((part, index) => {
            const isActive = part.groupId === activeGroupId;
            const partQuestions = questions.filter((question) => question.groupId === part.groupId);
            const partTotal = countQuestionSlots(partQuestions);
            const partAnswered = countAnsweredQuestions(partQuestions, answers);
            const firstItem = part.items[0];

            return (
              <button
                key={part.groupId}
                type="button"
                aria-current={isActive ? 'true' : undefined}
                aria-label={`Part ${index + 1}, ${partAnswered} of ${partTotal} answered${isActive ? ', current' : ''}`}
                onClick={() => {
                  if (!isActive && firstItem) onNavigate(firstItem.navigationId);
                }}
                className={`${pressClassName} flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[length:var(--student-control-font-size)] font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  isActive ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span className="truncate">Part {index + 1}</span>
                <span className="flex-shrink-0 text-[length:var(--student-meta-font-size)] font-medium text-gray-600">
                  {partAnswered}/{partTotal}
                </span>
              </button>
            );
          })}
        </div>

        <p className="hidden flex-shrink-0 whitespace-nowrap text-[length:var(--student-meta-font-size)] tabular-nums text-gray-600 sm:block">
          <span className="font-semibold text-gray-900">{answeredCount}</span> of {totalQuestions}{' '}
          answered
        </p>

        {items.length > 0 ? (
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              className={navButtonClassName}
              aria-label="Previous question"
              title="Previous question"
              disabled={!canGoPrevious}
              onClick={() => {
                if (previousItem) onNavigate(previousItem.navigationId);
              }}
            >
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <span className="min-w-[4.5rem] whitespace-nowrap text-center text-[length:var(--student-control-font-size)] font-semibold tabular-nums text-gray-900">
              <span className="sr-only">Current question </span>
              {currentItem ? currentItem.label : '—'} of {totalQuestions}
            </span>
            <button
              type="button"
              className={navButtonClassName}
              aria-label="Next question"
              title="Next question"
              disabled={!canGoNext}
              onClick={() => {
                if (nextItem) onNavigate(nextItem.navigationId);
              }}
            >
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {showSubmitButton ? (
          <Button
            variant={hasUnanswered ? 'warning' : 'primary'}
            size="sm"
            className="min-w-[4.5rem] flex-shrink-0"
            onClick={onSubmit}
          >
            Finish
          </Button>
        ) : null}
      </div>

      {activeItems.length > 0 ? (
        <div
          role="group"
          aria-label={`Part ${activePartIndex + 1} questions`}
          className="flex flex-wrap gap-1.5"
        >
          {activeItems.map((item) => {
            const isCurrent = item.current;
            const isFlagged = item.flagged;
            const isAnswered = item.answered;

            return (
              <button
                type="button"
                key={item.navigationId}
                onClick={() => onNavigate(item.navigationId)}
                className={`${pressClassName} relative flex size-12 items-center justify-center rounded-lg border text-[length:var(--student-chip-font-size)] font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 ${
                  isCurrent
                    ? 'border-blue-800 bg-blue-800 text-white hover:bg-blue-700'
                    : isFlagged
                      ? 'border-amber-700 bg-amber-100 text-amber-900 hover:bg-amber-200'
                      : isAnswered
                        ? 'border-green-700 bg-green-200 text-green-900 hover:bg-green-300'
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-100'
                }`}
                aria-label={`Question ${item.label}${isCurrent ? ', current' : ''}${isFlagged ? ', flagged' : ''}${isAnswered ? ', answered' : ', not answered'}`}
                aria-current={isCurrent ? 'true' : undefined}
              >
                {item.label}
                {/* Answered is also a shape (underline), not only green. */}
                {isAnswered && !isCurrent ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-current"
                  />
                ) : null}
                {isFlagged && !isCurrent ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border border-white bg-amber-700"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </footer>
  );
}
