/** The answered-exam PDF download, shown at the top of the report. */
export function SatReportDownload({
  canPrint,
  download,
  onPrint,
}: {
  /** False when no authorized answered-exam source exists: no nonfunctional download is offered. */
  canPrint: boolean;
  download: "idle" | "preparing" | "failed";
  onPrint: () => void;
}) {
  if (!canPrint) return null;
  return (
    <div className="mt-4 sm:max-w-sm">
      <button
        type="button"
        disabled={download === "preparing"}
        onClick={onPrint}
        className="sat-touch-target sat-pressable min-h-11 w-full rounded-full border border-[var(--sat-divider)] px-6 text-[14px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
      >
        {download === "preparing" ? "Preparing answered exam…" : "Save answered exam as PDF"}
      </button>
      {download === "failed" ? (
        <p role="alert" className="mt-2 text-[14px] text-[var(--sat-danger)]">
          Your answered exam could not be fully loaded, so no PDF was made. Check your connection
          and try again.
        </p>
      ) : (
        <p role="status" className="mt-2 text-[13px] text-[var(--sat-text-secondary)]">
          {download === "preparing"
            ? "Loading your answers."
            : "Choose “Save as PDF” in the print dialog. It includes your score report and answers."}
        </p>
      )}
    </div>
  );
}

export function SatReportActions({ onExit }: { onExit: () => void }) {
  return (
    <div className="mt-8 flex border-t border-[var(--sat-divider)] pt-6">
      <button
        type="button"
        onClick={onExit}
        className="sat-touch-target sat-pressable min-h-11 rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] sm:ml-auto"
      >
        Back to dashboard
      </button>
    </div>
  );
}
