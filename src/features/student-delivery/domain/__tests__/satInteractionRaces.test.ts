import { describe, expect, it } from 'vitest';
import {
  createSatInteractionState,
  normalizeSatInteractionState,
  satInteractionReducer,
  assertSatInteractionInvariants,
} from '../satInteractionState';
import { resolveSatExamToolPolicy } from '../satToolPolicy';
import type { SatInteractionContext, SatInteractionEvent } from '../satInteractionState';

// Adversarial interleavings: A -> B and B -> A must converge to the same safe
// state or to a deliberately documented difference. These mirror the real
// hazards of this runtime: server pause vs local navigation, policy revocation
// vs tool open, scope change vs editor open.
function mathCtx(): SatInteractionContext {
  return {
    phase: 'module',
    paused: false,
    terminated: false,
    isSubmitting: false,
    persistenceBlocked: false,
    toolPolicy: resolveSatExamToolPolicy('math', ['calculator', 'reference_sheet']),
    sectionKey: 'math',
    moduleKey: 'math-m1',
    questionId: 'q1',
  };
}

function rwCtx(): SatInteractionContext {
  return {
    ...mathCtx(),
    toolPolicy: resolveSatExamToolPolicy('reading-writing', []),
    sectionKey: 'reading-writing',
    moduleKey: 'rw-m1',
    questionId: 'q1',
  };
}

const selectionAnchor = { nodeId: 'stimulus:p1', startOffset: 0, endOffset: 4, exact: 'tree' } as const;

function run(events: readonly SatInteractionEvent[], ctx: SatInteractionContext) {
  let state = createSatInteractionState();
  for (const event of events) {
    state = satInteractionReducer(state, event, ctx);
    assertSatInteractionInvariants(state, ctx);
  }
  return state;
}

