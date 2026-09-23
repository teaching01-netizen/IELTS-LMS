import { resolveInteractionGate, satInteractionCan } from './satInteractionGuards';
import type { SatInteractionContext, SatInteractionState } from './satInteractionState';

/**
 * The only read surface leaf components should need. No raw
 * `state.surface.kind === ... && !paused && phase === ...` in JSX.
 */
export interface SatInteractionView {
  can: {
    answer: boolean;
    navigate: boolean;
    openNavigator: boolean;
    openDirections: boolean;
    openReadingSettings: boolean;
    openQuestionNotes: boolean;
    openCalculator: boolean;
    openReference: boolean;
    annotate: boolean;
    closeSurface: boolean;
    toggleReview: boolean;
    toggleElimination: boolean;
  };
  is: {
    navigatorOpen: boolean;
    directionsOpen: boolean;
    readingSettingsOpen: boolean;
    questionNotesOpen: boolean;
    annotationEditorOpen: boolean;
    surfaceOpen: boolean;
    blocked: boolean;
    terminal: boolean;
  };
  gate: 'interactive' | 'blocked' | 'terminal';
  surface: SatInteractionState['surface'];
  annotation: {
    /** True while the student has armed annotation (a selection may raise tools). */
    modeEnabled: boolean;
    /** The contextual toolbar anchor; the Selection v2 session owns the Range. */
    selectionToolsAnchor: SatInteractionState['annotation']['selectionToolsAnchor'];
  };
}

export function selectSatInteraction(
  state: SatInteractionState,
  ctx: SatInteractionContext,
): SatInteractionView {
  const gate = resolveInteractionGate(ctx);
  return {
    can: {
      answer: satInteractionCan.answer(state, ctx),
      navigate: satInteractionCan.navigate(state, ctx),
      openNavigator: satInteractionCan.openNavigator(state, ctx),
      openDirections: satInteractionCan.openDirections(state, ctx),
      openReadingSettings: satInteractionCan.openReadingSettings(state, ctx),
      openQuestionNotes: satInteractionCan.openQuestionNotes(state, ctx),
      openCalculator: satInteractionCan.openCalculator(state, ctx),
      openReference: satInteractionCan.openReference(state, ctx),
      annotate: satInteractionCan.annotate(state, ctx),
      closeSurface: satInteractionCan.closeSurface(state, ctx),
      toggleReview: satInteractionCan.toggleReview(state, ctx),
      toggleElimination: satInteractionCan.toggleElimination(state, ctx),
    },
    is: {
      navigatorOpen: state.surface.kind === 'navigator',
      directionsOpen: state.surface.kind === 'directions',
      readingSettingsOpen: state.surface.kind === 'reading-settings',
      questionNotesOpen: state.surface.kind === 'question-notes',
      annotationEditorOpen: state.surface.kind === 'annotation-note-editor',
      surfaceOpen: state.surface.kind !== 'none',
      blocked: gate === 'blocked',
      terminal: gate === 'terminal',
    },
    gate,
    surface: state.surface,
    annotation: {
      modeEnabled: state.annotation.modeEnabled,
      selectionToolsAnchor: state.annotation.selectionToolsAnchor,
    },
  };
}
