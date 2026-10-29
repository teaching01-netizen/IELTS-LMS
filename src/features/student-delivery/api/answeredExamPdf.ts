import { apiClient } from "../../../shared/api/apiClient";

export interface PreparedAnsweredExamPdf {
  downloadUrl: string;
  filename: string;
  sizeBytes: number;
  expiresAt: string;
}

export interface PrepareAnsweredExamPdfRequest {
  view: unknown;
}

/** Only a small JSON response enters JavaScript; the browser downloads the file. */
export async function prepareAnsweredExamPdf(
  endpoint: string,
  body: PrepareAnsweredExamPdfRequest,
  signal: AbortSignal,
  headers?: Record<string, string>
): Promise<PreparedAnsweredExamPdf> {
  const csrfToken = apiClient.getCsrfToken();
  const generation = apiClient.captureAuthGeneration();
  // Student callers pass their attempt bearer; its failures are not the
  // staff cookie's and must not open staff password confirmation.
  const bearer = Object.keys(headers ?? {}).some((name) => name.toLowerCase() === "authorization");
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: {
      "content-type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await apiClient.errorFromResponse(response);
    await apiClient.reportAuthFailure(error, {
      endpoint,
      method: "POST",
      requestId: error.requestId ?? "",
      generation,
      bearer,
    });
    error.message = `PDF preparation failed (${response.status}).`;
    throw error;
  }
  const pdf = (await response.json()) as PreparedAnsweredExamPdf | null;
  apiClient.assertAuthGeneration(generation);
  if (
    !pdf ||
    typeof pdf.downloadUrl !== "string" ||
    typeof pdf.expiresAt !== "string" ||
    !/^\/api\/v1\/sat-answered-pdf\/downloads\/[0-9a-f]{32}$/.test(pdf.downloadUrl) ||
    typeof pdf.filename !== "string" ||
    !pdf.filename.endsWith(".pdf") ||
    !Number.isSafeInteger(pdf.sizeBytes) ||
    pdf.sizeBytes <= 0 ||
    !Number.isFinite(Date.parse(pdf.expiresAt)) ||
    Date.parse(pdf.expiresAt) <= Date.now()
  ) {
    throw new Error("PDF preparation returned no usable download.");
  }
  return pdf;
}
