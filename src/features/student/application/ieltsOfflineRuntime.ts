import type { ExamSessionRuntime, SectionRuntimeState } from '../../../types/domain';
import {
  resolveIeltsSharedPosition,
  type IeltsSharedPositionKind,
  type IeltsSharedSchedule,
} from '../domain/exam-session/ieltsSharedSchedule';

/** Wall vs monotonic disagreement that marks the clock uncertain. */
export const IELTS_CLOCK_DISAGREEMENT_MS = 5_000;

export type IeltsClockConfidence = 'verified' | 'uncertain' | 'provisional';

export interface IeltsClockAnchorInput {
  serverNowMs: number;
  receivedWallMs: number;
  /** performance.now() at receipt; null after a full browser restart. */
  monotonicAtReceiptMs: number | null;
  /** Highest server time already projected on this device. */
  lastEstimatedServerNowMs: number;
}

export interface IeltsClockEstimate {
  serverNowMs: number;
  confidence: IeltsClockConfidence;
}

/**
 * Estimates server time without awarding time. Within one page lifetime the
 * monotonic delta is authoritative, but elapsed wall time (OS sleep) still
 * counts: the larger delta wins, so neither a backward wall clock nor a
 * paused monotonic clock adds working time. After a restart only the wall
 * delta exists; the estimate is provisional. Never moves backward.
 */
export function estimateIeltsServerNow(
  anchor: IeltsClockAnchorInput,
  nowWallMs: number,
  nowMonotonicMs: number | null,
): IeltsClockEstimate {
  const wallDelta = nowWallMs - anchor.receivedWallMs;
  let delta: number;
  let confidence: IeltsClockConfidence;
  if (anchor.monotonicAtReceiptMs === null || nowMonotonicMs === null) {
    delta = Math.max(0, wallDelta);
    confidence = 'provisional';
  } else {
    const monotonicDelta = Math.max(0, nowMonotonicMs - anchor.monotonicAtReceiptMs);
    delta = Math.max(monotonicDelta, wallDelta);
    confidence = Math.abs(wallDelta - monotonicDelta) > IELTS_CLOCK_DISAGREEMENT_MS ? 'uncertain' : 'verified';
  }
  return {
    serverNowMs: Math.max(anchor.serverNowMs + delta, anchor.lastEstimatedServerNowMs),
    confidence,
  };
}

export interface IeltsLocalProjection {
  positionKind: IeltsSharedPositionKind;
  scheduleRevision: number;
  clockConfidence: IeltsClockConfidence;
  /** The section a prepared device may edit right now (working current only). */
  editableSectionKey: string | null;
}

/**
 * Derives the effective runtime from the committed timetable at the estimated
 * server instant. Server-owned counters (revision, epochs) are copied, never
 * advanced (INV-4); the result is a local projection, flagged as such.
 */
export function projectIeltsSharedRuntime(
  snapshot: ExamSessionRuntime,
  schedule: IeltsSharedSchedule,
  clock: IeltsClockEstimate,
): ExamSessionRuntime & { ieltsLocalProjection: IeltsLocalProjection } {
  const position = resolveIeltsSharedPosition(schedule, clock.serverNowMs);
  const current = position.window;
  // A known terminal state outranks any cached permission (FR-8).
  if (snapshot.status === 'completed' || snapshot.status === 'cancelled') {
    return {
      ...snapshot,
      ieltsLocalProjection: { positionKind: 'complete', scheduleRevision: schedule.scheduleRevision, clockConfidence: clock.confidence, editableSectionKey: null },
    };
  }
  const nowMs = clock.serverNowMs;
  const sections: SectionRuntimeState[] = snapshot.sections.map((section) => {
    const w = schedule.windows.find((candidate) => candidate.sectionKey === section.sectionKey);
    if (!w) return section;
    const started = nowMs >= Date.parse(w.startAt);
    const drained = nowMs >= Date.parse(w.saveUntil);
    if (drained) {
      return { ...section, status: 'completed', actualStartAt: section.actualStartAt ?? w.startAt, actualEndAt: section.actualEndAt ?? w.saveUntil, pausedAt: null };
    }
    if (started && position.kind !== 'paused') {
      return { ...section, status: 'live', actualStartAt: section.actualStartAt ?? w.startAt, actualEndAt: null };
    }
    if (started) return { ...section, status: 'paused', actualStartAt: section.actualStartAt ?? w.startAt };
    return section.status === 'completed' ? section : { ...section, status: 'locked' };
  });
  const base = { ...snapshot, sections, serverNow: new Date(nowMs).toISOString() };
  const projection: IeltsLocalProjection = {
    positionKind: position.kind,
    scheduleRevision: schedule.scheduleRevision,
    clockConfidence: clock.confidence,
    editableSectionKey: position.kind === 'working' && current ? current.sectionKey : null,
  };
  const key = (current?.sectionKey ?? null) as ExamSessionRuntime['currentSectionKey'];
  switch (position.kind) {
    case 'working':
    case 'save_only':
      return {
        ...base,
        status: snapshot.status === 'paused' ? 'paused' : 'live',
        activeSectionKey: key,
        currentSectionKey: key,
        currentSectionDeadlineAt: current!.deadlineAt,
        currentSectionRemainingSeconds: Math.max(0, Math.ceil((Date.parse(current!.deadlineAt) - nowMs) / 1000)),
        waitingForNextSection: position.kind === 'save_only',
        nextSectionStartAt: null,
        ieltsLocalProjection: projection,
      };
    case 'gap':
    case 'before_start':
      return {
        ...base,
        currentSectionDeadlineAt: null,
        currentSectionRemainingSeconds: 0,
        waitingForNextSection: position.kind === 'gap',
        nextSectionStartAt: current!.startAt,
        ieltsLocalProjection: projection,
      };
    case 'paused':
      return { ...base, status: 'paused', activeSectionKey: key ?? base.activeSectionKey, currentSectionKey: key ?? base.currentSectionKey, ieltsLocalProjection: projection };
    case 'complete':
      return {
        ...base,
        status: 'completed',
        currentSectionDeadlineAt: null,
        currentSectionRemainingSeconds: 0,
        waitingForNextSection: false,
        nextSectionStartAt: null,
        ieltsLocalProjection: projection,
      };
  }
}

/**
 * Picks the timetable to follow. A newer revision from the server always
 * wins; a stale snapshot of the same or older revision can never rewind the
 * cached timetable.
 */
export function newestIeltsSchedule(
  ...candidates: Array<IeltsSharedSchedule | null | undefined>
): IeltsSharedSchedule | null {
  let best: IeltsSharedSchedule | null = null;
  for (const candidate of candidates) {
    if (candidate && (!best || candidate.scheduleRevision > best.scheduleRevision)) best = candidate;
  }
  return best;
}
