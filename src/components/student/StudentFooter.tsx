import React from 'react';
import { Button } from '../ui/Button';
import {
  countAnsweredQuestions,
  countQuestionSlots,
  getQuestionNumberLabel,
  isQuestionAnswered,
  type StudentQuestionDescriptor,
} from '@student/application/studentExamContentFacade';
import type { StudentAnswer } from './providers/StudentRuntimeProvider';
import type { StudentLayoutMode } from './layout/studentLayoutMode';
import { CompactQuestionNavigation } from './layout/CompactQuestionNavigation';

const pressClassName =
  'transition-[scale,background-color,border-color,box-shadow,opacity] duration-150 ease-out active:scale-[0.96]';

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
  const dedupeGroupedScoringSlots = React.useCallback(
    (items: StudentQuestionDescriptor[]) => {
      const seen = new Set<string>();
      const out: StudentQuestionDescriptor[] = [];
      for (const item of items) {
        const key =
          typeof item.rootId === 'string' && item.rootId.includes('::group::')
            ? item.rootId
            : item.id;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    },
    [],
  );

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

  if (layoutMode === 'compact') {
    return (
      <CompactQuestionNavigation
        questions={questions}
        currentQuestionId={currentQuestionId}
        onNavigate={onNavigate}
        onOpenNavigator={onOpenNavigator}
        onSubmit={onSubmit}
        showSubmitButton={showSubmitButton}
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
                  {dedupeGroupedScoringSlots(groupQuestions).map((question) => {
                    const isCurrent = question.id === currentQuestionId;
                    const isFlagged = Boolean(flags[question.id]);
                    const isAnswered = isQuestionAnswered(question, answers);
                    const displayLabel = getQuestionNumberLabel(questions, question.id);
                    const targetQuestionId = question.id;

                    return (
                      <button
                        key={targetQuestionId}
                        onClick={() => onNavigate(targetQuestionId)}
                        className={`${pressClassName} relative text-[length:var(--student-chip-font-size)] flex items-center justify-center min-w-[1.6rem] md:min-w-[1.8rem] lg:min-w-[2rem] h-6 md:h-7 lg:h-8 px-1 md:px-1.5 rounded-sm font-bold border ${
                          isCurrent
                            ? 'bg-blue-800 border-blue-800 text-white hover:bg-blue-700'
                            : isFlagged
                              ? 'bg-amber-100 border-amber-700 text-amber-900 hover:bg-amber-200'
                              : isAnswered
                                ? 'bg-green-200 border-green-700 text-green-900 hover:bg-green-300'
                                : 'bg-white border-gray-100 text-gray-700 hover:bg-gray-100'
                        }`}
                        aria-label={displayLabel}
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
                  className={`${pressClassName} flex items-center gap-1 md:gap-1.5 rounded-sm px-1 py-0.5 flex-shrink-0 cursor-pointer hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60`}
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
        {showSubmitButton && !tabletMode ? (
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
