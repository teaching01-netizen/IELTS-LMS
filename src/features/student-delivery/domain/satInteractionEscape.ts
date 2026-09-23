import { resolveInteractionGate } from './satInteractionGuards';
import { isSatNoteEditorSurface, type SatInteractionContext, type SatInteractionState } from './satInteractionState';

export type SatEscapeAction =
  | { type: 'IGNORE' }
  | { type: 'NOOP' }
  | { type: 'CLOSE_ANNOTATION_EDITOR' }
  | { type: 'CLOSE_SURFACE' }
  | { type: 'DISMISS_SELECTION_TOOLS' }
  | { type: 'DISABLE_LINE_READER' };

/**
 * One standardized Escape algorithm: exactly one semantic action per press.
 * Priority: blocking gate → annotation editor → exclusive surface →
 * contextual selection tools → line reader → noop. Line-reader state lives outside
 * this machine (reading preferences), so the caller passes lineReaderEnabled
 * and handles DISABLE_LINE_READER itself.
 *
 * The armed annotation mode is deliberately NOT in this list. Escape dismisses
 * chrome; the mode is a standing choice the student makes with an explicit
 * control, and silently disarming it would leave the top-bar toggle lying about
 * what the next selection will do. Dismissing the toolbar leaves the visual
 * range and mode armed, ready to reactivate the same phrase or select another.
 */
export function resolveEscapeAction(
  state: SatInteractionState,
  ctx: SatInteractionContext,
  options: { lineReaderEnabled?: boolean | undefined } = {},
): SatEscapeAction {
  if (resolveInteractionGate(ctx) !== 'interactive') return { type: 'IGNORE' };
  // Both note editors (a marked span, the question itself) close on the first
  // press: they are the innermost thing the student opened.
  if (isSatNoteEditorSurface(state.surface)) return { type: 'CLOSE_ANNOTATION_EDITOR' };
  if (state.surface.kind !== 'none') return { type: 'CLOSE_SURFACE' };
  if (state.annotation.selectionToolsAnchor !== null) return { type: 'DISMISS_SELECTION_TOOLS' };
  if (options.lineReaderEnabled) return { type: 'DISABLE_LINE_READER' };
  return { type: 'NOOP' };
}
