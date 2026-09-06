import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "../../../../constants/examDefaults";
import { studentAttemptRepository } from "../../../../services/studentAttemptRepository";
import type { ExamState } from "../../../../types";
import type { StudentAttempt } from "../../../../types/studentAttempt";
import type {
  ResponseAcknowledgementV2,
  ResponseBatchResponseV2,
  ResponseSnapshotV2,
} from "../../../../shared/durability/types";
import { StudentAttemptProvider, useStudentAttempt } from "../StudentAttemptProvider";
import { StudentNetworkProvider, useStudentNetwork } from "../StudentNetworkProvider";
import { StudentRuntimeProvider, useStudentRuntime } from "../StudentRuntimeProvider";

const transportMocks = vi.hoisted(() => ({
  transport: {
    sendBatch: vi.fn(),
    submit: vi.fn(),
    fetchSnapshot: vi.fn(),
  },
  createTransport: vi.fn(),
}));

vi.mock("@student/api/responseDurabilityTransport", () => ({
  createResponseDurabilityV2Transport: transportMocks.createTransport,
  takeOverResponseDurabilityLease: vi.fn(),
}));

vi.mock("../../../../utils/deviceFingerprinting", () => ({
  getDeviceFingerprint: vi.fn(async () => ({
    components: {},
    hash: "fp-1",
  })),
}));

import { getDeviceFingerprint } from "../../../../utils/deviceFingerprinting";

