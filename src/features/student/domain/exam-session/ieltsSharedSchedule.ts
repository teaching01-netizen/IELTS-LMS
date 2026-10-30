/**
 * Committed IELTS room timetable (`ielts_shared_schedule_v1`). The pure
 * resolver mirrors backend/go/internal/runtime/ielts_shared_schedule.go; both
 * run the vectors in __tests__/ieltsSharedSchedule.vectors.json.
 */

export const IELTS_SHARED_TIMING_MODEL = 'ielts_shared_schedule_v1';

export type IeltsSharedSectionKey = 'listening' | 'reading' | 'writing';

export interface IeltsSharedWindow {
  sectionKey: IeltsSharedSectionKey;
  order: number;
  /** Absolute UTC, inclusive. */
  startAt: string;
  /** Absolute UTC, exclusive for editing. */
  deadlineAt: string;
  /** Save-only drain; never additional working time. */
  saveUntil: string;
}

export interface IeltsSharedSchedule {
  schemaVersion: 1;
  scheduleRevision: number;
  status: 'active' | 'paused' | 'ended';
  pausedAt?: string | undefined;
  windows: IeltsSharedWindow[];
}

export type IeltsSharedPositionKind =
  | 'before_start'
  | 'working'
  | 'save_only'
  | 'gap'
  | 'paused'
  | 'complete';

export interface IeltsSharedPosition {
  kind: IeltsSharedPositionKind;
  /** Current window (working/save-only/paused) or the next one (gap/before-start). */
  window: IeltsSharedWindow | null;
}

const SECTIONS = new Set<string>(['listening', 'reading', 'writing']);

function instant(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

/**
 * Validates untrusted input (server payload or a cached copy). Returns null
 * for anything the resolver cannot interpret unambiguously.
 */
export function parseIeltsSharedSchedule(value: unknown): IeltsSharedSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw['schemaVersion'] !== 1) return null;
  const revision = raw['scheduleRevision'];
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null;
  const status = raw['status'];
  if (status !== 'active' && status !== 'paused' && status !== 'ended') return null;
  const pausedAt = raw['pausedAt'];
  if ((status === 'paused') !== (typeof pausedAt === 'string' && Number.isFinite(instant(pausedAt)))) return null;
  const windows = raw['windows'];
  if (!Array.isArray(windows) || windows.length === 0 || windows.length > SECTIONS.size) return null;
  const seen = new Set<string>();
  const parsed: IeltsSharedWindow[] = [];
  for (const entry of windows) {
    if (!entry || typeof entry !== 'object') return null;
    const w = entry as Record<string, unknown>;
    const key = w['sectionKey'];
    const order = w['order'];
    if (typeof key !== 'string' || !SECTIONS.has(key) || seen.has(key)) return null;
    if (typeof order !== 'number' || !Number.isInteger(order)) return null;
    const start = instant(w['startAt']);
    const deadline = instant(w['deadlineAt']);
    const saveUntil = instant(w['saveUntil']);
    if (![start, deadline, saveUntil].every(Number.isFinite) || deadline <= start || saveUntil < deadline) return null;
    const prev = parsed[parsed.length - 1];
    if (prev && (order <= prev.order || start < Date.parse(prev.saveUntil))) return null;
    seen.add(key);
    parsed.push({
      sectionKey: key as IeltsSharedSectionKey,
      order,
      startAt: w['startAt'] as string,
      deadlineAt: w['deadlineAt'] as string,
      saveUntil: w['saveUntil'] as string,
    });
  }
  return {
    schemaVersion: 1,
    scheduleRevision: revision,
    status,
    ...(status === 'paused' ? { pausedAt: pausedAt as string } : {}),
    windows: parsed,
  };
}

/** Pure position at an estimated server instant (ms since epoch). */
export function resolveIeltsSharedPosition(
  schedule: IeltsSharedSchedule,
  serverNowMs: number,
): IeltsSharedPosition {
  if (schedule.status === 'ended') return { kind: 'complete', window: null };
  const now = schedule.status === 'paused' ? Date.parse(schedule.pausedAt ?? '') : serverNowMs;
  let position: IeltsSharedPosition = { kind: 'complete', window: null };
  for (const [index, w] of schedule.windows.entries()) {
    if (now >= Date.parse(w.saveUntil)) continue;
    if (now < Date.parse(w.startAt)) {
      position = { kind: index === 0 ? 'before_start' : 'gap', window: w };
    } else if (now < Date.parse(w.deadlineAt)) {
      position = { kind: 'working', window: w };
    } else {
      position = { kind: 'save_only', window: w };
    }
    break;
  }
  if (schedule.status === 'paused' && position.kind !== 'complete') {
    return { kind: 'paused', window: position.window };
  }
  return position;
}

/** Next instant (ms) at which the resolved position changes; null when final. */
export function nextIeltsSharedBoundaryMs(
  schedule: IeltsSharedSchedule,
  serverNowMs: number,
): number | null {
  if (schedule.status !== 'active') return null;
  for (const w of schedule.windows) {
    for (const at of [w.startAt, w.deadlineAt, w.saveUntil]) {
      const ms = Date.parse(at);
      if (ms > serverNowMs) return ms;
    }
  }
  return null;
}
