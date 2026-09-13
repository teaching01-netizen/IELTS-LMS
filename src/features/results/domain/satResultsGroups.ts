import type { SatResultSummary } from '../api/satResultsQueries';

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