function createExamState(): ExamState {
  return {
    title: "Test Exam",
    type: "Academic",
    activeModule: "reading",
    activePassageId: "p1",
    activeListeningPartId: "l1",
    config: createDefaultConfig("Academic", "Academic"),
    reading: {
      passages: [
        {
          id: "p1",
          title: "Passage 1",
          content: "Test content",
          blocks: [],
        },
      ],
    },
    listening: {
      parts: [
        {
          id: "l1",
          title: "Part 1",
          pins: [],
          blocks: [],
        },
      ],
    },
    writing: {
      task1Prompt: "Task 1 prompt",
      task2Prompt: "Task 2 prompt",
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: {
      part1Topics: [],
      cueCard: "",
      part3Discussion: [],
    },
  };
}

function createAttemptSnapshot(): StudentAttempt {
  return {
    id: "attempt-1",
    scheduleId: "sched-1",
    studentKey: "student-sched-1-alice",
    examId: "exam-1",
    examTitle: "Test Exam",
    candidateId: "alice",
    candidateName: "Alice Roe",
    candidateEmail: "alice@example.com",
    phase: "exam",
    currentModule: "reading",
    currentQuestionId: "q1",
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: "active",
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    integrity: {
      preCheck: null,
      deviceFingerprintHash: "fp-1",
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
      syncState: "saved",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createEmptySnapshot(): ResponseSnapshotV2 {
  return {
    attemptId: "attempt-1",
    protocolVersion: 2,
    deliveryStatus: "open",
    leaseEpoch: 1,
    controlEpoch: 1,
    attemptRevision: 3,
    deadlineAt: null,
    closingGraceUntil: null,
    responses: [],
  };
}

function createAcknowledgement(writeId: string): ResponseAcknowledgementV2 {
  return {
    writeId,
    questionId: "q1",
    clientVersion: 1,
    outcome: "accepted",
    serverRevision: 4,
    canonicalResponse: { kind: "choice", questionId: "q1", value: "A" },
    contentHash: "hash-1",
  };
}

describe("StudentNetworkProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportMocks.createTransport.mockReturnValue(transportMocks.transport);
    transportMocks.transport.fetchSnapshot.mockResolvedValue(createEmptySnapshot());
    transportMocks.transport.sendBatch.mockImplementation(
      async (
        attemptId: string,
        request: { commands: Array<{ writeId: string; questionId: string; clientVersion: number }> }
      ) => {
        const response: ResponseBatchResponseV2 = {
          attemptRevision: 4,
          serverTime: "2026-01-01T00:00:01.000Z",
          acknowledgements: request.commands.map((command) => ({
            ...createAcknowledgement(command.writeId),
            questionId: command.questionId,
            clientVersion: command.clientVersion,
          })),
        };
        return response;
      }
    );

    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      "ielts_student_attempt_credentials_v1",
      JSON.stringify([
        {
          attemptId: "attempt-1",
          scheduleId: "sched-1",
          attemptToken: "token-1",
          expiresAt: "2026-01-02T00:00:00.000Z",
        },
      ])
    );

    vi.spyOn(studentAttemptRepository, "saveAttempt").mockResolvedValue();
    vi.spyOn(studentAttemptRepository, "saveHeartbeatEvent").mockResolvedValue();
    vi.spyOn(studentAttemptRepository, "getHeartbeatEvents").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createWrapper(
    attemptSnapshot = createAttemptSnapshot(),
    config = createExamState().config,
    onRefreshRuntime?: () => Promise<void>
  ) {
    const state = createExamState();
    state.config = config;

    return ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider state={state} onExit={vi.fn()} attemptSnapshot={attemptSnapshot}>
        <StudentAttemptProvider
          scheduleId={attemptSnapshot.scheduleId}
          attemptSnapshot={attemptSnapshot}
        >
          <StudentNetworkProvider
            config={config}
            scheduleId={attemptSnapshot.scheduleId}
            onRefreshRuntime={onRefreshRuntime}
          >
            {children}
          </StudentNetworkProvider>
        </StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
  }

  it("records offline state without entering blocking runtime mode", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });

    const { result } = renderHook(
      () => ({
        runtime: useStudentRuntime(),
        network: useStudentNetwork(),
      }),
      { wrapper: createWrapper() }
    );

    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event("offline"));
    });

    await waitFor(() => {
      expect(result.current.network.state.isOnline).toBe(false);
    });

    expect(result.current.runtime.state.blocking.reason).toBeNull();
    expect(result.current.network.state.isOnline).toBe(false);
    expect(result.current.network.state.lastDisconnectAt).not.toBeNull();
    expect(result.current.runtime.state.attemptSyncState).toBe("offline");
  });

  it("clears reconnect blocking after the V2 engine flush succeeds", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
        network: useStudentNetwork(),
      }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.attempt.state.attempt?.id).toBe("attempt-1");
    });

    act(() => {
      result.current.attempt.actions.persistAnswer("q1", "A");
    });

    await waitFor(() => {
      expect(transportMocks.transport.sendBatch).toHaveBeenCalled();
    });

    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(result.current.network.state.isRecovering).toBe(false);
    });

    expect(result.current.runtime.state.blocking.reason).toBeNull();
  });

  it("flushes the V2 engine before refreshing runtime on reconnect", async () => {
    const onRefreshRuntime = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
      }),
      {
        wrapper: createWrapper(createAttemptSnapshot(), createExamState().config, onRefreshRuntime),
      }
    );

    await waitFor(() => {
      expect(result.current.attempt.state.attempt?.id).toBe("attempt-1");
    });

    act(() => {
      result.current.attempt.actions.persistAnswer("q1", "A");
    });

    await waitFor(() => {
      expect(transportMocks.transport.sendBatch).toHaveBeenCalled();
    });

    transportMocks.transport.sendBatch.mockClear();

    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(onRefreshRuntime).toHaveBeenCalled();
    });

    expect(result.current.runtime.state.blocking.reason).toBeNull();
  });

  it("keeps reconnect recovery active when the V2 engine reports a terminal conflict", async () => {
    transportMocks.transport.sendBatch.mockRejectedValueOnce(
      Object.assign(new Error("LEASE_FENCED"), { code: "LEASE_FENCED" })
    );
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
        network: useStudentNetwork(),
      }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.attempt.state.attempt?.id).toBe("attempt-1");
    });

    act(() => {
      result.current.attempt.actions.persistAnswer("q1", "A");
    });

    await waitFor(() => {
      expect(transportMocks.transport.sendBatch).toHaveBeenCalled();
    });

    act(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(result.current.network.state.isRecovering).toBe(true);
    });

    expect(result.current.runtime.state.blocking.reason).toBeNull();
  });

  it("records heartbeat-lost violations without entering blocking runtime mode", async () => {
    vi.useFakeTimers();

    const config = createExamState().config;
    config.security.heartbeatIntervalSeconds = 0.01;
    config.security.heartbeatWarningThreshold = 1;
    config.security.heartbeatHardBlockThreshold = 2;

    vi.mocked(studentAttemptRepository.saveHeartbeatEvent).mockImplementation(
      async (event: any) => {
        if (event?.type === "heartbeat") {
          throw new Error("heartbeat failed");
        }
      }
    );

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });

    const { result } = renderHook(
      () => ({
        runtime: useStudentRuntime(),
      }),
      { wrapper: createWrapper(createAttemptSnapshot(), config) }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(result.current.runtime.state.blocking.reason).toBeNull();

    expect(
      result.current.runtime.state.violations.filter(
        (violation) => violation.type === "HEARTBEAT_LOST"
      )
    ).toHaveLength(1);

    const savedEventTypes = vi
      .mocked(studentAttemptRepository.saveHeartbeatEvent)
      .mock.calls.map((call) => call[0]?.type);
    expect(savedEventTypes.filter((type) => type === "lost")).toHaveLength(1);
  });

  it("keeps the heartbeat schedule alive while answers are updated", async () => {
    vi.useFakeTimers();

    const config = createExamState().config;
    config.security.heartbeatIntervalSeconds = 1;
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
      }),
      { wrapper: createWrapper(createAttemptSnapshot(), config) }
    );

    vi.mocked(studentAttemptRepository.saveHeartbeatEvent).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    act(() => {
      result.current.attempt.actions.persistAnswer("q1", "A");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(studentAttemptRepository.saveHeartbeatEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "heartbeat" })
    );
  });

  it("does not hard-block on initial load when the stored fingerprint differs", async () => {
    vi.mocked(getDeviceFingerprint).mockResolvedValue({
      components: {},
      hash: "fp-2",
    });

    const { result } = renderHook(
      () => ({
        runtime: useStudentRuntime(),
        network: useStudentNetwork(),
      }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.network.state.isOnline).toBe(true);
    });

    expect(result.current.runtime.state.blocking.reason).not.toBe("device_mismatch");
    expect(
      result.current.runtime.state.violations.some(
        (violation) => violation.type === "DEVICE_MISMATCH"
      )
    ).toBe(false);
  });

  it("retries reconnect recovery after a transient runtime refresh failure and eventually unblocks", async () => {
    vi.mocked(getDeviceFingerprint).mockResolvedValue({
      components: {},
      hash: "fp-1",
    });
    const onRefreshRuntime = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("live refresh timeout"))
      .mockResolvedValue(undefined);

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
      }),
      {
        wrapper: createWrapper(createAttemptSnapshot(), createExamState().config, onRefreshRuntime),
      }
    );

    await waitFor(() => {
      expect(result.current.attempt.state.attempt?.id).toBe("attempt-1");
    });

    act(() => {
      window.dispatchEvent(new Event("online"));
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(result.current.runtime.state.blocking.reason).toBeNull();
    });

    await waitFor(
      () => {
        expect(onRefreshRuntime).toHaveBeenCalledTimes(2);
      },
      { timeout: 3_000 }
    );
    await waitFor(
      () => {
        expect(result.current.runtime.state.blocking.reason).toBeNull();
      },
      { timeout: 3_000 }
    );
  });

  it("does not force a pageshow reconnect refresh when runtime is no longer block-gated", async () => {
    vi.mocked(getDeviceFingerprint).mockResolvedValue({
      components: {},
      hash: "fp-1",
    });
    const onRefreshRuntime = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });

    const { result } = renderHook(
      () => ({
        runtime: useStudentRuntime(),
      }),
      {
        wrapper: createWrapper(createAttemptSnapshot(), createExamState().config, onRefreshRuntime),
      }
    );

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(onRefreshRuntime).toHaveBeenCalledTimes(0);
    expect(result.current.runtime.state.blocking.reason).toBeNull();
  });

  it("does not force a visibility reconnect refresh when runtime is no longer block-gated", async () => {
    vi.mocked(getDeviceFingerprint).mockResolvedValue({
      components: {},
      hash: "fp-1",
    });
    const onRefreshRuntime = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    const { result } = renderHook(
      () => ({
        runtime: useStudentRuntime(),
      }),
      {
        wrapper: createWrapper(createAttemptSnapshot(), createExamState().config, onRefreshRuntime),
      }
    );

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(onRefreshRuntime).toHaveBeenCalledTimes(0);
    expect(result.current.runtime.state.blocking.reason).toBeNull();
  });

  it("reconciles a terminal proctor submit conflict from the canonical attempt", async () => {
    const attemptSnapshot = {
      ...createAttemptSnapshot(),
      id: "attempt-terminal-reconcile",
      scheduleId: "sched-terminal-reconcile",
      studentKey: "student-sched-terminal-reconcile-alice",
    };
    const canonicalAttempt = {
      ...attemptSnapshot,
      phase: "post-exam" as const,
      submittedAt: "2026-01-01T00:05:00.000Z",
      deliveryStatus: "submitted",
      finalSubmission: {
        submissionId: "submission-1",
        submittedAt: "2026-01-01T00:05:00.000Z",
      },
    };
    const getCanonicalAttempt = vi
      .spyOn(studentAttemptRepository, "getCanonicalAttemptByScheduleId")
      .mockResolvedValue(canonicalAttempt);
    transportMocks.transport.submit.mockRejectedValueOnce(
      Object.assign(new Error("Attempt was closed by the proctor."), {
        statusCode: 422,
      })
    );

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
      }),
      { wrapper: createWrapper(attemptSnapshot) }
    );

    await waitFor(() => {
      expect(result.current.attempt.state.attempt?.id).toBe("attempt-terminal-reconcile");
    });

    await act(async () => {
      await expect(result.current.attempt.actions.submitAttempt()).resolves.toBe(true);
    });

    await waitFor(() => {
      expect(result.current.attempt.state.attempt).toMatchObject({
        phase: "post-exam",
        submittedAt: canonicalAttempt.submittedAt,
        deliveryStatus: "submitted",
        recovery: {
          finalSubmissionPending: false,
          syncState: "saved",
        },
      });
    });
    expect(getCanonicalAttempt).toHaveBeenCalledWith(
      "sched-terminal-reconcile",
      "student-sched-terminal-reconcile-alice"
    );
  });
});
