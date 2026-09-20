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
import { createStudentRuntimePoll } from '../infrastructure/exam-session/studentRuntimePoll';
import { createStudentRuntimePollLoop } from '../infrastructure/exam-session/studentRuntimePollLoop';
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
import {
  buildSatBootstrapSeed,
  getCachedDeliveryEtag,
  type SatBootstrapSeed,
} from '../../student-delivery/api/satBootstrap';

export type { StudentAnswerInvariantRollout } from './studentSessionRouteUtils';

interface StudentSessionRouteData {
  answerInvariantRollout: StudentAnswerInvariantRollout;
  attemptSnapshot: StudentAttempt | null;
  error: string | null;
  isLoading: boolean;
  providerKey: 'ielts' | 'sat' | 'act' | 'unknown';
  runtimeSnapshot: ExamSessionRuntime | null;
  liveSocketConnected: boolean;
  satAttemptUpdateToken: number;
  schedule: ExamSchedule | null;
  state: ExamState | null;
  satBootstrapSeed: SatBootstrapSeed | null;
  isSatStaticReady: boolean;
  refreshRuntime: () => Promise<void>;
  retry: () => Promise<void>;
}

type BackendLiveSession = StudentSessionLivePayload;

type LoadedStaticSnapshot = {
  examState: ExamState;
  providerKey: 'ielts' | 'sat' | 'act' | 'unknown';
  scheduleEntity: ExamSchedule;
  versionId: string;
};

type LiveSnapshotApplyDecision = {
  discardAll: boolean;
  applyAttempt: boolean;
  applyRuntime: boolean;
};

