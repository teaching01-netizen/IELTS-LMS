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

function buildBackendSessionEndpoint(scheduleId: string, candidateId: string) {
  const query = new URLSearchParams({ candidateId });
  return `/v1/student/sessions/${scheduleId}?${query.toString()}`;
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

  const refreshBackendSessionSnapshot = useCallback(async () => {
    if (!scheduleId || !candidateId || !isWcodeCandidateId(candidateId)) {
      return;
    }

    const session = await backendGet<{
      schedule: Parameters<typeof mapBackendSchedule>[0];
      version: Parameters<typeof mapBackendExamVersion>[0];
      runtime?: Parameters<typeof mapBackendRuntime>[0] | null | undefined;
      attempt?: Parameters<typeof mapBackendStudentAttempt>[0] | null | undefined;
    }>(buildBackendSessionEndpoint(scheduleId, candidateId));
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

      const session = await backendGet<{
        schedule: Parameters<typeof mapBackendSchedule>[0];
        version: Parameters<typeof mapBackendExamVersion>[0];
        runtime?: Parameters<typeof mapBackendRuntime>[0] | null | undefined;
        attempt?: Parameters<typeof mapBackendStudentAttempt>[0] | null | undefined;
      }>(buildBackendSessionEndpoint(scheduleId, candidateId));
      const scheduleEntity = mapBackendSchedule(session.schedule);
      const version = mapBackendExamVersion(session.version);
      const examState = hydrateExamState({
        ...version.contentSnapshot,
        config: version.configSnapshot,
      } satisfies ExamState);

      setSchedule(scheduleEntity);
      setState(examState);
      setRuntimeSnapshot(
        session.runtime ? mapBackendRuntime(session.runtime, scheduleEntity) : null,
      );

      if (session.attempt) {
        const nextAttempt = mapBackendStudentAttempt(session.attempt);
        const isSubmittedAttempt = Boolean(
          (
            session.attempt as {
              submittedAt?: string | null | undefined;
            }
          ).submittedAt,
        );
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
            (session.runtime
              ? mapBackendRuntime(session.runtime, scheduleEntity).currentSectionKey
              : null) ?? firstEnabledModule,
        });
        setAttemptSnapshot(createdAttempt);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load exam data');
    } finally {
      setIsLoading(false);
    }
  }, [authStatus, candidateId, scheduleId, storedCandidateProfile, studentKey]);

  useEffect(() => {
    void loadStudentData();
  }, [loadStudentData]);

  const pollIntervalMs = runtimeSnapshot?.status === 'live' ? 4_000 : 2_000;
  const pollMaxIntervalMs = runtimeSnapshot?.status === 'live' ? 8_000 : 6_000;

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
