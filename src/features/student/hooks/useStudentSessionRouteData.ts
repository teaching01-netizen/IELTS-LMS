import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAsyncPolling } from '@app/hooks/useAsyncPolling';
import { useLiveUpdates, type LiveUpdateEvent } from '@app/hooks/useLiveUpdates';
import {
  fetchStudentLiveSession,
  useStudentStaticSession,
} from '@app/data/studentSessionQueries';
import { queryKeys } from '@app/data/queryClient';
import { useAuthSession } from '../../auth/authSession';
import { hydrateExamState } from '@services/examAdapterService';
import {
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

async function saveAttemptSnapshotForHydration(attempt: StudentAttempt): Promise<StudentAttempt> {
  await studentAttemptRepository.saveAttempt(attempt);
  const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId(attempt.scheduleId);
  return cachedAttempts.find((candidate) => candidate.id === attempt.id) ?? attempt;
}

interface StudentSessionRouteData {
  attemptSnapshot: StudentAttempt | null;
  error: string | null;
  isLoading: boolean;
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
  const queryClient = useQueryClient();
  const { session, status: authStatus } = useAuthSession();
  const [attemptSnapshot, setAttemptSnapshot] = useState<StudentAttempt | null>(null);
  const [schedule, setSchedule] = useState<ExamSchedule | null>(null);
  const [state, setState] = useState<ExamState | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ExamSessionRuntime | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
  const canLoadBackendSession = Boolean(
    scheduleId &&
      candidateId &&
      isWcodeCandidateId(candidateId) &&
      authStatus === 'authenticated',
  );
  const staticSessionQuery = useStudentStaticSession(
    scheduleId,
    candidateId,
    canLoadBackendSession && !error,
  );
  const staticSessionData = staticSessionQuery.data;
  const refetchStaticSession = staticSessionQuery.refetch;
  const isStaticSessionLoading = staticSessionQuery.isLoading;
  const staticSessionError = staticSessionQuery.error;

  const refreshBackendSessionSnapshot = useCallback(async () => {
    if (!scheduleId || !candidateId || !isWcodeCandidateId(candidateId)) {
      return;
    }

    const liveSession = await queryClient.fetchQuery({
      queryKey: queryKeys.students.liveSession(scheduleId, candidateId),
      queryFn: () => fetchStudentLiveSession(scheduleId, candidateId),
      staleTime: 0,
    });

    setRuntimeSnapshot(
      liveSession.runtime && schedule ? mapBackendRuntime(liveSession.runtime, schedule) : null,
    );

    if (liveSession.attempt) {
      const nextAttempt = mapBackendStudentAttempt(
        liveSession.attempt as Parameters<typeof mapBackendStudentAttempt>[0],
      );
      setAttemptSnapshot(await saveAttemptSnapshotForHydration(nextAttempt));
    }
  }, [candidateId, queryClient, schedule, scheduleId]);

  const handleLiveUpdate = useCallback(
    (event: LiveUpdateEvent) => {
      if (!scheduleId) {
        return;
      }
      if (event.kind === 'schedule_runtime') {
        if (event.id !== scheduleId) return;
      } else if (event.kind === 'attempt') {
        if (!attemptSnapshot?.id || event.id !== attemptSnapshot.id) return;
      } else {
        return;
      }
      void refreshBackendSessionSnapshot();
    },
    [attemptSnapshot?.id, refreshBackendSessionSnapshot, scheduleId],
  );

  useLiveUpdates({
    ...(scheduleId ? { scheduleId } : {}),
    ...(attemptSnapshot?.id ? { attemptId: attemptSnapshot.id } : {}),
    enabled: Boolean(
      scheduleId &&
        candidateId &&
        isWcodeCandidateId(candidateId) &&
        authStatus === 'authenticated' &&
        !error,
    ),
    onEvent: handleLiveUpdate,
  });

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

      if (staticSessionError) {
        throw staticSessionError;
      }
      if (!staticSessionData && isStaticSessionLoading) {
        return;
      }

      const staticSession = staticSessionData ?? (await refetchStaticSession()).data;
      if (!staticSession) {
        throw new Error('Failed to load exam data');
      }

      const scheduleEntity = mapBackendSchedule(staticSession.schedule);
      const version = mapBackendExamVersion(staticSession.version);
      const examState = hydrateExamState({
        ...version.contentSnapshot,
        config: version.configSnapshot,
      } satisfies ExamState);

      setSchedule(scheduleEntity);
      setState(examState);
      const liveSession = await queryClient.fetchQuery({
        queryKey: queryKeys.students.liveSession(scheduleId, candidateId),
        queryFn: () => fetchStudentLiveSession(scheduleId, candidateId),
        staleTime: 0,
      });
      setRuntimeSnapshot(
        liveSession.runtime ? mapBackendRuntime(liveSession.runtime, scheduleEntity) : null,
      );

      if (liveSession.attempt) {
        const nextAttempt = mapBackendStudentAttempt(
          liveSession.attempt as Parameters<typeof mapBackendStudentAttempt>[0],
        );
        const isSubmittedAttempt = Boolean(
          (
            liveSession.attempt as {
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

        const reconciledAttempt = await saveAttemptSnapshotForHydration(nextAttempt);
        if (isSubmittedAttempt) {
          setAttemptSnapshot(reconciledAttempt);
        } else if (!hasAttemptCredential(nextAttempt.scheduleId, nextAttempt.id)) {
          const credentialHydratedAttempt = await studentAttemptRepository.getAttemptByScheduleId(
            scheduleId,
            nextAttempt.studentKey,
          );
          setAttemptSnapshot(credentialHydratedAttempt ?? reconciledAttempt);
        } else {
          setAttemptSnapshot(reconciledAttempt);
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
            (liveSession.runtime
              ? mapBackendRuntime(liveSession.runtime, scheduleEntity).currentSectionKey
              : null) ?? firstEnabledModule,
        });
        setAttemptSnapshot(createdAttempt);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load exam data');
    } finally {
      setIsLoading(false);
    }
  }, [
    authStatus,
    candidateId,
    queryClient,
    refetchStaticSession,
    scheduleId,
    isStaticSessionLoading,
    staticSessionData,
    staticSessionError,
    storedCandidateProfile,
    studentKey,
  ]);

  useEffect(() => {
    void loadStudentData();
  }, [loadStudentData]);

  const pollIntervalMs = runtimeSnapshot?.status === 'live' ? 10_000 : 4_000;
  const pollMaxIntervalMs = runtimeSnapshot?.status === 'live' ? 15_000 : 8_000;

  useAsyncPolling(async () => {
    await refreshBackendSessionSnapshot();
  }, {
    enabled: Boolean(scheduleId && state && !error),
    intervalMs: pollIntervalMs,
    maxIntervalMs: pollMaxIntervalMs,
  });

  return {
    attemptSnapshot,
    error,
    isLoading,
    runtimeSnapshot,
    schedule,
    state,
    refreshRuntime: refreshBackendSessionSnapshot,
    retry: loadStudentData,
  };
}
