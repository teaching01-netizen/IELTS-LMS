import { pdfTargetKey, samplePageMarkerOrigin } from "@shared/sat/pdfLayout";
import type { PDFPageProxy } from "pdfjs-dist";

/**
 * Rasterizes the server-rendered sample PDF so the editor can show the real
 * printed page instead of a mock. The server marks every generated section
 * with a link annotation, so one render yields the page image for each
 * section plus its physical page number.
 */

export type SamplePage = { src: string; number: number };

export type SampleBook = {
  url: string;
  pages: Record<string, SamplePage>;
};

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

function renderPage(page: PDFPageProxy, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  return { canvas, viewport };
}

/** Every marked section in the sample, with the page it prints on. */
export async function rasterizeSampleBook(blob: Blob, signal: AbortSignal): Promise<SampleBook> {
  const pdfjs = await loadPdfjs();
  const data = await blob.arrayBuffer();
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const documentTask = pdfjs.getDocument({ data, isEvalSupported: false, useWasm: false });
  try {
    const pdf = await documentTask.promise;
    const pages: Record<string, SamplePage> = {};
    for (let number = 1; number <= pdf.numPages; number += 1) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const annotations = (await page.getAnnotations()) as Array<{ url?: string }>;
      const keys: string[] = number === 1 ? ["cover"] : [];
      for (const annotation of annotations) {
        const marker = annotation.url;
        if (!marker?.startsWith(samplePageMarkerOrigin)) continue;
        const key = decodeURIComponent(marker.slice(samplePageMarkerOrigin.length));
        if (!pages[key]) keys.push(key);
      }
      if (!keys.length) {
        page.cleanup();
        continue;
      }
      const { canvas, viewport } = renderPage(page, 1.5);
      await page.render({ canvas, viewport }).promise;
      signal.throwIfAborted();
      const sample: SamplePage = { src: canvas.toDataURL("image/png"), number };
      for (const key of keys) {
        pages[key] = sample;
        if (key.startsWith('["reviewModule",')) {
          const parsed = JSON.parse(key) as [string, string, string];
          const sectionKey = parsed[1];
          if (sectionKey) {
            pages["examReview"] ??= sample;
            pages[pdfTargetKey({ kind: "reviewSubject", sectionKey })] ??= sample;
          }
        }
      }
      page.cleanup();
    }
    return { url, pages };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    await documentTask.destroy().catch(() => {});
  }
}

/** The first page of a single-section sample render. */
export async function rasterizeFirstPage(blob: Blob, signal: AbortSignal): Promise<{ src: string }> {
  const pdfjs = await loadPdfjs();
  const data = await blob.arrayBuffer();
  signal.throwIfAborted();
  const documentTask = pdfjs.getDocument({ data, isEvalSupported: false, useWasm: false });
  try {
    const pdf = await documentTask.promise;
    const page = await pdf.getPage(1);
    const { canvas, viewport } = renderPage(page, 1.5);
    await page.render({ canvas, viewport }).promise;
    signal.throwIfAborted();
    return { src: canvas.toDataURL("image/png") };
  } finally {
    await documentTask.destroy().catch(() => {});
  }
}
