import { afterEach, expect, it, vi } from "vitest";
import { resumeSatStudentSession } from "../satStudentResume";
import { loadSatResumeLocator, saveSatResumeLocator } from "../satResumeLocator";
import { startSatDiagnostics } from "../../../../utils/satDiagnostics";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

it("preserves the sitting hint and requests staff recovery when exam access has expired", async () => {
  saveSatResumeLocator({ scheduleId: "room", candidateId: "W260260", attemptId: "original" });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "EXAM_ACCESS_EXPIRED", message: "Exam access expired." },
          }),
          { status: 401, headers: { "content-type": "application/json" } }
        )
    )
  );
  expect(
    await resumeSatStudentSession({ scheduleId: "room", locator: loadSatResumeLocator() })
  ).toEqual({ kind: "recovery-required", reason: "expired" });
  expect(loadSatResumeLocator()?.attemptId).toBe("original");
});

it("preserves the sitting hint and requests staff recovery when exam access was revoked", async () => {
  saveSatResumeLocator({ scheduleId: "room", candidateId: "W260260", attemptId: "original" });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "EXAM_ACCESS_REVOKED", message: "Exam access revoked." },
          }),
          { status: 401, headers: { "content-type": "application/json" } }
        )
    )
  );
  expect(
    await resumeSatStudentSession({ scheduleId: "room", locator: loadSatResumeLocator() })
  ).toEqual({ kind: "recovery-required", reason: "revoked" });
  expect(loadSatResumeLocator()?.attemptId).toBe("original");
});

it("preserves the sitting hint and offers transfer when another browser owns the exam", async () => {
  saveSatResumeLocator({ scheduleId: "room", candidateId: "W260260", attemptId: "original" });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "SESSION_ALREADY_ACTIVE", message: "Another browser is active." },
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
    )
  );
  expect(
    await resumeSatStudentSession({ scheduleId: "room", locator: loadSatResumeLocator() })
  ).toEqual({ kind: "recovery-required", reason: "ownership" });
  expect(loadSatResumeLocator()?.attemptId).toBe("original");
});

it("retains the access rejection for upload when that same attempt recovers", async () => {
  saveSatResumeLocator({ scheduleId: "room", candidateId: "W260260", attemptId: "original" });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "EXAM_ACCESS_REVOKED", message: "Revoked." },
          }),
          { status: 403, headers: { "content-type": "application/json" } }
        )
    )
  );
  await resumeSatStudentSession({ scheduleId: "room", locator: loadSatResumeLocator() });
  const uploads: unknown[] = [];
  const stop = startSatDiagnostics({
    scheduleId: "room",
    attemptId: "original",
    send: async (_s, _a, p) => {
      uploads.push(p);
    },
  });
  await vi.waitFor(() =>
    expect(uploads).toContainEqual(
      expect.objectContaining({ event: "resume_result", reason: "revoked" })
    )
  );
  stop();
});
