import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAsyncPolling } from '@shared/hooks/useAsyncPolling';
import { useLiveUpdates, type LiveUpdateEvent } from '@shared/hooks/useLiveUpdates';
import { useAuthSession } from '../../auth/api/authSession';
import {
  studentSessionFacade,
  type StudentSessionLivePayload,
} from '@student/application/studentSessionFacade';
import type { ExamState } from '../../../types';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import {
  emitStudentObservabilityMetric,
  withStudentObservabilityDimensions,
} from '../../../utils/studentObservability';
import {
  extractLiveSnapshotFreshness,
  mergeLiveSnapshotFreshness,
  type LiveSnapshotFreshness,
} from '../liveSnapshotFreshness';
import { createStudentSessionBootstrap } from '../application/exam-session/studentSessionBootstrap';
import {
  createStudentRealtimeCoordinator,
  type StudentRealtimeCoordinator,
} from '../infrastructure/exam-session/studentRealtimeCoordinator';
import { runStudentSessionMachineCommands } from './studentSessionMachineAdapters';
import { evaluateLiveSnapshotTransition, evaluateLoadTransition } from './studentSessionStateMachine';
import {
  asRecord,
  buildDefaultAnswerInvariantRollout,
  buildLiveMetricEndpoint,
  extractAttemptSyncState,
  LIVE_SESSION_STATUS_CODE,
  parseFiniteNumber,
  parseIsoTimestampMs,
  resolveAnswerInvariantRollout,
  type StudentAnswerInvariantRollout,
} from './studentSessionRouteUtils';
import {
  buildStudentKey,
  createCandidateProfile,
  loadStoredCandidateProfile,
  normalizeCandidateId,
} from './studentCandidateStorage';
import { collectPublishedDiagramSnapshotIssues } from './studentSessionDiagnostics';

export type { StudentAnswerInvariantRollout } from './studentSessionRouteUtils';

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

type BackendLiveSession = StudentSessionLivePayload;

type LoadedStaticSnapshot = {
  examState: ExamState;
  scheduleEntity: ExamSchedule;
  versionId: string;
};

type LiveSnapshotApplyDecision = {
  discardAll: boolean;
  applyAttempt: boolean;
  applyRuntime: boolean;
};

