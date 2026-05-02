import React from 'react';
import type { QuestionAnswer } from '../../types';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import type { StudentQuestionDescriptor } from '../../services/examAdapterService';
import { ProtectedInput } from './ProtectedInput';
import { Flag } from 'lucide-react';

interface SubAnswerTreeQuestionListProps {
  questions: StudentQuestionDescriptor[];
  answers: Record<string, QuestionAnswer>;
  currentQuestionId: string | null;
  flags?: Record<string, boolean>;
  onToggleFlag?: ((id: string) => void) | undefined;
  tabletMode?: boolean;
  onAnswerChange: (
    answerKey: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta,
  ) => void;
}

export function SubAnswerTreeQuestionList({
  questions,
  answers,
  currentQuestionId,
  flags = {},
  onToggleFlag,
  tabletMode = false,
  onAnswerChange,
}: SubAnswerTreeQuestionListProps) {
  return (
    <div className="space-y-3">
      {questions.map((question) => {
        const slotId = question.id;
        const value = typeof answers[slotId] === 'string' ? (answers[slotId] as string) : '';
        const isCurrent = currentQuestionId === slotId;
        const isFlagged = Boolean(flags[slotId]);
        const prompt = typeof question.treePrompt === 'string' ? question.treePrompt.trim() : '';

        return (
          <div
            key={slotId}
            id={`question-${slotId}`}
            className={`rounded-lg border p-2 transition-colors ${
              isCurrent ? 'ring-2 ring-blue-500 ring-offset-2' : ''
            } ${isFlagged ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
          >
            <div className="space-y-2">
              {prompt ? <p className="text-sm text-gray-800">{prompt}</p> : null}
              <div className="flex items-start gap-3">
                <span className="min-w-[2.5rem] font-bold text-blue-700">{question.numberLabel}</span>
                <div className="flex-1">
                  <ProtectedInput
                    type="text"
                    name={slotId}
                    security={{ preventAutofill: true, preventAutocorrect: true }}
                    value={value}
                    onChange={(event) =>
                      onAnswerChange(slotId, event.target.value, {
                        interactionType: 'typing',
                        slotId,
                        slotValue: event.target.value,
                        slotCount: 1,
                        slotIndex: 0,
                      })
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Enter answer..."
                    aria-label={`Answer for question ${question.numberLabel}`}
                  />
                </div>
                {onToggleFlag ? (
                  <button
                    type="button"
                    onClick={() => onToggleFlag(slotId)}
                    className={`inline-flex ${tabletMode ? 'h-8 w-8' : 'h-9 w-9'} items-center justify-center rounded-full border transition-colors ${
                      isFlagged
                        ? 'border-amber-700 bg-amber-700 text-white'
                        : 'border-gray-300 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700'
                    }`}
                    aria-label={isFlagged ? 'Unflag question' : 'Flag question'}
                  >
                    <Flag size={14} className={isFlagged ? 'fill-current' : ''} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
