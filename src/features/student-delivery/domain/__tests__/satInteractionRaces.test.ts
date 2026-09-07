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

  it('CALCULATOR_OPEN vs POLICY_REVOKED converges via normalization', () => {
    const opened = run([{ type: 'CALCULATOR_OPENED' }], mathCtx());
    expect(opened.tools.calculator).toBe('open');
    // Policy revocation normalizes centrally; the tool cannot linger open.
    const normalized = normalizeSatInteractionState(opened, rwCtx());
    expect(normalized.tools.calculator).toBe('closed');
    assertSatInteractionInvariants(normalized, rwCtx());
    // Opening directly under a revoked policy is refused.
    const refused = run([{ type: 'CALCULATOR_OPENED' }], rwCtx());
    expect(refused.tools.calculator).toBe('closed');
    expect(normalized.tools.calculator).toBe(refused.tools.calculator);
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

  it('SELECTING vs QUESTION_CHANGED converges: transient selection never survives scope change', () => {
    const selectingThenNavigate = run(
      [
        { type: 'ANNOTATION_MODE_CHANGED', mode: 'highlight' },
        { type: 'TEXT_SELECTION_STARTED' },
        { type: 'QUESTION_CHANGED', moduleKey: 'rw-m1', questionId: 'q2' },
      ],
      rwCtx(),
    );
    expect(selectingThenNavigate.annotation.textSelection).toBe('idle');
    expect(selectingThenNavigate.annotation.mode).toBe('highlight');
    assertSatInteractionInvariants(selectingThenNavigate, rwCtx());
  });

  it('torture sequence never violates an invariant', () => {
    const torture: SatInteractionEvent[] = [
      { type: 'NAVIGATOR_OPENED', returnFocus: { type: 'footer', control: 'navigator' } },
      { type: 'CALCULATOR_OPENED' },
      { type: 'ESCAPE_HANDLED' },
      { type: 'ANNOTATION_MODE_CHANGED', mode: 'highlight' },
      { type: 'TEXT_SELECTION_STARTED' },
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
    const end = run(torture, mathCtx());
    expect(end.surface.kind).toBe('none');
    expect(end.annotation.textSelection).toBe('idle');
  });
});
