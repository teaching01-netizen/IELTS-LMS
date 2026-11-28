import { useEffect, useId, useState } from "react";
import type { PdfLayout } from "@shared/sat/pdfLayout";
import { SatButton } from "../../../../../products/sat/ui/SatPage";
import type { SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";
import { AuthoringDialog } from "../../authoringPrimitives";
import { pdfErrorMessage } from "./PdfLayoutImageForm";

/**
 * Sample preview. The preview never replaces the editor: it opens over the
 * draft so the staff member can look at the report and still see what they
 * changed. It renders the same PDF pipeline a student's download uses.
 */
export function PdfLayoutPreviewDialog({
  open,
  examId,
  layout,
  previewLayout,
  onDenied,
  onClose,
}: {
  open: boolean;
  examId: string;
  layout: PdfLayout | undefined;
  previewLayout: SatPdfLayoutApi["preview"];
  onDenied: (error: unknown) => void;
  onClose: () => void;
}) {
  const modeId = useId();
  const [keyed, setKeyed] = useState(false);
  const [retry, setRetry] = useState(0);
  return (
    <AuthoringDialog
      open={open}
      onClose={onClose}
      title="Sample preview"
      description="Sample data. A student's PDF contains only the sections and modules released for that attempt."
      contentClassName="max-w-[64rem]"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="sat-select relative flex min-h-11 items-center gap-2 rounded-[var(--sat-staff-radius-control,8px)] border border-[var(--sat-staff-border-control,#00000017)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] pl-3" htmlFor={modeId}>
            <span className="text-[14px] font-medium text-[var(--sat-staff-text-secondary,#515154)]">Answer key</span>
            <select
              id={modeId}
              value={keyed ? "with" : "without"}
              onChange={(event) => setKeyed(event.currentTarget.value === "with")}
              className="min-h-11 cursor-pointer appearance-none rounded-[var(--sat-staff-radius-control,8px)] bg-transparent py-0 pl-2 pr-6 text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)] outline-none"
            >
              <option value="without">Without answer key</option>
              <option value="with">With answer key</option>
            </select>
          </label>
          <p className="text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            New PDFs use this layout. PDFs already prepared keep the version they were created with.
          </p>
        </div>
        <PdfSample key={`${keyed}:${retry}`} examId={examId} layout={layout} previewLayout={previewLayout} keyed={keyed} onDenied={onDenied} onRetry={() => setRetry(retry + 1)} />
      </div>
    </AuthoringDialog>
  );
}

function PdfSample({
  examId,
  layout,
  previewLayout,
  keyed,
  onDenied,
  onRetry,
}: {
  examId: string;
  layout: PdfLayout | undefined;
  previewLayout: SatPdfLayoutApi["preview"];
  keyed: boolean;
  onDenied: (error: unknown) => void;
  onRetry: () => void;
}) {
  const [result, setResult] = useState<{ url: string } | { error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void previewLayout(examId, layout, keyed, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setResult({ url });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      onDenied(error);
      setResult({ error: pdfErrorMessage(error, "The sample PDF could not be generated.") });
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [examId, keyed, layout, onDenied, previewLayout]);

  if (!result) return <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">Generating the sample PDF…</p>;
  if ("error" in result) {
    return (
      <div role="alert" className="space-y-3 rounded-[var(--sat-staff-radius-control,8px)] border border-[var(--sat-staff-danger-border,#d92d2033)] bg-[var(--sat-staff-danger-tint,#d92d2014)] p-4">
        <p className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{result.error}</p>
        <SatButton variant="secondary" onClick={onRetry}>Retry preview</SatButton>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <a className="inline-flex min-h-11 items-center text-[14px] font-medium underline" href={result.url} download="sample-sat-report.pdf">
        Download the sample PDF
      </a>
      <iframe
        className="h-[65dvh] w-full rounded-[var(--sat-staff-radius-control,8px)] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-[var(--sat-staff-surface-raised,#fbfbfd)]"
        src={result.url}
        title="Sample SAT exam PDF"
      />
    </div>
  );
}
