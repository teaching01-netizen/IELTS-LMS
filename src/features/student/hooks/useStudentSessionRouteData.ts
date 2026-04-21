import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAsyncPolling } from '@app/hooks/useAsyncPolling';
import { useAuthSession } from '../../auth/authSession';
import { hydrateExamState } from '@services/examAdapterService';
import {
  backendGet,
  mapBackendExamVersion,
  mapBackendRuntime,
  mapBackendSchedule,
} from '@services/backendBridge';
import {
  hasAttemptCredential,
  mapBackendStudentAttempt,
  ensureClientSessionIdForAttempt,
  refreshAttemptCredentialForAttempt,
  studentAttemptRepository,
} from '@services/studentAttemptRepository';
import type { ExamState } from '../../../types';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { ServerBusyError } from '@app/error/errorTypes';

const PROFILE_STORAGE_PREFIX = 'ielts-student-profile:';

function normalizeWcodeCandidateId(studentId?: string) {
  if (!studentId) {
    return null;
  }

  const normalized = studentId.trim().toUpperCase();
  return normalized || null;
}

function isWcodeCandidateId(candidateId: string) {
  return /^W[0-9]{6}$/.test(candidateId);
}

function buildStudentKey(scheduleId: string, candidateId: string) {
  return `student-${scheduleId}-${candidateId}`;
}

function buildBackendSessionSummaryEndpoint(scheduleId: string, candidateId: string) {
  const query = new URLSearchParams({ candidateId });
  return `/v1/student/sessions/${scheduleId}/summary?${query.toString()}`;
}

function buildBackendSessionVersionEndpoint(scheduleId: string) {
  return `/v1/student/sessions/${scheduleId}/version`;
}

