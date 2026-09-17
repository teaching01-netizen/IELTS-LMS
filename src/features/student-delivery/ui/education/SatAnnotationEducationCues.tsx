import { Highlighter } from 'lucide-react';
import { SAT_COPY } from '../../domain/satCopy';

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
 * The activation cue: the one quiet line a first-time student sees when they
 * arm annotation, rendered at the top of the passage rather than pinned near
 * the tool entry.
 *
 * It used to float at the top-right of the shell, which read as a tooltip about
 * the page — a label pointing at the toolbar. The answer to "what did I just
 * turn on?" belongs where the new capability applies: directly above the text
 * that can now be selected. It leaves on its own after a few seconds, so it can
 * never become furniture over the passage being read.
 */
export function SatAnnotationPassageHint() {
  return (
    <p
      data-sat-annotation-hint="true"
      role="note"
      className="mb-4 flex items-center gap-1.5 sat-type-metadata font-medium text-[var(--sat-text-secondary)]"
    >
      <Highlighter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {SAT_COPY.annotations.activationCue}
    </p>
  );
}

/*
 * The one-time "Highlighted" chip is gone on purpose. It used to appear beside
 * the first mark, in the same place as the tools that now stay open after a
 * highlight — two bordered panels stacked on the same span, one of which said
 * nothing the other did not (the pressed swatch under a "Highlight" heading IS
 * the confirmation). Nothing replaces it: the ink landing is the feedback.
 */
