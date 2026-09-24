import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudentAccessLinkEntryRoute } from "../StudentAccessLinkEntryRoute";
import type { PublicStudentAccessLink } from "../../contracts/access-link/PublicStudentAccessLink";
import {
  loadSatResumeLocator,
  saveSatResumeLocator,
} from "../../../student-delivery/infrastructure/satResumeLocator";

const mocks = vi.hoisted(() => ({
  studentEntry: vi.fn(),
  authStatus: "unauthenticated" as string,
  session: null as unknown,
  refresh: vi.fn(),
  resume: vi.fn(),
  link: null as PublicStudentAccessLink | null,
  error: null as Error | null,
  isLoading: false,
}));

vi.mock("../../../auth/api/authSession", () => ({
  useAuthSession: () => ({
    studentEntry: mocks.studentEntry,
    status: mocks.authStatus,
    session: mocks.session,
    refresh: mocks.refresh,
  }),
}));

vi.mock("../../../student-delivery/api/satResume", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../student-delivery/api/satResume")>()),
  resumeSatStudentSession: mocks.resume,
}));

vi.mock("../../api/access-link/studentAccessLinkQueries", () => ({
  useStudentAccessLink: () => ({
    data: mocks.link,
    error: mocks.error,
    isLoading: mocks.isLoading,
  }),
}));

function liveLink(overrides: Partial<PublicStudentAccessLink> = {}): PublicStudentAccessLink {
  return {
    id: "link-public-1",
    scheduleId: "schedule-link-1",
    examTitle: "Digital SAT",
    providerKey: "sat",
    versionNumber: 4,
    publishScope: "full",
    name: "Saturday Class",
    enabledSections: null,
    audienceType: "anyone",
    audienceLabel: null,
    accessMode: "open",
    availabilityType: "anytime",
    opensAt: null,
    closesAt: null,
    status: "live",
    ...overrides,
  };
}

function DestinationProbe() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}</div>;
}

function renderRoute(path = "/join/link-public-1") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join/:accessLinkId" element={<StudentAccessLinkEntryRoute />} />
        <Route path="/student/:scheduleId/:studentId" element={<DestinationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function enterIdentity() {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada Student" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ADA@example.com" } });
}

