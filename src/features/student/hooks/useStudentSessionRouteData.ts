import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAsyncPolling } from '@app/hooks/useAsyncPolling';
import { useLiveUpdates, type LiveUpdateEvent } from '@app/hooks/useLiveUpdates';
import { useAuthSession } from '../../auth/authSession';
import {
  studentSessionFacade,
  type StudentSessionLivePayload,
  type StudentSessionStaticPayload,
} from '@student/application/studentSessionFacade';
import type { ExamState } from '../../../types';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import {
  emitStudentObservabilityMetric,
  withStudentObservabilityDimensions,
} from '../../../utils/studentObservability';
import {
  compareFreshnessDimension,
  extractLiveSnapshotFreshness,
  isRuntimeValueUnchanged,
  mergeLiveSnapshotFreshness,
  type LiveSnapshotFreshness,
} from '../liveSnapshotFreshness';
import { runStudentSessionMachineCommands } from './studentSessionMachineAdapters';
import { evaluateLiveSnapshotTransition, evaluateLoadTransition } from './studentSessionStateMachine';

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

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseIsoTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
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

function normalizeCandidateId(studentId?: string) {
  if (!studentId) {
    return null;
  }

  const normalized = studentId.trim();
  if (!normalized) {
    return null;
  }
  if (/^w\d{6}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  return normalized;
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
    candidateName: stored?.candidateName ?? 'Unknown Candidate',
    candidateEmail: stored?.candidateEmail ?? '',
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

type BackendStaticSession = StudentSessionStaticPayload;
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

function buildLiveMetricEndpoint(scheduleId: string) {
  return `/v1/student/sessions/${scheduleId}/live`;
}

function extractAttemptSyncState(live: unknown): string {
  const record = asRecord(live);
  const attempt = record ? asRecord(record['attempt']) : null;
  const recovery = attempt ? asRecord(attempt['recovery']) : null;
  const syncState = recovery ? recovery['syncState'] : null;
  return typeof syncState === 'string' && syncState.trim().length > 0 ? syncState : 'idle';
}

function resolveAnswerInvariantRollout(live: unknown): StudentAnswerInvariantRollout {
  const runtime = asRecord(asRecord(live)?.['runtime']);
  if (!runtime) {
    return buildDefaultAnswerInvariantRollout();
  }

  const enabled = parseNullableBoolean(runtime['localWriterAnswerInvariantEnabled']);
  const killSwitch = parseNullableBoolean(runtime['localWriterAnswerInvariantKillSwitch']);
  const cohort = parseNullableString(runtime['localWriterAnswerInvariantCohort']);
  const configFingerprint = parseNullableString(runtime['localWriterAnswerInvariantConfigFingerprint']);

  if (enabled === null && killSwitch === null && cohort === null && configFingerprint === null) {
    return buildDefaultAnswerInvariantRollout();
  }

  return {
    enabled: enabled ?? (getEnvBoolean(ANSWER_INVARIANT_ENV_ENABLED) ?? true),
    killSwitch: killSwitch ?? (getEnvBoolean(ANSWER_INVARIANT_ENV_KILL_SWITCH) ?? false),
    cohort,
    configFingerprint,
    source: 'runtime',
  };
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
  const storedCandidateProfile = useMemo(
    () => (scheduleId && candidateId ? loadStoredCandidateProfile(scheduleId, candidateId) : null),
    [candidateId, scheduleId],
  );
  const studentKey = useMemo(
    () => (scheduleId && candidateId ? buildStudentKey(scheduleId, candidateId) : null),
    [candidateId, scheduleId],
  );

  useEffect(() => {
    runtimeSnapshotRef.current = runtimeSnapshot;
  }, [runtimeSnapshot]);

  const loadStaticSessionSnapshot = useCallback(async (): Promise<LoadedStaticSnapshot | null> => {
    if (!scheduleId || !candidateId) {
      return null;
    }

    const session = await studentSessionFacade.loadStaticSession(scheduleId, candidateId);
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

    let live = await studentSessionFacade.loadLiveSession(scheduleId, candidateId);
    const reloadedStatic = await maybeRebootstrapStaticOnVersionMismatch(live);
    if (reloadedStatic) {
      scheduleEntity = reloadedStatic.scheduleEntity;
      live = await studentSessionFacade.loadLiveSession(scheduleId, candidateId);
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
    const runtimeValueUnchanged =
      applyDecision.applyRuntime &&
      nextRuntimeSnapshot !== null &&
      isRuntimeValueUnchanged(runtimeSnapshotRef.current, nextRuntimeSnapshot);
    if (applyDecision.applyRuntime && !runtimeValueUnchanged) {
      runtimeSnapshotRef.current = nextRuntimeSnapshot;
      setRuntimeSnapshot(nextRuntimeSnapshot);
    } else if (runtimeValueUnchanged) {
      // Equal-revision duplicate frame: keep the applied snapshot (no state
      // churn, no timer restart) and only refresh the freshness bookkeeping.
      const runtimeRecord = asRecord(live?.['runtime']);
      const sectionKey =
        typeof runtimeRecord?.['currentSectionKey'] === 'string'
          ? (runtimeRecord?.['currentSectionKey'] as string)
          : null;
      const runtimeSections = runtimeRecord?.['sections'];
      const currentSection = (
        Array.isArray(runtimeSections) ? runtimeSections : []
      ).find((candidate) => asRecord(candidate)?.['sectionKey'] === sectionKey);
      const sectionStatusRecord = asRecord(currentSection);
      emitStudentObservabilityMetric(
        'student_timer_snapshot_churn_total',
        withStudentObservabilityDimensions({
          scheduleId: scheduleId ?? null,
          attemptId: live.attempt?.id ?? null,
          endpoint: scheduleId ? buildLiveMetricEndpoint(scheduleId) : null,
          statusCode: LIVE_SESSION_STATUS_CODE,
          reason: 'equal_revision_duplicate',
          syncState: extractAttemptSyncState(live),
          source: 'refresh',
          runtimeRevision: parseFiniteNumber(runtimeRecord?.['revision']),
          attemptRevision: parseFiniteNumber(live.attempt?.revision),
          currentSectionKey: sectionKey,
          runtimeStatus:
            typeof runtimeRecord?.['status'] === 'string'
              ? (runtimeRecord?.['status'] as string)
              : null,
          sectionStatus:
            typeof sectionStatusRecord?.['status'] === 'string'
              ? (sectionStatusRecord?.['status'] as string)
              : null,
          snapshotRemainingSeconds: parseFiniteNumber(runtimeRecord?.['currentSectionRemainingSeconds']),
          deadlineAt:
            typeof runtimeRecord?.['currentSectionDeadlineAt'] === 'string'
              ? (runtimeRecord?.['currentSectionDeadlineAt'] as string)
              : null,
          serverNow:
            typeof runtimeRecord?.['serverNow'] === 'string'
              ? (runtimeRecord?.['serverNow'] as string)
              : null,
          documentVisibilityState:
            typeof document === 'undefined' || typeof document.visibilityState !== 'string'
              ? null
              : document.visibilityState,
          navigatorOnline: typeof navigator === 'undefined' ? null : navigator.onLine,
        }),
      );
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

  const handleRuntimeSnapshot = useCallback(
    (payload: { scheduleId?: string; runtime: unknown }) => {
      if (!scheduleId || !schedule) {
        return;
      }
      if (payload.scheduleId && payload.scheduleId !== scheduleId) {
        return;
      }

      try {
        const runtimeRecord = payload.runtime as Record<string, unknown>;
        const incomingRuntimeFreshness = {
          revision: parseFiniteNumber(runtimeRecord['revision']),
          updatedAtMs: parseIsoTimestampMs(runtimeRecord['updatedAt']),
        };
        const freshnessOrder = compareFreshnessDimension(
          incomingRuntimeFreshness,
          appliedFreshnessRef.current?.runtime ?? { revision: null, updatedAtMs: null },
        );

        if (freshnessOrder < 0) {
          // Strictly older frame: the newest authoritative runtime already won.
          emitStudentObservabilityMetric(
            'student_refresh_stale_discard_total',
            withStudentObservabilityDimensions({
              scheduleId: scheduleId ?? null,
              attemptId: attemptSnapshot?.id ?? null,
              endpoint: buildLiveMetricEndpoint(scheduleId),
              statusCode: LIVE_SESSION_STATUS_CODE,
              reason: 'runtime_regressed',
              syncState: extractAttemptSyncState(payload.runtime),
              source: 'websocket',
              runtimeRevision: incomingRuntimeFreshness.revision,
            }),
          );
          return;
        }

        const mappedRuntime = studentSessionFacade.mapRuntime(payload.runtime, schedule);
        const runtimeValueUnchanged =
          mappedRuntime !== null &&
          isRuntimeValueUnchanged(runtimeSnapshotRef.current, mappedRuntime);

        if (freshnessOrder === 0 && runtimeValueUnchanged) {
          // Equal-revision duplicate frame: skip the state update but still
          // refresh the freshness bookkeeping so the applied window advances.
          emitStudentObservabilityMetric(
            'student_timer_snapshot_churn_total',
            withStudentObservabilityDimensions({
              scheduleId: scheduleId ?? null,
              attemptId: attemptSnapshot?.id ?? null,
              endpoint: buildLiveMetricEndpoint(scheduleId),
              statusCode: LIVE_SESSION_STATUS_CODE,
              reason: 'equal_revision_duplicate',
              syncState: extractAttemptSyncState(payload.runtime),
              source: 'websocket',
              runtimeRevision: incomingRuntimeFreshness.revision,
              attemptRevision: parseFiniteNumber(attemptSnapshot?.revision),
              currentSectionKey: mappedRuntime.currentSectionKey ?? null,
              runtimeStatus: mappedRuntime.status,
              sectionStatus:
                mappedRuntime.sections.find(
                  (section) => section.sectionKey === mappedRuntime.currentSectionKey,
                )?.status ?? null,
              snapshotRemainingSeconds: mappedRuntime.currentSectionRemainingSeconds,
              deadlineAt: mappedRuntime.currentSectionDeadlineAt ?? null,
              serverNow: mappedRuntime.serverNow ?? null,
              documentVisibilityState:
                typeof document === 'undefined' || typeof document.visibilityState !== 'string'
                  ? null
                  : document.visibilityState,
              navigatorOnline: typeof navigator === 'undefined' ? null : navigator.onLine,
            }),
          );
        } else {
          // Strictly newer, or equal freshness with changed timer values
          // (e.g. the first WS frame while polling already applied a snapshot).
          runtimeSnapshotRef.current = mappedRuntime;
          setRuntimeSnapshot(mappedRuntime);
        }

        const runtimeFreshness: LiveSnapshotFreshness = {
          attempt: {
            revision: appliedFreshnessRef.current?.attempt.revision ?? null,
            updatedAtMs: appliedFreshnessRef.current?.attempt.updatedAtMs ?? null,
          },
          runtime: incomingRuntimeFreshness,
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
    [attemptSnapshot?.id, attemptSnapshot?.revision, schedule, scheduleId],
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
      if (state) {
        void refreshBackendSessionSnapshot();
      }
    },
    onDisconnected: () => {
      setLiveSocketConnected(false);
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

      let live = await studentSessionFacade.loadLiveSession(scheduleId, candidateId);
      const reloadedStatic = await maybeRebootstrapStaticOnVersionMismatch(live);
      if (reloadedStatic) {
        loadedStatic = reloadedStatic;
        live = await studentSessionFacade.loadLiveSession(scheduleId, candidateId);
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
    storedCandidateProfile,
    studentKey,
  ]);

  useEffect(() => {
    void loadStudentData('load');
  }, [loadStudentData]);

  const pollIntervalMs = runtimeSnapshot?.status === 'live'
    ? liveSocketConnected
      ? 20_000
      : 1_500
    : 15_000;
  const pollMaxIntervalMs = runtimeSnapshot?.status === 'live'
    ? liveSocketConnected
      ? 30_000
      : 3_000
    : 25_000;

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
    retry: () => loadStudentData('retry'),
  };
}
