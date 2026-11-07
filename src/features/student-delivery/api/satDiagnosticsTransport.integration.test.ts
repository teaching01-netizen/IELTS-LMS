import { startSatDiagnostics } from "../../../utils/satDiagnostics";
import { afterEach, expect, it, vi } from "vitest";
import { assessmentDeliveryApi, configureAssessmentDeliveryAttempt } from "./assessmentDeliveryApi";
import { storeAttemptCredential } from "../../../services/attemptCredentialAdapter";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

it("never renews credentials or logs out the student to upload a diagnostic", async () => {
  configureAssessmentDeliveryAttempt("room", "attempt", "W260260");
  storeAttemptCredential(
    { scheduleId: "room", id: "attempt" },
    { attemptToken: "proof", expiresAt: "2099-01-01", credentialPolicy: "sitting_v1" }
  );
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "EXAM_ACCESS_REVOKED", message: "Revoked." },
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    })
  );
  await expect(
    assessmentDeliveryApi.recordDiagnostic("room", "attempt", {
      eventId: crypto.randomUUID(),
      event: "mounted",
      pageId: crypto.randomUUID(),
      version: "test",
      occurredAt: new Date().toISOString(),
    })
  ).rejects.toBeDefined();
  expect(requests).toEqual(["/api/v1/student/sessions/room/audit"]);
});

it("records the actual server access rejection without confusing it with a module deadline", async () => {
  configureAssessmentDeliveryAttempt("room-access", "attempt-access", "W260260");
  storeAttemptCredential(
    { scheduleId: "room-access", id: "attempt-access" },
    { attemptToken: "proof", expiresAt: "2099-01-01", credentialPolicy: "sitting_v1" }
  );
  const events: unknown[] = [];
  const stop = startSatDiagnostics({
    scheduleId: "room-access",
    attemptId: "attempt-access",
    send: async (_s, _a, p) => {
      events.push(p);
    },
  });
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
  await expect(
    assessmentDeliveryApi.heartbeat("room-access", "attempt-access")
  ).rejects.toBeDefined();
  await vi.waitFor(() =>
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "access_rejected",
        statusCode: 403,
        reason: "EXAM_ACCESS_REVOKED",
      })
    )
  );
  stop();
});
