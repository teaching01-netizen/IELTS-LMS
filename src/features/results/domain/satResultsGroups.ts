import type { SatAccessGroupSummary, SatAttemptRow, SatResultSummary } from '../api/satResultsQueries';

export type SatScoreFilter = 'all' | 'available' | 'unavailable';

export interface SatExamGroup {
  examId: string;
  examTitle: string;
  /** Sorted distinct ascending, e.g. [1, 2, 3]. */
  versions: number[];
  /** ALL attempts in the group, sorted submittedAt desc (null/invalid last), tie studentName asc, tie id asc. */
  attempts: SatResultSummary[];
  total: number;
  scored: number;
  pending: number;
  invalidated: number;
  /** Rounded mean of scored totals only; null when scored === 0. */
  avgScore: number | null;
  /** Original string of the max valid submittedAt; null when no valid dates. */
  latestSubmittedAt: string | null;
  /** Populated by groupSatAccessGroups for the workspace drill-down. */
  accessGroups?: SatAccessGroupSummary[];
}

export interface FilteredSatAccessGroup {
  group: SatAccessGroupSummary;
  visibleAttempts: SatAttemptRow[];
  hiddenCount: number;
}

export interface FilteredSatExamGroup extends Omit<SatExamGroup, 'attempts'> {
  /** Frozen canonical full list (copied array, shared row refs) — header truth stays stable under search. */
  attempts: SatResultSummary[];
  /** Filtered subset, same attempt sort order. */
  visibleAttempts: SatResultSummary[];
  /** attempts.length - visibleAttempts.length. */
  hiddenCount: number;
}

export interface FilterSatGroupsOptions {
  /** Raw search input; trimmed internally. */
  needle: string;
  scoreFilter: SatScoreFilter;
}

const MISSING_EXAM_KEY = '__missing_exam__';
const UNTITLED_EXAM = 'Untitled exam';

function isScoreAvailable(row: SatResultSummary): boolean {
  return row.outcomeStatus === 'scored' && row.totalScore != null;
}

function groupKeyFor(row: SatResultSummary): string {
  const key = (row.examId ?? '').trim();
  return key === '' ? MISSING_EXAM_KEY : key;
}

function groupTitleFor(firstSeen: SatResultSummary): string {
  return (firstSeen.examTitle ?? '').trim() || UNTITLED_EXAM;
}

function timeOrNull(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function compareStringsAsc(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function compareAttemptsDesc(a: SatResultSummary, b: SatResultSummary): number {
  const aTime = timeOrNull(a.submittedAt);
  const bTime = timeOrNull(b.submittedAt);
  if (aTime !== null || bTime !== null) {
    if (aTime === null) {
      return 1;
    }
    if (bTime === null) {
      return -1;
    }
    if (aTime !== bTime) {
      return bTime - aTime;
    }
  }
  const byName = (a.studentName ?? '').localeCompare(b.studentName ?? '');
  if (byName !== 0) {
    return byName;
  }
  return compareStringsAsc(a.id ?? '', b.id ?? '');
}

export function groupSatResults(rows: SatResultSummary[]): SatExamGroup[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const buckets = new Map<string, { firstSeen: SatResultSummary; rows: SatResultSummary[] }>();
  for (const row of rows) {
    if (row === null || row === undefined) {
      continue;
    }
    const key = groupKeyFor(row);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { firstSeen: row, rows: [row] });
    } else {
      bucket.rows.push(row);
    }
  }

  const groups: SatExamGroup[] = [];
  for (const [key, bucket] of buckets) {
    const attempts = [...bucket.rows].sort(compareAttemptsDesc);

    const versionSet = new Set<number>();
    for (const attempt of attempts) {
      if (typeof attempt.versionNumber === 'number' && Number.isFinite(attempt.versionNumber)) {
        versionSet.add(attempt.versionNumber);
      }
    }
    const versions = [...versionSet].sort((a, b) => a - b);

    let scored = 0;
    let pending = 0;
    let invalidated = 0;
    let scoreSum = 0;
    for (const attempt of attempts) {
      if (attempt.outcomeStatus === 'scored' && attempt.totalScore != null) {
        scored += 1;
        scoreSum += attempt.totalScore;
      }
      if (attempt.outcomeStatus === 'pending') {
        pending += 1;
      } else if (
        typeof attempt.outcomeStatus === 'string' &&
        attempt.outcomeStatus.startsWith('invalidated')
      ) {
        invalidated += 1;
      }
    }

    let latestSubmittedAt: string | null = null;
    let latestTime: number | null = null;
    for (const attempt of attempts) {
      const time = timeOrNull(attempt.submittedAt);
      if (time !== null && (latestTime === null || time > latestTime)) {
        latestTime = time;
        latestSubmittedAt = attempt.submittedAt;
      }
    }

    groups.push({
      examId: key,
      examTitle: groupTitleFor(bucket.firstSeen),
      versions,
      attempts,
      total: attempts.length,
      scored,
      pending,
      invalidated,
      avgScore: scored === 0 ? null : Math.round(scoreSum / scored),
      latestSubmittedAt,
    });
  }

  groups.sort((a, b) => {
    const aTime = timeOrNull(a.latestSubmittedAt);
    const bTime = timeOrNull(b.latestSubmittedAt);
    if (aTime !== null || bTime !== null) {
      if (aTime === null) {
        return 1;
      }
      if (bTime === null) {
        return -1;
      }
      if (aTime !== bTime) {
        return bTime - aTime;
      }
    }
    const byTitle = a.examTitle.localeCompare(b.examTitle);
    if (byTitle !== 0) {
      return byTitle;
    }
    return compareStringsAsc(a.examId, b.examId);
  });

  return groups;
}

