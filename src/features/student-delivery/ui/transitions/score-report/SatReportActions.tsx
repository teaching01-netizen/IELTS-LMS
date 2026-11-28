import { useId } from "react";
import type { PreparedAnsweredExamPdf } from "../../../api/answeredExamPdf";

/** The answered-exam PDF download, shown at the top of the report. */
export function SatReportDownload({
  canPrint,
  download,
  ready = null,
  onPrint,
}: {
  /** False when no authorized answered-exam source exists: no nonfunctional download is offered. */
  canPrint: boolean;
  download: "idle" | "preparing" | "ready" | "failed";
  ready?: PreparedAnsweredExamPdf | null;
  onPrint: () => void;
}) {
  const descriptionId = useId();
  if (!canPrint) return null;
  return (
    <div className="w-full sm:w-56">
      <button
        type="button"
        aria-describedby={descriptionId}
        disabled={download === "preparing"}
        onClick={onPrint}
        className="sat-touch-target sat-pressable min-h-11 w-full rounded-full border border-[var(--sat-divider)] px-6 text-[14px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
      >
        {download === "preparing" ? "Preparing PDF…" : ready ? "Download latest PDF" : "Download exam PDF"}
      </button>
      {ready ? (
        <a
          href={ready.downloadUrl}
          download={ready.filename}
          aria-describedby={descriptionId}
          referrerPolicy="no-referrer"
          onClick={(event) => {
            if (Date.parse(ready.expiresAt) <= Date.now()) {
              event.preventDefault();
              onPrint();
            }
          }}
          className="sat-touch-target mt-2 inline-flex min-h-11 items-center text-[13px] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          Save prepared copy
        </a>
      ) : null}
      <p id={descriptionId} className="mt-2 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
        Includes your score, the exam questions, and your answers.
      </p>
      {download === "failed" ? (
        <p role="alert" className="mt-2 text-[14px] text-[var(--sat-danger)]">
          Couldn’t prepare your PDF. Check your connection and try again.
        </p>
      ) : null}
      {download === "preparing" || ready ? (
        <p role="status" className="mt-2 text-[13px] text-[var(--sat-text-secondary)]">
          {ready ? "Your PDF is ready. Check your downloads." : "Your download will start automatically."}
        </p>
      ) : null}
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
