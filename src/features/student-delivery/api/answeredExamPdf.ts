import { apiClient } from '../../../shared/api/apiClient';

/** What the browser posts for a server-rendered answered-exam PDF. */
export interface AnsweredExamPdfRequest {
  title: string;
  view: unknown;
  /** Figures the paper loaded, as data:image URLs keyed by media id. */
  media: Record<string, string>;
}

/**
 * POSTs the request and returns the PDF. A non-OK answer throws with its
 * `statusCode`, so the attempt bearer's 401 refresh still applies.
 */
export async function postAnsweredExamPdf(
  endpoint: string,
  body: AnsweredExamPdfRequest,
  headers?: Record<string, string>,
): Promise<Blob> {
  const csrfToken = apiClient.getCsrfToken();
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`PDF request failed (${response.status}).`), { statusCode: response.status });
  }
  const pdf = await response.blob();
  if (pdf.type !== 'application/pdf') throw new Error('PDF request returned no PDF.');
  return pdf;
}
