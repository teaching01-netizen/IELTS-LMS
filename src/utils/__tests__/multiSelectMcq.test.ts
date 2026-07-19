import { describe, expect, it } from 'vitest';
import type { MultiMCQBlock } from '../../types';
import {
  getMultiSelectCorrectOptionIds,
  getMultiSelectSelectionLimit,
  removeMultiSelectOption,
  setMultiSelectCorrectOptionIds,
  setMultiSelectOptionCorrectness,
} from '../multiSelectMcq';

const buildBlock = (): MultiMCQBlock => ({
  id: 'multi-1',
  type: 'MULTI_MCQ',
  instruction: 'Choose all that apply.',
  stem: 'Which options are correct?',
  requiredSelections: 4,
  options: [
    { id: 'a', text: 'Alpha', isCorrect: true },
    { id: 'b', text: 'Beta', isCorrect: false },
    { id: 'c', text: 'Charlie', isCorrect: true },
  ],
});

describe('multiSelectMcq answer-key ownership', () => {
  it('derives the selection limit from marked options instead of stale requiredSelections', () => {
    const block = buildBlock();

    expect(getMultiSelectCorrectOptionIds(block)).toEqual(['a', 'c']);
    expect(getMultiSelectSelectionLimit(block)).toBe(2);
  });

  it('uses a safe runtime limit for malformed legacy blocks without inventing a correct answer', () => {
    const block = buildBlock();
    block.options = block.options.map((option) => ({ ...option, isCorrect: false }));

    expect(getMultiSelectCorrectOptionIds(block)).toEqual([]);
    expect(getMultiSelectSelectionLimit(block)).toBe(1);
  });

  it('synchronizes requiredSelections when correctness changes', () => {
    const next = setMultiSelectOptionCorrectness(buildBlock(), 'b', true);

    expect(getMultiSelectCorrectOptionIds(next)).toEqual(['a', 'b', 'c']);
    expect(next.requiredSelections).toBe(3);
  });

  it('refuses to clear or remove the final correct option', () => {
    const block = buildBlock();
    block.options = block.options.map((option) => ({
      ...option,
      isCorrect: option.id === 'a',
    }));
    block.requiredSelections = 1;

    expect(setMultiSelectOptionCorrectness(block, 'a', false)).toBe(block);
    expect(removeMultiSelectOption(block, 'a')).toBe(block);
  });

  it('keeps the compatibility count synchronized when removing an option', () => {
    const next = removeMultiSelectOption(buildBlock(), 'c');

    expect(next.options.map((option) => option.id)).toEqual(['a', 'b']);
    expect(next.requiredSelections).toBe(1);
  });

  it('rejects an empty answer-key edit and accepts one through all valid options', () => {
    const block = buildBlock();

    expect(setMultiSelectCorrectOptionIds(block, [])).toBe(block);

    const next = setMultiSelectCorrectOptionIds(block, ['a', 'b', 'c']);
    expect(getMultiSelectCorrectOptionIds(next)).toEqual(['a', 'b', 'c']);
    expect(next.requiredSelections).toBe(3);
  });
});
