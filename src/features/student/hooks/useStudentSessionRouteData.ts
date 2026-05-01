import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  mapBackendStudentAttempt,
  studentAttemptRepository,
} from '@services/studentAttemptRepository';
import type { ExamState } from '../../../types';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import {
  emitStudentObservabilityMetric,
  withStudentObservabilityDimensions,
} from '../../../utils/studentObservability';

const PROFILE_STORAGE_PREFIX = 'ielts-student-profile:';
const LIVE_SESSION_STATUS_CODE = 200;
const ANSWER_INVARIANT_ENV_ENABLED = 'VITE_FEATURE_STUDENT_LOCAL_WRITER_ANSWER_INVARIANT_ENABLED';
const ANSWER_INVARIANT_ENV_KILL_SWITCH = 'VITE_FEATURE_STUDENT_LOCAL_WRITER_ANSWER_INVARIANT_KILL_SWITCH';

export interface StudentAnswerInvariantRollout {
  enabled: boolean;
  killSwitch: boolean;
  cohort: string | null;
  configFingerprint: string | null;
  source: 'default' | 'runtime';
}

function getEnvBoolean(name: string): boolean | null {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const value = env[name];
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return null;
}

function buildDefaultAnswerInvariantRollout(): StudentAnswerInvariantRollout {
  return {
    enabled: getEnvBoolean(ANSWER_INVARIANT_ENV_ENABLED) ?? true,
    killSwitch: getEnvBoolean(ANSWER_INVARIANT_ENV_KILL_SWITCH) ?? false,
    cohort: null,
    configFingerprint: null,
    source: 'default',
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseNullableBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
}

function parseNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

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

function buildBackendStaticSessionEndpoint(scheduleId: string, candidateId: string) {
  const query = new URLSearchParams({ candidateId });
  return `/v1/student/sessions/${scheduleId}/static?${query.toString()}`;
}

function buildBackendLiveSessionEndpoint(scheduleId: string, candidateId: string) {
  const query = new URLSearchParams({ candidateId });
  return `/v1/student/sessions/${scheduleId}/live?${query.toString()}`;
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
  answerInvariantRollout: StudentAnswerInvariantRollout;
  attemptSnapshot: StudentAttempt | null;
  error: string | null;
  isLoading: boolean;
  runtimeSnapshot: ExamSessionRuntime | null;
  schedule: ExamSchedule | null;
  state: ExamState | null;
  refreshRuntime: () => Promise<void>;
  retry: () => Promise<void>;
}

type BackendStaticSession = {
  schedule: Parameters<typeof mapBackendSchedule>[0];
  version: Parameters<typeof mapBackendExamVersion>[0];
};

type BackendLiveSession = {
  runtime?: Parameters<typeof mapBackendRuntime>[0] | null | undefined;
  attempt?: Parameters<typeof mapBackendStudentAttempt>[0] | null | undefined;
  publishedVersionId?: string | null | undefined;
  rollout?: unknown;
};

interface LoadedStaticSnapshot {
  examState: ExamState;
  scheduleEntity: ExamSchedule;
  versionId: string;
}

interface SnapshotFreshnessDimension {
  revision: number | null;
  updatedAtMs: number | null;
}

interface LiveSnapshotFreshness {
  attempt: SnapshotFreshnessDimension;
  runtime: SnapshotFreshnessDimension;
}

interface LiveSnapshotApplyDecision {
  discardAll: boolean;
  applyAttempt: boolean;
  applyRuntime: boolean;
}

function buildLiveMetricEndpoint(scheduleId: string) {
  return `/v1/student/sessions/${scheduleId}/live`;
}

function extractAttemptSyncState(live: BackendLiveSession): string | null {
  const attempt = asRecord(live.attempt);
  const recovery = asRecord(attempt?.recovery);
  return parseNullableString(recovery?.syncState);
}

function resolveAnswerInvariantRollout(live: BackendLiveSession): StudentAnswerInvariantRollout {
  const defaultRollout = buildDefaultAnswerInvariantRollout();
  const rolloutRoot = asRecord(live.rollout);
  if (!rolloutRoot) {
    return defaultRollout;
  }

  const nested = asRecord(rolloutRoot.localWriterAnswerInvariant);
  const enabled = parseNullableBoolean(
    nested?.enabled ?? rolloutRoot.localWriterAnswerInvariantEnabled ?? rolloutRoot.enabled,
  );
  const killSwitch = parseNullableBoolean(
    nested?.killSwitch ??
      rolloutRoot.localWriterAnswerInvariantKillSwitch ??
      rolloutRoot.killSwitch,
  );
  const cohort = parseNullableString(
    nested?.cohort ?? rolloutRoot.localWriterAnswerInvariantCohort ?? rolloutRoot.cohort,
  );
  const configFingerprint = parseNullableString(
    nested?.configFingerprint ??
      rolloutRoot.localWriterAnswerInvariantConfigFingerprint ??
      rolloutRoot.configFingerprint,
  );

  const hasRuntimeOverride =
    enabled !== null || killSwitch !== null || cohort !== null || configFingerprint !== null;
  if (!hasRuntimeOverride) {
    return defaultRollout;
  }

  return {
    enabled: enabled ?? defaultRollout.enabled,
    killSwitch: killSwitch ?? defaultRollout.killSwitch,
    cohort,
    configFingerprint,
    source: 'runtime',
  };
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseIsoTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractLiveSnapshotFreshness(live: BackendLiveSession): LiveSnapshotFreshness {
  return {
    attempt: {
      revision: parseFiniteNumber(live.attempt?.revision),
      updatedAtMs: parseIsoTimestampMs(live.attempt?.updatedAt),
    },
    runtime: {
      revision: parseFiniteNumber(live.runtime?.revision),
      updatedAtMs: parseIsoTimestampMs(live.runtime?.updatedAt),
    },
  };
}

function hasFreshnessValue(value: SnapshotFreshnessDimension): boolean {
  return value.revision !== null || value.updatedAtMs !== null;
}

function compareFreshnessDimension(
  nextValue: SnapshotFreshnessDimension,
  currentValue: SnapshotFreshnessDimension,
): number {
  if (!hasFreshnessValue(nextValue)) {
    return 0;
  }

  if (!hasFreshnessValue(currentValue)) {
    return 1;
  }

  const nextHasRevision = nextValue.revision !== null;
  const currentHasRevision = currentValue.revision !== null;
  if (nextHasRevision || currentHasRevision) {
    if (nextHasRevision && !currentHasRevision) {
      return 1;
    }
    if (!nextHasRevision && currentHasRevision) {
      return -1;
    }
    if (nextValue.revision !== null && currentValue.revision !== null) {
      if (nextValue.revision > currentValue.revision) {
        return 1;
      }
      if (nextValue.revision < currentValue.revision) {
        return -1;
      }
    }
  }

  if (nextValue.updatedAtMs !== null && currentValue.updatedAtMs !== null) {
    if (nextValue.updatedAtMs > currentValue.updatedAtMs) {
      return 1;
    }
    if (nextValue.updatedAtMs < currentValue.updatedAtMs) {
      return -1;
    }
  }

  return 0;
}

function mergeLiveSnapshotFreshness(
  current: LiveSnapshotFreshness | null,
  incoming: LiveSnapshotFreshness,
  options?: { applyAttempt?: boolean; applyRuntime?: boolean },
): LiveSnapshotFreshness {
  const applyAttempt = options?.applyAttempt ?? true;
  const applyRuntime = options?.applyRuntime ?? true;
  return {
    attempt: {
      revision: applyAttempt
        ? incoming.attempt.revision ?? current?.attempt.revision ?? null
        : current?.attempt.revision ?? null,
      updatedAtMs: applyAttempt
        ? incoming.attempt.updatedAtMs ?? current?.attempt.updatedAtMs ?? null
        : current?.attempt.updatedAtMs ?? null,
    },
    runtime: {
      revision: applyRuntime
        ? incoming.runtime.revision ?? current?.runtime.revision ?? null
        : current?.runtime.revision ?? null,
      updatedAtMs: applyRuntime
        ? incoming.runtime.updatedAtMs ?? current?.runtime.updatedAtMs ?? null
        : current?.runtime.updatedAtMs ?? null,
    },
  };
}

export function useStudentSessionRouteData(
  scheduleId?: string,
  studentId?: string,
): StudentSessionRouteData {
  const { session, status: authStatus } = useAuthSession();
  const [answerInvariantRollout, setAnswerInvariantRollout] = useState<StudentAnswerInvariantRollout>(
    buildDefaultAnswerInvariantRollout,
  );
  const [attemptSnapshot, setAttemptSnapshot] = useState<StudentAttempt | null>(null);
  const [schedule, setSchedule] = useState<ExamSchedule | null>(null);
  const [state, setState] = useState<ExamState | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ExamSessionRuntime | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const candidateId = useMemo(() => normalizeWcodeCandidateId(studentId), [studentId]);
  const staticVersionIdRef = useRef<string | null>(null);
  const refreshEpochRef = useRef(0);
  const appliedFreshnessRef = useRef<LiveSnapshotFreshness | null>(null);
  const storedCandidateProfile = useMemo(
    () => (scheduleId && candidateId ? loadStoredCandidateProfile(scheduleId, candidateId) : null),
    [candidateId, scheduleId],
  );
  const studentKey = useMemo(
    () => (scheduleId && candidateId ? buildStudentKey(scheduleId, candidateId) : null),
    [candidateId, scheduleId],
  );

  const loadStaticSessionSnapshot = useCallback(async (): Promise<LoadedStaticSnapshot | null> => {
    if (!scheduleId || !candidateId || !isWcodeCandidateId(candidateId)) {
      return null;
    }

    const session = await backendGet<BackendStaticSession>(
      buildBackendStaticSessionEndpoint(scheduleId, candidateId),
    );
    const scheduleEntity = mapBackendSchedule(session.schedule);
    const version = mapBackendExamVersion(session.version);
    const examState = hydrateExamState({
      ...version.contentSnapshot,
      config: version.configSnapshot,
    } satisfies ExamState);

    setSchedule(scheduleEntity);
    setState(examState);
    staticVersionIdRef.current = version.id;

    return {
      examState,
      scheduleEntity,
      versionId: version.id,
    };
  }, [candidateId, scheduleId]);

  const maybeRebootstrapStaticOnVersionMismatch = useCallback(
    async (live: BackendLiveSession): Promise<LoadedStaticSnapshot | null> => {
      const expectedVersionId = staticVersionIdRef.current;
      if (!expectedVersionId || !live.publishedVersionId || live.publishedVersionId === expectedVersionId) {
        return null;
      }

      return loadStaticSessionSnapshot();
    },
    [loadStaticSessionSnapshot],
  );

  const saveAndReadReconciledAttempt = useCallback(async (nextAttempt: StudentAttempt) => {
    await studentAttemptRepository.saveAttempt(nextAttempt);
    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId(nextAttempt.scheduleId);
    return cachedAttempts.find((candidate) => candidate.id === nextAttempt.id) ?? nextAttempt;
  }, []);

  const readCachedAttemptForCandidate = useCallback(async () => {
    if (!scheduleId || !candidateId) {
      return null;
    }

    const normalizedCandidateId = candidateId.trim().toUpperCase();
    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId(scheduleId);
    const candidates = cachedAttempts.filter(
      (attempt) => attempt.candidateId.trim().toUpperCase() === normalizedCandidateId,
    );

    if (candidates.length === 0) {
      return null;
    }

    return candidates.reduce((latest, current) => {
      const latestTs = Date.parse(latest.updatedAt);
      const currentTs = Date.parse(current.updatedAt);
      if (!Number.isFinite(latestTs) && Number.isFinite(currentTs)) {
        return current;
      }
      if (Number.isFinite(latestTs) && Number.isFinite(currentTs) && currentTs > latestTs) {
        return current;
      }
      return latest;
    });
  }, [candidateId, scheduleId]);

  const evaluateLiveSnapshotApply = useCallback(
    (
      incomingFreshness: LiveSnapshotFreshness,
      applyEpoch: number,
      live: BackendLiveSession,
      source: 'refresh' | 'load',
    ): LiveSnapshotApplyDecision => {
      const rollout = resolveAnswerInvariantRollout(live);
      const rolloutEnabled = rollout.enabled && !rollout.killSwitch;
      if (applyEpoch !== refreshEpochRef.current) {
        emitStudentObservabilityMetric(
          'student_refresh_stale_discard_total',
          withStudentObservabilityDimensions({
            scheduleId: scheduleId ?? null,
            attemptId: live.attempt?.id ?? null,
            endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
            statusCode: LIVE_SESSION_STATUS_CODE,
            reason: 'epoch_superseded',
            syncState: extractAttemptSyncState(live),
            source,
            rolloutCohort: rollout.cohort,
            answerInvariantEnabled: rolloutEnabled,
            answerInvariantSource: rollout.source,
          }),
        );
        return {
          discardAll: true,
          applyAttempt: false,
          applyRuntime: false,
        };
      }

      const appliedFreshness = appliedFreshnessRef.current;
      if (!appliedFreshness) {
        return {
          discardAll: false,
          applyAttempt: true,
          applyRuntime: true,
        };
      }

      const attemptOrder = compareFreshnessDimension(incomingFreshness.attempt, appliedFreshness.attempt);
      const runtimeOrder = compareFreshnessDimension(incomingFreshness.runtime, appliedFreshness.runtime);
      if (runtimeOrder < 0) {
        emitStudentObservabilityMetric(
          'student_runtime_revision_regression_total',
          withStudentObservabilityDimensions({
            scheduleId: scheduleId ?? null,
            attemptId: live.attempt?.id ?? null,
            endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
            statusCode: LIVE_SESSION_STATUS_CODE,
            reason: 'runtime_regressed',
            syncState: extractAttemptSyncState(live),
            source,
            rolloutCohort: rollout.cohort,
            answerInvariantEnabled: rolloutEnabled,
            answerInvariantSource: rollout.source,
          }),
        );
      }
      if (attemptOrder < 0 && runtimeOrder < 0) {
        const reason =
          attemptOrder < 0 && runtimeOrder < 0
            ? 'attempt_and_runtime_regressed'
            : attemptOrder < 0
              ? 'attempt_regressed'
              : 'runtime_regressed';
        emitStudentObservabilityMetric(
          'student_refresh_stale_discard_total',
          withStudentObservabilityDimensions({
            scheduleId: scheduleId ?? null,
            attemptId: live.attempt?.id ?? null,
            endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
            statusCode: LIVE_SESSION_STATUS_CODE,
            reason,
            syncState: extractAttemptSyncState(live),
            source,
            rolloutCohort: rollout.cohort,
            answerInvariantEnabled: rolloutEnabled,
            answerInvariantSource: rollout.source,
          }),
        );
        return {
          discardAll: true,
          applyAttempt: false,
          applyRuntime: false,
        };
      }

      if (attemptOrder < 0 || runtimeOrder < 0) {
        const reason = attemptOrder < 0 ? 'attempt_regressed' : 'runtime_regressed';
        emitStudentObservabilityMetric(
          'student_refresh_stale_discard_total',
          withStudentObservabilityDimensions({
            scheduleId: scheduleId ?? null,
            attemptId: live.attempt?.id ?? null,
            endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
            statusCode: LIVE_SESSION_STATUS_CODE,
            reason,
            syncState: extractAttemptSyncState(live),
            source,
            rolloutCohort: rollout.cohort,
            answerInvariantEnabled: rolloutEnabled,
            answerInvariantSource: rollout.source,
          }),
        );
      }

      return {
        discardAll: false,
        applyAttempt: attemptOrder >= 0,
        applyRuntime: runtimeOrder >= 0,
      };
    },
    [scheduleId],
  );

  const refreshBackendSessionSnapshot = useCallback(async () => {
    if (!scheduleId || !candidateId || !isWcodeCandidateId(candidateId)) {
      return;
    }

    const applyEpoch = ++refreshEpochRef.current;

    let scheduleEntity = schedule;
    if (!scheduleEntity) {
      const loaded = await loadStaticSessionSnapshot();
      scheduleEntity = loaded?.scheduleEntity ?? null;
    }

    let live = await backendGet<BackendLiveSession>(buildBackendLiveSessionEndpoint(scheduleId, candidateId));
    const reloadedStatic = await maybeRebootstrapStaticOnVersionMismatch(live);
    if (reloadedStatic) {
      scheduleEntity = reloadedStatic.scheduleEntity;
      live = await backendGet<BackendLiveSession>(buildBackendLiveSessionEndpoint(scheduleId, candidateId));
    }

    const incomingFreshness = extractLiveSnapshotFreshness(live);
    const applyDecision = evaluateLiveSnapshotApply(incomingFreshness, applyEpoch, live, 'refresh');
    if (applyDecision.discardAll) {
      return;
    }

    const mappedRuntime =
      applyDecision.applyRuntime && live.runtime && scheduleEntity
        ? mapBackendRuntime(live.runtime, scheduleEntity)
        : null;
    const rollout = resolveAnswerInvariantRollout(live);
    let reconciledAttempt: StudentAttempt | null = null;

    if (live.attempt && applyDecision.applyAttempt) {
      const nextAttempt = mapBackendStudentAttempt(live.attempt);
      reconciledAttempt = await saveAndReadReconciledAttempt(nextAttempt);
    }

    if (applyEpoch !== refreshEpochRef.current) {
      emitStudentObservabilityMetric(
        'student_refresh_stale_discard_total',
        withStudentObservabilityDimensions({
          scheduleId: scheduleId ?? null,
          attemptId: live.attempt?.id ?? null,
          endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
          statusCode: LIVE_SESSION_STATUS_CODE,
          reason: 'epoch_superseded_after_reconcile',
          syncState: extractAttemptSyncState(live),
          source: 'refresh',
          rolloutCohort: rollout.cohort,
          answerInvariantEnabled: rollout.enabled && !rollout.killSwitch,
          answerInvariantSource: rollout.source,
        }),
      );
      return;
    }

    setAnswerInvariantRollout(rollout);
    if (applyDecision.applyRuntime) {
      setRuntimeSnapshot(mappedRuntime);
    }
    if (reconciledAttempt) {
      setAttemptSnapshot(reconciledAttempt);
    }
    appliedFreshnessRef.current = mergeLiveSnapshotFreshness(appliedFreshnessRef.current, incomingFreshness, {
      applyAttempt: applyDecision.applyAttempt,
      applyRuntime: applyDecision.applyRuntime,
    });
  }, [
    candidateId,
    evaluateLiveSnapshotApply,
    loadStaticSessionSnapshot,
    maybeRebootstrapStaticOnVersionMismatch,
    schedule,
    scheduleId,
    saveAndReadReconciledAttempt,
  ]);

  const handleLiveUpdate = useCallback(
    (event: LiveUpdateEvent) => {
      if (!scheduleId) {
        return;
      }

      if (event.kind === 'schedule_runtime') {
        if (event.id !== scheduleId) {
          return;
        }
      } else if (event.kind === 'attempt') {
        if (!attemptSnapshot?.id || event.id !== attemptSnapshot.id) {
          return;
        }
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

      let loadedStatic = await loadStaticSessionSnapshot();
      if (!loadedStatic) {
        throw new Error('Unable to load static exam session context');
      }

      let live = await backendGet<BackendLiveSession>(buildBackendLiveSessionEndpoint(scheduleId, candidateId));
      const reloadedStatic = await maybeRebootstrapStaticOnVersionMismatch(live);
      if (reloadedStatic) {
        loadedStatic = reloadedStatic;
        live = await backendGet<BackendLiveSession>(buildBackendLiveSessionEndpoint(scheduleId, candidateId));
      }

      const applyEpoch = ++refreshEpochRef.current;
      const incomingFreshness = extractLiveSnapshotFreshness(live);
      const applyDecision = evaluateLiveSnapshotApply(incomingFreshness, applyEpoch, live, 'load');
      if (applyDecision.discardAll) {
        return;
      }

      const rollout = resolveAnswerInvariantRollout(live);
      setAnswerInvariantRollout(rollout);
      const mappedRuntime = applyDecision.applyRuntime && live.runtime
        ? mapBackendRuntime(live.runtime, loadedStatic.scheduleEntity)
        : null;
      if (applyDecision.applyRuntime) {
        setRuntimeSnapshot(mappedRuntime);
      }

      if (live.attempt && applyDecision.applyAttempt) {
        const nextAttempt = mapBackendStudentAttempt(live.attempt);
        const reconciledAttempt = await saveAndReadReconciledAttempt(nextAttempt);
        if (applyEpoch !== refreshEpochRef.current) {
          emitStudentObservabilityMetric(
            'student_refresh_stale_discard_total',
            withStudentObservabilityDimensions({
              scheduleId: scheduleId ?? null,
              attemptId: live.attempt.id,
              endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
              statusCode: LIVE_SESSION_STATUS_CODE,
              reason: 'epoch_superseded_after_reconcile',
              syncState: extractAttemptSyncState(live),
              source: 'load',
              rolloutCohort: rollout.cohort,
              answerInvariantEnabled: rollout.enabled && !rollout.killSwitch,
              answerInvariantSource: rollout.source,
            }),
          );
          return;
        }
        setAttemptSnapshot(reconciledAttempt);
      } else if (!live.attempt) {
        const cachedAttempt = await readCachedAttemptForCandidate();
        if (cachedAttempt) {
          setAttemptSnapshot(cachedAttempt);
          appliedFreshnessRef.current = mergeLiveSnapshotFreshness(
            appliedFreshnessRef.current,
            incomingFreshness,
            {
              applyAttempt: false,
              applyRuntime: applyDecision.applyRuntime,
            },
          );
          return;
        }

        const firstEnabledModule =
          (['listening', 'reading', 'writing', 'speaking'] as const).find(
            (module) => loadedStatic.examState.config.sections[module].enabled,
          ) ?? 'listening';

        const createdAttempt = await studentAttemptRepository.createAttempt({
          scheduleId,
          studentKey,
          examId: loadedStatic.scheduleEntity.examId,
          examTitle: loadedStatic.scheduleEntity.examTitle,
          ...createCandidateProfile(candidateId, storedCandidateProfile),
          currentModule: mappedRuntime?.currentSectionKey ?? firstEnabledModule,
        });
        setAttemptSnapshot(createdAttempt);
      }
      appliedFreshnessRef.current = mergeLiveSnapshotFreshness(appliedFreshnessRef.current, incomingFreshness, {
        applyAttempt: applyDecision.applyAttempt,
        applyRuntime: applyDecision.applyRuntime,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load exam data');
    } finally {
      setIsLoading(false);
    }
  }, [
    authStatus,
    candidateId,
    evaluateLiveSnapshotApply,
    loadStaticSessionSnapshot,
    maybeRebootstrapStaticOnVersionMismatch,
    readCachedAttemptForCandidate,
    scheduleId,
    saveAndReadReconciledAttempt,
    storedCandidateProfile,
    studentKey,
  ]);

  useEffect(() => {
    void loadStudentData();
  }, [loadStudentData]);

  const pollIntervalMs = runtimeSnapshot?.status === 'live' ? 10_000 : 20_000;
  const pollMaxIntervalMs = runtimeSnapshot?.status === 'live' ? 15_000 : 30_000;

  useAsyncPolling(
    async () => {
      await refreshBackendSessionSnapshot();
    },
    {
      enabled: Boolean(scheduleId && state && !error),
      intervalMs: pollIntervalMs,
      maxIntervalMs: pollMaxIntervalMs,
    },
  );

  return {
    answerInvariantRollout,
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
