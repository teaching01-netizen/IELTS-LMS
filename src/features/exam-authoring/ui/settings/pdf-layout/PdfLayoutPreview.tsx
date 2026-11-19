import { useEffect, useId, useRef, useState } from "react";
import type { PdfLayout } from "@shared/sat/pdfLayout";
import { SatButton } from "../../../../../products/sat/ui/SatPage";
import { previewSatPdfLayout } from "../../../api/satPdfLayoutApi";
import { pdfErrorMessage, pdfInputClass } from "./PdfLayoutImageForm";

export function PdfLayoutPreview({ examId, layout, onBack, onDenied }: {
  examId: string;
  layout: PdfLayout | undefined;
  onBack: () => void;
  onDenied: (error: unknown) => void;
}) {
  const modeId = useId();
  const [keyed, setKeyed] = useState(false);
  const [retry, setRetry] = useState(0);
  const mode = useRef<HTMLSelectElement>(null);
  useEffect(() => mode.current?.focus(), []);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Sample preview</h3>
          <p className="text-sm text-muted-foreground">The sample shows all configured modules. Student PDFs vary by attempt.</p>
        </div>
        <SatButton variant="secondary" onClick={onBack}>Back to editor</SatButton>
      </div>
      <label className="block max-w-xs space-y-2 text-sm" htmlFor={modeId}>
        <span>Answer key</span>
        <select ref={mode} id={modeId} className={pdfInputClass} value={keyed ? "with" : "without"} onChange={(event) => setKeyed(event.currentTarget.value === "with")}>
          <option value="without">Without answer key</option>
          <option value="with">With answer key</option>
        </select>
      </label>
      <PdfSample key={`${keyed}:${retry}`} examId={examId} layout={layout} keyed={keyed} onDenied={onDenied} onRetry={() => setRetry(retry + 1)} />
    </div>
  );
}

function PdfSample({ examId, layout, keyed, onDenied, onRetry }: {
  examId: string;
  layout: PdfLayout | undefined;
  keyed: boolean;
  onDenied: (error: unknown) => void;
  onRetry: () => void;
}) {
  const [result, setResult] = useState<{ url: string } | { error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void previewSatPdfLayout(examId, layout, keyed, controller.signal).then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ url });
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        onDenied(error);
        setResult({ error: pdfErrorMessage(error, "The sample PDF could not be generated.") });
      });
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [examId, keyed, layout, onDenied]);

  if (!result) return <p role="status">Generating sample PDF…</p>;
  if ("error" in result) return (
    <div className="space-y-2">
      <p role="alert" className="text-destructive">{result.error}</p>
      <SatButton variant="secondary" onClick={onRetry}>Retry preview</SatButton>
    </div>
  );
  return (
    <>
      <a className="inline-flex text-sm underline" href={result.url} download="sample-sat-report.pdf">Download sample PDF</a>
      <iframe className="h-[55vh] w-full rounded-lg border border-border bg-muted" src={result.url} title="Sample SAT exam PDF" />
    </>
  );
}
