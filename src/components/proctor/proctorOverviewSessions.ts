import type { ExamGroup } from '../../types';

export type OverviewBucket = 'active' | 'past';
export type PastSessionStatusFilter = 'all' | 'completed' | 'cancelled';

const PAST_RUNTIME_STATUSES = new Set<ExamGroup['runtimeStatus']>(['completed', 'cancelled']);
const PAST_STATUS_FILTERS = new Set<PastSessionStatusFilter>(['all', 'completed', 'cancelled']);

/**
 * Proctor overview invariant: terminal cohorts remain loaded for history, but
 * are separated from actionable Active monitoring by default.
 */
export function getOverviewBucket(group: Pick<ExamGroup, 'runtimeStatus'>): OverviewBucket {
  return PAST_RUNTIME_STATUSES.has(group.runtimeStatus) ? 'past' : 'active';
}

export function filterPastSessionGroups(
  groups: readonly ExamGroup[],
  statusFilter: PastSessionStatusFilter,
): ExamGroup[] {
  return groups.filter((group) => {
    if (getOverviewBucket(group) !== 'past') {
      return false;
    }

    return statusFilter === 'all' || group.runtimeStatus === statusFilter;
  });
}

export function parsePastSessionStatusFilter(value: string): PastSessionStatusFilter | null {
  return PAST_STATUS_FILTERS.has(value as PastSessionStatusFilter)
    ? (value as PastSessionStatusFilter)
    : null;
}
