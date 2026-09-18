import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "../../../auth/authSession";
import { studentSessionFacade } from "@student/application/studentSessionFacade";
import { authService, type AuthSession } from "../../../../services/authService";
import {
  mapBackendStudentAttempt,
  studentAttemptRepository,
} from "../../../../services/studentAttemptRepository";
import { useStudentSessionRouteData } from "../useStudentSessionRouteData";

const originalFetch = global.fetch;

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthSessionProvider>{children}</AuthSessionProvider>;
  };
}

function buildAuthSession(): AuthSession {
  return {
    user: {
      id: "student-user-1",
      email: "alice@example.com",
      displayName: "Alice Roe",
      role: "student",
      state: "active",
    },
    csrfToken: "csrf-1",
    expiresAt: "2026-01-01T12:00:00.000Z",
  };
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonErrorResponse(message: string, status = 400) {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
      },
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );
}

function createDeferredResponse() {
  let resolve: ((response: Response) => void) | null = null;
  const promise = new Promise<Response>((resolver) => {
    resolve = resolver;
  });

  return {
    promise,
    resolve(response: Response) {
      resolve?.(response);
    },
  };
}

function buildStaticSessionContext(versionId = "ver-1") {
  return {
    schedule: {
      id: "sched-1",
      examId: "exam-1",
      examTitle: "Mock Exam",
      publishedVersionId: versionId,
      cohortName: "Cohort A",
      institution: "Center",
      startTime: "2026-01-01T09:00:00.000Z",
      endTime: "2026-01-01T12:00:00.000Z",
      plannedDurationMinutes: 180,
      deliveryMode: "proctor_start",
      recurrenceType: "none",
      recurrenceInterval: 1,
      autoStart: false,
      autoStop: false,
      status: "live",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "admin-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      revision: 1,
    },
    version: {
      id: versionId,
      examId: "exam-1",
      versionNumber: 1,
      parentVersionId: null,
      contentSnapshot: {
        title: "Mock Exam",
        type: "Academic",
        activeModule: "reading",
        activePassageId: "p1",
        activeListeningPartId: "l1",
        config: {
          general: { preset: "Academic" },
          sections: {
            listening: {
              enabled: true,
              order: 1,
              duration: 30,
              label: "Listening",
              gapAfterMinutes: 0,
            },
            reading: {
              enabled: true,
              order: 2,
              duration: 60,
              label: "Reading",
              gapAfterMinutes: 0,
            },
            writing: {
              enabled: true,
              order: 3,
              duration: 60,
              label: "Writing",
              gapAfterMinutes: 0,
            },
            speaking: {
              enabled: true,
              order: 4,
              duration: 30,
              label: "Speaking",
              gapAfterMinutes: 0,
            },
          },
          delivery: { allowedExtensionMinutes: [] },
        },
        reading: { passages: [] },
        listening: { parts: [] },
        writing: { task1Prompt: "Task 1", task2Prompt: "Task 2" },
        speaking: { part1Topics: [], cueCard: "", part3Discussion: [] },
      },
      configSnapshot: {
        general: { preset: "Academic" },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            label: "Listening",
            gapAfterMinutes: 0,
          },
          reading: { enabled: true, order: 2, duration: 60, label: "Reading", gapAfterMinutes: 0 },
          writing: { enabled: true, order: 3, duration: 60, label: "Writing", gapAfterMinutes: 0 },
          speaking: {
            enabled: true,
            order: 4,
            duration: 30,
            label: "Speaking",
            gapAfterMinutes: 0,
          },
        },
        delivery: { allowedExtensionMinutes: [] },
      },
      createdBy: "owner-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      isDraft: false,
      isPublished: true,
      revision: 1,
    },
    degradedLiveMode: false,
  };
}

function buildRuntime() {
  return {
    id: "runtime-1",
    scheduleId: "sched-1",
    examId: "exam-1",
    status: "live",
    planSnapshot: [],
    actualStartAt: "2026-01-01T09:00:00.000Z",
    actualEndAt: null,
    activeSectionKey: "reading",
    currentSectionKey: "reading",
    currentSectionRemainingSeconds: 1200,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    revision: 1,
    sections: [
      {
        id: "section-1",
        runtimeId: "runtime-1",
        sectionKey: "reading",
        label: "Reading",
        sectionOrder: 2,
        plannedDurationMinutes: 60,
        gapAfterMinutes: 0,
        status: "live",
        availableAt: "2026-01-01T09:00:00.000Z",
        actualStartAt: "2026-01-01T09:00:00.000Z",
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
        completionReason: null,
        projectedStartAt: "2026-01-01T09:00:00.000Z",
        projectedEndAt: "2026-01-01T10:00:00.000Z",
      },
    ],
  };
}

