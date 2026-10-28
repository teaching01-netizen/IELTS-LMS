import { ApiError } from '../shared/api-client/errors';
import { backendGet } from './backendBridge';
import type {
  AnswerHistoryExport,
  AnswerHistoryExportFormat,
  AnswerHistoryOverview,
  AnswerHistoryTargetDetail,
  AnswerHistoryTargetType,
} from '../features/answer-history/contracts';

function encode(value: string) {
  return encodeURIComponent(value);
}

function assertNonEmptyId(kind: 'submission' | 'attempt' | 'target', value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Cannot fetch answer history: ${kind} id must be a non-empty string.`);
  }
}

// Per-key in-flight GET dedupe: StrictMode double-mounts and parallel overview
// + detail mounts otherwise issue identical requests. Entries clear in
// `finally` so a failure never pins a rejected promise for later callers.
const inFlightGets = new Map<string, Promise<unknown>>();

function dedupedGet<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const existing = inFlightGets.get(key);
  if (existing) return existing as Promise<T>;
  const pending = fetch().finally(() => {
    if (inFlightGets.get(key) === pending) {
      inFlightGets.delete(key);
    }
  });
  inFlightGets.set(key, pending);
  return pending;
}

/** The overview screens index these lists directly; an incomplete payload is a load error. */
function checkOverview(value: unknown): AnswerHistoryOverview {
  const record = value as Record<string, unknown> | null;
  if (
    typeof record !== 'object' || record === null ||
    typeof record['attemptId'] !== 'string' ||
    !Array.isArray(record['questionSummaries']) ||
    !Array.isArray(record['sectionStats']) ||
    !Array.isArray(record['signals'])
  ) {
    throw new Error('The answer history response was incomplete. Try again.');
  }
  return value as AnswerHistoryOverview;
}

export async function fetchAnswerHistoryOverviewBySubmission(submissionId: string) {
  assertNonEmptyId('submission', submissionId);
  return dedupedGet(`overview:submission:${submissionId}`, () =>
    backendGet<unknown>(`/v1/answer-history/submissions/${encode(submissionId)}/overview`).then(checkOverview),
  );
}

export async function fetchAnswerHistoryOverviewByAttempt(attemptId: string) {
  assertNonEmptyId('attempt', attemptId);
  try {
    return await dedupedGet(`overview:attempt:${attemptId}`, () =>
      backendGet<unknown>(`/v1/answer-history/attempts/${encode(attemptId)}/overview`).then(checkOverview),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchAnswerHistoryTargetDetail(args: {
  submissionId: string;
  targetId: string;
  targetType: AnswerHistoryTargetType;
  cursor?: number | undefined;
  limit?: number | undefined;
}) {
  assertNonEmptyId('submission', args.submissionId);
  assertNonEmptyId('target', args.targetId);
  const query = new URLSearchParams({
    targetType: args.targetType,
    ...(typeof args.cursor === 'number' ? { cursor: String(args.cursor) } : {}),
    ...(typeof args.limit === 'number' ? { limit: String(args.limit) } : {}),
  });

  const key = `detail:submission:${args.submissionId}:${args.targetId}:${query.toString()}`;
  return dedupedGet(key, () =>
    backendGet<AnswerHistoryTargetDetail>(
      `/v1/answer-history/submissions/${encode(args.submissionId)}/targets/${encode(args.targetId)}?${query.toString()}`,
    ),
  );
}

export async function fetchAnswerHistoryTargetDetailByAttempt(args: {
  attemptId: string;
  targetId: string;
  targetType: AnswerHistoryTargetType;
  cursor?: number | undefined;
  limit?: number | undefined;
}) {
  assertNonEmptyId('attempt', args.attemptId);
  assertNonEmptyId('target', args.targetId);
  const query = new URLSearchParams({
    targetType: args.targetType,
    ...(typeof args.cursor === 'number' ? { cursor: String(args.cursor) } : {}),
    ...(typeof args.limit === 'number' ? { limit: String(args.limit) } : {}),
  });

  const key = `detail:attempt:${args.attemptId}:${args.targetId}:${query.toString()}`;
  return dedupedGet(key, () =>
    backendGet<AnswerHistoryTargetDetail>(
      `/v1/answer-history/attempts/${encode(args.attemptId)}/targets/${encode(args.targetId)}?${query.toString()}`,
    ),
  );
}

export async function fetchAnswerHistoryExport(args: {
  submissionId: string;
  targetId: string;
  targetType: AnswerHistoryTargetType;
  format: AnswerHistoryExportFormat;
}) {
  assertNonEmptyId('submission', args.submissionId);
  assertNonEmptyId('target', args.targetId);
  const query = new URLSearchParams({
    targetType: args.targetType,
    targetId: args.targetId,
    format: args.format,
  });

  return backendGet<AnswerHistoryExport>(
    `/v1/answer-history/submissions/${encode(args.submissionId)}/export?${query.toString()}`,
  );
}