export function useStudentSessionRouteData(
  scheduleId?: string,
  studentId?: string,
): StudentSessionRouteData {
  const { status: authStatus } = useAuthSession();
  const [answerInvariantRollout, setAnswerInvariantRollout] = useState<StudentAnswerInvariantRollout>(
    buildDefaultAnswerInvariantRollout,
  );
  const [attemptSnapshot, setAttemptSnapshot] = useState<StudentAttempt | null>(null);
  const [schedule, setSchedule] = useState<ExamSchedule | null>(null);
  const [state, setState] = useState<ExamState | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ExamSessionRuntime | null>(null);
  const [liveSocketConnected, setLiveSocketConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadTransitionRollout = useMemo(buildDefaultAnswerInvariantRollout, []);
  const candidateId = useMemo(() => normalizeCandidateId(studentId), [studentId]);
  const staticVersionIdRef = useRef<string | null>(null);
  const refreshEpochRef = useRef(0);
  const appliedFreshnessRef = useRef<LiveSnapshotFreshness | null>(null);
  const runtimeSnapshotRef = useRef<ExamSessionRuntime | null>(null);
  const realtimeCoordinatorRef = useRef<StudentRealtimeCoordinator | null>(null);
  const storedCandidateProfile = useMemo(
    () => (scheduleId && candidateId ? loadStoredCandidateProfile(scheduleId, candidateId) : null),
    [candidateId, scheduleId],
  );
  const studentKey = useMemo(
    () => (scheduleId && candidateId ? buildStudentKey(scheduleId, candidateId) : null),
    [candidateId, scheduleId],
  );
  const sessionBootstrap = useMemo(
    () =>
      scheduleId && candidateId
        ? createStudentSessionBootstrap({ scheduleId, candidateId })
        : null,
    [candidateId, scheduleId],
  );
  const realtimeCoordinator = useMemo(() => {
    if (!scheduleId || !candidateId) {
      return null;
    }

    return createStudentRealtimeCoordinator({
      scheduleId,
      candidateId,
      cache: {
        invalidateLiveSession: () => sessionBootstrap?.invalidateLive(),
        updateLiveRuntime: () => undefined,
      },
    });
  }, [candidateId, scheduleId, sessionBootstrap]);
  realtimeCoordinatorRef.current = realtimeCoordinator;

  useEffect(() => {
    runtimeSnapshotRef.current = runtimeSnapshot;
  }, [runtimeSnapshot]);

  const loadStaticSessionSnapshot = useCallback(async (): Promise<LoadedStaticSnapshot | null> => {
    if (!scheduleId || !candidateId) {
      return null;
    }

    const session = await (sessionBootstrap?.loadStatic() ??
      studentSessionFacade.loadStaticSession(scheduleId, candidateId));
    const scheduleEntity = studentSessionFacade.mapSchedule(session.schedule);
    const version = studentSessionFacade.mapVersion(session.version);
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
    const examState = studentSessionFacade.hydrateExamState(
      version.contentSnapshot,
      version.configSnapshot,
    );

    setSchedule(scheduleEntity);
    setState(examState);
    staticVersionIdRef.current = version.id;

    return {
      examState,
      scheduleEntity,
      versionId: version.id,
    };
  }, [candidateId, scheduleId, sessionBootstrap]);

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
    await studentSessionFacade.saveAttempt(nextAttempt);
    const cachedAttempts = await studentSessionFacade.getAttemptsByScheduleId(nextAttempt.scheduleId);
    return cachedAttempts.find((candidate) => candidate.id === nextAttempt.id) ?? nextAttempt;
  }, []);

  const readCachedAttemptForCandidate = useCallback(async () => {
    if (!scheduleId || !candidateId) {
      return null;
    }

    const normalizedCandidateId = normalizeCandidateId(candidateId);
    if (!normalizedCandidateId) {
      return null;
    }
    const cachedAttempts = await studentSessionFacade.getAttemptsByScheduleId(scheduleId);
    const candidates = cachedAttempts.filter(
      (attempt) => normalizeCandidateId(attempt.candidateId) === normalizedCandidateId,
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
      const transition = evaluateLiveSnapshotTransition({
        applyEpoch,
        currentEpoch: refreshEpochRef.current,
        scheduleId: scheduleId ?? null,
        attemptId: live.attempt?.id ?? null,
        syncState: extractAttemptSyncState(live),
        source,
        rollout: resolveAnswerInvariantRollout(live),
        incomingFreshness,
        appliedFreshness: appliedFreshnessRef.current,
      });
      runStudentSessionMachineCommands(transition.commands);
      return transition.decision;
    },
    [scheduleId],
  );

  const applyLoadTransition = useCallback(
    (source: 'load' | 'retry', event: { type: 'requested' } | { type: 'succeeded' } | { type: 'failed'; error: string }) => {
      const transition = evaluateLoadTransition(
        {
          scheduleId: scheduleId ?? null,
          attemptId: null,
          source,
          rollout: loadTransitionRollout,
        },
        event,
      );
      runStudentSessionMachineCommands(transition.commands);
      setIsLoading(transition.decision.isLoading);
      setError(transition.decision.error);
    },
    [loadTransitionRollout, scheduleId],
  );

  const refreshBackendSessionSnapshot = useCallback(async () => {
    if (!scheduleId || !candidateId) {
      return;
    }

    const applyEpoch = ++refreshEpochRef.current;

    let scheduleEntity = schedule;
    if (!scheduleEntity) {
      const loaded = await loadStaticSessionSnapshot();
      scheduleEntity = loaded?.scheduleEntity ?? null;
    }

    let live = await (sessionBootstrap?.loadLive() ??
      studentSessionFacade.loadLiveSession(scheduleId, candidateId));
    const reloadedStatic = await maybeRebootstrapStaticOnVersionMismatch(live);
    if (reloadedStatic) {
      scheduleEntity = reloadedStatic.scheduleEntity;
      live = await (sessionBootstrap?.loadLive() ??
        studentSessionFacade.loadLiveSession(scheduleId, candidateId));
    }

    const incomingFreshness = extractLiveSnapshotFreshness(live);
    const applyDecision = evaluateLiveSnapshotApply(incomingFreshness, applyEpoch, live, 'refresh');
    if (applyDecision.discardAll) {
      return;
    }

    const mappedRuntime =
      applyDecision.applyRuntime && live.runtime && scheduleEntity
        ? studentSessionFacade.mapRuntime(live.runtime, scheduleEntity)
        : null;
    const previousRuntimeSnapshot = runtimeSnapshotRef.current;
    const nextRuntimeSnapshot = applyDecision.applyRuntime
      ? mappedRuntime ?? previousRuntimeSnapshot
      : previousRuntimeSnapshot;
    const rollout = resolveAnswerInvariantRollout(live);
    let reconciledAttempt: StudentAttempt | null = null;

    if (live.attempt && applyDecision.applyAttempt) {
      const nextAttempt = studentSessionFacade.mapAttempt(live.attempt);
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
    if (applyDecision.applyRuntime && nextRuntimeSnapshot !== previousRuntimeSnapshot) {
      runtimeSnapshotRef.current = nextRuntimeSnapshot;
      setRuntimeSnapshot(nextRuntimeSnapshot);
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
    sessionBootstrap,
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

      realtimeCoordinatorRef.current?.handleEvent(event);
      void refreshBackendSessionSnapshot();
    },
    [attemptSnapshot?.id, refreshBackendSessionSnapshot, scheduleId],
  );

  const handleRuntimeSnapshot = useCallback(
    (payload: { scheduleId?: string; runtime: unknown }) => {
      if (!scheduleId || !schedule) {
        return;
      }
      if (payload.scheduleId && payload.scheduleId !== scheduleId) {
        return;
      }

      const runtimeRecord = asRecord(payload.runtime) ?? {};
      const realtimeResult = realtimeCoordinatorRef.current?.handleRuntimeSnapshot({
        runtime: payload.runtime,
        revision: parseFiniteNumber(runtimeRecord['revision']),
        ...(payload.scheduleId ? { scheduleId: payload.scheduleId } : {}),
      });
      if (realtimeResult === 'ignored') {
        return;
      }

      try {
        const mappedRuntime = studentSessionFacade.mapRuntime(payload.runtime, schedule);
        runtimeSnapshotRef.current = mappedRuntime;
        setRuntimeSnapshot(mappedRuntime);

        const runtimeFreshness: LiveSnapshotFreshness = {
          attempt: {
            revision: appliedFreshnessRef.current?.attempt.revision ?? null,
            updatedAtMs: appliedFreshnessRef.current?.attempt.updatedAtMs ?? null,
          },
          runtime: {
            revision: parseFiniteNumber(runtimeRecord['revision']),
            updatedAtMs: parseIsoTimestampMs(runtimeRecord['updatedAt']),
          },
        };
        appliedFreshnessRef.current = mergeLiveSnapshotFreshness(
          appliedFreshnessRef.current,
          runtimeFreshness,
          {
            applyAttempt: false,
            applyRuntime: true,
          },
        );
      } catch {
        // Ignore malformed snapshots and continue with pull-based refresh.
      }
    },
    [schedule, scheduleId],
  );

  useLiveUpdates({
    ...(scheduleId ? { scheduleId } : {}),
    ...(attemptSnapshot?.id ? { attemptId: attemptSnapshot.id } : {}),
    ...(Number.isInteger(runtimeSnapshot?.revision)
      ? { lastSeenRuntimeRevision: runtimeSnapshot?.revision as number }
      : {}),
    enabled: Boolean(
      scheduleId &&
        candidateId &&
        authStatus === 'authenticated' &&
        !error,
    ),
    debounceMs: 0,
    onConnected: () => {
      setLiveSocketConnected(true);
      realtimeCoordinatorRef.current?.handleSocketConnected();
      if (state) {
        void refreshBackendSessionSnapshot();
      }
    },
    onDisconnected: () => {
      setLiveSocketConnected(false);
      realtimeCoordinatorRef.current?.handleSocketDisconnected();
    },
    onRuntimeSnapshot: handleRuntimeSnapshot,
    onEvent: handleLiveUpdate,
  });

  useEffect(() => {
    if (
      !scheduleId ||
      !candidateId ||
      authStatus !== 'authenticated' ||
      Boolean(error)
    ) {
      setLiveSocketConnected(false);
    }
  }, [authStatus, candidateId, error, scheduleId]);

  const loadStudentData = useCallback(async (source: 'load' | 'retry' = 'load') => {
    if (!scheduleId) {
      applyLoadTransition(source, { type: 'failed', error: 'Schedule ID not found' });
      return;
    }

    if (authStatus === 'loading') {
      return;
    }

      applyLoadTransition(source, { type: 'requested' });

      try {
        if (!candidateId) {
        throw new Error('Invalid wcode. Please check in again.');
        }

      if (!studentKey) {
        throw new Error('Student identity not found');
      }

      const staticSnapshot = await loadStaticSessionSnapshot();
      if (!staticSnapshot) {
        throw new Error('Failed to load static session snapshot');
      }
      let loadedStatic: LoadedStaticSnapshot = staticSnapshot;

      let live = await (sessionBootstrap?.loadLive() ??
        studentSessionFacade.loadLiveSession(scheduleId, candidateId));
      const reloadedStatic = await maybeRebootstrapStaticOnVersionMismatch(live);
      if (reloadedStatic) {
        loadedStatic = reloadedStatic;
        live = await (sessionBootstrap?.loadLive() ??
          studentSessionFacade.loadLiveSession(scheduleId, candidateId));
      }

      const applyEpoch = ++refreshEpochRef.current;
      const incomingFreshness = extractLiveSnapshotFreshness(live);
      const applyDecision = evaluateLiveSnapshotApply(incomingFreshness, applyEpoch, live, 'load');
      if (applyDecision.discardAll) {
        applyLoadTransition(source, { type: 'succeeded' });
        return;
      }

      const rollout = resolveAnswerInvariantRollout(live);
      setAnswerInvariantRollout(rollout);
      const mappedRuntime = applyDecision.applyRuntime && live.runtime
        ? studentSessionFacade.mapRuntime(live.runtime, loadedStatic.scheduleEntity)
        : null;
      const previousRuntimeSnapshot = runtimeSnapshotRef.current;
      const nextRuntimeSnapshot = applyDecision.applyRuntime
        ? mappedRuntime ?? previousRuntimeSnapshot
        : previousRuntimeSnapshot;
      if (applyDecision.applyRuntime && nextRuntimeSnapshot !== previousRuntimeSnapshot) {
        runtimeSnapshotRef.current = nextRuntimeSnapshot;
        setRuntimeSnapshot(nextRuntimeSnapshot);
      }

      if (live.attempt && applyDecision.applyAttempt) {
        const nextAttempt = studentSessionFacade.mapAttempt(live.attempt);
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
          applyLoadTransition(source, { type: 'succeeded' });
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
          applyLoadTransition(source, { type: 'succeeded' });
          return;
        }

        const firstEnabledModule =
          (['listening', 'reading', 'writing', 'speaking'] as const).find(
            (module) => loadedStatic.examState.config.sections[module].enabled,
          ) ?? 'listening';

        const createdAttempt = await studentSessionFacade.createAttempt({
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
      applyLoadTransition(source, { type: 'succeeded' });
    } catch (loadError) {
      applyLoadTransition(source, {
        type: 'failed',
        error: loadError instanceof Error ? loadError.message : 'Failed to load exam data',
      });
    }
  }, [
    applyLoadTransition,
    authStatus,
    candidateId,
    evaluateLiveSnapshotApply,
    loadStaticSessionSnapshot,
    maybeRebootstrapStaticOnVersionMismatch,
    readCachedAttemptForCandidate,
    scheduleId,
    saveAndReadReconciledAttempt,
    sessionBootstrap,
    storedCandidateProfile,
    studentKey,
  ]);

  useEffect(() => {
    void loadStudentData('load');
  }, [loadStudentData]);

  const pollingPolicy = realtimeCoordinator?.getPollingPolicy(runtimeSnapshot?.status ?? null) ?? {
    intervalMs: runtimeSnapshot?.status === 'live' && liveSocketConnected ? 20_000 : 15_000,
    maxIntervalMs: runtimeSnapshot?.status === 'live' && liveSocketConnected ? 30_000 : 25_000,
  };

  useAsyncPolling(
    async () => {
      await refreshBackendSessionSnapshot();
    },
    {
      enabled: Boolean(scheduleId && state && !error),
      intervalMs: pollingPolicy.intervalMs,
      maxIntervalMs: pollingPolicy.maxIntervalMs,
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
    retry: () => loadStudentData('retry'),
  };
}
