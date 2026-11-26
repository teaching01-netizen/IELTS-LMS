import { apiClient } from "@shared/api/apiClient";

function path(examId: string) {
  return `/api/v1/assessment-authoring/exams/${encodeURIComponent(examId)}/sat-score-report-example`;
}

export interface ScoreReportExampleDownload {
  blob: Blob;
  filename: string;
}

const fallbackFilename = "SAT score report example.pdf";

/** Prefer the server's attachment name; fall back to a safe local name. */
export function exampleFilename(disposition: string | null): string {
  if (!disposition) return fallbackFilename;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // A malformed escape falls through to the plain filename.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() || fallbackFilename;
}

export const scoreReportExampleApi = {
  async download(examId: string): Promise<ScoreReportExampleDownload> {
    const response = await fetch(path(examId), {
      credentials: "same-origin",
      headers: { Accept: "application/pdf" },
    });
    if (!response.ok) throw await apiClient.errorFromResponse(response);
    if (response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf") {
      throw new Error("The score report example did not return a PDF.");
    }
    return {
      blob: await response.blob(),
      filename: exampleFilename(response.headers.get("Content-Disposition")),
    };
  },
};