beforeEach(() => {
  mocks.studentEntry.mockReset();
  mocks.resume.mockReset();
  mocks.refresh.mockReset();
  mocks.authStatus = "unauthenticated";
  mocks.session = null;
  mocks.link = liveLink();
  mocks.error = null;
  mocks.isLoading = false;
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("StudentAccessLinkEntryRoute", () => {
  it("automatically resumes through the same active Student Link", async () => {
    saveSatResumeLocator({
      scheduleId: "schedule-link-1",
      candidateId: "old-form-candidate",
      attemptId: "stale-attempt-id",
      accessLinkId: "link-public-1",
    });
    mocks.authStatus = "authenticated";
    mocks.session = { user: { role: "student" } };
    mocks.resume.mockResolvedValue({
      kind: "resumed",
      route: "/student/schedule-link-1/server-candidate",
      terminal: false,
      attempt: { id: "server-attempt", candidateId: "server-candidate" },
    });

    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId("destination")).toHaveTextContent(
        "/student/schedule-link-1/server-candidate"
      );
    });
    expect(mocks.resume).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });

  it("does not use a locator saved for a different Student Link", async () => {
    saveSatResumeLocator({
      scheduleId: "schedule-link-1",
      candidateId: "W123456",
      accessLinkId: "link-public-1",
    });
    mocks.authStatus = "authenticated";
    mocks.session = { user: { role: "student" } };
    mocks.link = liveLink({ id: "link-other", scheduleId: "schedule-other" });

    renderRoute("/join/link-other");

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it.each(["upcoming", "ended", "paused", "revoked"] as const)(
    "clears the saved SAT locator when the Student Link is %s",
    async (status) => {
      saveSatResumeLocator({
        scheduleId: "schedule-link-1",
        candidateId: "W123456",
        attemptId: "attempt-1",
        accessLinkId: "link-public-1",
      });
      mocks.link = liveLink({ status });

      renderRoute();

      await waitFor(() => expect(loadSatResumeLocator()).toBeNull());
      expect(mocks.resume).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    }
  );

  it("clears the saved SAT locator when its Student Link has been deleted", async () => {
    saveSatResumeLocator({
      scheduleId: "schedule-link-1",
      candidateId: "W123456",
      attemptId: "attempt-1",
      accessLinkId: "link-public-1",
    });
    mocks.link = null;
    mocks.error = Object.assign(new Error("Student Link not found."), { statusCode: 404 });

    renderRoute();

    await waitFor(() => expect(loadSatResumeLocator()).toBeNull());
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "This Student Link isn't available" })
    ).toBeInTheDocument();
  });

  it("uses the public link id only, omits student code for open links, and navigates with the server-issued handoff", async () => {
    mocks.studentEntry.mockResolvedValue({
      user: { id: "user-1", email: "ada@example.com", role: "student", state: "active" },
      csrfToken: "csrf",
      expiresAt: "2026-08-29T00:00:00.000Z",
      scheduleId: "internal-schedule-1",
      studentCode: "guest-server-issued",
    });
    renderRoute();

    expect(screen.queryByLabelText("Student code")).not.toBeInTheDocument();
    enterIdentity();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    await waitFor(() =>
      expect(mocks.studentEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          accessLinkId: "link-public-1",
          wcode: "",
          email: "ada@example.com",
          studentName: "Ada Student",
        })
      )
    );
    expect(mocks.studentEntry.mock.calls[0]?.[0].clientSessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "/student/internal-schedule-1/guest-server-issued"
    );
  });

  it("requires and forwards a code for selected-student links", async () => {
    mocks.link = liveLink({
      audienceType: "selected_students",
      audienceLabel: "Scholarship Cohort",
      accessMode: "student_code",
    });
    mocks.studentEntry.mockResolvedValue({
      user: { id: "user-2", email: "ada@example.com", role: "student", state: "active" },
      csrfToken: "csrf",
      expiresAt: "2026-08-29T00:00:00.000Z",
      scheduleId: "internal-schedule-2",
      studentCode: "W123456",
    });
    renderRoute();

    enterIdentity();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      await screen.findByText("Enter the student code provided by your teacher.")
    ).toBeInTheDocument();
    expect(mocks.studentEntry).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Student code"), { target: { value: "w123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() =>
      expect(mocks.studentEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          accessLinkId: "link-public-1",
          wcode: "W123456",
        })
      )
    );
  });

  it("recovers from a failed admission poll with working Retry and Leave-queue actions", async () => {
    mocks.studentEntry
      .mockResolvedValueOnce({
        state: "queued",
        ticketId: "link-ticket-retry-1",
        scheduleId: "internal-schedule-1",
        wcode: "",
        position: 2,
        pollAfterMs: 500,
        queuedAt: "2026-09-01T00:00:00.000Z",
      })
      .mockRejectedValueOnce(new Error("poll boom"))
      .mockResolvedValue({
        user: { id: "user-1", email: "ada@example.com", role: "student", state: "active" },
        csrfToken: "csrf",
        expiresAt: "2026-08-29T00:00:00.000Z",
        scheduleId: "internal-schedule-1",
        studentCode: "guest-server-issued",
      });
    renderRoute();

    enterIdentity();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/ticket ref link-ticket-retry-1/i)).toBeInTheDocument();
    });

    const retryButton = await screen.findByRole("button", { name: /^retry$/i }, { timeout: 3000 });
    expect(screen.getByText(/queue check failed after 1 attempt/i)).toBeInTheDocument();
    expect(screen.getByText(/position at failure 2/i)).toBeInTheDocument();
    // S3-C2: a failed poll must not dead-lock the form behind queue state.
    expect(screen.getByLabelText("Email")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Continue/i })).not.toBeDisabled();

    fireEvent.click(retryButton);

    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "/student/internal-schedule-1/guest-server-issued"
    );
    expect(
      window.sessionStorage.getItem("student-access-link-queue-ticket:link-public-1")
    ).toBeNull();
  });

  it("persists the link queue ticket so a reload resumes polling from the stored position", async () => {
    mocks.studentEntry
      .mockResolvedValueOnce({
        state: "queued",
        ticketId: "link-ticket-reload-1",
        scheduleId: "internal-schedule-1",
        wcode: "",
        position: 7,
        pollAfterMs: 10_000,
        queuedAt: "2026-09-01T00:00:00.000Z",
      })
      .mockResolvedValue({
        user: { id: "user-1", email: "ada@example.com", role: "student", state: "active" },
        csrfToken: "csrf",
        expiresAt: "2026-08-29T00:00:00.000Z",
        scheduleId: "internal-schedule-1",
        studentCode: "guest-server-issued",
      });
    const first = render(
      <MemoryRouter initialEntries={["/join/link-public-1"]}>
        <Routes>
          <Route path="/join/:accessLinkId" element={<StudentAccessLinkEntryRoute />} />
          <Route path="/student/:scheduleId/:studentId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    enterIdentity();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    await waitFor(() => {
      expect(
        window.sessionStorage.getItem("student-access-link-queue-ticket:link-public-1")
      ).not.toBeNull();
    });
    const stored = window.sessionStorage.getItem("student-access-link-queue-ticket:link-public-1");
    expect(JSON.parse(stored ?? "")).toMatchObject({
      ticket: { ticketId: "link-ticket-reload-1", position: 7 },
    });
    expect(mocks.studentEntry).toHaveBeenCalledTimes(1);

    // Simulate a reload: unmount, shorten the persisted poll delay so the
    // resumed poll fires inside the test timeout, then mount fresh.
    first.unmount();
    const persistedRaw = window.sessionStorage.getItem(
      "student-access-link-queue-ticket:link-public-1"
    );
    const persisted = JSON.parse(persistedRaw ?? "{}");
    window.sessionStorage.setItem(
      "student-access-link-queue-ticket:link-public-1",
      JSON.stringify({ ...persisted, ticket: { ...persisted.ticket, pollAfterMs: 500 } })
    );
    render(
      <MemoryRouter initialEntries={["/join/link-public-1"]}>
        <Routes>
          <Route path="/join/:accessLinkId" element={<StudentAccessLinkEntryRoute />} />
          <Route path="/student/:scheduleId/:studentId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/ticket ref link-ticket-reload-1/i)).toBeInTheDocument();
      expect(screen.getByText(/position 7/i)).toBeInTheDocument();
    });
    expect(mocks.studentEntry).toHaveBeenCalledTimes(1);

    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "/student/internal-schedule-1/guest-server-issued"
    );
  });

  it("still admits when profile storage is full (QuotaExceededError on write)", async () => {
    mocks.studentEntry.mockResolvedValue({
      user: { id: "user-1", email: "ada@example.com", role: "student", state: "active" },
      csrfToken: "csrf",
      expiresAt: "2026-08-29T00:00:00.000Z",
      scheduleId: "internal-schedule-1",
      studentCode: "guest-server-issued",
    });
    const quotaError = new DOMException("Quota exceeded", "QuotaExceededError");
    const rawSetItem = window.localStorage.setItem.bind(window.localStorage);
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation((key: string, value: string) => {
        if (key.startsWith("student-access-link-profile:")) throw quotaError;
        rawSetItem(key, value);
      });
    try {
      renderRoute();
      enterIdentity();
      fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
      expect(await screen.findByTestId("destination")).toHaveTextContent(
        "/student/internal-schedule-1/guest-server-issued"
      );
      expect(mocks.studentEntry).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
    }
  });

  it("still renders when profile storage read is denied", () => {
    const rawGetItem = window.localStorage.getItem.bind(window.localStorage);
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation((key: string) => {
      if (key.startsWith("student-access-link-profile:"))
        throw new DOMException("Denied", "SecurityError");
      return rawGetItem(key);
    });
    try {
      renderRoute();
      expect(screen.getByLabelText("Full name")).toHaveValue("");
      expect(screen.getByLabelText("Email")).toHaveValue("");
    } finally {
      getItem.mockRestore();
    }
  });

  it("renders availability as a terminal entry state and never authenticates before the window opens", () => {
    mocks.link = liveLink({
      availabilityType: "scheduled",
      opensAt: "2026-09-01T02:00:00.000Z",
      closesAt: "2026-09-01T06:00:00.000Z",
      status: "upcoming",
    });
    renderRoute();

    expect(screen.getByRole("heading", { name: "This exam isn’t open yet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue/i })).not.toBeInTheDocument();
    expect(mocks.studentEntry).not.toHaveBeenCalled();
  });

  it("states a narrowed section scope on the entry card before the student commits", () => {
    mocks.link = liveLink({ enabledSections: ["reading-writing"] });
    renderRoute();

    expect(
      screen.getByText(/You'll take Reading & Writing only\. The exam ends after that section\./)
    ).toBeInTheDocument();
  });

  it("says nothing about sections for an unscoped link", () => {
    mocks.link = liveLink({ enabledSections: null });
    renderRoute();

    expect(screen.queryByText(/The exam ends after that section/)).not.toBeInTheDocument();
  });

  it("states the pinned release scope for an otherwise unscoped link", () => {
    mocks.link = liveLink({ publishScope: "reading-writing", enabledSections: null });
    renderRoute();

    expect(
      screen.getByText(/You'll take Reading & Writing only\. The exam ends after that section\./)
    ).toBeInTheDocument();
  });

  it("does not admit a link whose saved scope has no intersection with its release", () => {
    mocks.link = liveLink({ publishScope: "reading-writing", enabledSections: ["math"] });
    renderRoute();

    expect(screen.getByRole("heading", { name: "This exam isn’t available" })).toBeInTheDocument();
    expect(
      screen.getByText(/no sections in this student link are enabled in its published release/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue/i })).not.toBeInTheDocument();
  });
});
