import { useEffect, useRef } from 'react';
import type { SelectionMenuPlacement } from '@shared/ui/selection-v2/engine/selectionPlacement';

/**
 * Focus the first actionable control of annotation chrome, exactly once per
 * anchor, and only after placement has landed.
 *
 * Order matters and is the whole reason this is shared: the chrome mounts with
 * `visibility: hidden` for one commit (and, while a fresh selection settles,
 * for one settle window), and `focus()` on a hidden element is silently ignored
 * — so focusing on mount does nothing at all and the toolbar's keyboard
 * affordance quietly disappears. A placement that is deliberately hidden (the
 * anchor scrolled away, the viewport is rotating) waits for the same reason.
 *
 * It lives beside the surfaces rather than inside the placement hook because it
 * is not placement: one is geometry, the other is where the caret goes.
 */
export function useSatAnnotationAutofocus(
  placement: SelectionMenuPlacement | null,
  anchorKey: string,
  containerRef: React.RefObject<HTMLElement | null>,
): void {
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!placement || placement.mode === 'hidden' || focusedRef.current === anchorKey) return;
    focusedRef.current = anchorKey;
    // Dismissals are skipped: the way out is not a way in, and landing the caret
    // on "close" would make the first keystroke after selecting text undo the
    // tools instead of using them.
    containerRef.current
      ?.querySelector<HTMLButtonElement>('button:not([disabled]):not([data-sat-annotation-dismiss])')
      ?.focus({ preventScroll: true });
  }, [anchorKey, containerRef, placement]);
}
