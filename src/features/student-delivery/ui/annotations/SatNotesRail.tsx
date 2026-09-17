import { ChevronRight } from 'lucide-react';
import { SAT_COPY } from '../../domain/satCopy';

/**
 * What the Notes column leaves behind when it is hidden.
 *
 * One problem, one control: a pane that can disappear with no trace teaches the
 * student that hiding it was a mistake, and leaves the only way back in a toolbar
 * that does not look like it belongs to the pane. So the column keeps its place
 * in the layout as a handle that says what it is and, with the chevron, which
 * way the pane comes back from.
 *
 * It is deliberately not a bare chevron on a hairline: the written label is the
 * pane's own name, which is the same rule the top-bar entry follows — nothing in
 * Highlights & Notes has to be decoded.
 */
export function SatNotesRail({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      // The one hook other code needs: a hidden column hands focus here (see
      // `focusSatNotesRail`), so this attribute is the handle's address.
      data-sat-notes-rail="true"
      onClick={onOpen}
      // Spoken name carries the action; the visible label carries the identity,
      // and stays inside the spoken one so a name-based command still matches.
      aria-label={SAT_COPY.notes.railAction}
      className="sat-pressable flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden border-l border-[var(--sat-divider)] bg-[var(--sat-surface)] text-[var(--sat-text-secondary)] hover:bg-[var(--sat-surface-hover)] hover:text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
    >
      {/* Points the way the pane unfolds: it grows from the edge this handle
          holds, which is the edge that also closes it. */}
      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      {/* Vertical so the label reads along the edge, the way a pane's tab does —
          and it is the pane's name, not a second word for the same place. */}
      <span className="sat-type-metadata font-medium [writing-mode:vertical-rl]">{SAT_COPY.notes.title}</span>
    </button>
  );
}