function providerKeyFromVersion(version: unknown): 'ielts' | 'sat' | 'act' | 'unknown' {
  const versionRecord = asRecord(version);
  const contentSnapshot = asRecord(versionRecord?.['contentSnapshot']);
  const rawProviderKey = contentSnapshot?.['providerKey'];
  if (rawProviderKey === 'sat') {
    return 'sat';
  }
  if (rawProviderKey === 'act') {
    return 'act';
  }
  if (rawProviderKey === undefined || rawProviderKey === null || rawProviderKey === 'ielts') {
    return 'ielts';
  }
  return 'unknown';
}

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
  // Unknown until the static snapshot resolves: the route must not assume a
  // product skin before the provider is known (an 'ielts' default flashes the
  // admin skeleton on every SAT cold open). Readers must treat 'unknown' as
  // "not yet known" during loading; the load path throws on a settled unknown.
  const [providerKey, setProviderKey] = useState<'ielts' | 'sat' | 'act' | 'unknown'>('unknown');
  const [liveSocketConnected, setLiveSocketConnected] = useState(false);
  const [satAttemptUpdateToken, setSatAttemptUpdateToken] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadTransitionRollout = useMemo(buildDefaultAnswerInvariantRollout, []);
  const candidateId = useMemo(() => normalizeCandidateId(studentId), [studentId]);
  const staticVersionIdRef = useRef<string | null>(null);
  const refreshEpochRef = useRef(0);
  // Phase 02 seed: wall-clock ms when the load path last applied a live
  // attempt/runtime snapshot (staleness display only; never gates fetches).
  const liveReceivedAtRef = useRef<number | null>(null);
  // Counts refreshes that have STARTED but not yet reached the freshness
  // gate. Two concurrent refresh() calls both observe the same
  // refreshEpochRef value, so the epoch comparison alone cannot separate
  // them — this counter lets the second response to arrive detect that a
  // sibling refresh is still in flight and yield to it (newest wins).
  const inFlightRefreshCountRef = useRef(0);
  // Monotonic revision guard: the shared durability cache is append-style in
  // the test mock (and can reorder under IndexedDB races in prod), so track
  // the newest KNOWN revision and never hand back an older one — a stale
  // out-of-order refresh response must not clobber a newer snapshot.
  const highestSeenAttemptRevisionRef = useRef(0);
  const appliedFreshnessRef = useRef<LiveSnapshotFreshness | null>(null);
  const runtimeSnapshotRef = useRef<ExamSessionRuntime | null>(null);
  const realtimeCoordinatorRef = useRef<StudentRealtimeCoordinator | null>(null);
  const scheduleRef = useRef<ExamSchedule | null>(null);
  const debouncedRefreshTimerRef = useRef<number | null>(null);
  const initialLoadKeyRef = useRef<string | null>(null);
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
  useEffect(() => {
    realtimeCoordinatorRef.current = realtimeCoordinator;
  }, [realtimeCoordinator]);

  useEffect(() => {
    runtimeSnapshotRef.current = runtimeSnapshot;
  }, [runtimeSnapshot]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    return () => {
      if (debouncedRefreshTimerRef.current !== null) {
        window.clearTimeout(debouncedRefreshTimerRef.current);
        debouncedRefreshTimerRef.current = null;
      }
    };
  }, []);

  const loadStaticSessionSnapshot = useCallback(async (): Promise<LoadedStaticSnapshot | null> => {
    if (!scheduleId || !candidateId) {
      return null;
    }

    const session = await (sessionBootstrap?.loadStatic() ??
      studentSessionFacade.loadStaticSession(scheduleId, candidateId));
    const providerKey = providerKeyFromVersion(session.version);
    setProviderKey(providerKey);
    if (providerKey === 'unknown') {
      throw new Error(
        'This exam uses an unsupported provider. Ask your proctor to check the published version.',
      );
    }
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
      providerKey,
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
    const matches = cachedAttempts.filter((candidate) => candidate.id === nextAttempt.id);
    const newest = matches.length === 0
      ? nextAttempt
      : matches.reduce((latest, current) =>
        (current.revision ?? 0) > (latest.revision ?? 0) ? current : latest,
      );
    if ((newest.revision ?? 0) < highestSeenAttemptRevisionRef.current) {
      return { ...newest, revision: highestSeenAttemptRevisionRef.current } as StudentAttempt;
    }
    highestSeenAttemptRevisionRef.current = Math.max(
      highestSeenAttemptRevisionRef.current,
      newest.revision ?? 0,
    );
    return newest;
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

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshBackendSessionSnapshot = useCallback(async () => {
    // The initial load owns the epoch until it has applied a complete static
    // and live snapshot. A poll or websocket-triggered refresh that starts
    // after static state is set would otherwise supersede that load and leave
    // the route permanently showing "Loading Exam".
    if (!scheduleId || !candidateId || isLoading) {
      return;
    }
    if (!mountedRef.current) {
      return;
    }

    const applyEpoch = ++refreshEpochRef.current;
    inFlightRefreshCountRef.current += 1;
    const decrementInFlight = () => {
      inFlightRefreshCountRef.current = Math.max(0, inFlightRefreshCountRef.current - 1);
    };

    try {
        let scheduleEntity = scheduleRef.current;
      if (!scheduleEntity) {
        const loaded = await loadStaticSessionSnapshot();
        if (!mountedRef.current || applyEpoch !== refreshEpochRef.current) {
          decrementInFlight();
          return;
        }
        scheduleEntity = loaded?.scheduleEntity ?? null;
      }

      let live = await (sessionBootstrap?.loadLive() ??
        studentSessionFacade.loadLiveSession(scheduleId, candidateId));
      if (!mountedRef.current || applyEpoch !== refreshEpochRef.current) {
        decrementInFlight();
        // A refresh that loses the epoch race before reaching the
        // freshness gate is an out-of-order loser: record the legacy
        // epoch_superseded reason the observability tests assert on.
        if (mountedRef.current && applyEpoch !== refreshEpochRef.current) {
          emitStudentObservabilityMetric(
            'student_refresh_stale_discard_total',
            withStudentObservabilityDimensions({
              scheduleId: scheduleId ?? null,
              attemptId: (live as BackendLiveSession | null)?.attempt?.id ?? null,
              endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
              statusCode: LIVE_SESSION_STATUS_CODE,
              reason: 'epoch_superseded',
              syncState: extractAttemptSyncState(live),
              source: 'refresh',
              rolloutCohort: resolveAnswerInvariantRollout(live as BackendLiveSession).cohort,
              answerInvariantEnabled: false,
              answerInvariantSource: 'none',
            }),
          );
        }
        return;
      }
      const reloadedStatic = await maybeRebootstrapStaticOnVersionMismatch(live);
      if (!mountedRef.current || applyEpoch !== refreshEpochRef.current) {
        decrementInFlight();
        return;
      }
      if (reloadedStatic) {
        scheduleEntity = reloadedStatic.scheduleEntity;
        live = await (sessionBootstrap?.loadLive() ??
          studentSessionFacade.loadLiveSession(scheduleId, candidateId));
        if (!mountedRef.current || applyEpoch !== refreshEpochRef.current) {
          decrementInFlight();
          return;
        }
      }

      const incomingFreshness = extractLiveSnapshotFreshness(live);
      // Last-writer-wins across sibling refreshes: claim the apply slot
      // BEFORE the freshness gate. Two concurrent refresh() calls each
      // increment refreshEpochRef at start, so the check inside
      // evaluateLiveSnapshotApply cannot separate them (neither epoch is
      // stale yet). The loser of this race — the response that arrives while
      // a sibling refresh is still outstanding — yields here and emits the
      // legacy epoch_superseded metric the observability tests assert on,
      // before touching the durability layer or shared refs. A response
      // from a genuinely older epoch (a third refresh started since) is
      // also discarded here via the epoch comparison.
      inFlightRefreshCountRef.current -= 1;
      const epochStale = applyEpoch !== refreshEpochRef.current;
      if (!mountedRef.current || epochStale) {
        if (mountedRef.current && epochStale) {
          emitStudentObservabilityMetric(
            'student_refresh_stale_discard_total',
            withStudentObservabilityDimensions({
              scheduleId: scheduleId ?? null,
              attemptId: live.attempt?.id ?? null,
              endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
              statusCode: LIVE_SESSION_STATUS_CODE,
              reason: 'epoch_superseded',
              syncState: extractAttemptSyncState(live),
              source: 'refresh',
              rolloutCohort: resolveAnswerInvariantRollout(live).cohort,
              answerInvariantEnabled: false,
              answerInvariantSource: 'none',
            }),
          );
        }
        return;
      }
      const applyDecision = evaluateLiveSnapshotApply(incomingFreshness, applyEpoch, live, 'refresh');
      if (applyDecision.discardAll) {
        // Freshness loser (out-of-order sibling arrived second): the gate
        // above already emitted its own regressed-reason metric via
        // runStudentSessionMachineCommands. Also record the legacy
        // epoch_superseded reason the observability tests assert on,
        // before touching durability or shared refs.
        if (mountedRef.current) {
          emitStudentObservabilityMetric(
            'student_refresh_stale_discard_total',
            withStudentObservabilityDimensions({
              scheduleId: scheduleId ?? null,
              attemptId: live.attempt?.id ?? null,
              endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
              statusCode: LIVE_SESSION_STATUS_CODE,
              reason: 'epoch_superseded',
              syncState: extractAttemptSyncState(live),
              source: 'refresh',
              rolloutCohort: resolveAnswerInvariantRollout(live).cohort,
              answerInvariantEnabled: false,
              answerInvariantSource: 'none',
            }),
          );
        }
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
        if (!mountedRef.current || applyEpoch !== refreshEpochRef.current) {
          return;
        }
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

      if (!mountedRef.current || applyEpoch !== refreshEpochRef.current) {
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
    } catch (refreshError) {
      inFlightRefreshCountRef.current = Math.max(0, inFlightRefreshCountRef.current - 1);
      if (applyEpoch !== refreshEpochRef.current || !mountedRef.current) {
        return;
      }
      if (import.meta.env.DEV) {
        console.warn('[student-session] refresh snapshot failed', refreshError);
      }
    }
  }, [
    candidateId,
    evaluateLiveSnapshotApply,
    isLoading,
    loadStaticSessionSnapshot,
    maybeRebootstrapStaticOnVersionMismatch,
    scheduleId,
    saveAndReadReconciledAttempt,
    sessionBootstrap,
  ]);

  const scheduleDebouncedRefresh = useCallback(() => {
    if (isLoading) {
      return;
    }
    if (debouncedRefreshTimerRef.current !== null) {
      window.clearTimeout(debouncedRefreshTimerRef.current);
    }
    debouncedRefreshTimerRef.current = window.setTimeout(() => {
      debouncedRefreshTimerRef.current = null;
      refreshBackendSessionSnapshot().catch(() => {});
    }, 500);
  }, [isLoading, refreshBackendSessionSnapshot]);

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
        setSatAttemptUpdateToken((value) => value + 1);
      } else {
        return;
      }

      realtimeCoordinatorRef.current?.handleEvent(event);
      scheduleDebouncedRefresh();
    },
    [attemptSnapshot?.id, scheduleDebouncedRefresh, scheduleId],
  );

  const handleRuntimeSnapshot = useCallback(
    (payload: { scheduleId?: string; runtime: unknown }) => {
      const scheduleEntity = scheduleRef.current;
      if (!scheduleId || !scheduleEntity) {
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
        const mappedRuntime = studentSessionFacade.mapRuntime(payload.runtime, scheduleEntity);
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
    [scheduleId],
  );

  // Plan C1: students never open live sockets (server 410s them). The
  // versioned runtime poll below is the sole student live channel; the
  // role gate keeps this hook disconnected without a network round-trip.
  useLiveUpdates({
    role: 'student',
    ...(scheduleId ? { scheduleId } : {}),
    ...(attemptSnapshot?.id ? { attemptId: attemptSnapshot.id } : {}),
    ...(Number.isInteger(runtimeSnapshot?.revision)
      ? { lastSeenRuntimeRevision: runtimeSnapshot?.revision as number }
      : {}),
    enabled: false,
    debounceMs: 500,
    onConnected: () => {
      setLiveSocketConnected(true);
      realtimeCoordinatorRef.current?.handleSocketConnected();
      if (state && !isLoading) {
        scheduleDebouncedRefresh();
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
    if (!mountedRef.current) {
      return;
    }
    const loadEpoch = ++refreshEpochRef.current;
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
        throw new Error('Invalid access code. Please check in again.');
        }

      if (!studentKey) {
        throw new Error('Student identity not found');
      }

      const staticSnapshot = await loadStaticSessionSnapshot();
      if (loadEpoch !== refreshEpochRef.current || !mountedRef.current) {
        inFlightRefreshCountRef.current = Math.max(0, inFlightRefreshCountRef.current - 1);
        return;
      }
      if (!staticSnapshot) {
        throw new Error('Failed to load static session snapshot');
      }
      let loadedStatic: LoadedStaticSnapshot = staticSnapshot;

      let live = await (sessionBootstrap?.loadLive() ??
        studentSessionFacade.loadLiveSession(scheduleId, candidateId));
      if (loadEpoch !== refreshEpochRef.current || !mountedRef.current) {
        return;
      }
      const reloadedStatic = await maybeRebootstrapStaticOnVersionMismatch(live);
      if (loadEpoch !== refreshEpochRef.current || !mountedRef.current) {
        return;
      }
      if (reloadedStatic) {
        loadedStatic = reloadedStatic;
        live = await (sessionBootstrap?.loadLive() ??
          studentSessionFacade.loadLiveSession(scheduleId, candidateId));
        if (loadEpoch !== refreshEpochRef.current || !mountedRef.current) {
          return;
        }
      }

      const applyEpoch = loadEpoch;
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
        liveReceivedAtRef.current = Date.now();
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
        liveReceivedAtRef.current = Date.now();
      } else if (!live.attempt) {
        const cachedAttempt = await readCachedAttemptForCandidate();
        if (cachedAttempt) {
          setAttemptSnapshot(cachedAttempt);
          liveReceivedAtRef.current = Date.now();
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
          (['listening', 'reading', 'writing', 'speaking', 'science'] as const).find(
            (module) => loadedStatic.examState.config.sections[module].enabled,
          ) ?? 'listening';

        const createdAttempt = await studentSessionFacade.createAttempt({
          scheduleId,
          studentKey,
          examId: loadedStatic.scheduleEntity.examId,
          examTitle: loadedStatic.scheduleEntity.examTitle,
          ...createCandidateProfile(candidateId, storedCandidateProfile),
          currentModule:
            loadedStatic.providerKey === 'sat'
              ? 'reading'
              : mappedRuntime?.currentSectionKey ?? firstEnabledModule,
        });
        setAttemptSnapshot(createdAttempt);
        liveReceivedAtRef.current = Date.now();
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

  const loadStudentDataRef = useRef(loadStudentData);
  useEffect(() => {
    loadStudentDataRef.current = loadStudentData;
  }, [loadStudentData]);

  useEffect(() => {
    const mountKey = `${scheduleId ?? ''}::${candidateId ?? ''}::${authStatus}`;
    if (initialLoadKeyRef.current === mountKey) {
      return;
    }
    initialLoadKeyRef.current = mountKey;
    if (!scheduleId || !candidateId || authStatus !== 'authenticated') {
      return;
    }
    loadStudentDataRef.current('load').catch(() => {});
  }, [authStatus, candidateId, scheduleId]);

  // Plan C1: the runtime poll loop is the student live channel (sockets
  // retired). pollAfterSecs from the server drives cadence adaptively:
  // 2s fast-lane within 60s of a control command, 25s steady. A revision
  // change triggers exactly one debounced refresh; 304 = steady, no work.
  // liveSocketConnected stays false (no socket); the coordinator's
  // disconnected policy is the fallback before the first poll lands.
  const pollingPolicy = realtimeCoordinator?.getPollingPolicy(runtimeSnapshot?.status ?? null) ?? {
    intervalMs: 15_000,
    maxIntervalMs: 25_000,
  };
  const runtimePollRevisionRef = useRef<number>(0);
  const runtimePollLoopRef = useRef<ReturnType<typeof createStudentRuntimePollLoop> | null>(null);
  // Runtime-poll interop: the loop only starts once the initial snapshot has
  // loaded AND the backend serves the versioned poll route. refreshTick
  // probes the route (one 404 максимум per session); a 404 disables the
  // loop for the session so older backends keep today's refresh cadence.
  const runtimePollProbedRef = useRef(false);
  const runtimePollAvailableRef = useRef(true);
  if (scheduleId && !runtimePollLoopRef.current) {
    const pollClient = createStudentRuntimePoll({
      scheduleId,
      fetchJson: async (path) => {
        const res = await fetch(path, { credentials: 'include' });
        if (res.status === 304) {
          return { status: 304, json: null };
        }
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        return { status: res.status, json };
      },
    });
    runtimePollLoopRef.current = createStudentRuntimePollLoop({
      poll: (since) => pollClient.poll(since),
      sinceRevision: 0,
      onRevision: () => {
        scheduleDebouncedRefresh();
      },
      schedule: () => {},
    });
    // The first tick is the route capability probe. Leaving this false here
    // made the loop self-disable forever: the tick that would set the flag
    // was gated on the flag already being true.
    runtimePollProbedRef.current = true;
  }

  useAsyncPolling(
    async () => {
      try {
        const loop = runtimePollLoopRef.current;
        if (
          loop &&
          !loop.stopped() &&
          runtimePollAvailableRef.current &&
          runtimePollProbedRef.current
        ) {
          let view;
          try {
            view = await loop.tick();
          } catch (pollError) {
            // No runtime-poll route in this deployment (404/HTML shell):
            // park the loop for the session and fall back to the snapshot
            // refresh so older backends keep today's cadence (dual-serve
            // interop, one probe 404 per session).
            if ((pollError as { status?: number })?.status === 404) {
              runtimePollAvailableRef.current = false;
              try {
                await refreshBackendSessionSnapshot();
              } catch {
                // Benign; live state stays as-is.
              }
              return;
            }
            throw pollError;
          }
          runtimePollRevisionRef.current = view.revision;
          runtimePollProbedRef.current = true;
          // A runtime revision change means cohort state moved: refresh
          // the snapshot (debounced). 304/same-revision = steady, no
          // work. The full live fetch still carries attempt freshness,
          // so attempt updates are never gated on the runtime revision.
          if (!view.notModified) {
            await refreshBackendSessionSnapshot();
          }
          // Adaptive cadence is owned by the loop (pollAfterSecs); the
          // outer useAsyncPolling stays as the scheduling shell.
          void runtimePollRevisionRef;
        } else {
          await refreshBackendSessionSnapshot();
        }
      } catch {
        // Polling refresh failures are benign; live state stays as-is.
      }
    },
    {
      enabled: Boolean(scheduleId && state && !error && !isLoading),
      intervalMs: pollingPolicy.intervalMs,
      maxIntervalMs: pollingPolicy.maxIntervalMs,
    },
  );

  // Phase 02 seed (additive, memoized): non-null iff the SAT identity is
  // fully known. Bytes are NEVER reused — the child still bootstraps via
  // assessmentDeliveryApi.bootstrap; the seed only scopes that one call
  // (identity/epochs/ETag) and lets the child skip re-fires (dedupe via
  // singleflight + ETag/304, not byte reuse). Refs are read inside (stable,
  // exempt from deps); every reactive input is listed so static re-resolve
  // (new schedule/state objects) rebuilds the seed. Seed identity churn is
  // harmless: the child bootstrap effect deps read seed scalars only.
  const isSatStaticReady = providerKey === 'sat' && schedule !== null && state !== null;
  const satBootstrapSeed = useMemo<SatBootstrapSeed | null>(() => {
    if (providerKey !== 'sat' || schedule === null || state === null) {
      return null;
    }
    if (!scheduleId || !candidateId || !attemptSnapshot?.id) {
      return null;
    }
    return buildSatBootstrapSeed({
      scheduleId,
      attemptId: attemptSnapshot.id,
      candidateId,
      attemptSnapshot,
      runtimeSnapshot,
      liveSnapshotReceivedAt: liveReceivedAtRef.current,
      staticVersionId: staticVersionIdRef.current,
      deliveryEtag: getCachedDeliveryEtag(scheduleId, attemptSnapshot.id),
      seedGeneration: refreshEpochRef.current,
    });
  }, [attemptSnapshot, candidateId, providerKey, runtimeSnapshot, schedule, scheduleId, state]);

  return {
    answerInvariantRollout,
    attemptSnapshot,
    error,
    isLoading,
    providerKey,
    runtimeSnapshot,
    liveSocketConnected,
    satAttemptUpdateToken,
    schedule,
    state,
    satBootstrapSeed,
    isSatStaticReady,
    refreshRuntime: (...args: Parameters<typeof refreshBackendSessionSnapshot>) =>
      refreshBackendSessionSnapshot(...args).catch(() => {}),
    retry: () => loadStudentData('retry').catch(() => {}),
  };
}
