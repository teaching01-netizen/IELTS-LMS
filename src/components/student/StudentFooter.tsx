import React from 'react';
import { Button } from '../ui/Button';
import {
  countQuestionSlots,
  getAnsweredSlotCount,
  getQuestionNumberLabel,
  isQuestionAnswered,
  type StudentQuestionDescriptor,
} from '@services/examAdapterService';
import type { StudentAnswer } from './providers/StudentRuntimeProvider';

interface StudentFooterProps {
  questions: StudentQuestionDescriptor[];
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  answers: Record<string, StudentAnswer | undefined>;
  flags?: Record<string, boolean>;
  onToggleFlag?: (id: string) => void;
  onSubmit: () => void;
}

export function StudentFooter({
  questions,
  currentQuestionId,
  onNavigate,
  answers,
  flags = {},
  onSubmit,
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
  const answeredCount = questions.reduce(
    (count, question) => count + getAnsweredSlotCount(question, answers),
    0,
  );
  const hasUnanswered = totalQuestions > 0 && answeredCount < totalQuestions;

  return (
    <footer
      className="border-t border-gray-200 bg-white flex flex-col flex-shrink-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.03)] max-h-32 md:max-h-28 lg:max-h-24"
      role="contentinfo"
      aria-label="Question navigation and progress"
    >
      <div className="flex items-center justify-between px-2 md:px-3 lg:px-4 py-1.5 md:py-2">
        <div className="flex items-center gap-2 md:gap-3 flex-1 overflow-x-auto">
          <div className="flex items-center gap-1 md:gap-1.5 px-1.5 md:px-2 py-0.5 bg-gray-50 rounded-sm flex-shrink-0">
            <span className="text-[9px] md:text-[10px] lg:text-[11px] font-black text-gray-900">
              {answeredCount}/{totalQuestions}
            </span>
          </div>
          <Button
            variant={hasUnanswered ? 'warning' : 'primary'}
            size="sm"
            className="min-w-[60px] md:min-w-[80px] shadow-md flex-shrink-0"
            onClick={onSubmit}
          >
            Finish
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 lg:px-4 pb-1.5 md:pb-2 overflow-x-auto">
        {passageGroups.map(({ groupId, groupQuestions, index }) => {
          const isActiveGroup = groupQuestions.some(
            (question) => question.id === currentQuestionId,
          );
          const partNumber = index + 1;
          const firstQuestionId = groupQuestions[0]?.id ?? null;
          const groupAnsweredSlots = groupQuestions.reduce(
            (count, question) => count + getAnsweredSlotCount(question, answers),
            0,
          );
          const groupTotalSlots = groupQuestions.reduce(
            (count, question) => count + (question.isMulti ? question.correctCount : 1),
            0,
          );
          const groupProgressPct =
            groupTotalSlots > 0 ? (groupAnsweredSlots / groupTotalSlots) * 100 : 0;

          return (
            <div
              key={groupId}
              className="flex items-center gap-1 md:gap-1.5 lg:gap-2 whitespace-nowrap flex-shrink-0"
            >
              {isActiveGroup ? (
                <div className="flex items-center gap-0.5 md:gap-1">
                  {groupQuestions.map((question) => {
                    const isCurrent = question.id === currentQuestionId;
                    const isFlagged = flags[question.id];
                    const isAnswered = isQuestionAnswered(question, answers);

                    return (
                      <button
                        key={question.id}
                        onClick={() => onNavigate(question.id)}
                        className={`relative text-[8px] md:text-[9px] lg:text-[10px] flex items-center justify-center min-w-[20px] md:min-w-[24px] lg:min-w-[28px] h-5 md:h-6 lg:h-7 px-0.5 md:px-1 rounded-sm font-bold border ${
                          isCurrent
                            ? 'bg-blue-800 border-blue-800 text-white'
                            : isFlagged
                              ? 'bg-amber-100 border-amber-700 text-amber-900'
                              : isAnswered
                                ? 'bg-blue-200 border-blue-500 text-blue-800'
                                : 'bg-white border-gray-100 text-gray-700'
                        }`}
                      >
                        {getQuestionNumberLabel(questions, question.id)}
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
                  className="flex items-center gap-1 md:gap-1.5 rounded-sm px-1 py-0.5 flex-shrink-0 cursor-pointer hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="w-8 md:w-10 lg:w-12 h-1 bg-gray-50 rounded-full overflow-hidden border border-gray-100">
                    <div
                      className="h-full bg-blue-800"
                      style={{
                        width: `${Math.max(0, Math.min(100, groupProgressPct))}%`,
                      }}
                    ></div>
                  </div>
                  <div className="flex items-center gap-1 text-[7px] md:text-[8px] lg:text-[9px] font-bold text-gray-500">
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
    </footer>
  );
}
