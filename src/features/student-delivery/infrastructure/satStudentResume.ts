import { backendGet, hasBackendStatusCode } from "@services/backendBridge";
import {
  mapBackendStudentAttempt,
  refreshAttemptCredentialForAttempt,
  ensureClientSessionIdForStudentKey,
  createStudentClientSessionId,
  satWriterStudentKey,
} from "@services/studentAttemptRepository";
import { storeAttemptCredential } from "@services/attemptCredentialAdapter";
import { studentSessionTransport } from "@services/studentSessionTransport";
import type { StudentAttempt } from "../../../types/studentAttempt";
import { getVerifiedTerminalState } from "../../student/api/verifiedTerminalState";
import {
  clearSatResumeLocator,
  matchesSatResumeLocator,
  type SatResumeLocatorV1,
} from "./satResumeLocator";
import {
  emitStudentObservabilityMetric,
  withStudentObservabilityDimensions,
} from "../../../utils/studentObservability";

interface ResumeSessionResponse {
  attempt?: unknown | null;
  attemptCredential?: { attemptToken: string; expiresAt: string } | null;
  clientSessionId?: string | null;
  runtime?: { status?: string | null } | null;
}

export type SatResumeResult =
  | { kind: "resumed"; attempt: StudentAttempt; route: string; terminal: boolean }
  | { kind: "no-attempt" }
  | { kind: "unauthenticated" }
  | { kind: "transient-error"; reason: "network" | "server_error" };

function statusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  const value = record["statusCode"] ?? record["status"];
  return typeof value === "number" ? value : null;
}

function emitResumeMetric(
  name: string,
  scheduleId: string,
  reason: string,
  attemptId?: string,
  latencyMs?: number
): void {
  emitStudentObservabilityMetric(
    name,
    withStudentObservabilityDimensions({
      scheduleId,
      attemptId: attemptId ?? null,
      reason,
      ...(latencyMs === undefined ? {} : { latencyMs }),
    })
  );
}

/**
 * Resolve a likely SAT session from the authenticated user's server-owned
 * attempt. The locator only picks a schedule; its candidate/attempt values
 * are never sent as identity or admission proof.
 */
export async function resumeSatStudentSession(input: {
  scheduleId: string;
  locator: SatResumeLocatorV1 | null;
}): Promise<SatResumeResult> {
  const { scheduleId, locator } = input;
  const startedAt = Date.now();
  emitResumeMetric("student_resume_probe_total", scheduleId, "probe");

  // The locator candidate is only a hint for finding this browser's existing
  // writer identity. The server still resolves the attempt from the cookie.
  // When there is no usable hint, send a fresh browser-owned id and bind it to
  // the canonical candidate only after the server returns that identity.
  const hintedCandidateId =
    locator?.providerKey === "sat" && locator.scheduleId === scheduleId
      ? locator.candidateId
      : null;
  const requestedWriterId = hintedCandidateId
    ? ensureClientSessionIdForStudentKey(
        scheduleId,
        satWriterStudentKey(scheduleId, hintedCandidateId)
      )
    : createStudentClientSessionId();

  try {
    const session = await backendGet<ResumeSessionResponse>(
      studentSessionTransport.paths.resume(scheduleId, requestedWriterId),
      { retries: 0, timeout: 8_000 }
    );
    if (!session.attempt || typeof session.attempt !== "object") {
      if (matchesSatResumeLocator(locator, { scheduleId })) clearSatResumeLocator();
      emitResumeMetric(
        "student_resume_failure_total",
        scheduleId,
        "no_active_attempt",
        undefined,
        Date.now() - startedAt
      );
      return { kind: "no-attempt" };
    }

    const attempt = mapBackendStudentAttempt(
      session.attempt as Parameters<typeof mapBackendStudentAttempt>[0]
    );
    const terminal =
      getVerifiedTerminalState({
        attempt,
        runtime: session.runtime?.status ? { status: session.runtime.status } : null,
      }) !== "not_terminal";
    const writerKey = satWriterStudentKey(scheduleId, attempt.candidateId);
    const serverWriterId = session.clientSessionId?.trim();
    const canReuseRequestedWriter = hintedCandidateId === attempt.candidateId || !hintedCandidateId;
    const canonicalWriterId = ensureClientSessionIdForStudentKey(
      scheduleId,
      writerKey,
      canReuseRequestedWriter ? requestedWriterId : null
    );
    const credentialBelongsToWriter = serverWriterId === canonicalWriterId;

    if (!terminal && credentialBelongsToWriter && session.attemptCredential) {
      storeAttemptCredential(attempt, session.attemptCredential);
    } else if (!terminal) {
      const writerAttempt: StudentAttempt = {
        ...attempt,
        integrity: { ...attempt.integrity, clientSessionId: canonicalWriterId },
        recovery: { ...attempt.recovery, clientSessionId: canonicalWriterId },
      };
      await refreshAttemptCredentialForAttempt(writerAttempt, canonicalWriterId);
    }

    if (terminal) clearSatResumeLocator();
    emitResumeMetric(
      "student_resume_success_total",
      scheduleId,
      terminal ? "terminal" : "resumed",
      attempt.id,
      Date.now() - startedAt
    );
    emitResumeMetric(
      "student_resume_recovery_ms",
      scheduleId,
      terminal ? "terminal" : "resumed",
      attempt.id,
      Date.now() - startedAt
    );
    return {
      kind: "resumed",
      attempt,
      route: `/student/${encodeURIComponent(scheduleId)}/${encodeURIComponent(attempt.candidateId)}`,
      terminal,
    };
  } catch (error) {
    if (hasBackendStatusCode(error, 401) || hasBackendStatusCode(error, 403)) {
      if (matchesSatResumeLocator(locator, { scheduleId })) clearSatResumeLocator();
      emitResumeMetric(
        "student_resume_failure_total",
        scheduleId,
        "unauthenticated",
        undefined,
        Date.now() - startedAt
      );
      return { kind: "unauthenticated" };
    }
    if (hasBackendStatusCode(error, 404)) {
      if (matchesSatResumeLocator(locator, { scheduleId })) clearSatResumeLocator();
      emitResumeMetric(
        "student_resume_failure_total",
        scheduleId,
        "no_active_attempt",
        undefined,
        Date.now() - startedAt
      );
      return { kind: "no-attempt" };
    }
    const code = statusCode(error);
    const reason = (code !== null && code >= 500) || code === 429 ? "server_error" : "network";
    emitResumeMetric(
      "student_resume_failure_total",
      scheduleId,
      reason,
      undefined,
      Date.now() - startedAt
    );
    return { kind: "transient-error", reason };
  }
}
