import { createContext, useContext } from 'react';
import type { SatTextAnchor, SatTextAnnotation } from '../../domain/satResponses';

/**
 * Bridge between the exam shell (which owns annotation state and renders the
 * contextual toolbar) and the annotated content (which owns the marks and the
 * selection gesture).
 *
 * Direction matters: the shell is an ANCESTOR of the question renderer, so the
 * content can consume this context, while every MUTATION still flows up into
 * the shell and from there to the route's response commands. Nothing here
 * writes an annotation.
 */
export interface SatAnnotationView {
  /** Annotation whose editor is open (drawn with emphasis). */
  activeAnnotationId: string | null;
  /**
   * False in read-only contexts (disabled exam, preview shells): marks render
   * as decoration instead of controls.
   */
  openEditorActive: boolean;
  /** Student tapped or activated an existing mark: open its editor. */
  openEditor: (annotation: SatTextAnnotation) => void;
  /** A completed text selection, reported upward for the toolbar. */
  onSelectionCaptured?: ((anchor: SatTextAnchor) => void) | undefined;
}

const EMPTY_VIEW: SatAnnotationView = {
  activeAnnotationId: null,
  openEditorActive: false,
  openEditor: () => undefined,
};

export const SatAnnotationViewContext = createContext<SatAnnotationView>(EMPTY_VIEW);

export function useSatAnnotationView(): SatAnnotationView {
  return useContext(SatAnnotationViewContext);
}
