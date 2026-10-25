import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
const focusClassName =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1';
// 36px with a mouse, 44px under touch (HIG minimum) — one height for every control.
const controlHeightClassName = 'h-9 min-w-9 pointer-coarse:h-11 pointer-coarse:min-w-11';

// Chips start at full size and shrink (not wrap) when a long part meets a
// narrow screen, so the bar stays one row; past the minimum the rail scrolls
// and keeps the current question in view.
const chipHeightClassName = 'h-9 pointer-coarse:h-11';
const chipWidthClassName = 'w-9 min-w-7 pointer-coarse:w-11';
const wideChipWidthClassName = 'w-14 min-w-12 pointer-coarse:w-16';

const navButtonClassName = `${pressClassName} ${focusClassName} ${controlHeightClassName} flex flex-shrink-0 items-center justify-center rounded-lg text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent`;

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
 * IELTS question footer for tablet widths, laid out like the computer-delivered
 * test: one full-width track where the active part expands inline to its
 * question numbers and every other part stretches to fill the rest as a
 * "Part N a/b" tab. Finish shows only when submission is offered (self-paced);
 * proctored delivery hides it.
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

  const activeChipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeChipsRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [currentQuestionId]);

  return (
    <footer
      className="student-exam-footer student-ielts-footer @container flex items-center gap-2 md:gap-3"
      role="contentinfo"
      aria-label="Question navigation and progress"
    >
      <div
        role="group"
        aria-label="Parts"
        className="flex min-w-0 flex-1 items-center gap-1 rounded-xl bg-gray-100 p-0.5"
      >
        {parts.map((part, index) => {
          const partNumber = index + 1;

          if (part.groupId === activeGroupId) {
            return (
              <div
                key={part.groupId}
                className="flex min-w-0 items-center gap-1 rounded-lg bg-white py-0.5 pr-0.5 shadow-sm"
              >
                <span
                  aria-hidden="true"
                  className={`${controlHeightClassName} flex flex-shrink-0 items-center whitespace-nowrap px-2 text-[length:var(--student-control-font-size)] font-semibold text-gray-950`}
                >
                  Part {partNumber}
                </span>
                <div
                  ref={activeChipsRef}
                  role="group"
                  aria-label={`Part ${partNumber} questions`}
                  className="flex min-w-0 gap-0.5 overflow-x-auto p-0.5 @4xl:gap-1"
                >
                  {part.items.map((item) => {
                    const isCurrent = item.current;
                    const isFlagged = item.flagged;
                    const isAnswered = item.answered;

                    return (
                      <button
                        type="button"
                        key={item.navigationId}
                        onClick={() => onNavigate(item.navigationId)}
                        className={`${pressClassName} ${focusClassName} ${chipHeightClassName} ${
                          item.label.length > 2 ? wideChipWidthClassName : chipWidthClassName
                        } relative flex items-center justify-center whitespace-nowrap rounded-lg border text-[length:var(--student-chip-font-size)] font-bold tabular-nums ${
                          isCurrent
                            ? 'border-blue-800 bg-blue-800 text-white hover:bg-blue-700'
                            : isFlagged
                              ? 'border-amber-700 bg-amber-100 text-amber-900 hover:bg-amber-200'
                              : isAnswered
                                ? 'border-green-700 bg-green-200 text-green-900 hover:bg-green-300'
                                : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
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
              </div>
            );
          }

          const partQuestions = questions.filter((question) => question.groupId === part.groupId);
          const partTotal = countQuestionSlots(partQuestions);
          const partAnswered = countAnsweredQuestions(partQuestions, answers);
          const firstItem = part.items[0];

          return (
            <button
              type="button"
              aria-label={`Part ${partNumber}, ${partAnswered} of ${partTotal} answered`}
              onClick={() => {
                if (firstItem) onNavigate(firstItem.navigationId);
              }}
              className={`${pressClassName} ${focusClassName} ${chipHeightClassName} flex min-w-fit flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[length:var(--student-control-font-size)] @4xl:px-2.5 font-semibold tabular-nums text-gray-700 hover:bg-gray-200`}
            >
              Part {partNumber}
              <span className="hidden text-[length:var(--student-meta-font-size)] font-medium text-gray-500 @4xl:inline">
                {partAnswered}/{partTotal}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {items.length > 0 ? (
          <>
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
          </>
        ) : null}

        {showSubmitButton ? (
          <button
            type="button"
            onClick={onSubmit}
            className={`${pressClassName} ${focusClassName} ${controlHeightClassName} ml-1 flex flex-shrink-0 items-center rounded-lg bg-gray-900 px-4 text-[length:var(--student-control-font-size)] font-semibold text-white hover:bg-gray-800 active:bg-gray-950`}
          >
            Finish
          </button>
        ) : null}
      </div>
    </footer>
  );
}