function buildAttempt(
  publishedVersionId = "ver-1"
): Parameters<typeof mapBackendStudentAttempt>[0] {
  return {
    id: "attempt-1",
    scheduleId: "sched-1",
    registrationId: null,
    studentKey: "student-sched-1-W250334",
    organizationId: null,
    examId: "exam-1",
    publishedVersionId,
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
    violationsSnapshot: [],
    integrity: {
      preCheck: null,
      deviceFingerprintHash: null,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      lastHeartbeatAt: null,
      lastHeartbeatStatus: "idle",
    },
    recovery: {
      lastRecoveredAt: null,
      lastLocalMutationAt: null,
      lastPersistedAt: null,
      pendingMutationCount: 0,
      syncState: "idle",
    },
    finalSubmission: null,
    submittedAt: null,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    revision: 1,
  } as Parameters<typeof mapBackendStudentAttempt>[0];
}

function buildLiveSessionContext(
  attempt: any,
  publishedVersionId = "ver-1",
  runtimeOverrides?: any
): any {
  return {
    runtime: {
      ...buildRuntime(),
      ...(runtimeOverrides ?? {}),
    },
    attempt,
    publishedVersionId,
    degradedLiveMode: false,
  };
}

function buildBootstrapContext(attempt: any): any {
  return {
    attempt,
    attemptCredential: {
      attemptToken: "attempt-token-1",
      expiresAt: "2026-01-01T12:00:00.000Z",
    },
  };
}

function buildSessionContext(
  attempt: any,
  publishedVersionId = "ver-1",
  runtimeOverrides?: any
): any {
  return {
    ...buildStaticSessionContext(publishedVersionId),
    ...buildLiveSessionContext(attempt, publishedVersionId, runtimeOverrides),
    attemptCredential: {
      attemptToken: "attempt-token-1",
      expiresAt: "2026-01-01T12:00:00.000Z",
    },
  };
}

function buildSessionContextWithMissingDiagramImage() {
  const context = buildSessionContext(buildAttempt());
  const contentSnapshot = context.version.contentSnapshot as {
    listening: {
      parts: Array<{
        id: string;
        title: string;
        pins: unknown[];
        blocks: unknown[];
      }>;
    };
  };

  contentSnapshot.listening.parts = [
    {
      id: "l1",
      title: "Part 1",
      pins: [],
      blocks: [
        {
          id: "diagram-1",
          type: "DIAGRAM_LABELING",
          title: "Diagram",
          instructions: "",
          imageUrl: "  ",
          labels: [{ id: "label-1", x: 12, y: 24, correctAnswer: "A" }],
        },
      ],
    },
  ];

  return context;
}

