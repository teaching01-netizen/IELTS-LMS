export interface DeviceDraftRecoverySurfaceProps {
  onKeepChanges: () => void;
  onDiscardChanges: () => void;
  onCopyChanges: () => void;
}

/** Offers an explicit bridge from the legacy device draft into the workspace room. */
export function DeviceDraftRecoverySurface({
  onKeepChanges,
  onDiscardChanges,
  onCopyChanges,
}: DeviceDraftRecoverySurfaceProps) {
  return (
    <section
      role="status"
      aria-label="Recovered device draft"
      className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 text-sm"
      data-testid="device-draft-recovery-surface"
    >
      <p className="min-w-0 flex-1 font-medium text-foreground">
        Unsaved changes from this device are available. Add them to the shared draft when ready.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onKeepChanges}
          className="min-h-11 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Keep recovered changes
        </button>
        <button
          type="button"
          onClick={onDiscardChanges}
          className="min-h-11 rounded-md px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onCopyChanges}
          className="min-h-11 rounded-md px-3 text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Copy my work
        </button>
      </div>
    </section>
  );
}
