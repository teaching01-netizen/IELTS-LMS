import type { SatTextAnchor } from '../../domain/satResponses';
import { satAnnotationSurfaceChrome, type SatAnnotationSurfaceChrome } from './SatAnnotationSurfaceFrame';
import { useSatAnnotationAutofocus } from './useSatAnnotationAutofocus';
import { useSatAnnotationDismiss } from './useSatAnnotationDismiss';
import { useSatAnnotationPlacement } from './useSatAnnotationPlacement';
import type { SelectionMenuEnvironment, SelectionMenuPlacement } from '@shared/ui/selection-v2/engine/selectionPlacement';

/**
 * Everything a surface needs to exist, in one call: where it goes, the chrome
 * that renders that answer, the node both of them measure and focus inside, and
 * the rule for when a press outside it counts as leaving.
 *
 * The two surfaces — selection tools and a mark's edit tools — differ only in
 * the actions they hold and in what the caret's landing is keyed to. Everything
 * else was written twice before this existed, including the two refs bound to
 * one DOM node, which is the kind of duplication that drifts silently: the
 * measurement scope and the focus scope are the same element, so they get one
 * ref rather than two names for it. Dismissal is the same bargain: the popover's
 * own node is what says where "outside" begins, so it comes from the same ref,
 * and neither surface can be the one that forgot to wire it.
 */
export function useSatAnnotationSurface(
  anchor: SatTextAnchor | null,
  options: {
    /** Identity of the thing the caret lands in; a new value re-focuses once. */
    autoFocusKey: string;
    /** Coarse-pointer comfort and browser-owned UI are separate placement facts. */
    environment: SelectionMenuEnvironment;
    visualScale?: number | undefined;
    /**
     * Close the surface because the student pressed outside it. Required on
     * purpose: a popover with no way out except Escape is a modal, and neither
     * of these is one.
     */
    onDismiss: () => void;
  },
): {
  placement: SelectionMenuPlacement | null;
  chrome: SatAnnotationSurfaceChrome;
  /** The surface's own node: measured for placement, scoped for the caret and for dismissal. */
  containerRef: React.RefObject<HTMLDivElement | null>;
} {
  const visualScale = options.visualScale ?? 1;
  const { placement, containerRef } = useSatAnnotationPlacement(anchor, {
    environment: options.environment,
    visualScale,
  });
  useSatAnnotationAutofocus(placement, options.autoFocusKey, containerRef);
  useSatAnnotationDismiss(containerRef, options.onDismiss);
  return { placement, chrome: satAnnotationSurfaceChrome(placement, visualScale), containerRef };
}
