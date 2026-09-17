import { Highlighter } from 'lucide-react';
import type { SatTextAnchor } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { useSatAnnotationPlacement } from '../annotations/useSatAnnotationPlacement';

/**
 * Education cues for Highlights & Notes.
 *
 * These are presentation only. Nothing in the annotation pipeline reads them,
 * nothing about them gates an annotation action, and deleting this file (plus
 * the call sites that render it) would leave the feature fully working — which
 * is the point: teaching is removable without surgery on the product.
 *
 * They also deliberately avoid tutorial grammar: no "Step 1", no welcome
 * dialog, no progress. Each cue appears at the moment it is useful and retires
 * itself the instant the student demonstrates understanding.
 */

/**
 * The one quiet line a first-time student sees, rendered at the top of the
 * passage rather than pinned near the tool entry.
 *
 * It used to float at the top-right of the shell, which read as a tooltip about
 * the page — a label pointing at the toolbar. The instruction belongs where the
 * gesture happens: it says "select text" while sitting directly above the text
 * there is to select.
 */
export function SatAnnotationPassageHint() {
  return (
    <p
      data-sat-annotation-hint="true"
      role="note"
      className="mb-4 flex items-center gap-1.5 sat-type-metadata font-medium text-[var(--sat-text-secondary)]"
    >
      <Highlighter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {SAT_COPY.annotations.passageHint}
    </p>
  );
}

/**
 * One-time confirmation beside the first highlight. The ink changing is the
 * real feedback; this exists only to name what just happened, once, for a
 * student who has never seen a highlight before.
 */
export function SatAnnotationFirstHighlightFeedback({ anchor }: { anchor: SatTextAnchor }) {
  const { placement, containerRef } = useSatAnnotationPlacement(anchor, { dock: false });
  return (
    <p
      ref={containerRef}
      data-sat-annotation-confirmation="true"
      role="status"
      className="sat-ui absolute z-[79] rounded-[6px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-2 py-1 sat-type-metadata font-semibold text-[var(--sat-text)] shadow-[var(--sat-shadow-floating)]"
      style={{
        left: placement ? placement.left : 8,
        top: placement ? placement.top : 8,
        visibility: placement ? 'visible' : 'hidden',
        animation: 'sat-annotation-enter var(--sat-motion-annotation) ease-out',
      }}
    >
      {SAT_COPY.annotations.highlightedConfirmation}
    </p>
  );
}
