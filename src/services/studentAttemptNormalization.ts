import type { StudentAttempt } from '../types/studentAttempt';

const WARNING_VIOLATION_TYPES = new Set(['PROCTOR_WARNING', 'AUTO_WARNING']);

export function deriveCandidateId(
  attempt: Pick<StudentAttempt, 'candidateId' | 'scheduleId' | 'studentKey' | 'id'>,
): string {
  if (attempt.candidateId) {
    return attempt.candidateId;
  }

  const prefix = `student-${attempt.scheduleId}-`;
  if (attempt.studentKey.startsWith(prefix)) {
    return attempt.studentKey.slice(prefix.length) || attempt.id;
  }

  return attempt.studentKey.split('-').pop() || attempt.id;
}

export function deriveProctorStatus(
  attempt: StudentAttempt,
): StudentAttempt['proctorStatus'] {
  if (attempt.proctorStatus) {
    return attempt.proctorStatus;
  }

  if (attempt.phase === 'post-exam') {
    if (attempt.submittedAt) {
      return 'idle';
    }
    return 'terminated';
  }

  const latestWarningId =
    attempt.lastWarningId ??
    [...(attempt.violations ?? [])]
      .reverse()
      .find((violation) => WARNING_VIOLATION_TYPES.has(violation.type))?.id ??
    null;

  if (latestWarningId && latestWarningId !== attempt.lastAcknowledgedWarningId) {
    return 'warned';
  }

  return 'active';
}

export function normalizeStudentAttempt(attempt: StudentAttempt): StudentAttempt {
  const candidateId = deriveCandidateId(attempt);
  const lastWarningId =
    attempt.lastWarningId ??
    [...(attempt.violations ?? [])]
      .reverse()
      .find((violation) => WARNING_VIOLATION_TYPES.has(violation.type))?.id ??
    null;

  return {
    ...attempt,
    candidateId,
    candidateName: attempt.candidateName ?? `Candidate ${candidateId}`,
    candidateEmail: attempt.candidateEmail ?? `${candidateId}@example.com`,
    answers: attempt.answers ?? {},
    writingAnswers: attempt.writingAnswers ?? {},
    flags: attempt.flags ?? {},
    violations: attempt.violations ?? [],
    submittedAt: attempt.submittedAt ?? null,
    proctorStatus: deriveProctorStatus(attempt),
    proctorNote: attempt.proctorNote ?? null,
    proctorUpdatedAt: attempt.proctorUpdatedAt ?? null,
    proctorUpdatedBy: attempt.proctorUpdatedBy ?? null,
    lastWarningId,
    lastAcknowledgedWarningId: attempt.lastAcknowledgedWarningId ?? null,
    integrity: {
      preCheck: attempt.integrity?.preCheck ?? null,
      deviceFingerprintHash: attempt.integrity?.deviceFingerprintHash ?? null,
      clientSessionId: attempt.integrity?.clientSessionId ?? null,
      lastDisconnectAt: attempt.integrity?.lastDisconnectAt ?? null,
      lastReconnectAt: attempt.integrity?.lastReconnectAt ?? null,
      lastHeartbeatAt: attempt.integrity?.lastHeartbeatAt ?? null,
      lastHeartbeatStatus: attempt.integrity?.lastHeartbeatStatus ?? 'idle',
    },
    recovery: {
      lastRecoveredAt: attempt.recovery?.lastRecoveredAt ?? null,
      lastLocalMutationAt: attempt.recovery?.lastLocalMutationAt ?? null,
      lastPersistedAt: attempt.recovery?.lastPersistedAt ?? null,
      lastDroppedMutations: attempt.recovery?.lastDroppedMutations ?? null,
      pendingMutationCount: attempt.recovery?.pendingMutationCount ?? 0,
      serverAcceptedThroughSeq: attempt.recovery?.serverAcceptedThroughSeq ?? 0,
      clientSessionId: attempt.recovery?.clientSessionId ?? null,
      syncState: attempt.recovery?.syncState ?? 'idle',
    },
  };
}

export function mergeStudentAttemptRecovery(
  attempt: StudentAttempt,
  recovery: Partial<StudentAttempt['recovery']>,
): StudentAttempt {
  return normalizeStudentAttempt({
    ...attempt,
    recovery: {
      ...attempt.recovery,
      ...recovery,
    },
  });
}
