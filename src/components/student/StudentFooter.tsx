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
import type { StudentLayoutMode } from './layout/studentLayoutMode';
import { CompactQuestionNavigation } from './layout/CompactQuestionNavigation';

const pressClassName =
  'transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out';

// P4: Previous/Next live in the ONE global navigator. Forward movement reads
// slightly easier than backward movement; neither scales or moves on press
// (the exam control recipe forbids geometry change), which is why these are not
// the shared Button — its press is a scale animation.
const navButtonBase =
  `${pressClassName} inline-flex flex-shrink-0 items-center justify-center gap-1 rounded-sm border px-2.5 h-8 md:h-9 text-[length:var(--student-control-font-size,0.9375rem)] font-semibold ` +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-inherit';
const navButtonSecondaryClassName = `${navButtonBase} border-gray-300 bg-white text-gray-800 hover:bg-gray-50 active:bg-gray-100`;
const navButtonPrimaryClassName = `${navButtonBase} border-gray-900 bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-950`;

interface StudentFooterProps {
  questions: StudentQuestionDescriptor[];
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  answers: Record<string, StudentAnswer | undefined>;
  flags?: Record<string, boolean>;
  onToggleFlag?: (id: string) => void;
  onSubmit: () => void;
  showSubmitButton?: boolean | undefined;
  tabletMode?: boolean | undefined;
  layoutMode?: StudentLayoutMode | undefined;
  onOpenNavigator?: (() => void) | undefined;
}

