import type { PdfImagePurpose, PdfLayout, PdfLayoutAsset, PdfLayoutEditorData, PdfTarget } from "@shared/sat/pdfLayout";
import { apiClient } from "@shared/api/apiClient";
import { backendGet, backendPut } from "../../../services/backendBridge";

function path(examId: string) {
  return `/v1/assessment-authoring/exams/${encodeURIComponent(examId)}`;
}

export function loadSatPdfLayout(examId: string, signal: AbortSignal) {
  return backendGet<PdfLayoutEditorData>(`${path(examId)}/sat-pdf-layout`, { signal });
}

export function saveSatPdfLayout(examId: string, expectedRevision: number, layout: PdfLayout, signal: AbortSignal) {
  return backendPut<PdfLayoutEditorData>(`${path(examId)}/sat-pdf-layout`, { expectedRevision, layout }, { signal });
}

export function satPdfImageUrl(examId: string, assetId: string) {
  return `/api${path(examId)}/sat-pdf-assets/${encodeURIComponent(assetId)}`;
}

async function post(endpoint: string, type: string, body: BodyInit, signal: AbortSignal, retryBusy = false) {
  const csrfToken = apiClient.getCsrfToken();
  const generation = apiClient.captureAuthGeneration();
  const send = () => fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": type, ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
    body,
    signal,
  });
  let response = await send();
  if (retryBusy && response.status === 429 && response.headers.get("X-RateLimit-Tier") === "answered-exam-pdf") {
    const seconds = Number(response.headers.get("Retry-After"));
    if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 10) {
      await response.body?.cancel();
      await new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => {
          window.clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = window.setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, seconds * 1000);
        signal.addEventListener("abort", abort, { once: true });
      });
      apiClient.assertAuthGeneration(generation);
      response = await send();
    }
  }
  if (!response.ok) {
    const error = await apiClient.errorFromResponse(response);
    await apiClient.reportAuthFailure(error, {
      endpoint,
      method: "POST",
      requestId: error.requestId ?? "",
      generation,
      bearer: false,
    });
    throw error;
  }
  apiClient.assertAuthGeneration(generation);
  return response;
}

export async function uploadSatPdfImage(examId: string, purpose: PdfImagePurpose, file: File, signal: AbortSignal): Promise<PdfLayoutAsset> {
  const query = new URLSearchParams({ purpose, filename: file.name });
  const response = await post(`/api${path(examId)}/sat-pdf-assets?${query}`, file.type, file, signal);
  return response.json() as Promise<PdfLayoutAsset>;
}

export async function previewSatPdfLayout(examId: string, layout: PdfLayout | undefined, sampleAnswerKey: boolean, signal: AbortSignal, sectionSample?: PdfTarget, sampleBook?: boolean) {
  const response = await post(
    `/api${path(examId)}/sat-pdf-layout/preview`, "application/json", JSON.stringify({ layout, sampleAnswerKey, sectionSample, sampleBook }), signal, true
  );
  if (response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf") {
    throw new Error("Preview returned an unusable PDF.");
  }
  return response.blob();
}

export const satPdfLayoutApi = {
  load: loadSatPdfLayout,
  save: saveSatPdfLayout,
  imageUrl: satPdfImageUrl,
  upload: uploadSatPdfImage,
  preview: previewSatPdfLayout,
};

export type SatPdfLayoutApi = typeof satPdfLayoutApi;
