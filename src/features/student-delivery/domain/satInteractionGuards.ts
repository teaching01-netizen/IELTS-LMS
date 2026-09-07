import { resolveInteractionGate } from './satInteractionState';
import type { SatInteractionContext, SatInteractionState } from './satInteractionState';

export type { SatInteractionGate } from './satInteractionState';
export { resolveInteractionGate };

function inModule(ctx: SatInteractionContext): boolean {
  return ctx.phase === 'module';
}

function unblocked(ctx: SatInteractionContext): boolean {
  return resolveInteractionGate(ctx) === 'interactive';
}

function editorOpen(state: SatInteractionState): boolean {
  return state.surface.kind === 'annotation-note-editor';
}

/**
 * Centralized capability selectors. Components must use these instead of
 * inline checks like `sectionKey === 'reading-writing' && !paused`.
 */
export const satInteractionCan = {
  answer(state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && !editorOpen(state);
  },
  navigate(state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && !editorOpen(state);
  },
  openNavigator(state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && !editorOpen(state);
  },
  openDirections(state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && !editorOpen(state);
  },
  openReadingSettings(state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && !editorOpen(state);
  },
  openQuestionNotes(state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return (
      inModule(ctx) && unblocked(ctx) && !editorOpen(state) && ctx.toolPolicy.notes
    );
  },
  openCalculator(_state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && ctx.toolPolicy.calculator;
  },
  openReference(_state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && ctx.toolPolicy.referenceSheet;
  },
  annotate(_state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return (
      inModule(ctx) &&
      unblocked(ctx) &&
      (ctx.toolPolicy.highlight || ctx.toolPolicy.underline || ctx.toolPolicy.notes)
    );
  },
  closeSurface(state: SatInteractionState, _ctx: SatInteractionContext): boolean {
    return state.surface.kind !== 'none';
  },
  toggleElimination(_state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && ctx.toolPolicy.optionEliminator;
  },
  toggleReview(state: SatInteractionState, ctx: SatInteractionContext): boolean {
    return inModule(ctx) && unblocked(ctx) && !editorOpen(state) && ctx.toolPolicy.markForReview;
  },
};

export type SatInteractionCapability = keyof typeof satInteractionCan;
