import type { MCQOption, MultiMCQBlock } from '../types';

type MultiSelectAnswerKey = Pick<MultiMCQBlock, 'options'>;

export function getMultiSelectCorrectOptionIds(
  block: MultiSelectAnswerKey,
): string[] {
  return block.options
    .filter((option) => option.isCorrect)
    .map((option) => option.id);
}

export function getMultiSelectCorrectCount(
  block: MultiSelectAnswerKey,
): number {
  return getMultiSelectCorrectOptionIds(block).length;
}

export function getMultiSelectSelectionLimit(
  block: MultiSelectAnswerKey,
): number {
  return Math.max(1, getMultiSelectCorrectCount(block));
}

function withSynchronizedOptions(
  block: MultiMCQBlock,
  options: MCQOption[],
): MultiMCQBlock {
  return {
    ...block,
    options,
    requiredSelections: Math.max(
      1,
      options.filter((option) => option.isCorrect).length,
    ),
  };
}

export function setMultiSelectOptionCorrectness(
  block: MultiMCQBlock,
  optionId: string,
  isCorrect: boolean,
): MultiMCQBlock {
  const option = block.options.find((candidate) => candidate.id === optionId);
  if (!option || option.isCorrect === isCorrect) {
    return block;
  }

  if (
    !isCorrect
    && option.isCorrect
    && getMultiSelectCorrectCount(block) <= 1
  ) {
    return block;
  }

  return withSynchronizedOptions(
    block,
    block.options.map((candidate) => (
      candidate.id === optionId
        ? { ...candidate, isCorrect }
        : candidate
    )),
  );
}

export function removeMultiSelectOption(
  block: MultiMCQBlock,
  optionId: string,
): MultiMCQBlock {
  const option = block.options.find((candidate) => candidate.id === optionId);
  if (!option) {
    return block;
  }

  if (option.isCorrect && getMultiSelectCorrectCount(block) <= 1) {
    return block;
  }

  return withSynchronizedOptions(
    block,
    block.options.filter((candidate) => candidate.id !== optionId),
  );
}

export function setMultiSelectCorrectOptionIds(
  block: MultiMCQBlock,
  optionIds: Iterable<string>,
): MultiMCQBlock {
  const availableIds = new Set(block.options.map((option) => option.id));
  const correctIds = new Set(
    Array.from(optionIds).filter((optionId) => availableIds.has(optionId)),
  );

  if (correctIds.size === 0) {
    return block;
  }

  return withSynchronizedOptions(
    block,
    block.options.map((option) => ({
      ...option,
      isCorrect: correctIds.has(option.id),
    })),
  );
}
