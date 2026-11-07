import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentAccessLinkEntryRoute } from "../StudentAccessLinkEntryRoute";
import { saveSatResumeLocator } from "../../../student-delivery/infrastructure/satResumeLocator";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "../../../auth/authSession";
import { storeAttemptCredential } from "../../../../services/attemptCredentialAdapter";
import { ensureClientSessionIdForStudentKey } from "../../../../services/studentAttemptRepository";
import { StudentEntryRoute } from "../StudentEntryRoute";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function mountEntry(
  entry: string,
  resumeError?: string,
  expired = false,
  locatorSchedule = "sat-room"
) {
  saveSatResumeLocator({
    scheduleId: locatorSchedule,
    candidateId: "W260260",
    attemptId: locatorSchedule === "sat-room" ? "original-attempt" : "other-attempt",
    accessLinkId: "sat-link",
  });
  const writer = ensureClientSessionIdForStudentKey("sat-room", "student-sat-room-W260260");
  storeAttemptCredential(
    { id: "original-attempt", scheduleId: "sat-room", candidateId: "W260260" },
    {
      attemptToken: "exam-proof",
      expiresAt: expired ? "2001-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
      credentialPolicy: "sitting_v1",
    }
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const respond = (data: unknown) =>
        new Response(JSON.stringify({ success: true, data }), {
          headers: { "content-type": "application/json" },
        });
      if (url.includes("/auth/session"))
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Authentication is required.",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } }
        );
      if (url.includes("/public/access-links/"))
        return respond({
          id: "sat-link",
          scheduleId: "sat-room",
          providerKey: "sat",
          status: "live",
          accessMode: "open",
          audienceType: "anyone",
          availabilityType: "anytime",
          publishScope: "full",
          enabledSections: null,
        });
      if (url.includes("/auth/student/schedules/"))
        return respond({ id: "sat-room", providerKey: "sat", status: "live" });
      if (url.includes("/student/sessions/sat-room?")) {
        if (resumeError)
          return new Response(
            JSON.stringify({
              success: false,
              error: { code: resumeError, message: "Access refused." },
            }),
            { status: 401, headers: { "content-type": "application/json" } }
          );
        if (new Headers(init?.headers).get("Authorization") !== "Bearer exam-proof") {
          return new Response("{}", { status: 401 });
        }
        return respond({
          attempt: {
            id: "original-attempt",
            scheduleId: "sat-room",
            candidateId: "W260260",
            studentKey: "student-sat-room-W260260",
            providerKey: "sat",
            phase: "exam",
            deliveryStatus: "running",
            answers: { q1: "B" },
            integrity: {},
            recovery: {},
            createdAt: "2026-11-05T13:38:22Z",
            updatedAt: "2026-11-05T13:46:25Z",
          },
          clientSessionId: writer,
          attemptCredential: {
            attemptToken: "exam-proof",
            expiresAt: "2099-01-01T00:00:00Z",
            credentialPolicy: "sitting_v1",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    })
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthSessionProvider>
        <MemoryRouter initialEntries={[entry === "link" ? "/join/sat-link" : "/student/sat-room"]}>
          <Routes>
            <Route path="/join/:accessLinkId" element={<StudentAccessLinkEntryRoute />} />
            <Route path="/student/:scheduleId" element={<StudentEntryRoute />} />
            <Route
              path="/student/:scheduleId/:studentId"
              element={<div>Original SAT sitting</div>}
            />
          </Routes>
        </MemoryRouter>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}

it.each(["direct", "link"])(
  "reopens the existing SAT sitting through %s entry after account login expires",
  async (entry) => {
    mountEntry(entry);
    expect(await screen.findByText("Original SAT sitting")).toBeInTheDocument();
  }
);

it.each(["direct", "link"])(
  "shows access recovery instead of registration through %s entry after revocation",
  async (entry) => {
    mountEntry(entry, "EXAM_ACCESS_REVOKED");
    expect(
      await screen.findByRole("heading", { name: "Exam access needs recovery" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  }
);

it.each(["direct", "link"])(
  "offers recovery for a locally expired sitting through %s entry",
  async (entry) => {
    mountEntry(entry, undefined, true);
    expect(await screen.findByRole("heading", { name: "Exam access expired" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  }
);

it("resumes the requested room when the last-used locator belongs to another room", async () => {
  mountEntry("direct", undefined, false, "other-room");
  expect(await screen.findByText("Original SAT sitting")).toBeInTheDocument();
});
