import type { PdfImagePurpose, PdfLayout, PdfLayoutAsset, PdfLayoutEditorData } from "@shared/sat/pdfLayout";
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

async function post(endpoint: string, type: string, body: BodyInit, signal: AbortSignal) {
  const csrfToken = apiClient.getCsrfToken();
  const generation = apiClient.captureAuthGeneration();
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": type, ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
    body,
    signal,
  });
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

export async function previewSatPdfLayout(examId: string, layout: PdfLayout | undefined, sampleAnswerKey: boolean, signal: AbortSignal) {
  const response = await post(
    `/api${path(examId)}/sat-pdf-layout/preview`, "application/json", JSON.stringify({ layout, sampleAnswerKey }), signal
  );
  if (response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf") {
    throw new Error("Preview returned an unusable PDF.");
  }
  return response.blob();
}