export function StudentFooter({
  questions,
  currentQuestionId,
  onNavigate,
  answers,
  flags = {},
  onSubmit,
  showSubmitButton = true,
  tabletMode = false,
  layoutMode,
  onOpenNavigator,
}: StudentFooterProps) {
  const groupedQuestions = questions.reduce<Record<string, StudentQuestionDescriptor[]>>(
    (groups, question) => {
      const existingGroup = groups[question.groupId];
      if (existingGroup) {
        existingGroup.push(question);
      } else {
        groups[question.groupId] = [question];
      }
      return groups;
    },
    {},
  );

  const passageGroups = Object.entries(groupedQuestions).map(([groupId, groupQuestions], index) => ({
    groupId,
    groupQuestions,
    index,
  }));

  const totalQuestions = countQuestionSlots(questions);
  const answeredCount = countAnsweredQuestions(questions, answers);
  const hasUnanswered = totalQuestions > 0 && answeredCount < totalQuestions;

  // P3.5: chips, compact previous/current/next, and the question sheet all
  // read the same derived view model.
  const navigationViewModel = getStudentQuestionNavigationViewModel({
    questions,
    answers,
    flags,
    currentQuestionId,
  });
  // P4: the same derived view model feeds the chips, the position readout, and
  // Previous/Next — one active question, one source of truth.
  const { items: navigationItems, currentIndex, canGoPrevious, canGoNext } = navigationViewModel;
  // The readout must never invent a position: it reports the question the
  // shared view model actually marks current.
  const currentItem = navigationItems.find((item) => item.current);
  const previousItem = canGoPrevious ? navigationItems[currentIndex - 1] : undefined;
  const nextItem = canGoNext ? navigationItems[currentIndex + 1] : undefined;
  const itemsByGroup = new Map<string, StudentQuestionNavigationItem[]>();
  for (const item of navigationViewModel.items) {
    const list = itemsByGroup.get(item.groupId);
    if (list) {
      list.push(item);
    } else {
      itemsByGroup.set(item.groupId, [item]);
    }
  }

  if (layoutMode === 'compact' || layoutMode === 'phone') {
    return (
      <CompactQuestionNavigation
        questions={questions}
        currentQuestionId={currentQuestionId}
        onNavigate={onNavigate}
        onOpenNavigator={onOpenNavigator}
        onSubmit={onSubmit}
        showSubmitButton={showSubmitButton}
        answers={answers}
        flags={flags}
      />
    );
  }

  return (
    <footer
      className={`student-exam-footer flex flex-col ${
        tabletMode ? 'max-h-24 md:max-h-24' : 'max-h-32 md:max-h-28 lg:max-h-24'
      }`}
      role="contentinfo"
      aria-label="Question navigation and progress"
    >
      <div
        className={`flex items-center gap-2 overflow-x-auto overscroll-x-contain md:gap-3 px-2 md:px-3 lg:px-4 ${tabletMode ? 'py-1' : 'py-1.5 md:py-2'}`}
        data-testid="student-footer-row"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto md:gap-3">
          {passageGroups.map(({ groupId, groupQuestions, index }) => {
          const isActiveGroup = groupQuestions.some(
            (question) => question.id === currentQuestionId,
          );
          const partNumber = index + 1;
          const firstQuestionId = groupQuestions[0]?.id ?? null;
          const groupTotalSlots = countQuestionSlots(groupQuestions);
          const groupAnsweredSlots = countAnsweredQuestions(groupQuestions, answers);
          const groupProgressPct =
            groupTotalSlots > 0 ? (groupAnsweredSlots / groupTotalSlots) * 100 : 0;

          return (
            <div
              key={groupId}
              className="flex items-center gap-1 md:gap-1.5 lg:gap-2 whitespace-nowrap flex-shrink-0"
            >
              {isActiveGroup ? (
                <div className="flex items-center gap-0.5 md:gap-1">
                  {(itemsByGroup.get(groupId) ?? []).map((item) => {
                    const isCurrent = item.current;
                    const isFlagged = item.flagged;
                    const isAnswered = item.answered;
                    const displayLabel = item.label;

                    return (
                      <button
                        type="button"
                        key={item.navigationId}
                        onClick={() => onNavigate(item.navigationId)}
                        className={`${pressClassName} relative text-[length:var(--student-chip-font-size)] flex items-center justify-center min-w-[1.6rem] min-h-6 md:min-w-[1.8rem] lg:min-w-[2rem] h-6 md:h-7 lg:h-8 px-1 md:px-1.5 rounded-sm font-bold border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 ${
                          isCurrent
                            ? 'bg-blue-800 border-blue-800 text-white hover:bg-blue-700'
                            : isFlagged
                              ? 'bg-amber-100 border-amber-700 text-amber-900 hover:bg-amber-200'
                              : isAnswered
                                ? 'bg-green-200 border-green-700 text-green-900 hover:bg-green-300'
                                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                        aria-label={`Question ${displayLabel}${isCurrent ? ', current' : ''}${isFlagged ? ', flagged' : ''}${isAnswered ? ', answered' : ', not answered'}`}
                        aria-current={isCurrent ? 'true' : undefined}
                      >
                        {displayLabel}
                        {isFlagged && !isCurrent ? (
                          <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-700 rounded-full border border-white"></div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!firstQuestionId}
                  onClick={() => {
                    if (firstQuestionId) {
                      onNavigate(firstQuestionId);
                    }
                  }}
                  aria-label={`Jump to Part ${partNumber}`}
                  title={`Click to jump to Part ${partNumber}`}
                  className={`${pressClassName} min-h-6 min-w-6 flex items-center gap-1 md:gap-1.5 rounded-sm px-1 py-0.5 flex-shrink-0 cursor-pointer hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <div className="w-8 md:w-10 lg:w-12 h-1 bg-gray-50 rounded-full overflow-hidden border border-gray-100">
                    <div
                      className="h-full bg-blue-800 transition-[width] duration-300 ease-out"
                      style={{
                        width: `${Math.max(0, Math.min(100, groupProgressPct))}%`,
                      }}
                    ></div>
                  </div>
                  <div className="flex items-center gap-1 text-[length:var(--student-meta-font-size)] font-bold text-gray-500">
                    <span>
                      {groupAnsweredSlots}/{groupTotalSlots}
                    </span>
                    <span className="underline decoration-dotted underline-offset-2">
                      Part {partNumber}
                    </span>
                  </div>
                </button>
              )}
              {index < passageGroups.length - 1 ? (
                <div className="w-px h-3 md:h-4 lg:h-5 bg-gray-200 mx-0.5"></div>
              ) : null}
            </div>
          );
          })}
        </div>
        <div className="flex flex-shrink-0 items-center rounded-sm bg-gray-50 px-2 py-1 md:px-2.5">
          <span className="text-[length:var(--student-chip-font-size)] font-semibold tabular-nums text-gray-900">
            {answeredCount}/{totalQuestions}
          </span>
        </div>
        {/* P4: the global navigator is the single navigation authority. The
            position readout and the two arrows read from the same active
            question as the chip rail, so the bar can never disagree with
            itself. */}
        {navigationViewModel.items.length > 0 ? (
          <div className="flex flex-shrink-0 items-center gap-1 md:gap-1.5">
            <span className="hidden whitespace-nowrap text-[length:var(--student-chip-font-size)] font-semibold tabular-nums text-gray-500 sm:inline">
              <span className="sr-only">Current question </span>
              {currentItem ? currentItem.label : '—'} of {totalQuestions}
            </span>
            <button
              type="button"
              className={navButtonSecondaryClassName}
              aria-label="Previous question"
              disabled={!canGoPrevious}
              onClick={() => {
                if (previousItem) onNavigate(previousItem.navigationId);
              }}
            >
              <ChevronLeft size={18} aria-hidden="true" /> Previous
            </button>
            <button
              type="button"
              className={navButtonPrimaryClassName}
              aria-label="Next question"
              disabled={!canGoNext}
              onClick={() => {
                if (nextItem) onNavigate(nextItem.navigationId);
              }}
            >
              Next <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {showSubmitButton ? (
          <Button
            variant={hasUnanswered ? 'warning' : 'primary'}
            size="sm"
            className="min-w-[4.25rem] flex-shrink-0 md:min-w-[5rem]"
            onClick={onSubmit}
          >
            Finish
          </Button>
        ) : null}
      </div>
    </footer>
  );
}