describe('satInteraction race commutativity (adversarial interleavings)', () => {
  it('NAVIGATE vs PAUSE-arrival converges: blocked context discards navigation surfaces', () => {
    const openThenTerminal = run(
      [
        { type: 'NAVIGATOR_OPENED', returnFocus: { type: 'footer', control: 'navigator' } },
        { type: 'TERMINAL_TRANSITION' },
      ],
      mathCtx(),
    );
    // Terminal-first: after the authoritative transition the CONTEXT itself is
    // terminal (spec §B — the reducer never stores paused/terminated, it reads
    // ctx). A late navigator open evaluated against terminal ctx is refused.
    const terminatedCtx = { ...mathCtx(), terminated: true };
    let terminalFirst = satInteractionReducer(
      createSatInteractionState(),
      { type: 'TERMINAL_TRANSITION' },
      terminatedCtx,
    );
    terminalFirst = satInteractionReducer(
      terminalFirst,
      { type: 'NAVIGATOR_OPENED', returnFocus: { type: 'footer', control: 'navigator' } },
      terminatedCtx,
    );
    assertSatInteractionInvariants(terminalFirst, terminatedCtx);
    // Terminal wins regardless of order: no navigator survives.
    expect(openThenTerminal.surface.kind).toBe('none');
    expect(terminalFirst.surface.kind).toBe('none');
    expect(openThenTerminal).toEqual(terminalFirst);
  });

  // Tool events are runner-owned strict no-ops here: both orders converge
  // trivially on the identical state reference.
  it('CALCULATOR_OPEN vs POLICY_REVOKED converges as strict no-ops', () => {
    const base = createSatInteractionState();
    const opened = satInteractionReducer(base, { type: 'CALCULATOR_OPENED' }, mathCtx());
    expect(opened).toBe(base);
    const refused = satInteractionReducer(base, { type: 'CALCULATOR_OPENED' }, rwCtx());
    expect(refused).toBe(base);
    assertSatInteractionInvariants(normalizeSatInteractionState(opened, rwCtx()), rwCtx());
  });

  it('NOTE_EDITOR_OPEN vs MODULE_TRANSITION converges: scope change resolves the editor', () => {
    const editorThenModule = run(
      [
        {
          type: 'ANNOTATION_NOTE_EDITOR_OPENED',
          annotationId: 'a1',
          returnFocus: { type: 'question', questionId: 'q1' },
        },
        { type: 'MODULE_SCOPE_CHANGED', moduleKey: 'rw-m2', questionId: 'q9' },
      ],
      rwCtx(),
    );
    expect(editorThenModule.surface.kind).toBe('none');
    assertSatInteractionInvariants(editorThenModule, rwCtx());
  });

  it('SELECTING vs QUESTION_CHANGED converges: the selection never survives scope change', () => {
    const selectingThenNavigate = run(
      [
        { type: 'ANNOTATION_MODE_ENABLED' },
        { type: 'TEXT_SELECTION_CAPTURED', anchor: selectionAnchor },
        { type: 'QUESTION_CHANGED', moduleKey: 'rw-m1', questionId: 'q2' },
      ],
      rwCtx(),
    );
    expect(selectingThenNavigate.annotation.selection).toBeNull();
    // …but the mode does: it belongs to the module, not the question.
    expect(selectingThenNavigate.annotation.modeEnabled).toBe(true);
    assertSatInteractionInvariants(selectingThenNavigate, rwCtx());
  });

  it('SELECTING vs MODULE_TRANSITION converges: leaving R&W drops the anchor and the mode', () => {
    const captured = run(
      [
        { type: 'ANNOTATION_MODE_ENABLED' },
        { type: 'TEXT_SELECTION_CAPTURED', anchor: selectionAnchor },
      ],
      rwCtx(),
    );
    expect(captured.annotation.selection).not.toBeNull();
    const normalized = normalizeSatInteractionState(captured, mathCtx());
    expect(normalized.annotation.selection).toBeNull();
    expect(normalized.annotation.modeEnabled).toBe(false);
    assertSatInteractionInvariants(normalized, mathCtx());
  });

  // The disarm/dismiss race: whichever arrives first, the exam ends the same way
  // — no selection, no mode, and no invariant broken on the way there.
  it('DISARM vs ESCAPE converges on an unarmed exam with nothing selected', () => {
    const armedAndSelected = run(
      [
        { type: 'ANNOTATION_MODE_ENABLED' },
        { type: 'TEXT_SELECTION_CAPTURED', anchor: selectionAnchor },
      ],
      rwCtx(),
    );
    const disarmFirst = run(
      [
        { type: 'ANNOTATION_MODE_ENABLED' },
        { type: 'TEXT_SELECTION_CAPTURED', anchor: selectionAnchor },
        { type: 'ANNOTATION_MODE_DISABLED' },
        { type: 'TEXT_SELECTION_CLEARED' },
      ],
      rwCtx(),
    );
    const escapeFirst = run(
      [
        { type: 'ANNOTATION_MODE_ENABLED' },
        { type: 'TEXT_SELECTION_CAPTURED', anchor: selectionAnchor },
        { type: 'TEXT_SELECTION_CLEARED' },
        { type: 'ANNOTATION_MODE_DISABLED' },
      ],
      rwCtx(),
    );
    expect(armedAndSelected.annotation.selection).not.toBeNull();
    for (const state of [disarmFirst, escapeFirst]) {
      expect(state.annotation.modeEnabled).toBe(false);
      expect(state.annotation.selection).toBeNull();
      assertSatInteractionInvariants(state, rwCtx());
    }
  });

  it('a selection reported after a disarm is discarded, never resurrected', () => {
    const state = run(
      [
        { type: 'ANNOTATION_MODE_ENABLED' },
        { type: 'ANNOTATION_MODE_DISABLED' },
        { type: 'TEXT_SELECTION_CAPTURED', anchor: selectionAnchor },
      ],
      rwCtx(),
    );
    expect(state.annotation.selection).toBeNull();
    assertSatInteractionInvariants(state, rwCtx());
  });

  it('torture sequence never violates an invariant', () => {
    const torture: SatInteractionEvent[] = [
      { type: 'NAVIGATOR_OPENED', returnFocus: { type: 'footer', control: 'navigator' } },
      { type: 'CALCULATOR_TOGGLED' },
      { type: 'ESCAPE_HANDLED' },
      // Armed first: an unarmed exam discards the selection outright, which
      // would make the rest of this sequence vacuous.
      { type: 'ANNOTATION_MODE_ENABLED' },
      { type: 'TEXT_SELECTION_CAPTURED', anchor: selectionAnchor },
      {
        type: 'ANNOTATION_NOTE_EDITOR_OPENED',
        annotationId: 'a1',
        returnFocus: { type: 'question', questionId: 'q1' },
      },
      { type: 'NAVIGATOR_OPENED', returnFocus: { type: 'footer', control: 'navigator' } },
      { type: 'QUESTION_CHANGED', moduleKey: 'rw-m1', questionId: 'q2' },
      { type: 'REFERENCE_OPENED' },
      { type: 'MODULE_SCOPE_CHANGED', moduleKey: 'math-m1', questionId: 'q1' },
      { type: 'ESCAPE_HANDLED' },
      { type: 'TERMINAL_TRANSITION' },
    ];
    // Run under R&W so every annotation event in the sequence actually applies:
    // under Math they would all be refused, and the torture test would be
    // asserting that nothing happened rather than that nothing broke.
    const end = run(torture, rwCtx());
    expect(end.surface.kind).toBe('none');
    expect(end.annotation.selection).toBeNull();
    expect(end.annotation.modeEnabled).toBe(false);
  });
});
