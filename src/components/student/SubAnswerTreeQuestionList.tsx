import React from 'react';
import type { QuestionAnswer } from '../../types';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import type { StudentQuestionDescriptor } from '../../services/examAdapterService';
import { ProtectedInput } from './ProtectedInput';
import { Flag } from 'lucide-react';
import { FormattedText } from './FormattedText';

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
  const rootOrder = new Map<string, number>();
  const groups: Array<{
    rootId: string;
    rootNumber: number;
    prompt: string;
    leaves: StudentQuestionDescriptor[];
  }> = [];

  questions.forEach((question) => {
    if (!rootOrder.has(question.rootId)) {
      rootOrder.set(question.rootId, groups.length);
      groups.push({
        rootId: question.rootId,
        rootNumber: question.rootNumber,
        prompt: '',
        leaves: [],
      });
    }
    const group = groups[rootOrder.get(question.rootId)!];
    if (!group) return;
    if (!group.prompt) {
      const prompt = typeof question.treePrompt === 'string' ? question.treePrompt.trim() : '';
      if (prompt) {
        group.prompt = prompt;
      }
    }
    group.leaves.push(question);
  });

  groups.forEach((group) => {
    group.leaves.sort((left, right) => {
      const order = left.rootLeafQuestionIds ?? right.rootLeafQuestionIds ?? [];
      const leftIndex = order.indexOf(left.id);
      const rightIndex = order.indexOf(right.id);
      if (leftIndex >= 0 && rightIndex >= 0) {
        return leftIndex - rightIndex;
      }
      return left.numberLabel.localeCompare(right.numberLabel, undefined, { numeric: true });
    });
  });

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.rootId} className="space-y-2">
          {group.prompt ? (
            <div className="flex gap-3">
              <span className="min-w-[1.75rem] font-bold text-gray-900">{group.rootNumber}.</span>
              <FormattedText as="span" className="text-gray-800" text={group.prompt} />
            </div>
          ) : null}
          <div className={`${tabletMode ? 'ml-0' : 'ml-9'} space-y-2`}>
            {group.leaves.map((leaf) => {
              const slotId = leaf.id;
              const value = typeof answers[slotId] === 'string' ? (answers[slotId] as string) : '';
              const isCurrent = currentQuestionId === slotId;
              const isFlagged = Boolean(flags[slotId]);
              const displayNumber = group.leaves.length > 1 ? leaf.numberLabel : String(group.rootNumber);

              return (
                <div
                  key={slotId}
                  id={`question-${slotId}`}
                  className={`rounded-lg p-1 transition-colors ${
                    isCurrent ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                  } ${isFlagged ? 'bg-amber-50' : ''}`}
                >
                  <div className={tabletMode ? 'flex flex-col items-stretch gap-2' : 'flex items-center gap-3'}>
                    <span className="min-w-[2.5rem] font-bold text-blue-700">{displayNumber}</span>
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
                        className="w-full rounded-md border-2 border-gray-300 px-4 py-2 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="Enter answer..."
                        aria-label={`Answer for question ${displayNumber}`}
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
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
