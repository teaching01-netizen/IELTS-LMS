import { ApiError } from '../shared/api-client/errors';

/**
 * Shared helpers for backend library services (passage library, question bank).
 *
 * - `assertLibraryContentValid`: fail fast on empty/garbage payloads so the
 *   client never POSTs content the backend would store as an unusable record.
 * - `isConflictError`: detects HTTP 409 (revision collision) across both the
 *   typed `ApiError` shape and legacy `{ statusCode }` shapes.
 * - `RevisionRefresher` + `dedupeRefresh`: per-id in-flight dedupe for the
 *   GET-before-PATCH revision hydration. Concurrent `update*` calls for the
 *   same id share one GET instead of stampeding the backend; distinct ids
 *   proceed independently.
 */

export function assertLibraryContentValid(kind: 'passage' | 'question', content: string): void {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error(`Cannot save ${kind}: content must be a non-empty string.`);
  }
}

export function isConflictError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 409;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === 409
  );
}

/**
 * Refreshes the cached revision for one record id by re-reading it. Returns
 * the fresh revision, or `undefined` when the record no longer exists.
 */
export type RevisionRefresher = (id: string) => Promise<number | undefined>;

const inFlightRefreshes = new Map<string, Promise<number | undefined>>();

/**
 * Per-id single-flight wrapper around `refresh`: concurrent callers for the
 * same key share the same promise; the entry is removed in `finally` so a
 * settled refresh never pins a stale promise (and a rejected refresh does not
 * poison later callers).
 */
export function dedupeRefresh(key: string, refresh: () => Promise<number | undefined>): Promise<number | undefined> {
  const existing = inFlightRefreshes.get(key);
  if (existing) return existing;
  const pending = refresh().finally(() => {
    if (inFlightRefreshes.get(key) === pending) {
      inFlightRefreshes.delete(key);
    }
  });
  inFlightRefreshes.set(key, pending);
  return pending;
}
