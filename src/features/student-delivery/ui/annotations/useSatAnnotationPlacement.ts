import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SatTextAnchor } from '../../domain/satResponses';
import {
  placeSatAnnotationDock,
  placeSatAnnotationToolbar,
  type AnnotationPlacement,
  type SatRectLike,
} from './satSelectionGeometry';

/** Fallback sizes used before the element has been measured (and in jsdom). */
const TOOLBAR_SIZE: SatRectLike = { left: 0, top: 0, width: 288, height: 108 };
const DOCK_SIZE: SatRectLike = { left: 0, top: 0, width: 320, height: 168 };

function viewportBounds(): SatRectLike {
  if (typeof window === 'undefined') return { left: 0, top: 0, width: 1024, height: 768 };
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/**
 * Position the contextual annotation toolbar (or the touch dock) against the
 * live selection, and keep it there while the student scrolls, resizes, or the
 * on-screen keyboard moves the visual viewport.
 *
 * Degrades instead of disappearing: when the anchor cannot be measured (a
 * headless renderer, or a mark that just scrolled away) it falls back to the
 * body's top-left inset so the controls stay reachable — the annotation
 * action must never become unreachable because geometry failed.
 */
export function useSatAnnotationPlacement(
  anchor: SatTextAnchor | null,
  options: { dock: boolean },
): {
  placement: AnnotationPlacement | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measure: () => void;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<AnnotationPlacement | null>(null);
  const dock = options.dock;

  const measure = useCallback(() => {
    const container = containerRef.current;
    const boundsElement = container?.closest<HTMLElement>('[data-sat-annotation-bounds]') ?? null;
    const boundsRect = boundsElement?.getBoundingClientRect();
    const bounds: SatRectLike =
      boundsRect && boundsRect.width > 0 && boundsRect.height > 0
        ? { left: boundsRect.left, top: boundsRect.top, width: boundsRect.width, height: boundsRect.height }
        : viewportBounds();
    const measured =
      container && container.offsetWidth > 0 && container.offsetHeight > 0
        ? { width: container.offsetWidth, height: container.offsetHeight }
        : null;
    if (dock) {
      setPlacement(placeSatAnnotationDock(bounds, measured ?? { width: DOCK_SIZE.width, height: DOCK_SIZE.height }));
      return;
    }
    if (!anchor) {
      setPlacement(null);
      return;
    }
    setPlacement(
      placeSatAnnotationToolbar(anchor, bounds, measured ?? { width: TOOLBAR_SIZE.width, height: TOOLBAR_SIZE.height })
        ?? { left: 8, top: 8, flipped: false },
    );
  }, [anchor, dock]);

  // Layout effect, not an animation frame: the toolbar is placed in the same
  // commit that mounts it, so it is never briefly unplaced (and never briefly
  // invisible to a student who just selected text).
  useLayoutEffect(() => {
    if (!anchor) {
      setPlacement(null);
      return;
    }
    measure();
  }, [anchor, measure]);

  useEffect(() => {
    if (!anchor) return;
    const viewport = window.visualViewport;
    window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [anchor, measure]);

  return { placement, containerRef, measure };
}

/**
 * Focus the first actionable control of annotation chrome, exactly once per
 * anchor, and only after placement has landed.
 *
 * Order matters and is the whole reason this is shared: the chrome mounts with
 * `visibility: hidden` for one commit while it is measured, and `focus()` on a
 * hidden element is silently ignored — so focusing on mount does nothing at all
 * and the toolbar's keyboard affordance quietly disappears (the anchor never
 * changes, so a mount-keyed effect never gets a second chance).
 *
 * `skip` is for chrome that holds a field the student just asked for: the caret
 * belongs in that field, and a later placement commit must not pull it back onto
 * the first button.
 */
export function useSatAnnotationAutofocus(
  placement: AnnotationPlacement | null,
  anchorKey: string,
  containerRef: React.RefObject<HTMLElement | null>,
  options: { skip?: boolean } = {},
): void {
  const focusedRef = useRef<string | null>(null);
  const skip = options.skip === true;
  useEffect(() => {
    if (skip || !placement || focusedRef.current === anchorKey) return;
    focusedRef.current = anchorKey;
    // Dismissals are skipped: the way out is not a way in, and landing the caret
    // on "close" would make the first keystroke after selecting text undo the
    // tools instead of using them.
    containerRef.current
      ?.querySelector<HTMLButtonElement>('button:not([disabled]):not([data-sat-annotation-dismiss])')
      ?.focus({ preventScroll: true });
  }, [anchorKey, containerRef, placement, skip]);
}
