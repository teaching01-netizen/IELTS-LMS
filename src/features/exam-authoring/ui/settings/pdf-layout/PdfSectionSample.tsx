import { useEffect, useState } from "react";
import { pdfTargetKey, samplePageMarkerOrigin, type PdfLayout, type PdfTarget } from "@shared/sat/pdfLayout";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import type { SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";
import { SatButton } from "../../../../../products/sat/ui/SatPage";
import { pdfErrorMessage } from "./PdfLayoutImageForm";

type SamplePage = { src: string; number: number };
type SampleBook = {
  url: string;
  pages: Record<string, SamplePage>;
  complete: boolean;
};

export function usePdfSampleBook({ enabled, identity, examId, layout, previewLayout, onDenied }: {
  enabled: boolean;
  identity: string;
  examId: string;
  layout: PdfLayout | undefined;
  previewLayout: SatPdfLayoutApi["preview"];
  onDenied: (error: unknown) => void;
}) {
  const [result, setResult] = useState<{ identity: string; book: SampleBook } | { identity: string; error: string }>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    let documentTask: PDFDocumentLoadingTask | undefined;
    let objectUrl: string | undefined;
    const timer = window.setTimeout(async () => {
      try {
        const [blob, pdfjs, worker] = await Promise.all([
          previewLayout(examId, layout, false, signal, undefined, true),
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        const data = await blob.arrayBuffer();
        signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        objectUrl = url;
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        documentTask = pdfjs.getDocument({ data, isEvalSupported: false, useWasm: false });
        const pdf = await documentTask.promise;
        const pages: Record<string, SamplePage> = {};
        for (let number = 1; number <= pdf.numPages; number++) {
          signal.throwIfAborted();
          const page = await pdf.getPage(number);
          const annotations: { url?: string }[] = await page.getAnnotations();
          const keys = number === 1 ? ["cover"] : [];
          for (const { url } of annotations) {
            if (url?.startsWith(samplePageMarkerOrigin)) {
              const key = decodeURIComponent(url.slice(samplePageMarkerOrigin.length));
              if (!pages[key]) keys.push(key);
            }
          }
          if (!keys.length) continue;
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          signal.throwIfAborted();
          const sample = { src: canvas.toDataURL("image/png"), number };
          for (const key of keys) {
            pages[key] = sample;
            if (key.startsWith('["reviewModule",')) {
              const [, sectionKey] = JSON.parse(key) as [string, string, string];
              pages["examReview"] ??= sample;
              pages[pdfTargetKey({ kind: "reviewSubject", sectionKey })] ??= sample;
            }
          }
          page.cleanup();
          setResult({ identity, book: { url, pages: { ...pages }, complete: false } });
        }
        signal.throwIfAborted();
        if (!pages["scoreReport"] || !pages["answerSummary"]) throw new Error("The sample PDF index is incomplete.");
        setResult({ identity, book: { url, pages, complete: true } });
      } catch (error) {
        if (!signal.aborted) {
          onDenied(error);
          setResult({ identity, error: pdfErrorMessage(error, "The sample PDF could not be prepared.") });
        }
      } finally {
        const task = documentTask;
        documentTask = undefined;
        await task?.destroy().catch(() => {});
      }
    }, 175);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      const task = documentTask;
      documentTask = undefined;
      void task?.destroy().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, examId, identity, layout, onDenied, previewLayout, retry]);

  const current = enabled && result?.identity === identity ? result : undefined;
  return {
    book: current && "book" in current ? current.book : undefined,
    error: current && "error" in current ? current.error : undefined,
    retry: () => { setResult(undefined); setRetry((value) => value + 1); },
  };
}

export function PdfSectionSample({ target, label, samples }: {
  target: PdfTarget;
  label: string;
  samples: ReturnType<typeof usePdfSampleBook>;
}) {
  const { book, error, retry } = samples;
  const page = book?.pages[pdfTargetKey(target)];

  return (
    <figure className="space-y-2">
      <div className="grid aspect-[297/210] w-full place-items-center overflow-hidden rounded-md border border-border bg-background text-center shadow-sm">
        {page ? (
          <img className="h-full w-full object-contain" src={page.src} alt={label + " sample PDF page"} />
        ) : error ? (
          <div className="space-y-2 p-3">
            <p className="text-sm text-destructive" role="alert">{error}</p>
            <SatButton variant="secondary" onClick={retry}>Retry sample PDF</SatButton>
          </div>
        ) : book?.complete ? (
          <p className="p-3 text-sm text-muted-foreground">No sample page is available for this section.</p>
        ) : (
          <p className="p-3 text-sm text-muted-foreground" role="status">Preparing sample pages…</p>
        )}
      </div>
      {page && book ? (
        <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Sample data</span>
          <a className="inline-flex min-h-9 items-center underline" href={book.url + "#page=" + page.number} target="_blank" rel="noreferrer">Open sample PDF<span className="sr-only"> (new tab)</span></a>
        </figcaption>
      ) : null}
    </figure>
  );
}
