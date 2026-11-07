import { afterEach, expect, it, vi } from "vitest";
import { recordSatDiagnostic, startSatDiagnostics } from "../satDiagnostics";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reports a sitting mount and browser error without uploading the error message or answers", async () => {
  const uploads: unknown[] = [];
  const stop = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "attempt",
    send: async (_schedule, _attempt, payload) => {
      uploads.push(payload);
    },
  });
  window.dispatchEvent(
    new ErrorEvent("error", { message: "secret-token answer B email@example.com" })
  );
  await vi.waitFor(() =>
    expect(uploads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "mounted" }),
        expect.objectContaining({ event: "unhandled_error", reason: "unknown" }),
      ])
    )
  );
  expect(JSON.stringify(uploads)).not.toContain("secret-token");
  expect(JSON.stringify(uploads)).not.toContain("email@example.com");
  stop();
});

it("retries an undelivered event with the same id when the same sitting reopens", async () => {
  const failed: unknown[] = [];
  const stop = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "attempt",
    send: async (_s, _a, payload) => {
      failed.push(payload);
      throw new Error("offline");
    },
  });
  await vi.waitFor(() => expect(failed.length).toBeGreaterThan(0));
  stop();
  const retried: unknown[] = [];
  const stopAgain = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "attempt",
    send: async (_s, _a, payload) => {
      retried.push(payload);
    },
  });
  await vi.waitFor(() => expect(retried).toContainEqual(failed[0]));
  stopAgain();
});

it("records an unexplained interruption after a page disappears without an explicit exit", async () => {
  const stop = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "crashed-attempt",
    send: async () => undefined,
  });
  window.dispatchEvent(new Event("pagehide"));
  // A new JS realm represents reopening after the old page disappeared.
  vi.resetModules();
  const { startSatDiagnostics: reopen } = await import("../satDiagnostics");
  const uploads: unknown[] = [];
  const stopAgain = reopen({
    scheduleId: "room",
    attemptId: "crashed-attempt",
    send: async (_s, _a, p) => {
      uploads.push(p);
    },
  });
  await vi.waitFor(() =>
    expect(uploads).toContainEqual(
      expect.objectContaining({ event: "interrupted", reason: "unknown" })
    )
  );
  stop();
  stopAgain();
});

it("does not call an explicit exit a crash when the sitting is reopened", async () => {
  const firstPage: { event: string; pageId: string }[] = [];
  const stop = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "exit-attempt",
    send: async (_s, _a, p) => {
      firstPage.push(p);
    },
  });
  await vi.waitFor(() => expect(firstPage.length).toBeGreaterThan(0));
  recordSatDiagnostic("explicit_exit", { reason: "explicit" });
  stop();
  const uploads: { event: string; pageId: string }[] = [];
  const stopAgain = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "exit-attempt",
    send: async (_s, _a, p) => {
      uploads.push(p);
    },
  });
  await vi.waitFor(() =>
    expect(uploads.some((p) => p.event === "mounted" && p.pageId !== firstPage[0]?.pageId)).toBe(
      true
    )
  );
  expect(uploads.some((p) => p.event === "interrupted")).toBe(false);
  stopAgain();
});

it("bounds diagnostic uploads during a browser error storm", async () => {
  const uploads: unknown[] = [];
  const stop = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "storm",
    send: async (_s, _a, p) => {
      uploads.push(p);
    },
  });
  for (let i = 0; i < 100; i++) {
    window.dispatchEvent(new Event("error"));
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(uploads.length).toBeLessThanOrEqual(40);
  stop();
});

it("identifies a browser reload without recording the URL", async () => {
  vi.stubGlobal("performance", {
    now: () => 0,
    getEntriesByType: () => [{ type: "reload", name: "https://example.com/?token=secret" }],
  });
  const uploads: unknown[] = [];
  const stop = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "reload",
    send: async (_s, _a, p) => {
      uploads.push(p);
    },
  });
  await vi.waitFor(() =>
    expect(uploads).toContainEqual(
      expect.objectContaining({ event: "mounted", navigationType: "reload" })
    )
  );
  expect(JSON.stringify(uploads)).not.toContain("secret");
  stop();
});
