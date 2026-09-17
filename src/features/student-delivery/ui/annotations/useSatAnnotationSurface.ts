import type { SatTextAnchor } from '../../domain/satResponses';
import { satAnnotationSurfaceChrome, type SatAnnotationSurfaceChrome } from './SatAnnotationSurfaceFrame';
import { useSatAnnotationAutofocus } from './useSatAnnotationAutofocus';
import { useSatAnnotationPlacement } from './useSatAnnotationPlacement';
import type { AnnotationPlacement } from './satSelectionGeometry';

/**
 * Everything a surface needs to exist, in one call: where it goes, the chrome
 * that renders that answer, and the node both of them measure and focus inside.
 *
 * The two surfaces — selection tools and a mark's edit tools — differ only in
 * the actions they hold and in what the caret's landing is keyed to. Everything
 * else was written twice before this existed, including the two refs bound to
 * one DOM node, which is the kind of duplication that drifts silently: the
 * measurement scope and the focus scope are the same element, so they get one
 * ref rather than two names for it.
 */
export function useSatAnnotationSurface(
  anchor: SatTextAnchor | null,
  options: {
    /** Identity of the thing the caret lands in; a new value re-focuses once. */
    autoFocusKey: string;
    /** Force the dock. Only for layouts docked by contract; geometry decides otherwise. */
    dock?: boolean | undefined;
    /** Coarse pointer: widen the budget for the native selection menu's zone. */
    touch?: boolean | undefined;
  },
): {
  placement: AnnotationPlacement | null;
  chrome: SatAnnotationSurfaceChrome;
  /** The surface's own node: measured for placement, scoped for the caret. */
  containerRef: React.RefObject<HTMLDivElement | null>;
} {
  const { placement, containerRef } = useSatAnnotationPlacement(anchor, {
    dock: options.dock,
    touch: options.touch,
  });
  useSatAnnotationAutofocus(placement, options.autoFocusKey, containerRef);
  return { placement, chrome: satAnnotationSurfaceChrome(placement), containerRef };
}
