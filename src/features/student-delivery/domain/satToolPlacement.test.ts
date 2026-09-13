import { describe, expect, it } from 'vitest';
import {
  CASCADE_OFFSET,
  canFitBoth,
  canFitBothTools,
  placeSatTool,
  satOverlapArea,
  satPlacementCandidates,
  scoreSatPlacementCandidate,
  type SatPlacementInput,
} from './satToolPlacement';

const VIEWPORT = { w: 1280, h: 800 };
const SAFE = { top: 112, right: 16, bottom: 86, left: 16 };
const CALC = { w: 460, h: 560 };

function baseInput(overrides: Partial<SatPlacementInput> = {}): SatPlacementInput {
  return {
    tool: CALC,
    viewport: VIEWPORT,
    safeArea: SAFE,
    question: null,
    existing: [],
    trigger: null,
    lastPosition: null,
    ...overrides,
  };
}

describe('satToolPlacement', () => {
  it('lands on the RIGHT edge with an empty exam (candidate order, ties break right-first)', () => {
    const at = placeSatTool(baseInput());
    // maxX = 1280 - 16 - 460 = 804, minY = top = 112.
    expect(at).toEqual({ x: 804, y: 112 });
  });

  it('keeps the tool off the question: question on the left still lands right', () => {
    const question = { x: 16, y: 112, w: 500, h: 600 };
    const at = placeSatTool(baseInput({ question }));
    expect(at).toEqual({ x: 804, y: 112 });
    expect(satOverlapArea({ ...at, ...CALC }, question)).toBe(0);
  });

  it('places the second tool on the opposite edge without overlapping the question or the first tool', () => {
    const question = { x: 500, y: 112, w: 280, h: 602 };
    const first = { x: 804, y: 112, w: 460, h: 560 };
    const second = placeSatTool(baseInput({ question, existing: [first], tool: { w: 420, h: 560 } }));
    expect(second).toEqual({ x: 16, y: 112 });
    expect(satOverlapArea({ ...second, w: 420, h: 560 }, question)).toBe(0);
    expect(satOverlapArea({ ...second, w: 420, h: 560 }, first)).toBe(0);
  });

  it('reports canFitBoth false on narrow viewports (cascade path)', () => {
    expect(canFitBoth(VIEWPORT, SAFE, CALC, { w: 420, h: 560 })).toBe(true);
    expect(canFitBoth({ w: 700, h: 800 }, SAFE, CALC, { w: 420, h: 560 })).toBe(false);
    expect(canFitBothTools({ w: 700, h: 800 }, SAFE, CALC, { w: 420, h: 560 })).toBe(false);
    expect(CASCADE_OFFSET).toBe(24);
  });

  it('penalizes outside-safe-area candidates hardest per px^2 (weight 20 > 10 > 8)', () => {
    const input = baseInput({ question: { x: 804, y: 112, w: 460, h: 560 } });
    const candidates = satPlacementCandidates(input);
    const rightScore = scoreSatPlacementCandidate(input, candidates.right);
    const leftScore = scoreSatPlacementCandidate(input, candidates.left);
    // Right sits exactly on the question: 460*560*10 = 2,576,000. Left is free: 0.
    expect(rightScore).toBe(460 * 560 * 10);
    expect(leftScore).toBe(0);
    // A candidate poking 100x100 outside the safe area pays 10,000*20 = 200,000.
    const poking = scoreSatPlacementCandidate(input, { x: -84, y: 112 });
    expect(poking).toBeGreaterThan(leftScore);
  });

  it('is deterministic: the same input always yields the same output', () => {
    const input = baseInput({ question: { x: 200, y: 200, w: 300, h: 300 }, lastPosition: { x: 400, y: 400 } });
    expect(placeSatTool(input)).toEqual(placeSatTool(input));
  });

  it('treats an unmeasurable question/trigger as zero overlap/distance (top free edge)', () => {
    expect(placeSatTool(baseInput({ question: null, trigger: null }))).toEqual({ x: 804, y: 112 });
  });
});
