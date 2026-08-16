import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Flag, X } from 'lucide-react';
import {
  countAnsweredQuestions,
  countQuestionSlots,
  getQuestionNumberLabel,
  isQuestionAnswered,
  isQuestionFullyAnswered,
  type StudentQuestionDescriptor,
} from '@student/application/studentExamContentFacade';
import type { StudentAnswer } from './providers/StudentRuntimeProvider';

interface QuestionNavigatorProps {
  questions: StudentQuestionDescriptor[];
  answers: Record<string, StudentAnswer | undefined>;
  flags: Record<string, boolean>;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
}

export function QuestionNavigator({
  questions,
  answers,
  flags,
  currentQuestionId,
  onNavigate,
  onClose,
}: QuestionNavigatorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
      queueMicrotask(() => previousActiveElementRef.current?.focus());
    };
  }, []);

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

  const totalQuestions = countQuestionSlots(questions);
  const answeredCount = countAnsweredQuestions(questions, answers);
  const flaggedCount = Object.values(flags).filter(Boolean).length;
  const partiallyAnsweredCount = questions.reduce(
    (count, question) =>
      count + (isQuestionAnswered(question, answers) && !isQuestionFullyAnswered(question, answers) ? 1 : 0),
    0,
  );

  const groups = questions.reduce<Record<string, StudentQuestionDescriptor[]>>((result, question) => {
    const existingGroup = result[question.groupId];
    if (existingGroup) {
      existingGroup.push(question);
    } else {
      result[question.groupId] = [question];
    }
    return result;
  }, {});

  const dialog = (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col p-0 backdrop:bg-black/50"
      aria-labelledby="question-navigator-title"
      aria-modal="true"
    >
      <div className="flex items-center justify-between p-3 md:p-4 border-b border-gray-200">
        <h2 id="question-navigator-title" className="text-base md:text-lg font-bold text-gray-900">
          Question Navigator
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="student-touch-target flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="Close question navigator"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-3 md:p-4 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-x-3 md:gap-x-5 gap-y-1.5 text-xs md:text-sm">
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="w-3.5 md:w-4 h-3.5 md:h-4 bg-blue-800 rounded-sm"></div>
          <span>Current</span>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="w-3.5 md:w-4 h-3.5 md:h-4 bg-green-800 rounded-sm flex items-center justify-center text-white text-[length:var(--student-meta-font-size)]">
            ✓
          </div>
          <span>Answered ({answeredCount})</span>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="w-3.5 md:w-4 h-3.5 md:h-4 bg-green-200 rounded-sm border border-green-700"></div>
          <span>Partially answered ({partiallyAnsweredCount})</span>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="w-3.5 md:w-4 h-3.5 md:h-4 bg-gray-100 rounded-sm border border-gray-200"></div>
          <span>Unanswered ({totalQuestions - answeredCount})</span>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="w-3.5 md:w-4 h-3.5 md:h-4 bg-amber-100 rounded-sm border border-amber-300 flex items-center justify-center">
            <Flag size={8} className="text-amber-700 fill-amber-700" />
          </div>
          <span>Flagged ({flaggedCount})</span>
        </div>
      </div>

      <div className="overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-8">
        {Object.entries(groups).map(([groupId, groupQuestions], groupIndex) => (
          <div key={groupId}>
            <h3 className="font-medium text-gray-700 mb-3 text-[length:var(--student-control-font-size)]">
              {groupQuestions[0]?.groupLabel || `Section ${groupIndex + 1}`}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,3.5rem))] gap-2 md:gap-2.5">
              {dedupeGroupedScoringSlots(groupQuestions).map((question) => {
                const isAnswered = isQuestionAnswered(question, answers);
                const isFullyComplete = isQuestionFullyAnswered(question, answers);
                const isFlagged = flags[question.id];
                const isCurrent = currentQuestionId === question.id;

                return (
                  <button
                    type="button"
                    key={question.id}
                    onClick={() => onNavigate(question.id)}
                    className={`
                      relative h-11 md:h-12 rounded-md border border-transparent flex items-center justify-center text-[length:var(--student-control-font-size)] font-medium transition-colors
                      ${isCurrent
                        ? 'bg-blue-800 text-white border-blue-800 hover:bg-blue-700'
                        : isFlagged
                          ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                          : isFullyComplete
                            ? 'bg-green-800 text-white hover:bg-green-900'
                            : isAnswered
                              ? 'bg-green-200 text-green-900 hover:bg-green-300'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                    `}
                  >
                    {getQuestionNumberLabel(questions, question.id)}
                    {isFlagged ? (
                      <div className="absolute -top-1 md:-top-1.5 -right-1 md:-right-1.5 w-3.5 md:w-4 h-3.5 md:h-4 bg-amber-500 rounded-full flex items-center justify-center shadow-sm">
                        <Flag size={6} className="text-white fill-white" />
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </dialog>
  );

  return typeof document === 'undefined' ? null : createPortal(dialog, document.body);
}
