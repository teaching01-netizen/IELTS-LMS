import type { ProctorAlert, SessionAuditLog } from '../../../types';

/**
 * Pure reconciliation of the proctor detail collections.
 *
 * Completeness differs per collection (backend/go/internal/proctor/sessions.go):
 * - notes and violation rules: the full set for the room. A row the server
 *   no longer returns was deleted.
 * - alerts: the newest `limit` UNACKNOWLEDGED alerts. A row can leave the
 *   window because it was acknowledged or because newer alerts pushed it out;
 *   only a window that is not full proves the former.
 * - audit log: the newest `limit` entries of an append-only log. Nothing is
 *   ever deleted, so older entries a window omits are still history.
 *
 * Local, unconfirmed operations are overlays applied on top of the confirmed
 * snapshot: they never become part of it, and they never need synthetic
 * timestamps to win.
 */

export interface CollectionOverlay<T extends { id: string }> {
  /** Pending creates/updates, shown over the server row. */
  readonly upserts: ReadonlyMap<string, T>;
  /** Pending deletes, hidden even while the server still returns them. */
  readonly deletes: ReadonlySet<string>;
}

export function emptyOverlay<T extends { id: string }>(): CollectionOverlay<T> {
  return { upserts: new Map(), deletes: new Set() };
}

/** A full server collection plus pending operations. Missing server rows are deletions. */
export function reconcileFullCollection<T extends { id: string }>(
  server: readonly T[],
  overlay: CollectionOverlay<T>,
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const row of server) {
    seen.add(row.id);
    if (overlay.deletes.has(row.id)) continue;
    result.push(overlay.upserts.get(row.id) ?? row);
  }
  for (const [id, row] of overlay.upserts) {
    if (!seen.has(id) && !overlay.deletes.has(id)) result.push(row);
  }
  return result;
}

export interface AlertWindowInput {
  /** The server window: newest unacknowledged alerts, at most `limit`. */
  readonly server: readonly ProctorAlert[];
  readonly limit: number;
  /** What the room showed before this read. */
  readonly previous: readonly ProctorAlert[];
  /** Acknowledgements this client sent (pending or confirmed). */
  readonly acknowledged: ReadonlySet<string>;
  /** Display-only reopenings; the server has no reopen command. */
  readonly reopened: ReadonlySet<string>;
  /** Client-generated alerts (auto-rule notifications) the server never returns. */
  readonly isLocalOnly: (alert: ProctorAlert) => boolean;
}

function sortNewestFirst<T extends { timestamp: string }>(rows: T[]): T[] {
  return rows.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

export function reconcileAlertWindow(input: AlertWindowInput): ProctorAlert[] {
  const { server, limit, previous, acknowledged, reopened, isLocalOnly } = input;
  const ackState = (alert: ProctorAlert, serverSaysAcked: boolean): ProctorAlert => {
    const isAcknowledged = !reopened.has(alert.id) && (serverSaysAcked || acknowledged.has(alert.id));
    return alert.isAcknowledged === isAcknowledged ? alert : { ...alert, isAcknowledged };
  };
  const byId = new Map<string, ProctorAlert>();
  for (const alert of server) byId.set(alert.id, ackState(alert, alert.isAcknowledged));

  const windowComplete = server.length < limit;
  for (const alert of previous) {
    if (byId.has(alert.id)) continue;
    if (isLocalOnly(alert)) {
      byId.set(alert.id, ackState(alert, alert.isAcknowledged));
    } else if (acknowledged.has(alert.id) || windowComplete) {
      // Gone from a window that holds every unacknowledged alert: it was
      // acknowledged (here or by another proctor), never silently re-opened.
      byId.set(alert.id, ackState(alert, true));
    } else {
      // A full window may simply have pushed it out; keep what we knew.
      byId.set(alert.id, alert);
    }
  }
  return sortNewestFirst([...byId.values()]);
}

/** Union of an append-only log and its newest server window; the server copy of a row wins. */
export function mergeAuditWindow(
  previous: readonly SessionAuditLog[],
  server: readonly SessionAuditLog[],
): SessionAuditLog[] {
  const byId = new Map(previous.map((entry) => [entry.id, entry] as const));
  for (const entry of server) byId.set(entry.id, entry);
  return sortNewestFirst([...byId.values()]);
}

export type StudentAction = 'warn' | 'pause' | 'resume' | 'terminate';

/**
 * The roster row after the server confirmed a student action, until the next
 * read (which carries the server's revision and supersedes it).
 */
export function applyConfirmedStudentAction<T extends {
  status: string;
  warnings: number;
  violations: Array<{ id: string; type: string; severity: string; timestamp: string; description: string }>;
}>(session: T, action: StudentAction, detail: { message: string; violationId: string; at: string }): T {
  if (action === 'warn') {
    return {
      ...session,
      status: 'warned',
      warnings: session.warnings + 1,
      violations: [
        ...session.violations,
        { id: detail.violationId, type: 'PROCTOR_WARNING', severity: 'medium', timestamp: detail.at, description: detail.message },
      ],
    };
  }
  if (action === 'pause') return { ...session, status: 'paused' };
  if (action === 'resume') return { ...session, status: 'active' };
  return { ...session, status: 'terminated' };
}
