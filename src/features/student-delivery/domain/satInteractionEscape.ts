import { resolveInteractionGate } from './satInteractionGuards';
import { isSatNoteEditorSurface, type SatInteractionContext, type SatInteractionState } from './satInteractionState';

export type SatEscapeAction =
  | { type: 'IGNORE' }
  | { type: 'NOOP' }
  | { type: 'CLOSE_ANNOTATION_EDITOR' }
  | { type: 'CLOSE_SURFACE' }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'DISABLE_LINE_READER' };

/**
 * One standardized Escape algorithm: exactly one semantic action per press.
 * Priority: blocking gate → annotation editor → exclusive surface →
 * annotation selection → line reader → noop. Line-reader state lives outside
 * this machine (reading preferences), so the caller passes lineReaderEnabled
 * and handles DISABLE_LINE_READER itself.
 *
 * There is no armed annotation mode to disable: the annotation layer is
 * cleared by dismissing its selection, which is also what closes the
 * contextual toolbar.
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
  if (state.annotation.selection !== null) return { type: 'CLEAR_SELECTION' };
  if (options.lineReaderEnabled) return { type: 'DISABLE_LINE_READER' };
  return { type: 'NOOP' };
}
