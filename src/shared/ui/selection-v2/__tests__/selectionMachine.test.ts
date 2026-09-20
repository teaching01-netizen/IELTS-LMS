import { describe, expect, it } from 'vitest';
import {
  endEndpointOf,
  idleSelectionState,
  moveNeedsPoint,
  movingEdgeOf,
  reduceSelection,
  startEndpointOf,
  type SelectionEffect,
  type SelectionMachineEvent,
  type SelectionMachineState,
} from '../domain/selectionMachine';
import type { TextPoint } from '../domain/selectionTypes';

function textNode(data: string): Text {
  return document.createTextNode(data);
}

const node = textNode('alpha beta gamma');
const at = (offset: number): TextPoint => ({ node, offset });

/** Walk a list of events, returning the final state and every effect emitted. */
function run(
  events: SelectionMachineEvent[],
  initial: SelectionMachineState = idleSelectionState('long-press', 8),
): { state: SelectionMachineState; effects: SelectionEffect[] } {
  let state = initial;
  const effects: SelectionEffect[] = [];
  for (const event of events) {
    const transition = reduceSelection(state, event);
    state = transition.state;
    effects.push(...transition.effects);
  }
  return { state, effects };
}

const press = (offset: number, type: 'touch' | 'mouse' = 'touch'): SelectionMachineEvent => ({
  type: 'press',
  pointerId: 1,
  pointerType: type,
  x: offset * 10,
  y: 10,
  point: at(offset),
});

const move = (offset: number, pointerId = 1): SelectionMachineEvent => ({
  type: 'move',
  pointerId,
  x: offset * 10,
  y: 10,
  point: at(offset),
});

describe('claiming a gesture', () => {
  it('selects nothing for a tap: the finger goes down and up without a hold', () => {
    const { state, effects } = run([press(4), { type: 'release', pointerId: 1 }]);

    expect(state.phase).toBe('idle');
    expect(effects.map((effect) => effect.type)).toContain('clear');
    expect(effects.map((effect) => effect.type)).not.toContain('suppress-scroll');
    expect(effects.map((effect) => effect.type)).not.toContain('commit');
  });

  it('claims the word under a completed hold and suppresses scrolling from then on', () => {
    const { state, effects } = run([press(4), { type: 'hold' }]);

    expect(state.phase).toBe('selecting');
    expect(effects.map((effect) => effect.type)).toEqual(
      expect.arrayContaining(['arm-hold', 'capture-pointer', 'disarm-hold', 'suppress-scroll']),
    );
  });

  it('extends as the finger travels after a hold', () => {
    const { state } = run([press(4), { type: 'hold' }, move(11)]);

    expect(state.phase).toBe('extending');
    expect(state.moving).toEqual(at(11));
    expect(state.fixed).toEqual(at(4));
    expect(state.movingEdge).toBe('end');
  });

  it('claims the text on an immediate drag when a tool is already armed', () => {
    const { state, effects } = run([press(4), move(20)], idleSelectionState('drag', 8));

    expect(state.phase).toBe('extending');
    expect(state.moving).toEqual(at(20));
    expect(effects.map((effect) => effect.type)).toContain('suppress-scroll');
  });

  it('hands an unarmed drag back to the platform as a scroll', () => {
    const { state, effects } = run([press(4), move(20)]);

    expect(state.phase).toBe('idle');
    expect(effects.map((effect) => effect.type)).not.toContain('suppress-scroll');
    expect(effects.map((effect) => effect.type)).toEqual(
      expect.arrayContaining(['release-pointer', 'allow-scroll', 'clear']),
    );
  });

  it('treats a move inside the tolerance as no decision at all', () => {
    const pressing = run([press(4)]);
    const moved = reduceSelection(pressing.state, { type: 'move', pointerId: 1, x: 41, y: 12, point: at(4) });

    expect(moved.state.phase).toBe('pending');
    expect(moved.effects).toEqual([]);
  });

  it('keeps the moving endpoint under a finger that drags backwards', () => {
    const { state } = run([press(11), { type: 'hold' }, move(2)]);

    expect(state.moving).toEqual(at(2));
    expect(state.fixed).toEqual(at(11));
    expect(state.movingEdge).toBe('start');
    expect(startEndpointOf(state)).toEqual(at(2));
    expect(endEndpointOf(state)).toEqual(at(11));
  });
});

describe('one pointer owns the gesture', () => {
  it('cancels an owned gesture when a second finger lands', () => {
    const { state, effects } = run([
      press(4),
      { type: 'hold' },
      { type: 'press', pointerId: 2, pointerType: 'touch', x: 90, y: 40, point: at(9) },
    ]);

    expect(state.phase).toBe('idle');
    expect(effects.map((effect) => effect.type)).toContain('clear');
    expect(effects).toContainEqual({ type: 'release-pointer', pointerId: 1 });
  });

  it('ignores movement from a pointer that does not own the gesture', () => {
    const { state } = run([press(4), { type: 'hold' }, move(9, 2)]);

    expect(state.moving).toEqual(at(4));
    expect(state.phase).toBe('selecting');
  });

  it('abandons the selection when the platform cancels the gesture', () => {
    const { state, effects } = run([press(4), { type: 'hold' }, move(9), { type: 'cancel', pointerId: 1 }]);

    expect(state.phase).toBe('idle');
    expect(effects.map((effect) => effect.type)).not.toContain('commit');
    expect(effects.map((effect) => effect.type)).toEqual(
      expect.arrayContaining(['release-pointer', 'allow-scroll', 'clear']),
    );
  });

  it('clears everything when the surface is disabled mid-drag', () => {
    const { state, effects } = run([press(4), { type: 'hold' }, move(9), { type: 'dismiss' }]);

    expect(state.phase).toBe('idle');
    expect(effects.map((effect) => effect.type)).not.toContain('commit');
    expect(effects.map((effect) => effect.type)).toContain('allow-scroll');
  });
});

