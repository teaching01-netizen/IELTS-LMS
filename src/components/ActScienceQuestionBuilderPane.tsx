import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  ACT_SCIENCE_SKILL_CATEGORIES,
  ActScienceStimulus,
  ActScienceSkillCategory,
  MCQOption,
  SingleMCQBlock,
  SingleMCQQuestion,
} from '../types';
import { createId } from '../utils/idUtils';
import { getImageUrlCandidates } from '../utils/imageUrl';

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

interface ActImagePreviewProps {
  src: string;
  alt: string;
  className: string;
}

function ActImagePreview({ src, alt, className }: ActImagePreviewProps) {
  const candidates = getImageUrlCandidates(src);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [hasError, setHasError] = useState(false);
  const resolvedSrc = candidates[candidateIndex] ?? '';

  useEffect(() => {
    setCandidateIndex(0);
    setHasError(false);
  }, [src]);

  if (!resolvedSrc || hasError) {
    return (
      <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Preview unavailable. Check the image URL.
      </p>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={() => {
        if (candidateIndex + 1 < candidates.length) {
          setCandidateIndex((current) => current + 1);
        } else {
          setHasError(true);
        }
      }}
    />
  );
}

export function createActScienceQuestion(id = createId('act_q')): SingleMCQQuestion {
  return {
    id,
    stem: '',
    skillCategory: 'interpretation_of_data',
    options: OPTION_LABELS.map((label, index) => ({
      id: createId('act_opt'),
      text: `Option ${label}`,
      isCorrect: index === 0,
    })),
  };
}

export function createActScienceBlock(id = createId('act_block')): SingleMCQBlock {
  const question = createActScienceQuestion(id);
  return {
    id,
    type: 'SINGLE_MCQ',
    instruction: '',
    stem: question.stem,
    options: question.options,
    questions: [question],
  };
}

function normalizeOptions(options: MCQOption[]): MCQOption[] {
  const normalized = options.slice(0, OPTION_LABELS.length).map((option) => ({
    ...option,
    text: option.text ?? '',
  }));

  while (normalized.length < OPTION_LABELS.length) {
    const index = normalized.length;
    normalized.push({
      id: createId('act_opt'),
      text: `Option ${OPTION_LABELS[index]}`,
      isCorrect: false,
    });
  }

  return normalized;
}

function getBlockQuestions(block: SingleMCQBlock): SingleMCQQuestion[] {
  if (Array.isArray(block.questions) && block.questions.length > 0) {
    return block.questions.map((question) => ({
      ...question,
      skillCategory: question.skillCategory ?? 'interpretation_of_data',
      options: normalizeOptions(question.options),
    }));
  }

  return [
    {
      id: block.id,
      stem: block.stem || '',
      skillCategory: 'interpretation_of_data',
      options: normalizeOptions(block.options),
    },
  ];
}

function syncBlockQuestions(block: SingleMCQBlock, questions: SingleMCQQuestion[]): SingleMCQBlock {
  const firstQuestion = questions[0];
  return {
    ...block,
    stem: firstQuestion?.stem ?? '',
    options: firstQuestion?.options ?? normalizeOptions([]),
    questions,
  };
}

interface QuestionEntry {
  blockIndex: number;
  questionIndex: number;
  question: SingleMCQQuestion;
  number: number;
}

export interface ActScienceQuestionBuilderPaneProps {
  stimulus: ActScienceStimulus;
  startNumber?: number;
  onChange: (nextStimulus: ActScienceStimulus) => void;
}

export function ActScienceQuestionBuilderPane({
  stimulus,
  startNumber = 1,
  onChange,
}: ActScienceQuestionBuilderPaneProps) {
  const entries: QuestionEntry[] = stimulus.blocks.flatMap((block, blockIndex) =>
    getBlockQuestions(block).map((question, questionIndex) => ({
      blockIndex,
      questionIndex,
      question,
      number: startNumber + 0,
    })),
  );

  entries.forEach((entry, index) => {
    entry.number = startNumber + index;
  });

  const updateStimulus = (update: (current: ActScienceStimulus) => ActScienceStimulus) => {
    onChange(update(stimulus));
  };

  const updateQuestion = (
    blockIndex: number,
    questionIndex: number,
    update: (question: SingleMCQQuestion) => SingleMCQQuestion,
  ) => {
    updateStimulus((current) => ({
      ...current,
      blocks: current.blocks.map((block, currentBlockIndex) => {
        if (currentBlockIndex !== blockIndex) {
          return block;
        }

        const questions = getBlockQuestions(block).map((question, currentQuestionIndex) =>
          currentQuestionIndex === questionIndex ? update(question) : question,
        );
        return syncBlockQuestions(block, questions);
      }),
    }));
  };

  const updateInstruction = (blockIndex: number, instruction: string) => {
    updateStimulus((current) => ({
      ...current,
      blocks: current.blocks.map((block, currentBlockIndex) =>
        currentBlockIndex === blockIndex ? { ...block, instruction } : block,
      ),
    }));
  };

  const removeQuestionImage = (blockIndex: number, questionIndex: number) => {
    updateQuestion(blockIndex, questionIndex, (current) => ({
      ...current,
      imageUrl: undefined,
    }));
  };

  const removeChoiceImage = (blockIndex: number, questionIndex: number, optionId: string) => {
    updateQuestion(blockIndex, questionIndex, (current) => ({
      ...current,
      options: current.options.map((candidate) =>
        candidate.id === optionId ? { ...candidate, imageUrl: undefined } : candidate,
      ),
    }));
  };

  const addQuestion = () => {
    updateStimulus((current) => {
      if (current.blocks.length === 0) {
        return { ...current, blocks: [createActScienceBlock()] };
      }

      const [firstBlock, ...remainingBlocks] = current.blocks;
      if (!firstBlock) {
        return current;
      }

      const questions = [...getBlockQuestions(firstBlock), createActScienceQuestion()];
      return {
        ...current,
        blocks: [syncBlockQuestions(firstBlock, questions), ...remainingBlocks],
      };
    });
  };

  const removeQuestion = (blockIndex: number, questionIndex: number) => {
    if (entries.length <= 1) {
      return;
    }

    updateStimulus((current) => ({
      ...current,
      blocks: current.blocks.map((block, currentBlockIndex) => {
        if (currentBlockIndex !== blockIndex) {
          return block;
        }

        const questions = getBlockQuestions(block).filter(
          (_question, currentQuestionIndex) => currentQuestionIndex !== questionIndex,
        );
        return syncBlockQuestions(block, questions.length > 0 ? questions : [createActScienceQuestion()]);
      }),
    }));
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">ACT Science</p>
          <h2 className="text-lg font-bold text-gray-900">Questions ({entries.length})</h2>
          <p className="mt-1 text-xs text-gray-500">
            Single-choice questions with four options. Choose one correct answer and one skill category.
          </p>
        </div>
        <button
          type="button"
          onClick={addQuestion}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          aria-label="Add ACT Science question"
        >
          <Plus size={14} /> Add Question
        </button>
      </div>

      {stimulus.blocks.map((block, blockIndex) => {
        const blockQuestions = getBlockQuestions(block);
        return (
          <div key={block.id} className="mb-5 space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <label className="mb-1 block text-xs font-semibold text-gray-700" htmlFor={`act-instruction-${block.id}`}>
                Question set instructions
              </label>
              <textarea
                id={`act-instruction-${block.id}`}
                value={block.instruction}
                onChange={(event) => updateInstruction(blockIndex, event.target.value)}
                rows={2}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                placeholder="Optional instructions for these questions..."
              />
            </div>

            {blockQuestions.map((question, questionIndex) => {
              const entry = entries.find(
                (candidate) =>
                  candidate.blockIndex === blockIndex && candidate.questionIndex === questionIndex,
              );
              const questionNumber = entry?.number ?? startNumber;

              return (
                <div key={question.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-gray-900">Question {questionNumber}</span>
                    <button
                      type="button"
                      onClick={() => removeQuestion(blockIndex, questionIndex)}
                      disabled={entries.length <= 1}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Remove question ${questionNumber}`}
                    >
                      <Trash2 size={14} /> Remove
                    </button>
                  </div>

                  <label className="mb-1 block text-xs font-semibold text-gray-700" htmlFor={`act-stem-${question.id}`}>
                    Question {questionNumber} stem
                  </label>
                  <textarea
                    id={`act-stem-${question.id}`}
                    value={question.stem}
                    onChange={(event) =>
                      updateQuestion(blockIndex, questionIndex, (current) => ({
                        ...current,
                        stem: event.target.value,
                      }))
                    }
                    rows={3}
                    className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter the ACT Science question..."
                  />

                  <div className="mb-4 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {question.imageUrl ? (
                        <button
                          type="button"
                          onClick={() => removeQuestionImage(blockIndex, questionIndex)}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-red-400 hover:text-red-700"
                          aria-label={`Remove image from question ${questionNumber} stem`}
                        >
                          <X size={14} /> Remove image
                        </button>
                      ) : null}
                    </div>
                    {question.imageUrl ? (
                      <ActImagePreview
                        src={question.imageUrl}
                        alt={`Question ${questionNumber} stem preview`}
                        className="max-h-40 max-w-full rounded-md border border-gray-200 object-contain"
                      />
                    ) : null}
                    <label
                      className="text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                      htmlFor={`act-question-image-url-${question.id}`}
                    >
                      Question image URL
                    </label>
                    <input
                      id={`act-question-image-url-${question.id}`}
                      type="url"
                      value={question.imageUrl ?? ''}
                      onChange={(event) =>
                        updateQuestion(blockIndex, questionIndex, (current) => ({
                          ...current,
                          imageUrl: event.target.value,
                        }))
                      }
                      aria-label={`Question ${questionNumber} image URL`}
                      placeholder="https://drive.google.com/file/d/... or https://example.com/image.png"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <label className="mb-1 block text-xs font-semibold text-gray-700" htmlFor={`act-skill-${question.id}`}>
                    Skill category for question {questionNumber}
                  </label>
                  <select
                    id={`act-skill-${question.id}`}
                    value={question.skillCategory ?? 'interpretation_of_data'}
                    onChange={(event) =>
                      updateQuestion(blockIndex, questionIndex, (current) => ({
                        ...current,
                        skillCategory: event.target.value as ActScienceSkillCategory,
                      }))
                    }
                    className="mb-4 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  >
                    {ACT_SCIENCE_SKILL_CATEGORIES.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-700">Answer choices (select the correct answer)</p>
                    {OPTION_LABELS.map((label, optionIndex) => {
                      const option = question.options[optionIndex];
                      if (!option) {
                        return null;
                      }

                      return (
                        <div key={option.id} className="flex items-start gap-2">
                          <input
                            type="radio"
                            name={`act-correct-${question.id}`}
                            checked={option.isCorrect}
                            onChange={() =>
                              updateQuestion(blockIndex, questionIndex, (current) => ({
                                ...current,
                                options: current.options.map((candidate) => ({
                                  ...candidate,
                                  isCorrect: candidate.id === option.id,
                                })),
                              }))
                            }
                            aria-label={`Correct answer ${label} for question ${questionNumber}`}
                          />
                          <span className="w-5 text-sm font-bold text-gray-700">{label}</span>
                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <input
                              type="text"
                              value={option.text}
                              onChange={(event) =>
                                updateQuestion(blockIndex, questionIndex, (current) => ({
                                  ...current,
                                  options: current.options.map((candidate) =>
                                    candidate.id === option.id
                                      ? { ...candidate, text: event.target.value }
                                      : candidate,
                                  ),
                                }))
                              }
                              aria-label={`Option ${label} text for question ${questionNumber}`}
                              className="min-w-0 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              {option.imageUrl ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeChoiceImage(blockIndex, questionIndex, option.id)
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-red-400 hover:text-red-700"
                                  aria-label={`Remove image from option ${label} question ${questionNumber}`}
                                >
                                  <X size={14} /> Remove image
                                </button>
                              ) : null}
                            </div>
                            {option.imageUrl ? (
                              <ActImagePreview
                                src={option.imageUrl}
                                alt={`Option ${label} preview`}
                                className="max-h-32 max-w-full rounded-md border border-gray-200 object-contain"
                              />
                            ) : null}
                            <label
                              className="text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                              htmlFor={`act-option-image-url-${question.id}-${option.id}`}
                            >
                              Option {label} image URL
                            </label>
                            <input
                              id={`act-option-image-url-${question.id}-${option.id}`}
                              type="url"
                              value={option.imageUrl ?? ''}
                              onChange={(event) =>
                                updateQuestion(blockIndex, questionIndex, (current) => ({
                                  ...current,
                                  options: current.options.map((candidate) =>
                                    candidate.id === option.id
                                      ? { ...candidate, imageUrl: event.target.value }
                                      : candidate,
                                  ),
                                }))
                              }
                              aria-label={`Option ${label} image URL for question ${questionNumber}`}
                              placeholder="https://drive.google.com/file/d/... or https://example.com/image.png"
                              className="min-w-0 w-full rounded-md border border-gray-300 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {entries.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No questions yet. Add the first ACT Science question to this stimulus.
        </div>
      )}
    </div>
  );
}

