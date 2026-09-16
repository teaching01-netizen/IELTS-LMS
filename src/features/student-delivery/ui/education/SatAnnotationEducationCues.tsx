import { Highlighter, StickyNote } from 'lucide-react';
import type { SatTextAnchor } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { useSatAnnotationPlacement } from '../annotations/useSatAnnotationPlacement';

/**
 * Education cues for Highlights & Notes.
 *
 * These are presentation only. Nothing in the annotation pipeline reads them,
 * nothing about them gates an annotation action, and deleting this file (plus
 * the two call sites that render it) would leave the feature fully working —
 * which is the point: teaching is removable without surgery on the product.
 *
 * They also deliberately avoid tutorial grammar: no "Step 1", no welcome
 * dialog, no progress. Each cue appears at the moment it is useful and retires
 * itself the instant the student demonstrates understanding.
 */

/**
 * The one quiet line under the tool entry on a student's first exam
 * interaction. Non-modal, non-blocking, no close button, no scrim — it says
 * the one thing a student could not guess, then leaves.
 */
export function SatAnnotationFirstUseHint() {
  return (
    <p
      data-sat-annotation-hint="true"
      role="note"
      className="sat-ui fixed right-[calc(1rem+var(--student-safe-right))] top-[calc(var(--student-safe-top)+96px)] z-[65] max-w-[240px] rounded-[8px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-3 py-2 sat-type-metadata font-medium text-[var(--sat-text)] shadow-[var(--sat-shadow-floating)] lg:top-[calc(var(--student-safe-top)+100px)]"
    >
      {SAT_COPY.annotations.firstUseHint}
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

/**
 * Notes panel empty state. This is the one place the spec allows a two-line
 * instruction, because the student explicitly opened the feature asking "where
 * are my notes?" — answering that question is the point.
 */
export function SatAnnotationEmptyNotesCoach() {
  return (
    <div data-sat-notes-empty="true" className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <StickyNote className="h-7 w-7 text-[var(--sat-text-secondary)]" aria-hidden="true" />
      <p className="sat-type-control-primary font-semibold text-[var(--sat-text)]">
        {SAT_COPY.annotations.emptyNotesTitle}
      </p>
      <p className="max-w-[240px] sat-type-control-secondary text-[var(--sat-text-secondary)]">
        {SAT_COPY.annotations.emptyNotesBody}
      </p>
    </div>
  );
}

/**
 * Transient label that points at the passage while the student browses an empty
 * Notes panel. It disappears the moment they select text, so it can never
 * become furniture.
 */
export function SatAnnotationSelectTextCoach() {
  return (
    <p
      data-sat-select-text-coach="true"
      className="sat-ui pointer-events-none absolute left-1/2 top-2 z-[70] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-3 py-1 sat-type-metadata font-medium text-[var(--sat-text-secondary)] shadow-[var(--sat-shadow-floating)]"
    >
      <Highlighter className="h-3.5 w-3.5" aria-hidden="true" />
      {SAT_COPY.annotations.selectTextCoach}
    </p>
  );
}