describe('a completed selection stays selected', () => {
  it('holds the selection after the finger lifts and reports it once', () => {
    const { state, effects } = run([press(4), { type: 'hold' }, move(11), { type: 'release', pointerId: 1 }]);

    expect(state.phase).toBe('selected');
    expect(state.fixed).toEqual(at(4));
    expect(state.moving).toEqual(at(11));
    expect(effects.filter((effect) => effect.type === 'commit')).toHaveLength(1);
  });

  it('reports a selection made by an armed drag exactly once as well', () => {
    const { state, effects } = run(
      [press(4), move(11), { type: 'release', pointerId: 1 }],
      idleSelectionState('drag', 8),
    );

    expect(state.phase).toBe('selected');
    expect(effects.filter((effect) => effect.type === 'commit')).toHaveLength(1);
  });

  it('dismisses a resting selection without reporting anything', () => {
    const { state, effects } = run([
      press(4),
      { type: 'hold' },
      move(11),
      { type: 'release', pointerId: 1 },
      { type: 'dismiss' },
    ]);

    expect(state.phase).toBe('idle');
    expect(effects.filter((effect) => effect.type === 'commit')).toHaveLength(1);
  });

  it('never resurrects a resting selection from a stray move', () => {
    const { state } = run([
      press(4),
      { type: 'hold' },
      move(11),
      { type: 'release', pointerId: 1 },
      move(20),
    ]);

    expect(state.phase).toBe('selected');
    expect(state.moving).toEqual(at(11));
  });
});

describe('handle adjustment', () => {
  const resting: SelectionMachineState = run([
    press(4),
    { type: 'hold' },
    move(11),
    { type: 'release', pointerId: 1 },
  ]).state;

  it('moves only the endpoint whose handle was grabbed', () => {
    const { state } = run([{ type: 'grab', pointerId: 7, edge: 'start', x: 40, y: 10 }, move(2, 7)], resting);

    expect(state.phase).toBe('adjusting-start');
    expect(state.moving).toEqual(at(2));
    expect(state.fixed).toEqual(at(11));
  });

  it('swaps semantics when the dragged endpoint crosses the fixed one', () => {
    const { state } = run([{ type: 'grab', pointerId: 7, edge: 'end', x: 110, y: 10 }, move(20, 7)], resting);

    expect(state.moving).toEqual(at(20));
    expect(state.fixed).toEqual(at(4));
    expect(state.movingEdge).toBe('end');
    expect(state.phase).toBe('adjusting-end');

    const crossed = run([{ type: 'grab', pointerId: 7, edge: 'start', x: 40, y: 10 }, move(20, 7)], resting);
    expect(crossed.state.moving).toEqual(at(20));
    expect(crossed.state.fixed).toEqual(at(11));
    expect(crossed.state.phase).toBe('adjusting-end');
  });

  it('captures the handle pointer and re-reports the selection when it settles', () => {
    const { state, effects } = run(
      [
        { type: 'grab', pointerId: 7, edge: 'end', x: 110, y: 10 },
        move(15, 7),
        { type: 'release', pointerId: 7 },
      ],
      resting,
    );

    expect(effects).toContainEqual({ type: 'capture-pointer', pointerId: 7 });
    expect(effects).toContainEqual({ type: 'release-pointer', pointerId: 7 });
    expect(effects.filter((effect) => effect.type === 'commit')).toHaveLength(1);
    expect(state.phase).toBe('selected');
  });

  it('refuses to grab a handle on a selection that is not resting', () => {
    const { state } = run([press(4), { type: 'hold' }, { type: 'grab', pointerId: 7, edge: 'start', x: 40, y: 10 }]);

    expect(state.phase).toBe('selecting');
    expect(state.pointerId).toBe(1);
  });
});

describe('the machine stays pure', () => {
  it('answers whether a move needs a caret before the caller pays for one', () => {
    const idle = idleSelectionState('long-press', 8);
    expect(moveNeedsPoint(idle, 100, 100)).toBe(false);

    const pending = reduceSelection(idle, press(4)).state;
    expect(moveNeedsPoint(pending, 41, 12)).toBe(false);
    expect(moveNeedsPoint(pending, 100, 12)).toBe(true);

    const holding = reduceSelection(pending, { type: 'hold' }).state;
    expect(moveNeedsPoint(holding, 41, 12)).toBe(true);
  });

  it('derives the moving edge from the two positions and nothing else', () => {
    expect(movingEdgeOf(at(4), at(11))).toBe('end');
    expect(movingEdgeOf(at(11), at(4))).toBe('start');
    expect(movingEdgeOf(null, at(4))).toBe('end');
  });

  it('never mutates the state it was given', () => {
    const before = reduceSelection(idleSelectionState(), press(4)).state;
    const snapshot = JSON.stringify({ ...before, fixed: before.fixed?.offset, moving: before.moving?.offset });

    reduceSelection(before, move(20));

    expect(JSON.stringify({ ...before, fixed: before.fixed?.offset, moving: before.moving?.offset })).toBe(snapshot);
    expect(before.phase).toBe('pending');
  });
});
