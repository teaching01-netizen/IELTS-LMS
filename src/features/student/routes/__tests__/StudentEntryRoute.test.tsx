import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, UNSAFE_NavigationContext } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudentEntryRoute } from "../StudentEntryRoute";

const navigateMock = vi.fn();
const studentEntryMock = vi.fn();
const getStudentEntryScheduleMock = vi.hoisted(() => vi.fn());

vi.mock("../../infrastructure/studentEntryGateway", () => ({
  getStudentEntrySchedule: getStudentEntryScheduleMock,
  isStudentEntryScheduleBlockedError: () => false,
}));

vi.mock("../../../auth/authSession", () => ({
  useAuthSession: () => ({ studentEntry: studentEntryMock }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderRoute(scheduleId: string) {
  render(
    <MemoryRouter initialEntries={[`/student/${scheduleId}`]}>
      <Routes>
        <Route path="/student/:scheduleId" element={<StudentEntryRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

function submitForm(wcode = "W250334") {
  fireEvent.change(screen.getByLabelText(/access code|wcode/i), {
    target: { value: wcode },
  });
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "student@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/full name/i), {
    target: { value: "Student One" },
  });
  fireEvent.change(screen.getByLabelText(/nickname/i), {
    target: { value: "student-one" },
  });
  fireEvent.change(screen.getByLabelText(/IELTS Course/i), {
    target: { value: "IELTS Academic" },
  });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

function RouteProbe({ onReady }: { onReady: (push: (to: string) => void) => void }) {
  const { navigator } = React.useContext(UNSAFE_NavigationContext);

  React.useEffect(() => {
    onReady((to) => navigator.push(to));
  }, [navigator, onReady]);

  return null;
}

describe("StudentEntryRoute", () => {
  beforeEach(() => {
    getStudentEntryScheduleMock.mockResolvedValue({ status: "live", providerKey: "ielts" });
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    navigateMock.mockReset();
    studentEntryMock.mockReset();
    getStudentEntryScheduleMock.mockReset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates a behind-the-scenes student session and continues to the schedule-backed delivery route", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440000";
    studentEntryMock.mockResolvedValue({
      user: {
        id: "student-1",
        email: "student@example.com",
        displayName: "Student One",
        role: "student",
        state: "active",
      },
      csrfToken: "csrf-1",
      expiresAt: "2026-01-01T12:00:00.000Z",
    });

    renderRoute(scheduleId);
    submitForm();

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: "W250334",
        email: "student@example.com",
        studentName: "Student One",
        nickname: "student-one",
        ieltsCourse: "IELTS Academic",
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    });
  });

  it("keeps check-in available for a scheduled exam before the runtime starts", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440141";
    getStudentEntryScheduleMock.mockResolvedValue({ status: "scheduled", providerKey: "ielts" });
    studentEntryMock.mockResolvedValue({
      user: {
        id: "student-scheduled-1",
        email: "student@example.com",
        displayName: "Student One",
        role: "student",
        state: "active",
      },
      csrfToken: "csrf-scheduled-1",
      expiresAt: "2026-01-01T12:00:00.000Z",
    });

    renderRoute(scheduleId);
    await waitFor(() => {
      expect(getStudentEntryScheduleMock).toHaveBeenCalledWith(scheduleId);
    });
    expect(screen.getByRole("heading", { name: "Exam Check-in" })).toBeInTheDocument();

    submitForm();

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: "W250334",
        email: "student@example.com",
        studentName: "Student One",
        nickname: "student-one",
        ieltsCourse: "IELTS Academic",
      });
    });
  });

  it("auto-resumes an existing attempt for the last wcode instead of forcing check-in again", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440001";
    window.localStorage.setItem(`ielts-student-last-wcode:${scheduleId}`, "W250334");
    window.localStorage.setItem(
      "ielts_student_attempts_v1",
      JSON.stringify([
        {
          id: "attempt-1",
          scheduleId,
          studentKey: `student-${scheduleId}-W250334`,
          examId: "exam-1",
          examTitle: "Mock Exam",
          candidateId: "W250334",
          candidateName: "Student One",
          candidateEmail: "student@example.com",
          phase: "exam",
          currentModule: "reading",
          currentQuestionId: null,
          answers: {},
          writingAnswers: {},
          flags: {},
          violations: [],
          integrity: {
            preCheck: null,
            deviceFingerprintHash: null,
            clientSessionId: null,
            lastDisconnectAt: null,
            lastReconnectAt: null,
            lastHeartbeatAt: null,
            lastHeartbeatStatus: "idle",
          },
          recovery: {
            lastRecoveredAt: null,
            lastLocalMutationAt: null,
            lastPersistedAt: null,
            lastDroppedMutations: null,
            pendingMutationCount: 0,
            serverAcceptedThroughSeq: 0,
            clientSessionId: null,
            syncState: "idle",
          },
          createdAt: "2026-04-24T00:00:00.000Z",
          updatedAt: "2026-04-24T00:00:00.000Z",
        },
      ])
    );

    renderRoute(scheduleId);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`, {
        replace: true,
      });
    });

    expect(studentEntryMock).not.toHaveBeenCalled();
  });

  it("auto-resumes an existing attempt for non-legacy access codes", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440126";
    const accessCode = "guest-alpha_01";
    window.localStorage.setItem(`ielts-student-last-wcode:${scheduleId}`, accessCode);
    window.localStorage.setItem(
      "ielts_student_attempts_v1",
      JSON.stringify([
        {
          id: "attempt-2",
          scheduleId,
          studentKey: `student-${scheduleId}-${accessCode}`,
          examId: "exam-1",
          examTitle: "Mock Exam",
          candidateId: accessCode,
          candidateName: "Student One",
          candidateEmail: "student@example.com",
          phase: "exam",
          currentModule: "reading",
          currentQuestionId: null,
          answers: {},
          writingAnswers: {},
          flags: {},
          violations: [],
          integrity: {
            preCheck: null,
            deviceFingerprintHash: null,
            clientSessionId: null,
            lastDisconnectAt: null,
            lastReconnectAt: null,
            lastHeartbeatAt: null,
            lastHeartbeatStatus: "idle",
          },
          recovery: {
            lastRecoveredAt: null,
            lastLocalMutationAt: null,
            lastPersistedAt: null,
            lastDroppedMutations: null,
            pendingMutationCount: 0,
            serverAcceptedThroughSeq: 0,
            clientSessionId: null,
            syncState: "idle",
          },
          createdAt: "2026-04-24T00:00:00.000Z",
          updatedAt: "2026-04-24T00:00:00.000Z",
        },
      ])
    );

    renderRoute(scheduleId);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/${accessCode}`, {
        replace: true,
      });
    });

    expect(studentEntryMock).not.toHaveBeenCalled();
  });

  it("rejects emails that pass simple regex patterns but fail shared schema validation", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440099";
    renderRoute(scheduleId);

    fireEvent.change(screen.getByLabelText(/access code|wcode/i), {
      target: { value: "W250334" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "student@example..com" },
    });
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Student One" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(studentEntryMock).not.toHaveBeenCalled();
    });
  });

  it("shows queue position and keeps polling until admission is granted", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440123";
    studentEntryMock
      .mockResolvedValueOnce({
        state: "queued",
        ticketId: "ticket-1",
        scheduleId,
        wcode: "W250334",
        position: 3,
        pollAfterMs: 10,
        queuedAt: "2026-05-08T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        user: {
          id: "student-1",
          email: "student@example.com",
          displayName: "Student One",
          role: "student",
          state: "active",
        },
        csrfToken: "csrf-1",
        expiresAt: "2026-01-01T12:00:00.000Z",
      });

    renderRoute(scheduleId);
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/you are in queue/i)).toBeInTheDocument();
      expect(screen.getByText(/position: 3/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledTimes(2);
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    });
  });

  it("recovers from a failed admission poll with working Retry and Leave-queue actions", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440130";
    studentEntryMock
      .mockResolvedValueOnce({
        state: "queued",
        ticketId: "ticket-retry-1",
        scheduleId,
        wcode: "W250334",
        position: 2,
        pollAfterMs: 500,
        queuedAt: "2026-05-08T00:00:00.000Z",
      })
      .mockRejectedValueOnce(new Error("poll boom"))
      .mockResolvedValue({
        user: {
          id: "student-1",
          email: "student@example.com",
          displayName: "Student One",
          role: "student",
          state: "active",
        },
        csrfToken: "csrf-1",
        expiresAt: "2026-01-01T12:00:00.000Z",
      });

    renderRoute(scheduleId);
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/ticket ref: ticket-retry-1/i)).toBeInTheDocument();
    });

    const retryButton = await screen.findByRole("button", { name: /^retry$/i }, { timeout: 3000 });
    expect(screen.getByText(/queue check failed after 1 attempt/i)).toBeInTheDocument();
    expect(screen.getByText(/position at failure: 2/i)).toBeInTheDocument();
    // S3-C2: a failed poll must not dead-lock the form behind queue state.
    expect(screen.getByLabelText(/email/i)).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();

    fireEvent.click(retryButton);

    await waitFor(
      () => {
        expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
      },
      { timeout: 3000 }
    );
    expect(window.sessionStorage.getItem(`ielts-student-queue-ticket:${scheduleId}`)).toBeNull();
  });

  it("leaves the queue after a failed poll and clears the persisted ticket", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440131";
    studentEntryMock
      .mockResolvedValueOnce({
        state: "queued",
        ticketId: "ticket-leave-1",
        scheduleId,
        wcode: "W250334",
        position: 4,
        pollAfterMs: 500,
        queuedAt: "2026-05-08T00:00:00.000Z",
      })
      .mockRejectedValueOnce(new Error("poll boom"));

    renderRoute(scheduleId);
    submitForm();

    await screen.findByRole("button", { name: /^retry$/i }, { timeout: 3000 });
    expect(
      window.sessionStorage.getItem(`ielts-student-queue-ticket:${scheduleId}`)
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /leave queue/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^retry$/i })).not.toBeInTheDocument();
    });
    expect(window.sessionStorage.getItem(`ielts-student-queue-ticket:${scheduleId}`)).toBeNull();
    expect(screen.getByLabelText(/email/i)).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();
  });

  it("persists the queue ticket so a reload resumes polling from the stored position", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440132";
    studentEntryMock
      .mockResolvedValueOnce({
        state: "queued",
        ticketId: "ticket-reload-1",
        scheduleId,
        wcode: "W250334",
        position: 5,
        pollAfterMs: 10_000,
        queuedAt: "2026-05-08T00:00:00.000Z",
      })
      .mockResolvedValue({
        user: {
          id: "student-1",
          email: "student@example.com",
          displayName: "Student One",
          role: "student",
          state: "active",
        },
        csrfToken: "csrf-1",
        expiresAt: "2026-01-01T12:00:00.000Z",
      });

    const first = render(
      <MemoryRouter initialEntries={[`/student/${scheduleId}`]}>
        <Routes>
          <Route path="/student/:scheduleId" element={<StudentEntryRoute />} />
        </Routes>
      </MemoryRouter>
    );
    submitForm();

    // S3-C3: the ticket must reach sessionStorage before any reload.
    await waitFor(() => {
      expect(
        window.sessionStorage.getItem(`ielts-student-queue-ticket:${scheduleId}`)
      ).not.toBeNull();
    });
    const stored = window.sessionStorage.getItem(`ielts-student-queue-ticket:${scheduleId}`);
    expect(JSON.parse(stored ?? "")).toMatchObject({
      ticket: { ticketId: "ticket-reload-1", position: 5 },
    });
    expect(studentEntryMock).toHaveBeenCalledTimes(1);

    // Simulate a reload: unmount, shorten the persisted poll delay so the
    // resumed poll fires inside the test timeout, then mount fresh.
    first.unmount();
    const persistedRaw = window.sessionStorage.getItem(`ielts-student-queue-ticket:${scheduleId}`);
    const persisted = JSON.parse(persistedRaw ?? "{}");
    window.sessionStorage.setItem(
      `ielts-student-queue-ticket:${scheduleId}`,
      JSON.stringify({ ...persisted, ticket: { ...persisted.ticket, pollAfterMs: 500 } })
    );
    render(
      <MemoryRouter initialEntries={[`/student/${scheduleId}`]}>
        <Routes>
          <Route path="/student/:scheduleId" element={<StudentEntryRoute />} />
        </Routes>
      </MemoryRouter>
    );

    // The recovered banner shows the persisted position without a new submit.
    await waitFor(() => {
      expect(screen.getByText(/ticket ref: ticket-reload-1/i)).toBeInTheDocument();
      expect(screen.getByText(/position: 5/i)).toBeInTheDocument();
    });
    expect(studentEntryMock).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    });
  });

  it("accepts non-Wcode formatted access codes", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440124";
    studentEntryMock.mockResolvedValue({
      user: {
        id: "student-2",
        email: "student@example.com",
        displayName: "Student Two",
        role: "student",
        state: "active",
      },
      csrfToken: "csrf-2",
      expiresAt: "2026-01-01T12:00:00.000Z",
    });

    renderRoute(scheduleId);
    submitForm("guest-alpha_01");

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: "guest-alpha_01",
        email: "student@example.com",
        studentName: "Student One",
        nickname: "student-one",
        ieltsCourse: "IELTS Academic",
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/guest-alpha_01`);
    });
  });

  it("canonicalizes legacy W-codes to uppercase without blocking input", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440127";
    studentEntryMock.mockResolvedValue({
      user: {
        id: "student-4",
        email: "student@example.com",
        displayName: "Student Four",
        role: "student",
        state: "active",
      },
      csrfToken: "csrf-4",
      expiresAt: "2026-01-01T12:00:00.000Z",
    });

    renderRoute(scheduleId);
    submitForm("w250334");

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: "W250334",
        email: "student@example.com",
        studentName: "Student One",
        nickname: "student-one",
        ieltsCourse: "IELTS Academic",
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    });
  });

  it("encodes access code when navigating to student route", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440125";
    const rawAccessCode = "guest/a?x#y";
    studentEntryMock.mockResolvedValue({
      user: {
        id: "student-3",
        email: "student@example.com",
        displayName: "Student Three",
        role: "student",
        state: "active",
      },
      csrfToken: "csrf-3",
      expiresAt: "2026-01-01T12:00:00.000Z",
    });

    renderRoute(scheduleId);
    submitForm(rawAccessCode);

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: rawAccessCode,
        email: "student@example.com",
        studentName: "Student One",
        nickname: "student-one",
        ieltsCourse: "IELTS Academic",
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        `/student/${scheduleId}/${encodeURIComponent(rawAccessCode)}`
      );
    });
  });

  it("requires only code, name, and email for SAT schedules via ?provider=sat", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440140";
    studentEntryMock.mockResolvedValue({
      user: {
        id: "student-sat-1",
        email: "sat@example.com",
        displayName: "SAT Student",
        role: "student",
        state: "active",
      },
      csrfToken: "csrf-sat-1",
      expiresAt: "2026-01-01T12:00:00.000Z",
    });

    render(
      <MemoryRouter initialEntries={[`/student/${scheduleId}?provider=sat`]}>
        <Routes>
          <Route path="/student/:scheduleId" element={<StudentEntryRoute />} />
        </Routes>
      </MemoryRouter>
    );

    // S3-C8/M1: nickname + IELTS course are hidden for SAT direct entry.
    expect(screen.queryByLabelText(/nickname/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ielts course/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/access code|wcode/i), {
      target: { value: "W250334" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "sat@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "SAT Student" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: "W250334",
        email: "sat@example.com",
        studentName: "SAT Student",
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    });
  });

  it("resets form state when the schedule or query access code changes in place", async () => {
    const firstScheduleId = "550e8400-e29b-41d4-a716-446655440128";
    const secondScheduleId = "550e8400-e29b-41d4-a716-446655440129";
    window.localStorage.setItem(
      `ielts-student-profile:${firstScheduleId}:W111111`,
      JSON.stringify({
        studentName: "First Student",
        email: "first@example.com",
        nickname: "first",
        ieltsCourse: "IELTS Academic",
      })
    );

    let pushRoute: ((to: string) => void) | null = null;
    const setPushRoute = (push: (to: string) => void) => {
      pushRoute = push;
    };

    render(
      <MemoryRouter initialEntries={[`/student/${firstScheduleId}?wcode=W111111`]}>
        <Routes>
          <Route
            path="/student/:scheduleId"
            element={
              <>
                <StudentEntryRoute />
                <RouteProbe onReady={setPushRoute} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toHaveValue("first@example.com");
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "edited@example.com" },
    });

    await act(async () => {
      pushRoute?.(`/student/${secondScheduleId}?wcode=W222222`);
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/access code|wcode/i)).toHaveValue("W222222");
      expect(screen.getByLabelText(/email/i)).toHaveValue("");
      expect(screen.getByLabelText(/full name/i)).toHaveValue("");
    });
  });
});
