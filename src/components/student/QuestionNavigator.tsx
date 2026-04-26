import React from 'react';
import { Flag, X } from 'lucide-react';
import {
  countQuestionSlots,
  getAnsweredSlotCount,
  getQuestionNumberLabel,
  isQuestionAnswered,
  isQuestionFullyAnswered,
  type StudentQuestionDescriptor,
} from '@services/examAdapterService';
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
  const totalQuestions = countQuestionSlots(questions);
  const answeredCount = questions.reduce(
    (count, question) => count + getAnsweredSlotCount(question, answers),
    0,
  );
  const flaggedCount = Object.values(flags).filter(Boolean).length;

  const groups = questions.reduce<Record<string, StudentQuestionDescriptor[]>>((result, question) => {
    const existingGroup = result[question.groupId];
    if (existingGroup) {
      existingGroup.push(question);
    } else {
      result[question.groupId] = [question];
    }
    return result;
  }, {});

  return (
    <div
      className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="question-navigator-title"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-3 md:p-4 border-b border-gray-200">
          <h2 id="question-navigator-title" className="text-base md:text-lg font-bold text-gray-900">
            Question Navigator
          </h2>
          <button
            onClick={onClose}
            className="p-2 md:p-2.5 text-gray-500 hover:bg-gray-100 rounded-md"
            aria-label="Close question navigator"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-3 md:p-4 border-b border-gray-100 bg-gray-50 flex gap-2 md:gap-4 text-xs md:text-sm">
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="w-3 md:w-4 h-3 md:h-4 bg-green-500 rounded-sm flex items-center justify-center text-white text-[length:var(--student-meta-font-size)]">
              ✓
            </div>
            <span>Answered ({answeredCount})</span>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="w-3 md:w-4 h-3 md:h-4 bg-gray-200 rounded-sm"></div>
            <span>Unanswered ({totalQuestions - answeredCount})</span>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="w-3 md:w-4 h-3 md:h-4 bg-amber-500 rounded-sm flex items-center justify-center text-white">
              <Flag size={8} className="fill-white" />
            </div>
            <span>Flagged ({flaggedCount})</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-8">
          {Object.entries(groups).map(([groupId, groupQuestions], groupIndex) => (
            <div key={groupId}>
              <h3 className="font-medium text-gray-700 mb-3 text-[length:var(--student-control-font-size)]">
                Section {groupIndex + 1}
              </h3>
              <div className="flex flex-wrap gap-2">
                {groupQuestions.map((question) => {
                  const isAnswered = isQuestionAnswered(question, answers);
                  const isFullyComplete = isQuestionFullyAnswered(question, answers);
                  const isFlagged = flags[question.id];
                  const isCurrent = currentQuestionId === question.id;

                  return (
                    <button
                      key={question.id}
                      onClick={() => onNavigate(question.id)}
                      className={`
                        relative ${question.isMulti ? 'px-2.5 md:px-3 min-w-[2.75rem] md:min-w-[3.25rem]' : 'w-11 md:w-12'} h-11 md:h-12 rounded-md flex items-center justify-center text-[length:var(--student-control-font-size)] font-medium transition-all
                        ${isCurrent ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                        ${isFullyComplete ? 'bg-green-500 text-white hover:bg-green-600' : isAnswered ? 'bg-green-200 text-green-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                        ${isFlagged && !isAnswered ? 'bg-amber-100 text-amber-800 border border-amber-300' : ''}
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
      </div>
    </div>
  );
}
