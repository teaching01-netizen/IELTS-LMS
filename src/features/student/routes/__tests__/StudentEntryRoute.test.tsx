import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, UNSAFE_NavigationContext } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudentEntryRoute } from "../StudentEntryRoute";

const navigateMock = vi.fn();
const studentEntryMock = vi.fn();
const getStudentEntryScheduleMock = vi.hoisted(() => vi.fn());

vi.mock("../../infrastructure/studentEntryGateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infrastructure/studentEntryGateway")>();
  return {
    ...actual,
    getStudentEntrySchedule: getStudentEntryScheduleMock,
    isStudentEntryScheduleBlockedError: () => false,
  };
});

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
  fireEvent.change(screen.getByLabelText(/code|wcode/i), {
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

    fireEvent.change(screen.getByLabelText(/code|wcode/i), {
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

  it("shows bounded retry state and keeps polling until admission is granted", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440123";
    studentEntryMock
      .mockRejectedValueOnce({
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        details: { tier: "student-entry", retryAfterSeconds: 1 },
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
      expect(screen.getByText(/high traffic/i)).toBeInTheDocument();
      expect(screen.queryByText(/position:/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/keep your place/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/ticket/i)).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledTimes(2);
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    }, { timeout: 4000 });
  });

  it("recovers from a failed admission poll with working Retry and Leave-queue actions", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440130";
    studentEntryMock
      .mockRejectedValueOnce({
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        details: { tier: "student-entry", retryAfterSeconds: 1 },
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
      expect(screen.getByText(/high traffic/i)).toBeInTheDocument();
    }, { timeout: 2000 });

    const retryButton = await screen.findByRole("button", { name: /^retry$/i }, { timeout: 3000 });
    expect(screen.getByText(/retry failed after 1 attempt/i)).toBeInTheDocument();
    expect(screen.getAllByText(/poll boom/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/position:|ticket|keep your place/i)).not.toBeInTheDocument();
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
    expect(window.sessionStorage.length).toBe(0);
  });

  it("leaves bounded retry state after a failed poll and clears the payload", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440131";
    studentEntryMock
      .mockRejectedValueOnce({
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        details: { tier: "student-entry", retryAfterSeconds: 1 },
      })
      .mockRejectedValueOnce(new Error("poll boom"));

    renderRoute(scheduleId);
    submitForm();

    await screen.findByRole("button", { name: /^retry$/i }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: /leave and edit/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^retry$/i })).not.toBeInTheDocument();
    });
    expect(window.sessionStorage.length).toBe(0);
    expect(screen.getByLabelText(/email/i)).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();
  });

  it("does not persist a server-owned queue position or ticket", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440132";
    studentEntryMock
      .mockRejectedValueOnce({
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        details: { tier: "student-entry", retryAfterSeconds: 30 },
      });

    renderRoute(scheduleId);
    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/high traffic/i)).toBeInTheDocument();
    });
    expect(window.sessionStorage.length).toBe(0);
    expect(screen.queryByText(/position:|ticket|keep your place/i)).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText(/code|wcode/i), {
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

  it("uses the neutral Course label for ACT schedules", async () => {
    const scheduleId = "550e8400-e29b-41d4-a716-446655440141";
    getStudentEntryScheduleMock.mockResolvedValue({ status: "live", providerKey: "act" });
    studentEntryMock.mockResolvedValue({
      user: {
        id: "student-act-1",
        email: "act@example.com",
        displayName: "ACT Student",
        role: "student",
        state: "active",
      },
      csrfToken: "csrf-act-1",
      expiresAt: "2026-01-01T12:00:00.000Z",
    });

    renderRoute(scheduleId);

    await waitFor(() => {
      expect(screen.getByLabelText("Course")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("IELTS Course")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/code|wcode/i), {
      target: { value: "anything-at-all" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "act@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "ACT Student" },
    });
    fireEvent.change(screen.getByLabelText(/nickname/i), {
      target: { value: "act-student" },
    });
    fireEvent.change(screen.getByLabelText("Course"), {
      target: { value: "ACT" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: "anything-at-all",
        email: "act@example.com",
        studentName: "ACT Student",
        nickname: "act-student",
        ieltsCourse: "ACT",
      });
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
      expect(screen.getByLabelText(/code|wcode/i)).toHaveValue("W222222");
      expect(screen.getByLabelText(/email/i)).toHaveValue("");
      expect(screen.getByLabelText(/full name/i)).toHaveValue("");
    });
  });
});
