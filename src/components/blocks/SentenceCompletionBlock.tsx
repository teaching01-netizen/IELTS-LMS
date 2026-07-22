import React from 'react';
import { SentenceCompletionBlock as SentenceCompletionBlockType, AnswerRule } from '../../types';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { createId } from '../../utils/idUtils';
import { countBlankPlaceholders } from '../../utils/blankPlaceholders';
import { handleBoldHotkey } from '../../utils/boldMarkdown';
import { AcceptedAnswersEditor } from './AcceptedAnswersEditor';
import {
  buildAcceptedAnswerFields,
  resolveAcceptedAnswers,
} from '../../utils/acceptedAnswers';
import { InsertedImagesEditor } from './InsertedImagesEditor';
import { maxVariantWordCountFromAcceptedAnswers, suggestUpgradedAnswerRule } from '../../utils/answerRuleAutoUpgrade';
import { countUniqueSharedSentenceKeys, getSharedSentenceAnswerPool } from '../../utils/sentenceCompletionAnswerPool';

interface SentenceCompletionBlockProps {
  block: SentenceCompletionBlockType;
  startNum: number;
  endNum: number;
  updateBlock: (block: SentenceCompletionBlockType) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
  errors?: Array<{ field: string; message: string }>;
  onAddSubAnswerAtSlot?: (slotIndex: number) => void;
}

