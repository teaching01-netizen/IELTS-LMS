import { useMemo } from "react";
import {
  prepareAnsweredExamPdf,
  type PrepareAnsweredExamPdfRequest,
} from "../../../features/student-delivery/api/answeredExamPdf";
import { useAnsweredExamDownload } from "../../../features/student-delivery/ui/transitions/score-report/useAnsweredExamDownload";
import type { StudentScoreReportView } from "../../../features/student-delivery/ui/transitions/score-report/scoreReportViewModel";

/**
 * Staff copy of the student's answered-exam PDF (PDF-08): the same server
 * projection and print gate, independent of the student's report switch.
 * `view` adds the score report to the paper; omit it for an unscored attempt.
 */
export function SatAnsweredExamDownload({
  attemptId,
  view = null,
}: {
  attemptId: string;
  view?: StudentScoreReportView | null;
}) {
  const source = useMemo(
    () => ({
      key: `staff:${attemptId}`,
      preparePdf: (request: PrepareAnsweredExamPdfRequest, signal: AbortSignal) =>
        prepareAnsweredExamPdf(
          `/api/v1/sat-answered-pdf/attempts/${encodeURIComponent(attemptId)}/prepare`,
          request,
          signal
        ),
    }),
    [attemptId]
  );
  const { download, ready, prepare } = useAnsweredExamDownload(source, view);
  return (
    <div className="mt-3 print:hidden">
      {ready ? (
        <a
          href={ready.downloadUrl}
          download={ready.filename}
          referrerPolicy="no-referrer"
          className="sat-btn sat-btn--secondary sat-press"
          onClick={(event) => {
            if (Date.parse(ready.expiresAt) <= Date.now()) {
              event.preventDefault();
              void prepare();
            }
          }}
        >
          Download PDF again
        </a>
      ) : (
        <button
          type="button"
          disabled={download === "preparing"}
          onClick={() => void prepare()}
          className="sat-btn sat-btn--secondary sat-press disabled:opacity-50"
        >
          {download === "preparing" ? "Preparing answered exam…" : "Download answered exam (PDF)"}
        </button>
      )}
      {ready ? (
        <button
          type="button"
          onClick={() => void prepare()}
          className="sat-touch-target ml-3 min-h-11 text-[14px] underline"
        >
          Prepare PDF again
        </button>
      ) : null}
      {ready ? (
        <p role="status" className="mt-2 text-[14px]">
          Your PDF is ready. Check your downloads.
        </p>
      ) : null}
      {download === "failed" ? (
        <p
          role="alert"
          className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]"
        >
          The answered exam could not be fully loaded, so no PDF was made. It is available once the
          attempt has ended. Try again.
        </p>
      ) : null}
    </div>
  );
}
