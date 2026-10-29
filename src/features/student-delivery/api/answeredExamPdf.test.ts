import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../shared/api/apiClient";
import { prepareAnsweredExamPdf } from "./answeredExamPdf";

beforeEach(() => {
  vi.spyOn(apiClient, "getCsrfToken").mockReturnValue("csrf");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  apiClient.setReauthenticationRequiredHandler(null);
  apiClient.setUnauthorizedHandler(null);
});
const ready = () => ({
  downloadUrl: "/api/v1/sat-answered-pdf/downloads/0123456789abcdef0123456789abcdef",
  filename: "มินา - Answered exam.pdf",
  sizeBytes: 8192,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
});

describe("native PDF preparation", () => {
  it("posts only report JSON with cancellation and authentication, never reading a PDF Blob", async () => {
    const pdf = ready();
    const blob = vi.fn(() => {
      throw new Error("PDF bytes must not enter JS");
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => pdf, blob });
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(
      await prepareAnsweredExamPdf("/prepare", { view: null }, controller.signal, {
        Authorization: "Bearer attempt",
      })
    ).toEqual(pdf);
    expect(fetch).toHaveBeenCalledWith(
      "/prepare",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        body: '{"view":null}',
        headers: {
          "content-type": "application/json",
          "x-csrf-token": "csrf",
          Authorization: "Bearer attempt",
        },
      })
    );
    expect(blob).not.toHaveBeenCalled();
  });
  it.each([401, 429, 503])("retains status %s for credential refresh and retry", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(
      prepareAnsweredExamPdf("/prepare", { view: null }, new AbortController().signal)
    ).rejects.toMatchObject({ statusCode: status });
  });
  it("routes staff REAUTH_REQUIRED to password confirmation, never for an attempt bearer", async () => {
    const onReauth = vi.fn();
    apiClient.setReauthenticationRequiredHandler(onReauth);
    const reauthResponse = () =>
      new Response(JSON.stringify({ code: "REAUTH_REQUIRED", message: "confirm" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reauthResponse()));
    await expect(
      prepareAnsweredExamPdf("/prepare", { view: null }, new AbortController().signal)
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED", statusCode: 403 });
    expect(onReauth).toHaveBeenCalledTimes(1);
    await expect(
      prepareAnsweredExamPdf("/prepare", { view: null }, new AbortController().signal, {
        Authorization: "Bearer attempt",
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(onReauth).toHaveBeenCalledTimes(1);
  });
  it.each(["external", "expired", "missing", "bad-size", "bad-types"])(
    "rejects an unusable %s grant",
    async (kind) => {
      const pdf: Record<string, unknown> = ready();
      if (kind === "external") pdf.downloadUrl = "https://example.test/document.pdf";
      if (kind === "expired") pdf.expiresAt = new Date(Date.now() - 1).toISOString();
      if (kind === "bad-size") pdf.sizeBytes = -1;
      if (kind === "bad-types") pdf.downloadUrl = [pdf.downloadUrl];
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => (kind === "missing" ? null : pdf) })
      );
      await expect(
        prepareAnsweredExamPdf("/prepare", { view: null }, new AbortController().signal)
      ).rejects.toThrow("no usable download");
    }
  );
});
