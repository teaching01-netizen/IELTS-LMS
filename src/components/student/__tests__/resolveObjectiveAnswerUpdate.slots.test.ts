import { describe, expect, it } from 'vitest';
import { resolveObjectiveAnswerUpdate } from '../resolveObjectiveAnswerUpdate';

describe('resolveObjectiveAnswerUpdate slot-based updates', () => {
  describe('scalar answer without slot metadata', () => {
    it('replaces currentValue with scalar answer', () => {
      const result = resolveObjectiveAnswerUpdate(undefined, 'A');
      expect(result).toBe('A');
    });

    it('replaces array currentValue with scalar answer', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B'], 'C');
      expect(result).toBe('C');
    });

    it('handles null answer', () => {
      const result = resolveObjectiveAnswerUpdate('A', null as any);
      expect(result).toBeNull();
    });

    it('handles undefined answer', () => {
      const result = resolveObjectiveAnswerUpdate('A', undefined as any);
      expect(result).toBeUndefined();
    });
  });

  describe('slot-based updates with slotIndex', () => {
    it('creates array from scratch when currentValue is undefined', () => {
      const result = resolveObjectiveAnswerUpdate(undefined, 'A', {
        slotIndex: 0,
        slotCount: 1,
        slotValue: 'A',
      });
      expect(result).toEqual(['A']);
    });

    it('updates first slot of existing array', () => {
      const result = resolveObjectiveAnswerUpdate(['old', 'B'], 'new', {
        slotIndex: 0,
        slotCount: 2,
        slotValue: 'new',
      });
      expect(result).toEqual(['new', 'B']);
    });

    it('updates second slot of existing array', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'old'], 'new', {
        slotIndex: 1,
        slotCount: 2,
        slotValue: 'new',
      });
      expect(result).toEqual(['A', 'new']);
    });

    it('expands array when slotIndex exceeds current length', () => {
      const result = resolveObjectiveAnswerUpdate(['A'], 'C', {
        slotIndex: 2,
        slotCount: 3,
        slotValue: 'C',
      });
      expect(result).toEqual(['A', '', 'C']);
    });

    it('uses slotValue from answer array when slotValue is not provided', () => {
      const result = resolveObjectiveAnswerUpdate([], ['X', 'Y', 'Z'], {
        slotIndex: 1,
        slotCount: 3,
      });
      expect(result).toEqual(['', 'Y', '']);
    });

    it('uses slotValue property when provided', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B'], 'ignored', {
        slotIndex: 1,
        slotCount: 2,
        slotValue: 'override',
      });
      expect(result).toEqual(['A', 'override']);
    });

    it('defaults to empty string when answer is null and no slotValue', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B'], null as any, {
        slotIndex: 0,
        slotCount: 2,
      });
      expect(result).toEqual(['', 'B']);
    });

    it('defaults to empty string when answer is undefined and no slotValue', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B'], undefined as any, {
        slotIndex: 0,
        slotCount: 2,
      });
      expect(result).toEqual(['', 'B']);
    });

    it('preserves existing slots when updating a different slot', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B', 'C'], 'new', {
        slotIndex: 1,
        slotCount: 3,
        slotValue: 'new',
      });
      expect(result).toEqual(['A', 'new', 'C']);
    });

    it('handles slotIndex 0 with empty array', () => {
      const result = resolveObjectiveAnswerUpdate([], 'first', {
        slotIndex: 0,
        slotCount: 1,
        slotValue: 'first',
      });
      expect(result).toEqual(['first']);
    });
  });

  describe('array answer without slot metadata', () => {
    it('merges shorter array into longer currentValue', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B', 'C'], ['X'], undefined);
      expect(result).toEqual(['X', 'B', 'C']);
    });

    it('merges shorter currentValue with longer array', () => {
      const result = resolveObjectiveAnswerUpdate(['A'], ['X', 'Y', 'Z'], undefined);
      expect(result).toEqual(['X', 'Y', 'Z']);
    });

    it('handles equal length arrays', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B'], ['X', 'Y'], undefined);
      expect(result).toEqual(['X', 'Y']);
    });

    it('handles empty arrays', () => {
      const result = resolveObjectiveAnswerUpdate([], [], undefined);
      expect(result).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('handles slotCount larger than slotIndex', () => {
      const result = resolveObjectiveAnswerUpdate([], 'val', {
        slotIndex: 0,
        slotCount: 5,
        slotValue: 'val',
      });
      expect(result).toEqual(['val', '', '', '', '']);
    });

    it('handles slotCount smaller than slotIndex', () => {
      const result = resolveObjectiveAnswerUpdate([], 'val', {
        slotIndex: 3,
        slotCount: 2,
        slotValue: 'val',
      });
      expect(result).toEqual(['', '', '', 'val']);
    });

    it('handles negative slotIndex (treated as no slot intent)', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B'], 'C', {
        slotIndex: -1,
      } as any);
      expect(result).toBe('C');
    });

    it('handles non-integer slotIndex (treated as no slot intent)', () => {
      const result = resolveObjectiveAnswerUpdate(['A', 'B'], 'C', {
        slotIndex: 1.5,
      } as any);
      expect(result).toBe('C');
    });
  });
});