export function SentenceCompletionBlock({
  block,
  startNum,
  endNum,
  updateBlock,
  deleteBlock,
  moveBlock,
  errors = [],
  onAddSubAnswerAtSlot,
}: SentenceCompletionBlockProps) {
  const updateInstruction = (instruction: string) => {
    updateBlock({ ...block, instruction });
  };

  const updateQuestion = (questionId: string, updates: { sentence?: string; answerRule?: AnswerRule }) => {
    const newQuestions = block.questions.map((q) => {
      if (q.id !== questionId) return q;

      const nextSentence = updates.sentence ?? q.sentence;
      const placeholderCount = countBlankPlaceholders(nextSentence);

      let nextBlanks = q.blanks;
      if (placeholderCount !== q.blanks.length) {
        nextBlanks = q.blanks.slice(0, placeholderCount);
        while (nextBlanks.length < placeholderCount) {
              nextBlanks = [
            ...nextBlanks,
            {
              id: createId('blank'),
              correctAnswer: '',
              acceptedAnswers: [],
              position: nextBlanks.length,
            },
          ];
        }
      }

      nextBlanks = nextBlanks.map((blank, index) => ({ ...blank, position: index }));

      const nextQuestion = { ...q, ...updates, sentence: nextSentence, blanks: nextBlanks };
      const requiredWords =
        nextQuestion.acceptAnyAnswerKey === true
          ? maxVariantWordCountFromAcceptedAnswers(getSharedSentenceAnswerPool(nextQuestion))
          : Math.max(
              0,
              ...nextQuestion.blanks.map((blank) =>
                maxVariantWordCountFromAcceptedAnswers(resolveAcceptedAnswers(blank)),
              ),
            );
      const upgrade = suggestUpgradedAnswerRule(nextQuestion.answerRule, requiredWords);
      return upgrade ? { ...nextQuestion, answerRule: upgrade } : nextQuestion;
    });

    updateBlock({ ...block, questions: newQuestions });
  };

  const updateBlank = (
    questionId: string,
    blankId: string,
    updates: { correctAnswer?: string; acceptedAnswers?: string[] },
  ) => {
    const newQuestions = block.questions.map((q) => {
      if (q.id !== questionId) return q;
      const newBlanks = q.blanks.map((b) => (b.id === blankId ? { ...b, ...updates } : b));
      const requiredWords = Math.max(
        0,
        ...newBlanks.map((blank) => maxVariantWordCountFromAcceptedAnswers(resolveAcceptedAnswers(blank))),
      );
      const upgrade = suggestUpgradedAnswerRule(q.answerRule, requiredWords);
      return upgrade ? { ...q, blanks: newBlanks, answerRule: upgrade } : { ...q, blanks: newBlanks };
    });
    updateBlock({ ...block, questions: newQuestions });
  };

  const updateQuestionSharedAnswerMode = (questionId: string, acceptAnyAnswerKey: boolean) => {
    const newQuestions = block.questions.map((question) => {
      if (question.id !== questionId) return question;

      if (!acceptAnyAnswerKey) {
        return { ...question, acceptAnyAnswerKey: false };
      }

      const questionWithSharedAnswerKeys = { ...question, acceptAnyAnswerKey: true };
      const sharedAcceptedAnswers =
        question.sharedAcceptedAnswers ?? getSharedSentenceAnswerPool(questionWithSharedAnswerKeys);
      const requiredWords = maxVariantWordCountFromAcceptedAnswers(sharedAcceptedAnswers);
      const upgrade = suggestUpgradedAnswerRule(question.answerRule, requiredWords);

      return upgrade
        ? { ...questionWithSharedAnswerKeys, sharedAcceptedAnswers, answerRule: upgrade }
        : { ...questionWithSharedAnswerKeys, sharedAcceptedAnswers };
    });

    updateBlock({ ...block, questions: newQuestions });
  };

  const updateSharedAcceptedAnswers = (questionId: string, sharedAcceptedAnswers: string[]) => {
    const newQuestions = block.questions.map((question) => {
      if (question.id !== questionId) return question;

      const requiredWords = maxVariantWordCountFromAcceptedAnswers(sharedAcceptedAnswers);
      const upgrade = suggestUpgradedAnswerRule(question.answerRule, requiredWords);
      return upgrade
        ? { ...question, sharedAcceptedAnswers, answerRule: upgrade }
        : { ...question, sharedAcceptedAnswers };
    });

    updateBlock({ ...block, questions: newQuestions });
  };

  const isGroupedScoringQuestion = (question: SentenceCompletionBlockType['questions'][number]): boolean =>
    question.blanks.some((blank) => Boolean(blank.scoreGroupId?.trim()));

  const getQuestionScoreCount = (question: SentenceCompletionBlockType['questions'][number]): number => {
    if (isGroupedScoringQuestion(question)) {
      return 1;
    }
    return Math.max(1, question.blanks.length);
  };

  const updateQuestionScoringMode = (questionId: string, mode: 'independent' | 'grouped_2_for_1') => {
    const newQuestions = block.questions.map((question) => {
      if (question.id !== questionId) return question;

      if (mode === 'independent') {
        return {
          ...question,
          blanks: question.blanks.map((blank) => ({
            ...(() => {
              const {
                scoreGroupId: _scoreGroupId,
                scoreWeight: _scoreWeight,
                groupRule: _groupRule,
                requiredCorrect: _requiredCorrect,
                ...rest
              } = blank;
              void _scoreGroupId;
              void _scoreWeight;
              void _groupRule;
              void _requiredCorrect;
              return rest;
            })(),
          })),
        };
      }

      return {
        ...question,
        blanks: question.blanks.map((blank, blankIndex) => ({
          ...blank,
          scoreGroupId: question.id,
          scoreWeight: blankIndex === 0 ? 1 : 0,
          groupRule: 'at_least_n',
          requiredCorrect: 2,
        })),
      };
    });
    updateBlock({ ...block, questions: newQuestions });
  };

  const addQuestion = () => {
    const newQuestion = {
      id: createId('q'),
      sentence: 'The ____ is important.',
      blanks: [{ id: createId('blank'), correctAnswer: '', acceptedAnswers: [], position: 0 }],
      answerRule: 'TWO_WORDS' as AnswerRule
    };
    updateBlock({ ...block, questions: [...block.questions, newQuestion] });
  };

  const removeQuestion = (questionId: string) => {
    const newQuestions = block.questions.filter(q => q.id !== questionId);
    updateBlock({ ...block, questions: newQuestions });
  };

  const getQuestionNumberLabel = (questionIndex: number) => {
    const offset = block.questions
      .slice(0, questionIndex)
      .reduce((count, q) => count + getQuestionScoreCount(q), 0);
    const start = startNum + offset;
    const currentQuestion = block.questions[questionIndex];
    const questionCount = currentQuestion ? getQuestionScoreCount(currentQuestion) : 1;
    const end = start + Math.max(0, questionCount - 1);
    if (questionCount <= 1) return `${start}`;
    return `${start}–${end}`;
  };

  const getQuestionSlotOffset = (questionIndex: number) =>
    block.questions
      .slice(0, questionIndex)
      .reduce((count, question) => count + question.blanks.length, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-sm shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Q{startNum}-{endNum}</span>
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">
            Sentence Completion
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => moveBlock(block.id, 'up')}
            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
            title="Move up"
          >
            <ArrowUp size={16} />
          </button>
          <button
            onClick={() => moveBlock(block.id, 'down')}
            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
            title="Move down"
          >
            <ArrowDown size={16} />
          </button>
          <button
            onClick={() => deleteBlock(block.id)}
            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
            title="Delete block"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Instruction */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Instruction
        </label>
        <textarea
          value={block.instruction}
          onChange={(e) => updateInstruction(e.target.value)}
          onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateInstruction(nextValue))}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Enter instruction for this question..."
        />
      </div>
      <InsertedImagesEditor
        images={block.insertedImages}
        onChange={(nextImages) => updateBlock({ ...block, insertedImages: nextImages })}
        errors={errors}
      />

      {/* Questions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">
            Sentences ({block.questions.length})
          </label>
          <button
            onClick={addQuestion}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={14} /> Add Sentence
          </button>
        </div>
        <div className="space-y-4">
          {block.questions.map((question, index) => (
            <div key={question.id} className="border rounded-md p-4">
              <div className="flex items-start justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">
                  {getQuestionNumberLabel(index)}.
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={isGroupedScoringQuestion(question) ? 'grouped_2_for_1' : 'independent'}
                    onChange={(event) =>
                      updateQuestionScoringMode(
                        question.id,
                        event.target.value as 'independent' | 'grouped_2_for_1',
                      )
                    }
                    className="text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="independent">Independent (1 slot = 1 point)</option>
                    <option value="grouped_2_for_1">Grouped (2 correct required = 1 point)</option>
                  </select>
                  <select
                    value={question.answerRule}
                    onChange={(e) => updateQuestion(question.id, { answerRule: e.target.value as AnswerRule })}
                    className="text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="ONE_WORD">One word only</option>
                    <option value="TWO_WORDS">No more than two words</option>
                    <option value="THREE_WORDS">No more than three words</option>
                  </select>
                  <label
                    htmlFor={`accept-any-answer-key-${question.id}`}
                    className="inline-flex items-center gap-1 text-xs text-gray-600"
                  >
                    <input
                      id={`accept-any-answer-key-${question.id}`}
                      type="checkbox"
                      checked={question.acceptAnyAnswerKey === true}
                      onChange={(event) =>
                        updateQuestionSharedAnswerMode(question.id, event.target.checked)
                      }
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Accept any answer key in this sentence</span>
                  </label>
                  <button
                    onClick={() => removeQuestion(question.id)}
                    className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                    title="Remove sentence"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {isGroupedScoringQuestion(question) ? (
                  <p className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                    Scoring: 2 answers required for 1 point
                  </p>
                ) : null}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Sentence (use ____ for blanks)
                  </label>
                  <textarea
                    value={question.sentence}
                    onChange={(e) => updateQuestion(question.id, { sentence: e.target.value })}
                    onKeyDown={(e) => handleBoldHotkey(e, (nextValue) => updateQuestion(question.id, { sentence: nextValue }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="Enter sentence with ____ for blanks..."
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Use <span className="font-mono">____</span> to create blanks. Answers below are generated automatically.
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-medium text-gray-600">
                      Blank Answers ({question.blanks.length})
                    </label>
                  </div>
                  {question.acceptAnyAnswerKey === true ? (
                    <div className="space-y-2">
                      <AcceptedAnswersEditor
                        value={getSharedSentenceAnswerPool(question)}
                        onChange={(next) => updateSharedAcceptedAnswers(question.id, next)}
                        placeholder="Answer..."
                        ariaLabel={`Shared accepted answers for sentence ${getQuestionNumberLabel(index)}`}
                      />
                      {countUniqueSharedSentenceKeys(question) < question.blanks.length ? (
                        <p
                          role="status"
                          aria-live="polite"
                          className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
                        >
                          This sentence has fewer unique answer keys than blanks. Students may not be able to receive full credit.
                        </p>
                      ) : null}
                    </div>
                  ) : question.blanks.length > 0 ? (
                    <div className="space-y-2">
                      {question.blanks.map((blank, blankIndex) => {
                        const slotOffset = getQuestionSlotOffset(index) + blankIndex;
                        return (
                        <div key={blank.id} className="flex items-center gap-2">
                          <div className="flex w-16 items-start justify-between pt-1">
                            <span className="text-xs text-gray-500">Blank {blankIndex + 1}:</span>
                            {onAddSubAnswerAtSlot ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onAddSubAnswerAtSlot(slotOffset);
                                }}
                                className="rounded-full border border-gray-300 bg-white p-0.5 text-gray-500 hover:border-blue-400 hover:text-blue-700"
                                title="Add sub-answer"
                                aria-label={`Add sub-answer to question ${startNum + slotOffset}.1`}
                              >
                                <Plus size={10} />
                              </button>
                            ) : null}
                          </div>
                          <div className="flex-1">
                            <AcceptedAnswersEditor
                              value={resolveAcceptedAnswers(blank)}
                              onChange={(next) =>
                                updateBlank(question.id, blank.id, buildAcceptedAnswerFields(next))
                              }
                              placeholder="Answer..."
                            />
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No blanks added yet</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
