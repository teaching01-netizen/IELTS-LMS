import { useEffect, useState } from "react";
import type { PdfLayout, PdfTarget } from "@shared/sat/pdfLayout";
import type { SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";
import { pdfErrorMessage } from "./PdfLayoutImageForm";
import { rasterizeFirstPage, rasterizeSampleBook, type SampleBook } from "./pdfSampleRaster";

/**
 * Sample rendering for the editor.
 *
 * The samples come from the same renderer a student's PDF uses, so what the
 * staff member sees is what prints. A failed render never blanks the canvas:
 * the last good page stays on screen with the error beside it.
 */

export function usePdfSampleBook({
  enabled,
  identity,
  examId,
  layout,
  previewLayout,
  onDenied,
}: {
  enabled: boolean;
  /** Changes whenever the rendered sample would change. */
  identity: string;
  examId: string;
  layout: PdfLayout | undefined;
  previewLayout: SatPdfLayoutApi["preview"];
  onDenied: (error: unknown) => void;
}) {
  const [book, setBook] = useState<SampleBook | undefined>(undefined);
  const [renderedIdentity, setRenderedIdentity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    let objectUrl: string | undefined;
    const timer = window.setTimeout(async () => {
      setPending(true);
      try {
        const blob = await previewLayout(examId, layout, false, signal, undefined, true);
        signal.throwIfAborted();
        const rendered = await rasterizeSampleBook(blob, signal);
        signal.throwIfAborted();
        objectUrl = rendered.url;
        setBook((previous) => {
          if (previous?.url && previous.url !== rendered.url) URL.revokeObjectURL(previous.url);
          return rendered;
        });
        setRenderedIdentity(identity);
        setError(null);
      } catch (cause) {
        if (signal.aborted) return;
        onDenied(cause);
        setError(pdfErrorMessage(cause, "The sample PDF could not be prepared."));
      } finally {
        if (!signal.aborted) setPending(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, examId, identity, layout, onDenied, previewLayout, retry]);

  return {
    book,
    error,
    pending: pending || renderedIdentity !== identity,
    retry: () => {
      setError(null);
      setRetry((value) => value + 1);
    },
  };
}

/**
 * One section of the sample report. Used where a single page is enough, such
 * as checking a brand mark on the cover.
 */
export function useSectionSample({
  enabled,
  identity,
  examId,
  layout,
  target,
  previewLayout,
  onDenied,
}: {
  enabled: boolean;
  identity: string;
  examId: string;
  layout: PdfLayout | undefined;
  target: PdfTarget | undefined;
  previewLayout: SatPdfLayoutApi["preview"];
  onDenied: (error: unknown) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [renderedIdentity, setRenderedIdentity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!enabled || !target) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = window.setTimeout(async () => {
      setPending(true);
      try {
        const blob = await previewLayout(examId, layout, false, signal, target);
        signal.throwIfAborted();
        const rendered = await rasterizeFirstPage(blob, signal);
        signal.throwIfAborted();
        setSrc(rendered.src);
        setRenderedIdentity(identity);
        setError(null);
      } catch (cause) {
        if (signal.aborted) return;
        onDenied(cause);
        setError(pdfErrorMessage(cause, "This page could not be prepared."));
      } finally {
        if (!signal.aborted) setPending(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, examId, identity, layout, onDenied, previewLayout, retry, target]);

  return {
    src,
    error,
    pending: pending || renderedIdentity !== identity,
    retry: () => {
      setError(null);
      setRetry((value) => value + 1);
    },
  };
}