export function groupSatAccessGroups(rows: SatAccessGroupSummary[]): SatExamGroup[] {
  const buckets = new Map<string, SatAccessGroupSummary[]>();
  for (const row of rows ?? []) {
    const key = (row.examId ?? '').trim() || MISSING_EXAM_KEY;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  const groups: SatExamGroup[] = [];
  for (const [examId, accessGroups] of buckets) {
    const sortedAccess = [...accessGroups].sort((a, b) => {
      const timeOrder = (timeOrNull(b.latestSubmittedAt) ?? 0) - (timeOrNull(a.latestSubmittedAt) ?? 0);
      return timeOrder || a.accessLinkName.localeCompare(b.accessLinkName) || compareStringsAsc(a.scheduleId, b.scheduleId);
    });
    const first = sortedAccess[0];
    if (!first) continue;
    const total = sortedAccess.reduce((sum, group) => sum + group.attemptCount, 0);
    const scored = sortedAccess.reduce((sum, group) => sum + group.scoredCount, 0);
    const pending = sortedAccess.reduce((sum, group) => sum + group.pendingCount, 0);
    const invalidated = sortedAccess.reduce((sum, group) => sum + group.invalidatedCount, 0);
    const versions = [...new Set(sortedAccess.map((group) => group.versionNumber).filter(Number.isFinite))].sort((a, b) => a - b);
    const latestSubmittedAt = sortedAccess.reduce<string | null>((latest, group) => {
      const current = timeOrNull(group.latestSubmittedAt);
      return current != null && (latest == null || current > (timeOrNull(latest) ?? -Infinity)) ? group.latestSubmittedAt : latest;
    }, null);
    groups.push({
      examId,
      examTitle: first.examTitle.trim() || UNTITLED_EXAM,
      versions,
      attempts: [],
      total,
      scored,
      pending,
      invalidated,
      avgScore: null,
      latestSubmittedAt,
      accessGroups: sortedAccess,
    });
  }
  return groups.sort((a, b) => {
    const timeOrder = (timeOrNull(b.latestSubmittedAt) ?? 0) - (timeOrNull(a.latestSubmittedAt) ?? 0);
    return timeOrder || a.examTitle.localeCompare(b.examTitle) || compareStringsAsc(a.examId, b.examId);
  });
}

export function filterSatAttempts(rows: SatAttemptRow[], options: FilterSatGroupsOptions): FilteredSatAccessGroup['visibleAttempts'] {
  const needle = (typeof options?.needle === 'string' ? options.needle : '').trim().toLocaleLowerCase();
  const scoreFilter = options?.scoreFilter === 'available' || options?.scoreFilter === 'unavailable' ? options.scoreFilter : 'all';
  return (rows ?? []).filter((row) => {
    const available = row.outcomeStatus === 'scored' && row.totalScore != null;
    if (scoreFilter === 'available' && !available) return false;
    if (scoreFilter === 'unavailable' && available) return false;
    return needle === '' || [row.studentName, row.studentId, row.cohortName].some((value) => (value ?? '').toLocaleLowerCase().includes(needle));
  });
}

export function filterSatGroups(
  groups: SatExamGroup[],
  options: FilterSatGroupsOptions,
): FilteredSatExamGroup[] {
  if (!Array.isArray(groups) || groups.length === 0) {
    return [];
  }

  const scoreInput: unknown = options?.scoreFilter;
  const scoreFilter: SatScoreFilter =
    scoreInput === 'available' || scoreInput === 'unavailable' ? scoreInput : 'all';

  const needleInput: unknown = options?.needle;
  const needle = (typeof needleInput === 'string' ? needleInput : '').trim().toLocaleLowerCase();

  const visible: FilteredSatExamGroup[] = [];
  for (const group of groups) {
    if (group === null || group === undefined) {
      continue;
    }

    let scoreKept: SatResultSummary[];
    if (scoreFilter === 'available') {
      scoreKept = group.attempts.filter(isScoreAvailable);
    } else if (scoreFilter === 'unavailable') {
      scoreKept = group.attempts.filter((attempt) => !isScoreAvailable(attempt));
    } else {
      scoreKept = [...group.attempts];
    }

    let visibleAttempts: SatResultSummary[];
    if (needle === '') {
      visibleAttempts = scoreKept;
    } else if ((group.examTitle ?? '').toLocaleLowerCase().includes(needle)) {
      visibleAttempts = scoreKept;
    } else {
      visibleAttempts = scoreKept.filter(
        (attempt) =>
          (attempt.studentName ?? '').toLocaleLowerCase().includes(needle) ||
          (attempt.studentId ?? '').toLocaleLowerCase().includes(needle) ||
          (attempt.cohortName ?? '').toLocaleLowerCase().includes(needle),
      );
    }

    if (visibleAttempts.length === 0) {
      continue;
    }

    visible.push({
      examId: group.examId,
      examTitle: group.examTitle,
      versions: [...group.versions],
      attempts: [...group.attempts],
      total: group.total,
      scored: group.scored,
      pending: group.pending,
      invalidated: group.invalidated,
      avgScore: group.avgScore,
      latestSubmittedAt: group.latestSubmittedAt,
      visibleAttempts,
      hiddenCount: group.attempts.length - visibleAttempts.length,
    });
  }

  return visible;
}
