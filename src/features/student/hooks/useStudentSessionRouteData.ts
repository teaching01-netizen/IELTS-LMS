import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAsyncPolling } from '@app/hooks/useAsyncPolling';
import { useLiveUpdates, type LiveUpdateEvent } from '@app/hooks/useLiveUpdates';
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

type DiagramSnapshotIssue = {
  blockId: string;
  section: 'reading' | 'listening';
  containerId: string;
  hasImageSrc: boolean;
  hasAssetUrl: boolean;
  hasUsableFallback: boolean;
};

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function collectPublishedDiagramSnapshotIssues(contentSnapshot: unknown): {
  totalDiagramBlocks: number;
  missingImageUrlCount: number;
  missingUsableImageCount: number;
  missingBlocks: DiagramSnapshotIssue[];
} {
  const snapshot = contentSnapshot as {
    reading?: {
      passages?: Array<{ id?: unknown; blocks?: unknown }>;
    };
    listening?: {
      parts?: Array<{ id?: unknown; blocks?: unknown }>;
    };
  };

  const missingBlocks: DiagramSnapshotIssue[] = [];
  let totalDiagramBlocks = 0;
  let missingImageUrlCount = 0;
  let missingUsableImageCount = 0;

  const collectFromBlocks = (
    section: DiagramSnapshotIssue['section'],
    containerId: string,
    blocks: unknown,
  ) => {
    if (!Array.isArray(blocks)) {
      return;
    }

    blocks.forEach((block) => {
      if (!block || typeof block !== 'object') {
        return;
      }

      const blockRecord = block as Record<string, unknown>;
      if (blockRecord['type'] !== 'DIAGRAM_LABELING') {
        return;
      }

      totalDiagramBlocks += 1;

      const imageUrl = readNonEmptyString(blockRecord['imageUrl']);
      if (imageUrl) {
        return;
      }

      const imageSrc = readNonEmptyString(blockRecord['imageSrc']);
      const assetUrl = readNonEmptyString(blockRecord['assetUrl']);
      const hasUsableFallback = Boolean(imageSrc || assetUrl);
      if (!hasUsableFallback) {
        missingUsableImageCount += 1;
      }

      missingImageUrlCount += 1;
      missingBlocks.push({
        blockId: readNonEmptyString(blockRecord['id']) ?? '(unknown-block-id)',
        section,
        containerId,
        hasImageSrc: Boolean(imageSrc),
        hasAssetUrl: Boolean(assetUrl),
        hasUsableFallback,
      });
    });
  };

  if (Array.isArray(snapshot.reading?.passages)) {
    snapshot.reading?.passages.forEach((passage, index) => {
      const passageId =
        readNonEmptyString(passage?.id) ?? `reading-passage-${index + 1}`;
      collectFromBlocks('reading', passageId, passage?.blocks);
    });
  }

  if (Array.isArray(snapshot.listening?.parts)) {
    snapshot.listening?.parts.forEach((part, index) => {
      const partId = readNonEmptyString(part?.id) ?? `listening-part-${index + 1}`;
      collectFromBlocks('listening', partId, part?.blocks);
    });
  }

  return {
    totalDiagramBlocks,
    missingImageUrlCount,
    missingUsableImageCount,
    missingBlocks,
  };
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

      const session = await backendGet<{
        schedule: Parameters<typeof mapBackendSchedule>[0];
        version: Parameters<typeof mapBackendExamVersion>[0];
        runtime?: Parameters<typeof mapBackendRuntime>[0] | null | undefined;
        attempt?: Parameters<typeof mapBackendStudentAttempt>[0] | null | undefined;
      }>(buildBackendSessionEndpoint(scheduleId, candidateId));
      const scheduleEntity = mapBackendSchedule(session.schedule);
      const version = mapBackendExamVersion(session.version);
      const diagramSnapshotDiagnostics = collectPublishedDiagramSnapshotIssues(version.contentSnapshot);
      if (diagramSnapshotDiagnostics.missingImageUrlCount > 0) {
        console.warn('[student-session] published version has DIAGRAM_LABELING blocks without imageUrl', {
          routeScheduleId: scheduleId,
          scheduleId: scheduleEntity.id,
          publishedVersionId: scheduleEntity.publishedVersionId,
          loadedVersionId: version.id,
          totalDiagramBlocks: diagramSnapshotDiagnostics.totalDiagramBlocks,
          missingImageUrlCount: diagramSnapshotDiagnostics.missingImageUrlCount,
          missingUsableImageCount: diagramSnapshotDiagnostics.missingUsableImageCount,
          missingBlocks: diagramSnapshotDiagnostics.missingBlocks,
        });
      }
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