function loadStoredCandidateProfile(
  scheduleId: string,
  candidateId: string,
): { candidateName?: string; candidateEmail?: string } | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(`${PROFILE_STORAGE_PREFIX}${scheduleId}:${candidateId}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { studentName?: unknown; email?: unknown };
    const studentName = typeof parsed.studentName === 'string' ? parsed.studentName.trim() : '';
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';

    const profile: { candidateName?: string; candidateEmail?: string } = {};
    if (studentName) {
      profile.candidateName = studentName;
    }
    if (email) {
      profile.candidateEmail = email;
    }
    return profile;
  } catch {
    return null;
  }
}

function createCandidateProfile(
  candidateId: string,
  stored: { candidateName?: string; candidateEmail?: string } | null,
) {
  return {
    candidateId,
    candidateName: stored?.candidateName ?? `Candidate ${candidateId}`,
    candidateEmail: stored?.candidateEmail ?? `${candidateId}@example.com`,
  };
}

interface StudentSessionRouteData {
  attemptSnapshot: StudentAttempt | null;
  error: string | null;
  isLoading: boolean;
  isServerBusy: boolean;
  runtimeSnapshot: ExamSessionRuntime | null;
  schedule: ExamSchedule | null;
  state: ExamState | null;
  refreshRuntime: () => Promise<void>;
  retry: () => Promise<void>;
}

export function useStudentSessionRouteData(
  scheduleId?: string,
  studentId?: string,
): StudentSessionRouteData {
  const { status: authStatus } = useAuthSession();
  const [attemptSnapshot, setAttemptSnapshot] = useState<StudentAttempt | null>(null);
  const [schedule, setSchedule] = useState<ExamSchedule | null>(null);
  const [state, setState] = useState<ExamState | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ExamSessionRuntime | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isServerBusy, setIsServerBusy] = useState(false);
  const [serverBusyRetryAfterMs, setServerBusyRetryAfterMs] = useState(2_000);
  const [error, setError] = useState<string | null>(null);
  const candidateId = useMemo(() => normalizeWcodeCandidateId(studentId), [studentId]);
  const storedCandidateProfile = useMemo(
    () => (scheduleId && candidateId ? loadStoredCandidateProfile(scheduleId, candidateId) : null),
    [candidateId, scheduleId],
  );
  const studentKey = useMemo(
    () => (scheduleId && candidateId ? buildStudentKey(scheduleId, candidateId) : null),
    [candidateId, scheduleId],
  );

  useEffect(() => {
    setAttemptSnapshot(null);
    setSchedule(null);
    setState(null);
    setRuntimeSnapshot(null);
    setIsLoading(true);
    setIsServerBusy(false);
    setServerBusyRetryAfterMs(2_000);
    setError(null);
  }, [candidateId, scheduleId]);

  const refreshBackendSessionSnapshot = useCallback(async () => {
    if (!scheduleId || !candidateId || !isWcodeCandidateId(candidateId)) {
      return;
    }

    try {
      const session = await backendGet<{
      schedule: Parameters<typeof mapBackendSchedule>[0];
      runtime?: Parameters<typeof mapBackendRuntime>[0] | null | undefined;
      attempt?: Parameters<typeof mapBackendStudentAttempt>[0] | null | undefined;
      degradedLiveMode?: boolean | undefined;
    }>(buildBackendSessionSummaryEndpoint(scheduleId, candidateId), { retries: 0 });
      const nextSchedule = mapBackendSchedule(session.schedule);

      setSchedule(nextSchedule);
      setRuntimeSnapshot(
        session.runtime ? mapBackendRuntime(session.runtime, nextSchedule) : null,
      );

      if (session.attempt) {
        const nextAttempt = mapBackendStudentAttempt(session.attempt);
        await studentAttemptRepository.saveAttempt(nextAttempt);
        setAttemptSnapshot(nextAttempt);
      }

      setIsServerBusy(false);
    } catch (loadError) {
      if (loadError instanceof ServerBusyError) {
        setIsServerBusy(true);
        const retryAfterSeconds = (loadError.details as { retryAfterSeconds?: unknown } | undefined)
          ?.retryAfterSeconds;
        if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          setServerBusyRetryAfterMs(Math.round(retryAfterSeconds * 1000));
        }
      }
      throw loadError;
    }
  }, [candidateId, scheduleId]);

  const loadStudentData = useCallback(async () => {
    if (!scheduleId) {
      setError('Schedule ID not found');
      setIsLoading(false);
      return;
    }

    if (authStatus === 'loading') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (!candidateId || !isWcodeCandidateId(candidateId)) {
        throw new Error('Invalid access code. Please check in again.');
      }

      if (!studentKey) {
        throw new Error('Student identity not found');
      }

      const summary = await backendGet<{
        schedule: Parameters<typeof mapBackendSchedule>[0];
        runtime?: Parameters<typeof mapBackendRuntime>[0] | null | undefined;
        attempt?: Parameters<typeof mapBackendStudentAttempt>[0] | null | undefined;
        degradedLiveMode?: boolean | undefined;
      }>(buildBackendSessionSummaryEndpoint(scheduleId, candidateId), { retries: 0 });
      const scheduleEntity = mapBackendSchedule(summary.schedule);

      let examState = state;
      if (!examState) {
        const version = await backendGet<Parameters<typeof mapBackendExamVersion>[0]>(
          buildBackendSessionVersionEndpoint(scheduleId),
          { retries: 0 },
        );
        const mapped = mapBackendExamVersion(version);
        examState = hydrateExamState({
          ...mapped.contentSnapshot,
          config: mapped.configSnapshot,
        } satisfies ExamState);
        setState(examState);
      }

      setSchedule(scheduleEntity);
      setRuntimeSnapshot(
        summary.runtime ? mapBackendRuntime(summary.runtime, scheduleEntity) : null,
      );

      if (summary.attempt) {
        const nextAttempt = mapBackendStudentAttempt(summary.attempt);
        const isSubmittedAttempt = Boolean(
          (
            summary.attempt as {
              submittedAt?: string | null | undefined;
            }
          ).submittedAt,
        );

        if (!isSubmittedAttempt) {
          // Restore/lock the clientSessionId used for mutation sequencing if sessionStorage was lost.
          ensureClientSessionIdForAttempt(nextAttempt);
          if (!hasAttemptCredential(nextAttempt.scheduleId, nextAttempt.id)) {
            await refreshAttemptCredentialForAttempt(nextAttempt).catch(() => false);
          }
        }

        await studentAttemptRepository.saveAttempt(nextAttempt);
        if (isSubmittedAttempt) {
          setAttemptSnapshot(nextAttempt);
        } else if (!hasAttemptCredential(nextAttempt.scheduleId, nextAttempt.id)) {
          const hydratedAttempt = await studentAttemptRepository.getAttemptByScheduleId(
            scheduleId,
            nextAttempt.studentKey,
          );
          setAttemptSnapshot(hydratedAttempt ?? nextAttempt);
        } else {
          setAttemptSnapshot(nextAttempt);
        }
      } else {
        const firstEnabledModule =
          (['listening', 'reading', 'writing', 'speaking'] as const).find(
            (module) => examState.config.sections[module].enabled,
          ) ?? 'listening';
        const createdAttempt = await studentAttemptRepository.createAttempt({
          scheduleId,
          studentKey,
          examId: scheduleEntity.examId,
          examTitle: scheduleEntity.examTitle,
          ...createCandidateProfile(candidateId, storedCandidateProfile),
          currentModule:
            (summary.runtime
              ? mapBackendRuntime(summary.runtime, scheduleEntity).currentSectionKey
              : null) ?? firstEnabledModule,
        });
        setAttemptSnapshot(createdAttempt);
      }
      setIsServerBusy(false);
      setIsLoading(false);
    } catch (loadError) {
      if (loadError instanceof ServerBusyError) {
        setIsServerBusy(true);
        const retryAfterSeconds = (loadError.details as { retryAfterSeconds?: unknown } | undefined)
          ?.retryAfterSeconds;
        if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          setServerBusyRetryAfterMs(Math.round(retryAfterSeconds * 1000));
        }
        setError(null);
        throw loadError;
      }
      setIsServerBusy(false);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load exam data');
      setIsLoading(false);
    }
  }, [authStatus, candidateId, scheduleId, state, storedCandidateProfile, studentKey]);

  useAsyncPolling(loadStudentData, {
    enabled: Boolean(scheduleId && authStatus !== 'loading' && !state && !error),
    intervalMs: isServerBusy ? serverBusyRetryAfterMs : 2_000,
    maxIntervalMs: isServerBusy ? serverBusyRetryAfterMs : 30_000,
    jitterMs: 250,
  });

  const pollIntervalMs = runtimeSnapshot?.status === 'live' ? 10_000 : 15_000;
  const pollMaxIntervalMs = runtimeSnapshot?.status === 'live' ? 15_000 : 30_000;

  useAsyncPolling(async () => {
    await refreshBackendSessionSnapshot();
  }, {
    enabled: Boolean(scheduleId && state && !error && !isLoading),
    intervalMs: pollIntervalMs,
    maxIntervalMs: pollMaxIntervalMs,
    jitterMs: runtimeSnapshot?.status === 'live' ? 750 : 15_000,
  });

  return {
    attemptSnapshot,
    error,
    isLoading,
    isServerBusy,
    runtimeSnapshot,
    schedule,
    state,
    refreshRuntime: refreshBackendSessionSnapshot,
    retry: loadStudentData,
  };
}