describe("useStudentSessionRouteData backend mode", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("hydrates static exam payload once, then uses live session payload for runtime and attempt", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext()))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(null)))
      .mockResolvedValueOnce(jsonResponse(buildBootstrapContext(buildAttempt())))
      .mockResolvedValue(jsonResponse(buildLiveSessionContext(buildAttempt())));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot).not.toBeNull();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.schedule).toMatchObject({
      id: "sched-1",
      examTitle: "Mock Exam",
      cohortName: "Cohort A",
    });
    expect(result.current.state?.title).toBe("Mock Exam");
    expect(result.current.runtimeSnapshot).toMatchObject({
      scheduleId: "sched-1",
      status: "live",
      currentSectionKey: "reading",
    });
    expect(result.current.attemptSnapshot).toMatchObject({
      id: "attempt-1",
      candidateId: "W250334",
      scheduleId: "sched-1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/student/sessions/sched-1/static?candidateId=W250334",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/student/sessions/sched-1/live?candidateId=W250334",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/student/sessions/sched-1/bootstrap",
      expect.objectContaining({ method: "POST" })
    );
    const bootstrapRequest = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    const bootstrapBody = JSON.parse(String(bootstrapRequest?.body ?? "{}")) as {
      candidateName?: string;
      candidateEmail?: string;
    };
    expect(bootstrapBody.candidateName).toBe("Unknown Candidate");
    expect(bootstrapBody.candidateEmail).toBe("");
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === "/api/v1/student/sessions/sched-1?candidateId=W250334"
      )
    ).toBe(false);
  });

  it("loads student session data through facade and preserves existing route-hook behavior", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
    const loadStaticSessionSpy = vi.spyOn(studentSessionFacade, "loadStaticSession");
    const loadLiveSessionSpy = vi.spyOn(studentSessionFacade, "loadLiveSession");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext()))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(null)))
      .mockResolvedValueOnce(jsonResponse(buildBootstrapContext(buildAttempt())))
      .mockResolvedValue(jsonResponse(buildLiveSessionContext(buildAttempt())));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot).not.toBeNull();
    });

    expect(loadStaticSessionSpy).toHaveBeenCalledWith("sched-1", "W250334");
    expect(loadLiveSessionSpy).toHaveBeenCalledWith("sched-1", "W250334");
    expect(result.current.schedule).toMatchObject({
      id: "sched-1",
      examTitle: "Mock Exam",
    });
    expect(result.current.runtimeSnapshot).toMatchObject({
      scheduleId: "sched-1",
      status: "live",
    });
    expect(result.current.attemptSnapshot).toMatchObject({
      id: "attempt-1",
      candidateId: "W250334",
      scheduleId: "sched-1",
    });
  });

  it("uses the reconciled cached attempt snapshot after saving a live backend attempt", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    const backendAttempt = buildAttempt("ver-1");
    backendAttempt.revision = 9;
    backendAttempt.answers = { q1: "SERVER_RAW" };
    backendAttempt.updatedAt = "2026-01-01T09:10:00.000Z";
    const mappedAttempt = mapBackendStudentAttempt(backendAttempt);
    const reconciledAttempt = {
      ...mappedAttempt,
      answers: { q1: "RECONCILED_LOCAL" },
      updatedAt: "2026-01-01T09:10:01.000Z",
    };

    vi.spyOn(studentAttemptRepository as any, "saveAttempt").mockResolvedValue(undefined);
    vi.spyOn(studentAttemptRepository as any, "getAttemptsByScheduleId").mockResolvedValue([
      reconciledAttempt,
    ]);

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(backendAttempt)));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.attemptSnapshot?.answers.q1).toBe("RECONCILED_LOCAL");
      expect(result.current.attemptSnapshot?.revision).toBe(9);
    });
  });

  it("waits for auth session hydration before bootstrapping the backend student attempt", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");

    let resolveSession: ((session: AuthSession | null) => void) | null = null;
    vi.spyOn(authService, "getSession").mockImplementation(
      () =>
        new Promise<AuthSession | null>((resolve) => {
          resolveSession = resolve;
        })
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext()))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(null)))
      .mockResolvedValueOnce(jsonResponse(buildBootstrapContext(buildAttempt())))
      .mockResolvedValue(jsonResponse(buildLiveSessionContext(buildAttempt())));
    global.fetch = fetchMock as typeof fetch;

    renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    expect(fetchMock).not.toHaveBeenCalled();

    (resolveSession as ((session: AuthSession | null) => void) | null)?.(buildAuthSession());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/v1/student/sessions/sched-1/static?candidateId=W250334",
        expect.objectContaining({ method: "GET" })
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/v1/student/sessions/sched-1/live?candidateId=W250334",
        expect.objectContaining({ method: "GET" })
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/v1/student/sessions/sched-1/bootstrap",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("keeps initial backend load parity for schedule, state, runtime, and attempt snapshots", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildSessionContext(buildAttempt())));
      }
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(buildAttempt())));
      }
      if (url === "/api/v1/student/sessions/sched-1/bootstrap") {
        return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
      }
      return Promise.resolve(jsonResponse(buildSessionContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    expect(result.current.schedule).toMatchObject({
      id: "sched-1",
      examTitle: "Mock Exam",
    });
    expect(result.current.state?.title).toBe("Mock Exam");
    expect(result.current.runtimeSnapshot).toMatchObject({
      scheduleId: "sched-1",
      status: "live",
      currentSectionKey: "reading",
    });
    expect(result.current.attemptSnapshot).toMatchObject({
      id: "attempt-1",
      candidateId: "W250334",
      scheduleId: "sched-1",
    });
  });

  it("recovers from transient backend load failure when retry is invoked", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    let failMode = true;
    const fetchMock = vi.fn((url: string) => {
      if (failMode) {
        return Promise.resolve(jsonErrorResponse("Transient backend outage"));
      }
      if (url === "/api/v1/student/sessions/sched-1?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildSessionContext(buildAttempt())));
      }
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(buildAttempt())));
      }
      if (url === "/api/v1/student/sessions/sched-1/bootstrap") {
        return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
      }
      return Promise.resolve(jsonResponse(buildSessionContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).not.toBeNull();
      },
      { timeout: 5_000 }
    );

    failMode = false;

    await act(async () => {
      await result.current.retry();
    });

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.runtimeSnapshot?.currentSectionKey).toBe("reading");
        expect(result.current.attemptSnapshot?.id).toBe("attempt-1");
      },
      { timeout: 5_000 }
    );
  });

  it("discards stale out-of-order refresh responses and keeps the newest snapshot", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
    const metricEvents: Record<string, unknown>[] = [];
    const metricListener = (event: Event) => {
      const customEvent = event as CustomEvent<Record<string, unknown>>;
      metricEvents.push(customEvent.detail);
    };
    let cachedAttempt: Record<string, unknown> | null = null;
    vi.spyOn(studentAttemptRepository as any, "saveAttempt").mockImplementation(async (attempt) => {
      cachedAttempt = attempt as Record<string, unknown>;
    });
    vi.spyOn(studentAttemptRepository as any, "getAttemptsByScheduleId").mockImplementation(
      async () => {
        return cachedAttempt ? [cachedAttempt] : [];
      }
    );

    const buildAttemptRevision = (revision: number, answer: string, updatedAt: string) => ({
      ...buildAttempt("ver-1"),
      revision,
      answers: { q1: answer },
      updatedAt,
    });

    const olderRefresh = createDeferredResponse();
    const newerRefresh = createDeferredResponse();
    let liveCallCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        liveCallCount += 1;
        if (liveCallCount === 1) {
          return Promise.resolve(
            jsonResponse(
              buildLiveSessionContext(
                buildAttemptRevision(1, "INITIAL", "2026-01-01T09:00:00.000Z")
              )
            )
          );
        }
        if (liveCallCount === 2) {
          return olderRefresh.promise;
        }
        if (liveCallCount === 3) {
          return newerRefresh.promise;
        }
        return Promise.resolve(
          jsonResponse(
            buildLiveSessionContext(buildAttemptRevision(3, "LATEST", "2026-01-01T09:00:03.000Z"))
          )
        );
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    window.addEventListener("student-observability-metric", metricListener as EventListener);
    try {
      const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.attemptSnapshot?.revision).toBe(1);
      });

      const firstRefresh = result.current.refreshRuntime();
      const secondRefresh = result.current.refreshRuntime();

      newerRefresh.resolve(
        jsonResponse(
          buildLiveSessionContext(buildAttemptRevision(3, "LATEST", "2026-01-01T09:00:03.000Z"))
        )
      );
      await act(async () => {
        await secondRefresh;
      });

      olderRefresh.resolve(
        jsonResponse(
          buildLiveSessionContext(buildAttemptRevision(2, "STALE", "2026-01-01T09:00:02.000Z"))
        )
      );
      await act(async () => {
        await firstRefresh;
      });

      await waitFor(() => {
        expect(result.current.attemptSnapshot?.revision).toBe(3);
        expect(result.current.attemptSnapshot?.answers.q1).toBe("LATEST");
      });

      const staleDiscardMetric = metricEvents.find(
        (metric) =>
          metric.name === "student_refresh_stale_discard_total" &&
          metric.reason === "epoch_superseded"
      );
      expect(staleDiscardMetric).toMatchObject({
        scheduleId: "sched-1",
        attemptId: "attempt-1",
        endpoint: "/v1/student/sessions/sched-1/live",
        statusCode: 200,
        reason: "epoch_superseded",
        syncState: "idle",
      });
      expect(staleDiscardMetric?.version).toEqual(expect.any(String));
    } finally {
      window.removeEventListener("student-observability-metric", metricListener as EventListener);
    }
  });

  it("applies fresher attempt snapshots even when runtime freshness regresses", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    const initialAttempt = {
      ...buildAttempt("ver-1"),
      revision: 1,
      answers: { q1: "INITIAL" },
      updatedAt: "2026-01-01T09:00:01.000Z",
    };
    const initialLive = buildLiveSessionContext(initialAttempt);
    initialLive.runtime = {
      ...buildRuntime(),
      revision: 10,
      updatedAt: "2026-01-01T09:00:10.000Z",
      currentSectionKey: "reading",
      activeSectionKey: "reading",
    };

    const fresherAttemptWithOlderRuntime = {
      ...buildAttempt("ver-1"),
      revision: 2,
      answers: { q1: "SERVER_FRESH_ATTEMPT" },
      updatedAt: "2026-01-01T09:00:02.000Z",
    };
    const regressedRuntimeLive = buildLiveSessionContext(fresherAttemptWithOlderRuntime);
    regressedRuntimeLive.runtime = {
      ...buildRuntime(),
      revision: 9,
      updatedAt: "2026-01-01T09:00:09.000Z",
      currentSectionKey: "writing",
      activeSectionKey: "writing",
    };

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        if (fetchMock.mock.calls.filter(([calledUrl]) => calledUrl === url).length <= 1) {
          return Promise.resolve(jsonResponse(initialLive));
        }
        return Promise.resolve(jsonResponse(regressedRuntimeLive));
      }
      // The second refresh has to come from the versioned runtime poll now that
      // the loop actually ticks (it used to refresh the snapshot on every tick
      // because the tick branch was unreachable). A revision the client has
      // not seen is exactly what makes the poll pull the live session.
      //
      // This route is the one student surface that is NOT enveloped: the delta
      // is the whole body ({revision,status,activeSection,pollAfterSecs}, see
      // cmd/api/runtime_poll_test.go). Wrapping it in {success,data} makes the
      // client parse an empty record, read notModified forever, and never
      // refresh — a fixture that silently asserts nothing.
      if (String(url).includes("/runtime?sinceRevision=")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              revision: 11,
              status: "live",
              activeSection: "reading",
              pollAfterSecs: 2,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(
      () => {
        const liveCalls = fetchMock.mock.calls.filter(([calledUrl]) =>
          String(calledUrl).includes("/live?candidateId="),
        );
        expect(liveCalls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 3_000 },
    );
    await waitFor(() => {
      expect(result.current.attemptSnapshot?.revision).toBe(2);
      expect(result.current.attemptSnapshot?.answers.q1).toBe("SERVER_FRESH_ATTEMPT");
    });
    expect(result.current.runtimeSnapshot?.currentSectionKey).toBe("reading");
  });

  it("does not apply a revisionless attempt snapshot over an already-applied revisioned snapshot", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    const initialAttempt = {
      ...buildAttempt("ver-1"),
      revision: 10,
      answers: { q1: "REVISION_10" },
      updatedAt: "2026-01-01T09:00:10.000Z",
    };

    const revisionlessAttempt = {
      ...buildAttempt("ver-1"),
      answers: { q1: "REVISIONLESS_STALE" },
      updatedAt: "2026-01-01T09:00:20.000Z",
    };
    delete (revisionlessAttempt as { revision?: unknown }).revision;

    let liveCallCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        liveCallCount += 1;
        if (liveCallCount <= 2) {
          return Promise.resolve(jsonResponse(buildLiveSessionContext(initialAttempt)));
        }
        return Promise.resolve(jsonResponse(buildLiveSessionContext(revisionlessAttempt)));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot?.answers.q1).toBe("REVISION_10");
      expect(result.current.attemptSnapshot?.revision).toBe(10);
    });

    await act(async () => {
      await result.current.refreshRuntime();
    });

    await waitFor(() => {
      expect(result.current.attemptSnapshot?.answers.q1).toBe("REVISION_10");
      expect(result.current.attemptSnapshot?.revision).toBe(10);
    });
  });

  it("uses cached local attempt when live payload temporarily omits attempt instead of immediately bootstrapping", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    const cachedAttempt = mapBackendStudentAttempt({
      ...buildAttempt("ver-1"),
      revision: 7,
      answers: { q1: "CACHED_LOCAL" },
      updatedAt: "2026-01-01T09:07:00.000Z",
    });
    vi.spyOn(studentAttemptRepository as any, "getAttemptsByScheduleId").mockResolvedValue([
      cachedAttempt,
    ]);

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(null)));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot?.answers.q1).toBe("CACHED_LOCAL");
      expect(result.current.attemptSnapshot?.revision).toBe(7);
    });

    expect(
      fetchMock.mock.calls.some((call) => {
        const url = String(call[0]);
        const init = (call as unknown[])[1] as { method?: string } | undefined;
        return url === "/api/v1/student/sessions/sched-1/bootstrap" && init?.method === "POST";
      })
    ).toBe(false);
  });

  it("ignores malformed cached attempts with null candidateId when live payload omits attempt", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    const cachedAttempt = mapBackendStudentAttempt({
      ...buildAttempt("ver-1"),
      revision: 8,
      answers: { q1: "VALID_CACHED" },
      updatedAt: "2026-01-01T09:08:00.000Z",
    });
    const malformedAttempt = {
      ...cachedAttempt,
      id: "attempt-malformed",
      candidateId: null,
      updatedAt: "2026-01-01T09:09:00.000Z",
    } as unknown as typeof cachedAttempt;
    vi.spyOn(studentAttemptRepository as any, "getAttemptsByScheduleId").mockResolvedValue([
      malformedAttempt,
      cachedAttempt,
    ]);

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(null)));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.attemptSnapshot?.id).toBe(cachedAttempt.id);
      expect(result.current.attemptSnapshot?.answers.q1).toBe("VALID_CACHED");
    });
  });

  it("preserves last-known runtime snapshot when a refresh payload temporarily omits runtime", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    const initialAttempt = {
      ...buildAttempt("ver-1"),
      revision: 1,
      answers: { q1: "INITIAL" },
      updatedAt: "2026-01-01T09:00:01.000Z",
    };
    const fresherAttemptWithoutRuntime = {
      ...buildAttempt("ver-1"),
      revision: 2,
      answers: { q1: "FRESH_ATTEMPT" },
      updatedAt: "2026-01-01T09:00:02.000Z",
    };

    let liveCallCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        liveCallCount += 1;
        if (liveCallCount === 1) {
          return Promise.resolve(jsonResponse(buildLiveSessionContext(initialAttempt)));
        }
        const refreshPayload = buildLiveSessionContext(fresherAttemptWithoutRuntime);
        refreshPayload.runtime = null;
        return Promise.resolve(jsonResponse(refreshPayload));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.runtimeSnapshot?.currentSectionKey).toBe("reading");
    });

    await act(async () => {
      await result.current.refreshRuntime();
    });

    await waitFor(() => {
      expect(result.current.attemptSnapshot?.revision).toBe(2);
      expect(result.current.attemptSnapshot?.answers.q1).toBe("FRESH_ATTEMPT");
    });
    expect(result.current.runtimeSnapshot?.currentSectionKey).toBe("reading");
  });

  it("reads runtime-delivered rollout canary and kill-switch flags for answer invariant behavior", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        return Promise.resolve(
          jsonResponse(
            buildLiveSessionContext(buildAttempt("ver-1"), "ver-1", {
              localWriterAnswerInvariantEnabled: false,
              localWriterAnswerInvariantKillSwitch: true,
              localWriterAnswerInvariantCohort: "legacy-control",
              localWriterAnswerInvariantConfigFingerprint: "cfg-legacy-control",
            })
          )
        );
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.answerInvariantRollout).toMatchObject({
      enabled: false,
      killSwitch: true,
      cohort: "legacy-control",
      configFingerprint: "cfg-legacy-control",
      source: "runtime",
    });
  });

  it("re-bootstrap static payload when live publishedVersionId changes", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext("ver-1")))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(buildAttempt("ver-2"), "ver-2")))
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext("ver-2")))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(buildAttempt("ver-2"), "ver-2")))
      .mockResolvedValue(jsonResponse(buildLiveSessionContext(buildAttempt("ver-2"), "ver-2")));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot?.publishedVersionId).toBe("ver-2");
    });

    const staticCalls = fetchMock.mock.calls.filter(
      ([url]) => url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334"
    );
    const liveCalls = fetchMock.mock.calls.filter(
      ([url]) => url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334"
    );

    expect(staticCalls.length).toBeGreaterThanOrEqual(2);
    expect(liveCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts non-wcode student ids and loads backend session API", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/static?candidateId=alice")) {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url.includes("/live?candidateId=alice")) {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(buildAttempt())));
      }
      if (url === "/api/v1/student/sessions/sched-1/bootstrap") {
        return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
      }
      return Promise.resolve(jsonResponse(buildSessionContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "alice"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/sessions/sched-1/static?candidateId=alice",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/student/sessions/sched-1/live?candidateId=alice",
      expect.any(Object)
    );
  });

  it("emits a SAT bootstrap seed with identity + epochs once static+live settle", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
    // Static carries the SAT provider key; live carries the reconciled attempt.
    // NOTE: buildStaticSessionContext defaults to an IELTS-shaped snapshot
    // (no providerKey -> hook default 'ielts'), so this test overrides the
    // contentSnapshot providerKey to 'sat' to reach the SAT seed branch.
    const satStatic = buildStaticSessionContext("ver-9");
    (satStatic.version.contentSnapshot as Record<string, unknown>).providerKey = "sat";
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/student/sessions/sched-1/static?candidateId=W250334") {
        return Promise.resolve(jsonResponse(satStatic));
      }
      if (url === "/api/v1/student/sessions/sched-1/live?candidateId=W250334") {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(buildAttempt("ver-9"), "ver-9")));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt("ver-9"))));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.providerKey).toBe("sat");
    expect(result.current.isSatStaticReady).toBe(true);
    expect(result.current.satBootstrapSeed).toMatchObject({
      scheduleId: "sched-1",
      attemptId: "attempt-1",
      staticVersionId: "ver-9",
      attemptRevision: 1,
      runtimeRevision: 1,
    });
    expect(result.current.satBootstrapSeed?.attemptSnapshot?.id).toBe("attempt-1");
    expect(result.current.satBootstrapSeed?.liveSnapshotReceivedAt).toEqual(expect.any(Number));
  });

  it("keeps the SAT seed null-safe on error with no attempt (no throw)", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonErrorResponse("Transient backend outage")),
    ) as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).not.toBeNull();
    });

    expect(() => result.current.satBootstrapSeed).not.toThrow();
    expect(result.current.satBootstrapSeed).toBeNull();
    expect(result.current.isSatStaticReady).toBe(false);
  });

  it("logs published snapshot diagnostics when diagram blocks are missing imageUrl", async () => {
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
    vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(buildSessionContextWithMissingDiagramImage()))
      );
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[student-session] published version has DIAGRAM_LABELING blocks without imageUrl",
      expect.objectContaining({
        routeScheduleId: "sched-1",
        scheduleId: "sched-1",
        publishedVersionId: "ver-1",
        loadedVersionId: "ver-1",
        missingImageUrlCount: 1,
        missingUsableImageCount: 1,
      })
    );
  });

  /**
   * Phase 3/4: the student socket is a real transport again — behind one
   * switch — and it is only ever a WAKE-UP plus snapshot. Revisions stay
   * monotonic on the client: a frame for a revision already applied cannot
   * start a second refresh, while a newer transition refreshes immediately
   * instead of waiting out the 500ms coalescer meant for answer bursts.
   */
  describe("student realtime transport", () => {
    const originalWebSocket = globalThis.WebSocket;

    class MockSocket {
      static instances: MockSocket[] = [];
      url: string;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        MockSocket.instances.push(this);
      }

      open() {
        this.onopen?.(new Event("open"));
      }

      emit(data: unknown) {
        this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
      }

      close() {
        this.onclose?.(new CloseEvent("close"));
      }

      send() {}
    }

    function installSocket() {
      MockSocket.instances = [];
      // @ts-expect-error test shim: deterministic WebSocket.
      globalThis.WebSocket = MockSocket;
      return MockSocket;
    }

    function liveFetchCount(fetchMock: { mock: { calls: unknown[][] } }) {
      return fetchMock.mock.calls.filter((call) => String(call[0]).includes("/live")).length;
    }

    function stubSessionFetch() {
      vi.stubEnv("VITE_FEATURE_USE_BACKEND_DELIVERY", "true");
      vi.spyOn(authService, "getSession").mockResolvedValue(buildAuthSession());
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext()))
        .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(null)))
        .mockResolvedValueOnce(jsonResponse(buildBootstrapContext(buildAttempt())))
        .mockResolvedValue(jsonResponse(buildLiveSessionContext(buildAttempt())));
      global.fetch = fetchMock as unknown as typeof fetch;
      return fetchMock;
    }

    afterEach(() => {
      globalThis.WebSocket = originalWebSocket;
    });

    it("keeps the socket closed when the rollout flag is absent", async () => {
      installSocket();
      stubSessionFetch();

      const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(MockSocket.instances).toHaveLength(0);
      expect(result.current.liveSocketConnected).toBe(false);
    });

    it("opens the student socket and applies only newer runtime snapshots", async () => {
      installSocket();
      vi.stubEnv("VITE_STUDENT_REALTIME", "websocket");
      const fetchMock = stubSessionFetch();

      const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await waitFor(() => expect(MockSocket.instances.length).toBeGreaterThan(0));

      const socket = MockSocket.instances[MockSocket.instances.length - 1]!;
      expect(socket.url).toContain("scheduleId=sched-1");
      expect(socket.url).toContain("attemptId=attempt-1");
      // The reconnect gap closer: the client tells the server what it has.
      expect(socket.url).toContain("lastSeenRuntimeRevision=");

      socket.open();
      await waitFor(() => expect(result.current.liveSocketConnected).toBe(true));

      const baseline = liveFetchCount(fetchMock);
      socket.emit({
        type: "runtime_snapshot",
        scheduleId: "sched-1",
        runtime: { ...buildRuntime(), revision: 42, status: "paused" },
      });
      await waitFor(() => expect(result.current.runtimeSnapshot?.status).toBe("paused"));

      // A re-delivered revision behind the applied one is ignored whole: no
      // state change and no refetch.
      socket.emit({
        type: "runtime_snapshot",
        scheduleId: "sched-1",
        runtime: { ...buildRuntime(), revision: 41, status: "live" },
      });
      expect(result.current.runtimeSnapshot?.status).toBe("paused");
      expect(liveFetchCount(fetchMock)).toBe(baseline);

      // A schedule_runtime frame AT the applied revision is a replay: ignored.
      socket.emit({ kind: "schedule_runtime", id: "sched-1", revision: 42, event: "pause_runtime" });
      expect(liveFetchCount(fetchMock)).toBe(baseline);

      // A newer transition refreshes immediately (the 500ms coalescer is for
      // answer bursts, not for the frame that opens the exam).
      socket.emit({ kind: "schedule_runtime", id: "sched-1", revision: 43, event: "start_runtime" });
      await waitFor(() => expect(liveFetchCount(fetchMock)).toBe(baseline + 1));
    });

    // The race the monotonic-revision rule exists for: a poll response that
    // overtook the socket frame in flight carries an OLDER revision. It must
    // never regress state the socket already applied.
    it("does not let a stale poll response regress a newer socket snapshot", async () => {
      installSocket();
      vi.stubEnv("VITE_STUDENT_REALTIME", "websocket");
      const fetchMock = stubSessionFetch();

      const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await waitFor(() => expect(MockSocket.instances.length).toBeGreaterThan(0));

      const socket = MockSocket.instances[MockSocket.instances.length - 1]!;
      socket.open();
      await waitFor(() => expect(result.current.liveSocketConnected).toBe(true));

      socket.emit({
        type: "runtime_snapshot",
        scheduleId: "sched-1",
        runtime: { ...buildRuntime(), revision: 42, status: "paused" },
      });
      await waitFor(() => expect(result.current.runtimeSnapshot?.revision).toBe(42));

      // Every later authoritative fetch answers with the older revision.
      fetchMock.mockResolvedValue(
        jsonResponse(
          buildLiveSessionContext(buildAttempt(), "ver-1", { revision: 41, status: "live" }),
        ),
      );
      const baseline = liveFetchCount(fetchMock);
      socket.emit({ kind: "schedule_runtime", id: "sched-1", revision: 43, event: "start_runtime" });
      await waitFor(() => expect(liveFetchCount(fetchMock)).toBe(baseline + 1));
      // Give the (discarded) payload a chance to land before asserting.
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.runtimeSnapshot?.revision).toBe(42);
      expect(result.current.runtimeSnapshot?.status).toBe("paused");
    });

    /**
     * A rollout you cannot see is not a rollout. These are the client-side
     * signals that say whether enabling student sockets is working: did it
     * connect, did it drop after opening, how much did a reconnect snapshot
     * have to close, how long did a runtime frame take to arrive.
     */
    it("reports the realtime rollout lifecycle metrics", async () => {
      installSocket();
      vi.stubEnv("VITE_STUDENT_REALTIME", "websocket");
      stubSessionFetch();

      const captured: Array<Record<string, unknown>> = [];
      const listener = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail && typeof detail === "object") captured.push(detail as Record<string, unknown>);
      };
      window.addEventListener("student-observability-metric", listener);

      try {
        const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
          wrapper: createWrapper(),
        });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        await waitFor(() => expect(MockSocket.instances.length).toBeGreaterThan(0));

        const socket = MockSocket.instances[MockSocket.instances.length - 1]!;
        socket.open();
        await waitFor(() => expect(result.current.liveSocketConnected).toBe(true));
        expect(captured.some((metric) => metric['name'] === "student_ws_connect_success")).toBe(true);

        // The server's reconnect snapshot is ahead of what the client held.
        socket.emit({
          type: "runtime_snapshot",
          scheduleId: "sched-1",
          runtime: { ...buildRuntime(), revision: 42, status: "paused" },
        });
        await waitFor(() =>
          expect(captured.some((metric) => metric['name'] === "runtime_revision_gap_on_reconnect")).toBe(
            true,
          ),
        );
        const gap = captured.find((metric) => metric['name'] === "runtime_revision_gap_on_reconnect");
        expect(typeof gap?.['revisionGap']).toBe("number");
        expect(gap?.['revisionGap'] as number).toBeGreaterThan(0);

        // A runtime transition frame carries its commit instant.
        socket.emit({
          kind: "schedule_runtime",
          id: "sched-1",
          revision: 43,
          event: "start_runtime",
          createdAt: new Date(Date.now() - 120).toISOString(),
        });
        await waitFor(() =>
          expect(captured.some((metric) => metric['name'] === "runtime_event_to_client_ms")).toBe(true),
        );
        const latency = captured.find((metric) => metric['name'] === "runtime_event_to_client_ms");
        expect(latency?.['reason']).toBe("start_runtime");
        expect(latency?.['latencyMs'] as number).toBeGreaterThanOrEqual(100);

        // A drop after a healthy open is its own signal.
        socket.close();
        await waitFor(() =>
          expect(captured.some((metric) => metric['name'] === "student_ws_disconnect_after_open")).toBe(
            true,
          ),
        );
      } finally {
        window.removeEventListener("student-observability-metric", listener);
      }
    });

    // The fallback firing is the rollout's safety property: with the socket
    // enabled but unavailable, the versioned poll must take over — and say so.
    it("reports the poll fallback when the socket never comes up", async () => {
      vi.useFakeTimers();
      installSocket();
      vi.stubEnv("VITE_STUDENT_REALTIME", "websocket");
      stubSessionFetch();

      const captured: Array<Record<string, unknown>> = [];
      const listener = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail && typeof detail === "object") captured.push(detail as Record<string, unknown>);
      };
      window.addEventListener("student-observability-metric", listener);

      try {
        const { result } = renderHook(() => useStudentSessionRouteData("sched-1", "W250334"), {
          wrapper: createWrapper(),
        });
        // Let the bootstrap/poll promises settle, then run past the poll
        // interval: the loop probes once, then ticks.
        await act(async () => {
          for (let i = 0; i < 20; i++) await Promise.resolve();
        });
        expect(result.current.isLoading).toBe(false);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(40_000);
        });

        expect(
          captured.some((metric) => metric['name'] === 'poll_fallback_activation'),
        ).toBe(true);
      } finally {
        window.removeEventListener("student-observability-metric", listener);
        vi.useRealTimers();
      }
    });
  });
});
