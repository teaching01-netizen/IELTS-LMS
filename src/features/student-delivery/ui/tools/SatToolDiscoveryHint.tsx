/**
 * Phase 07 first-open teaching chip.
 *
 * Presentational only: the SatFloatingTool primitive decides when to mount
 * it (first desktop open of each tool per session) and when to mark it
 * seen. Auto-dismiss runs as a CSS animation keyed to
 * --sat-tool-hint-life; the primitive flips the seen flag on animationend.
 * Never a modal, never a focus trap, never blocks input.
 */

export function SatToolDiscoveryHint(props: { onAnimationEnd?: () => void }) {
  return (
    <div
      data-sat-tool-hint
      aria-hidden="true"
      onAnimationEnd={props.onAnimationEnd}
      className="sat-tool-hint pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-2"
    >
      <span className="sat-tool-hint-chip rounded-full border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] px-3 py-1 text-[12px] font-medium text-[var(--sat-text-secondary)] shadow-[var(--sat-shadow-floating)]">
        Drag the top to move &middot; Resize from corners
      </span>
    </div>
  );
}
