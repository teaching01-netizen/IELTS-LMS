import { afterEach, describe, expect, it, vi } from "vitest";
import { exampleFilename, scoreReportExampleApi } from "../scoreReportExampleApi";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
});

describe("scoreReportExampleApi", () => {
  it("uses the server's plain attachment filename", () => {
    expect(exampleFilename('attachment; filename="SAT Practice 04 - Score report example.pdf"')).toBe(
      "SAT Practice 04 - Score report example.pdf"
    );
  });

  it("decodes an RFC 5987 filename and falls back safely", () => {
    expect(exampleFilename("attachment; filename*=UTF-8''SAT%20Practice%2004%20-%20Example.pdf")).toBe(
      "SAT Practice 04 - Example.pdf"
    );
    expect(exampleFilename(null)).toBe("SAT score report example.pdf");
    expect(exampleFilename("attachment; filename*=UTF-8''broken%")).toBe("SAT score report example.pdf");
  });

  it("fetches the exam example and returns its blob", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="SAT Practice 04 - Score report example.pdf"',
      }),
      blob: async () => blob,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await scoreReportExampleApi.download("exam-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/assessment-authoring/exams/exam-1/sat-score-report-example",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(result.blob).toBe(blob);
    expect(result.filename).toBe("SAT Practice 04 - Score report example.pdf");
  });

  it("aborts a stalled example download with a retry message", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const result = expect(scoreReportExampleApi.download("exam-1")).rejects.toThrow(
      "The score report example took too long. Try again."
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
  });
});
