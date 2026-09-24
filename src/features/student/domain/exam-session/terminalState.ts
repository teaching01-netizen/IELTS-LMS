import type { ExamSessionRuntime } from "../../../../types/domain";
import type { StudentAttempt } from "../../../../types/studentAttempt";

export type VerifiedTerminalState = "not_terminal" | "completed" | "terminated";

/**
 * Terminal state confirmed on the persisted attempt itself. Runtime completion
 * may arrive before the student's final response submission is acknowledged,
 * so completion UI must wait for one of these attempt fields.
 */
export function getAttemptTerminalState(attempt: StudentAttempt | null): VerifiedTerminalState {
  if (attempt?.proctorStatus === "terminated") {
    return "terminated";
  }

  if (
    attempt?.deliveryStatus === "terminated" ||
    attempt?.deliveryStatus === "locked" ||
    attempt?.deliveryStatus === "cancelled"
  ) {
    return "terminated";
  }

  if (attempt?.submittedAt || attempt?.deliveryStatus === "submitted") {
    return "completed";
  }

  return "not_terminal";
}

export function isRuntimeStructurallyCompleted(runtime: ExamSessionRuntime | null): boolean {
  if (!runtime || runtime.status !== "completed") {
    return false;
  }

  if (runtime.actualEndAt) {
    return true;
  }

  if (runtime.currentSectionKey === null) {
    return true;
  }

  return runtime.sections.every((section) => section.status === "completed");
}

export function getVerifiedTerminalState(input: {
  readonly attempt: StudentAttempt | null;
  readonly runtime: { readonly status: string } | null;
}): VerifiedTerminalState {
  const attemptTerminal = getAttemptTerminalState(input.attempt);
  if (attemptTerminal !== "not_terminal") return attemptTerminal;

  if (
    input.attempt?.submittedAt ||
    input.attempt?.phase === "post-exam" ||
    input.attempt?.phase === "submitted" ||
    input.attempt?.deliveryStatus === "submitted" ||
    input.runtime?.status === "completed"
  ) {
    return "completed";
  }

  if (input.runtime?.status === "cancelled") {
    return "terminated";
  }

  return "not_terminal";
}
