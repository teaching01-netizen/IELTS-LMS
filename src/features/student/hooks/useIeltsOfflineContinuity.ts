import { useEffect, useMemo, useRef, useState } from 'react';
import { isIeltsSharedScheduleTimingModel, type ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import {
  nextIeltsSharedBoundaryMs,
  resolveIeltsSharedPosition,
} from '../domain/exam-session/ieltsSharedSchedule';
import {
  estimateIeltsServerNow,
  newestIeltsSchedule,
  projectIeltsSharedRuntime,
  type IeltsClockAnchorInput,
  type IeltsClockConfidence,
  type IeltsLocalProjection,
} from '../application/ieltsOfflineRuntime';
import {
  prepareIeltsOfflinePackage,
  type IeltsOfflinePreparationFailure,
} from '../application/ieltsOfflinePreparation';
import {
  ieltsOfflinePackageKey,
  latestIeltsOfflineManifest,
  refreshIeltsOfflinePackage,
  subscribeIeltsOfflineManifest,
  type IeltsOfflineManifest,
  type IeltsOfflinePackage,
} from '../infrastructure/ieltsOfflinePackageStore';
import { pinIeltsOfflineShell } from '../infrastructure/ieltsOfflineShell';
import { fetchIeltsOfflineManifestForAttempt } from '../infrastructure/ieltsOfflineManifestGateway';
import {
  backendPost,
  ensureBrowserClientSessionIdForAttempt,
  tryBuildAttemptAuthorizationHeader,
} from '../api/studentAttemptGateway';
import { emitStudentObservabilityMetric } from '../../../utils/studentObservability';

/** Longest wait between projections; also the persistence cadence. */
const MAX_TICK_MS = 30_000;

export type IeltsOfflinePackageStatus =
  | { state: 'unavailable' }
  | { state: 'preparing' }
  | { state: 'prepared'; record: IeltsOfflinePackage }
  | { state: 'failed'; reason: IeltsOfflinePreparationFailure };

export interface IeltsOfflineContinuity {
  /** Effective runtime: the timetable projection for shared rooms, else the snapshot. */
  runtimeSnapshot: ExamSessionRuntime | null;
  packageStatus: IeltsOfflinePackageStatus;
  projection: IeltsLocalProjection | null;
  /** The route is running from the package after a network failure. */
  restoredOffline: boolean;
  retryPreparation: () => void;
}

function useLatestManifest(attemptId: string | null): IeltsOfflineManifest | null {
  const [manifest, setManifest] = useState<IeltsOfflineManifest | null>(null);
  useEffect(() => {
    if (!attemptId) {
      setManifest(null);
      return undefined;
    }
    setManifest(latestIeltsOfflineManifest(attemptId));
    return subscribeIeltsOfflineManifest((next) => {
      if (next.attemptId === attemptId) setManifest(next);
    });
  }, [attemptId]);
  return manifest;
}

const nowMonotonic = () => (typeof performance === 'undefined' ? null : performance.now());

/**
 * Device-local continuity for `ielts_shared_schedule_v1` rooms: prepares the
 * offline package, keeps its timetable and clock fresh, and projects the
 * committed timetable so a prepared device crosses boundaries with no network.
 * It never calls /ready and never changes server state (FR-1, FR-2, FR-3).
 */
export function useIeltsOfflineContinuity(input: {
  runtimeSnapshot: ExamSessionRuntime | null;
  attemptSnapshot: StudentAttempt | null;
  staticPayload: Record<string, unknown> | null;
  /** Set by the route only when it restored from the package offline. */
  offlinePackage: IeltsOfflinePackage | null;
  userId: string | null;
  candidateId: string | null;
}): IeltsOfflineContinuity {
  const { runtimeSnapshot, attemptSnapshot, staticPayload, offlinePackage, userId, candidateId } = input;
  const shared = isIeltsSharedScheduleTimingModel(runtimeSnapshot?.timingModel);
  const attemptId = attemptSnapshot?.id ?? null;
  const manifest = useLatestManifest(shared ? attemptId : null);
  const [packageStatus, setPackageStatus] = useState<IeltsOfflinePackageStatus>(
    offlinePackage ? { state: 'prepared', record: offlinePackage } : { state: 'unavailable' },
  );
  const [retryToken, setRetryToken] = useState(0);
  const record = packageStatus.state === 'prepared' ? packageStatus.record : null;
  const restoredRuntime = offlinePackage?.liveSnapshot?.runtime as ExamSessionRuntime | undefined;
  const restoredOffline = Boolean(restoredRuntime) && runtimeSnapshot?.serverNow === restoredRuntime?.serverNow;

  // --- Manifest capture through the existing credential path ----------------
  // The live read carries no writer identity, so it cannot return a package
  // descriptor without exposing another browser's session id. The credentialed
  // session read is the existing owner-only path that does. Retry on a timer:
  // the descriptor is absent until the room commits its timetable.
  const scheduleCommitted = Boolean(runtimeSnapshot?.ieltsSharedSchedule);
  useEffect(() => {
    if (!shared || manifest || !userId || !attemptSnapshot?.id || !scheduleCommitted) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (cancelled) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        timer = setTimeout(() => void load(), 10_000);
        return;
      }
      const clientSessionId = ensureBrowserClientSessionIdForAttempt(attemptSnapshot);
      const ok = await fetchIeltsOfflineManifestForAttempt(attemptSnapshot, clientSessionId).catch(() => false);
      if (!ok && !cancelled) timer = setTimeout(() => void load(), 10_000);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Identity fields only: the attempt projection object is replaced by polls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, manifest, userId, attemptSnapshot?.id, attemptSnapshot?.scheduleId, scheduleCommitted]);

  // --- Preparation: once per package identity, online only -----------------
  const identityKey = manifest
    ? [manifest.attemptId, manifest.publishedVersionId, manifest.clientSessionId, manifest.leaseEpoch, manifest.recoveryRunGeneration, manifest.contentDigest].join(':')
    : null;
  const latest = useRef({ runtimeSnapshot, attemptSnapshot, staticPayload, record });
  latest.current = { runtimeSnapshot, attemptSnapshot, staticPayload, record };
  const hasStatic = Boolean(staticPayload);
  useEffect(() => {
    if (!shared || !manifest || !userId || !candidateId || !attemptId || !hasStatic) return undefined;
    const current = latest.current;
    if (current.record?.key === ieltsOfflinePackageKey(userId, manifest) && current.record.manifest.contentDigest === manifest.contentDigest) {
      return undefined;
    }
    const controller = new AbortController();
    const startedAt = Date.now();
    setPackageStatus({ state: 'preparing' });
    void prepareIeltsOfflinePackage({
      manifest,
      identity: {
        userId,
        candidateId,
        scheduleId: manifest.scheduleId,
        attemptId,
        publishedVersionId: current.attemptSnapshot?.publishedVersionId ?? null,
        clientSessionId: null,
      },
      staticPayload: current.staticPayload ?? {},
      liveSnapshot: { runtime: current.runtimeSnapshot, attempt: current.attemptSnapshot },
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      emitStudentObservabilityMetric('ielts_offline_preparation', {
        reason: result.status === 'prepared' ? 'prepared' : result.reason,
        latencyMs: Date.now() - startedAt,
      });
      if (result.status === 'prepared') {
        setPackageStatus({ state: 'prepared', record: result.record });
        if (result.record.shellBuildId) void pinIeltsOfflineShell(result.record.shellBuildId, attemptId);
      } else {
        setPackageStatus({ state: 'failed', reason: result.reason });
      }
    });
    return () => controller.abort();
    // identityKey stands for the manifest fields that define the package.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, identityKey, userId, candidateId, attemptId, hasStatic, retryToken]);

  // --- Clock anchor: a fresh server read anchors monotonic time -------------
  const lastEstimateRef = useRef(offlinePackage?.clock.lastEstimatedServerNowMs ?? 0);
  const anchor = useMemo<IeltsClockAnchorInput | null>(() => {
    if (!shared || !runtimeSnapshot?.serverNow) return null;
    if (restoredOffline && offlinePackage) {
      // A full restart has no monotonic origin: provisional, wall-clock based.
      return { ...offlinePackage.clock, monotonicAtReceiptMs: null, lastEstimatedServerNowMs: lastEstimateRef.current };
    }
    return {
      serverNowMs: Date.parse(runtimeSnapshot.serverNow),
      receivedWallMs: Date.now(),
      monotonicAtReceiptMs: nowMonotonic(),
      lastEstimatedServerNowMs: lastEstimateRef.current,
    };
    // Re-anchor only on a new authoritative read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, runtimeSnapshot?.serverNow, restoredOffline]);

  // --- Projection, recomputed at each committed boundary ---------------------
  const [tick, setTick] = useState(0);
  const schedule = shared
    ? newestIeltsSchedule(runtimeSnapshot?.ieltsSharedSchedule, record?.manifest.schedule)
    : null;
  const scheduleRevision = schedule?.scheduleRevision ?? null;
  const projected = useMemo(() => {
    if (!runtimeSnapshot || !schedule || !anchor) return null;
    const estimate = estimateIeltsServerNow(anchor, Date.now(), anchor.monotonicAtReceiptMs === null ? null : nowMonotonic());
    lastEstimateRef.current = Math.max(lastEstimateRef.current, estimate.serverNowMs);
    return { runtime: projectIeltsSharedRuntime(runtimeSnapshot, schedule, estimate), estimate };
    // The schedule is keyed by revision; tick re-projects at the boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeSnapshot, scheduleRevision, anchor, tick]);

  const confidence: IeltsClockConfidence | null = projected?.estimate.confidence ?? null;
  useEffect(() => {
    if (!schedule || !projected) return undefined;
    const now = projected.estimate.serverNowMs;
    const boundary = nextIeltsSharedBoundaryMs(schedule, now);
    const delay = boundary === null ? MAX_TICK_MS : Math.min(MAX_TICK_MS, Math.max(0, boundary - now) + 5);
    const timer = setTimeout(() => setTick((value) => value + 1), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projected]);

  useEffect(() => {
    if (confidence && confidence !== 'verified') emitStudentObservabilityMetric('ielts_clock_uncertain', { reason: confidence });
  }, [confidence]);

  // --- Roster visibility: report the verified package once per section ------
  // Diagnostic only: /ready records preparation for staff and never allocates,
  // extends or starts a shared clock. A failure is retried quietly and never
  // affects local continuity.
  const reportedSections = useRef(new Set<string>());
  const reportSection =
    projected && schedule
      ? projected.runtime.currentSectionKey ??
        resolveIeltsSharedPosition(schedule, projected.estimate.serverNowMs).window?.sectionKey ??
        null
      : null;
  // The manifest object changes on every live read; the report must key on its
  // stable identity fields, not its identity, or a failing request would retry
  // on every poll.
  const reportScheduleId = manifest?.scheduleId ?? null;
  const reportClientSessionId = manifest?.clientSessionId ?? null;
  const reportControlEpoch = manifest?.controlEpoch ?? null;
  const reportLeaseEpoch = manifest?.leaseEpoch ?? null;
  useEffect(() => {
    if (
      !shared ||
      !attemptId ||
      !reportSection ||
      !reportScheduleId ||
      !reportClientSessionId ||
      reportControlEpoch === null ||
      reportLeaseEpoch === null ||
      packageStatus.state !== 'prepared' ||
      typeof navigator === 'undefined' ||
      !navigator.onLine
    ) {
      return undefined;
    }
    const reportKey = `${attemptId}:${reportControlEpoch}:${reportLeaseEpoch}:${reportSection}`;
    if (reportedSections.current.has(reportKey)) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = async () => {
      try {
        await backendPost(
          `/v1/student/sessions/${encodeURIComponent(reportScheduleId)}/sections/${encodeURIComponent(reportSection)}/ready`,
          {
            attemptId,
            clientSessionId: reportClientSessionId,
            contentReady: true,
            localStorageReady: true,
            audioReady: true,
            offlinePackageReady: true,
          },
          { headers: tryBuildAttemptAuthorizationHeader(reportScheduleId, attemptId) ?? {}, retries: 0 },
        );
        if (cancelled) return;
        reportedSections.current.add(reportKey);
        emitStudentObservabilityMetric('ielts_offline_prepared_report', { reason: 'reported' });
      } catch {
        if (cancelled) return;
        emitStudentObservabilityMetric('ielts_offline_prepared_report', { reason: 'retry' });
        timer = setTimeout(() => void send(), 30_000);
      }
    };
    void send();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // reportSection is derived from the projection; a boundary change re-reports.
  }, [
    shared,
    attemptId,
    reportSection,
    reportScheduleId,
    reportClientSessionId,
    reportControlEpoch,
    reportLeaseEpoch,
    packageStatus.state,
  ]);

  // Persist the newest timetable, projection and anchor so a restart resumes them.
  const packageKey = record?.key ?? null;
  useEffect(() => {
    if (!packageKey || !projected) return;
    const latestInput = latest.current;
    void refreshIeltsOfflinePackage(packageKey, {
      schedule,
      ...(restoredOffline || !anchor
        ? {}
        : {
            liveSnapshot: { runtime: latestInput.runtimeSnapshot, attempt: latestInput.attemptSnapshot },
            serverNowMs: anchor.serverNowMs,
            receivedWallMs: anchor.receivedWallMs,
          }),
      lastEstimatedServerNowMs: projected.estimate.serverNowMs,
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageKey, projected]);

  return {
    runtimeSnapshot: projected?.runtime ?? runtimeSnapshot,
    packageStatus,
    projection: projected?.runtime.ieltsLocalProjection ?? null,
    restoredOffline,
    retryPreparation: () => setRetryToken((value) => value + 1),
  };
}
