import { describe, expect, it } from "vitest";
import type { ExamSessionRuntime } from "../../../../types/domain";
import type { StudentAttempt } from "../../../../types/studentAttempt";
import type { ModuleType } from "../../../../types";
import { deriveStudentPhase } from "../deriveStudentPhase";
import { evaluateSubmissionBarrier } from "../submissionPolicy";
import { reconcileRuntimeSnapshot } from "../runtimeReconciliation";
import { resolveObjectiveAnswerUpdate } from "../answerPolicy";
import { deriveBlockingState } from "../blockingPolicy";

function buildAttempt(overrides: Partial<StudentAttempt> = {}): StudentAttempt {
  return {
    id: "attempt-1",
    scheduleId: "schedule-1",
    studentKey: "student-1",
    examId: "exam-1",
    examTitle: "IELTS",
    candidateId: "W250334",
    candidateName: "Candidate",
    candidateEmail: "candidate@example.com",
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
    submittedAt: null,
    integrity: {
      preCheck: {
        completedAt: "2026-08-16T00:00:00.000Z",
        browserFamily: "other",
        browserVersion: null,
        screenDetailsSupported: true,
        heartbeatReady: true,
        acknowledgedSafariLimitation: false,
        checks: [],
      },
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
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

function buildRuntime(overrides: Partial<ExamSessionRuntime> = {}): ExamSessionRuntime {
  return {
    id: "runtime-1",
    scheduleId: "schedule-1",
    status: "not_started",
    currentSectionKey: "reading",
    currentSectionRemainingSeconds: 1200,
    currentSectionDeadlineAt: null,
    serverNow: "2026-08-16T00:00:00.000Z",
    actualEndAt: null,
    waitingForNextSection: false,
    sections: [
      {
        sectionKey: "reading",
        status: "locked",
        remainingSeconds: 1200,
        extensionMinutes: 0,
        pausedAt: null,
      },
    ],
    ...overrides,
  };
}

describe("student exam acceptance contracts", () => {
  it("keeps a completed pre-check in the lobby until runtime becomes active", () => {
    const attempt = buildAttempt();
    const lobbyRuntime = buildRuntime({ status: "not_started" });
    const liveRuntime = buildRuntime({ status: "live" });

    expect(deriveStudentPhase({ attempt, runtime: lobbyRuntime, runtimeBacked: true })).toBe(
      "lobby"
    );
    expect(deriveStudentPhase({ attempt, runtime: liveRuntime, runtimeBacked: true })).toBe("exam");
  });

  it("does not expose completion from a stale post-exam attempt while runtime is live", () => {
    const attempt = buildAttempt({ phase: "post-exam" });
    const runtime = buildRuntime({ status: "live" });

    expect(deriveStudentPhase({ attempt, runtime, runtimeBacked: true })).toBe("exam");
  });

  it("treats a server-submitted delivery status as terminal without a client timestamp", () => {
    const attempt = buildAttempt({ deliveryStatus: "submitted" });
    const runtime = buildRuntime({ status: "live" });

    expect(deriveStudentPhase({ attempt, runtime, runtimeBacked: true })).toBe("post-exam");
  });

  it("preserves a newer runtime position when an older snapshot arrives", () => {
    const current = {
      phase: "exam" as const,
      currentModule: "reading" as ModuleType,
      currentQuestionId: "q17",
      timeRemaining: 100,
      currentSectionExtensionMinutes: 0,
      waitingForCohortAdvance: false,
    };

    expect(
      reconcileRuntimeSnapshot({
        current,
        incoming: buildRuntime({
          status: "live",
          currentSectionKey: "listening",
          currentSectionRemainingSeconds: 900,
        }),
        nextModule: "listening",
        firstQuestionId: "q1-listening",
        currentSectionExtensionMinutes: 0,
        preserveLocalAdvance: true,
      })
    ).toEqual(current);
  });

  it("takes an authoritative section extension from the incoming runtime", () => {
    const current = {
      phase: "exam" as const,
      currentModule: "reading" as ModuleType,
      currentQuestionId: "q17",
      timeRemaining: 100,
      currentSectionExtensionMinutes: 2,
      waitingForCohortAdvance: false,
    };

    expect(
      reconcileRuntimeSnapshot({
        current,
        incoming: buildRuntime({ status: "live", currentSectionRemainingSeconds: 90 }),
        nextModule: "reading",
        firstQuestionId: "q1-reading",
        currentSectionExtensionMinutes: 5,
        preserveLocalAdvance: false,
      }).currentSectionExtensionMinutes
    ).toBe(5);
  });

  it("updates only the requested answer slot", () => {
    expect(
      resolveObjectiveAnswerUpdate(["one", "two"], ["one", "new"], {
        slotIndex: 1,
        slotCount: 2,
        slotValue: "new",
      })
    ).toEqual(["one", "new"]);
  });

  it("keeps offline and heartbeat signals non-blocking while storage remains a hard stop", () => {
    const base = {
      runtimeBacked: true,
      runtime: buildRuntime({ status: "live" }),
      waitingForCohortAdvance: false,
      proctorStatus: "active" as const,
      blockingReasonOverride: null,
      timeRemaining: 100,
    };

    expect(deriveBlockingState(base)).toMatchObject({ active: false, reason: null });
    expect(deriveBlockingState({ ...base, timeRemaining: 0 })).toMatchObject({
      active: true,
      reason: "time_expired",
      timeRemaining: 0,
    });
    expect(
      deriveBlockingState({ ...base, blockingReasonOverride: "storage_unavailable" })
    ).toMatchObject({
      active: true,
      reason: "storage_unavailable",
    });
  });

  it("requires a durability barrier before reporting submission readiness", () => {
    expect(
      evaluateSubmissionBarrier({
        phase: "exam",
        pendingMutationCount: 1,
        durabilityReady: false,
        runtimeBacked: false,
        runtimeStatus: null,
        runtimeCompletionVerified: false,
      })
    ).toEqual({ kind: "blocked", reason: "pending_mutations" });

    expect(
      evaluateSubmissionBarrier({
        phase: "exam",
        pendingMutationCount: 0,
        durabilityReady: true,
        runtimeBacked: false,
        runtimeStatus: null,
        runtimeCompletionVerified: false,
      })
    ).toEqual({ kind: "ready" });
  });

  it("gives expiry precedence over typing: expired clock blocks even with a live runtime", () => {
    // Typing-while-time-expires: the candidate may still have keystrokes in
    // flight, but the pure blocking decision must already report time_expired
    // so effects (auto-submit, edit-stop) trigger from one authoritative value.
    const base = {
      runtimeBacked: true,
      runtime: buildRuntime({ status: "live" }),
      waitingForCohortAdvance: false,
      proctorStatus: "active" as const,
      blockingReasonOverride: null,
      timeRemaining: 0,
    };
    expect(deriveBlockingState(base)).toMatchObject({ active: true, reason: "time_expired" });
  });

  it("gives proctor pause precedence over submission readiness (pause-vs-submit)", () => {
    // Proctor-pause-arriving-during-submission: blocking reports proctor_paused
    // regardless of barrier readiness, so the coordinator must observe the
    // blocking state before treating a ready barrier as permission to submit.
    const blocked = deriveBlockingState({
      runtimeBacked: true,
      runtime: buildRuntime({ status: "live" }),
      waitingForCohortAdvance: false,
      proctorStatus: "paused" as const,
      blockingReasonOverride: null,
      timeRemaining: 600,
    });
    expect(blocked).toMatchObject({ active: true, reason: "proctor_paused" });
    expect(
      evaluateSubmissionBarrier({
        phase: "exam",
        pendingMutationCount: 0,
        durabilityReady: true,
        runtimeBacked: true,
        runtimeStatus: "live",
        runtimeCompletionVerified: false,
      })
    ).toEqual({ kind: "ready" });
  });

  it("gives verified-terminal precedence over stale resume (stale-resume-after-complete)", () => {
    // A stale resume arriving after completion: attempt carries submittedAt /
    // deliveryStatus submitted while the runtime snapshot is still live.
    // Verified-terminal wins, so phase resolves to post-exam, never back to exam.
    const attempt = buildAttempt({ submittedAt: "2026-08-16T00:05:00.000Z" });
    const liveRuntime = buildRuntime({ status: "live" });
    expect(deriveStudentPhase({ attempt, runtime: liveRuntime, runtimeBacked: true })).toBe(
      "post-exam"
    );
  });

  it("rejects submission from a stale post-exam snapshot while runtime is live", () => {
    // Duplicate-submit / stale-resume guard at the barrier layer: phase derived
    // from a stale post-exam attempt under a live runtime resolves to exam, but
    // a genuinely completed attempt (submittedAt) stays post-exam, so the
    // barrier reports not_exam and no second submit can proceed.
    const completedAttempt = buildAttempt({
      phase: "post-exam",
      submittedAt: "2026-08-16T00:05:00.000Z",
    });
    const phase = deriveStudentPhase({
      attempt: completedAttempt,
      runtime: buildRuntime({ status: "live" }),
      runtimeBacked: true,
    });
    expect(phase).toBe("post-exam");
    expect(
      evaluateSubmissionBarrier({
        phase,
        pendingMutationCount: 0,
        durabilityReady: true,
        runtimeBacked: true,
        runtimeStatus: "live",
        runtimeCompletionVerified: true,
      })
    ).toEqual({ kind: "blocked", reason: "not_exam" });
  });
});
