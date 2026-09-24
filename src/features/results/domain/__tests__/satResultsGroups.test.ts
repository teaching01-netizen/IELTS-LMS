import { describe, expect, it } from 'vitest';
import type { SatResultSummary } from '../../api/satResultsQueries';
import type { SatExamGroup } from '../satResultsGroups';
import { filterSatAttempts, filterSatGroups, groupSatAccessGroups, groupSatResults } from '../satResultsGroups';

type RowOverrides = Partial<SatResultSummary>;

const baseRow = (overrides: RowOverrides = {}): SatResultSummary => ({
  id: 'r-1',
  submissionId: 'sub-1',
  outcomeStatus: 'scored',
  scheduleId: 'sched-1',
  examId: 'exam-A',
  examTitle: 'Practice Test 06',
  versionNumber: 1,
  studentId: 'W2501',
  studentName: 'Ananda S.',
  studentEmail: null,
  cohortName: 'Morning',
  submittedAt: '2026-08-30T08:00:00Z',
  totalScore: 1200,
  scoreKind: 'practice',
  releaseStatus: 'ready_to_release',
  ...overrides,
});

const groupById = (groups: SatExamGroup[]): Map<string, SatExamGroup> =>
  new Map(groups.map((group) => [group.examId, group]));

describe('groupSatResults', () => {
  it('returns [] for empty input', () => {
    expect(groupSatResults([])).toEqual([]);
    expect(filterSatGroups([], { needle: '', scoreFilter: 'all' })).toEqual([]);
  });

  it('keys groups by examId, never examTitle', () => {
    const rows = [
      baseRow({ id: 'r-a', examId: 'exam-A', examTitle: 'Practice Test 06', totalScore: 1200 }),
      baseRow({
        id: 'r-b',
        submissionId: 'sub-b',
        examId: 'exam-B',
        examTitle: 'Practice Test 06',
        studentId: 'W2502',
        studentName: 'Brian T.',
        totalScore: 1300,
      }),
    ];
    const groups = groupSatResults(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.examId).not.toBe(groups[1]?.examId);
    const byId = groupById(groups);
    expect(byId.get('exam-A')).toMatchObject({ total: 1, scored: 1, avgScore: 1200 });
    expect(byId.get('exam-B')).toMatchObject({ total: 1, scored: 1, avgScore: 1300 });
  });

  it('collects mixed versions as distinct sorted numbers', () => {
    const rows = [3, 1, 3, 2].map((versionNumber, index) =>
      baseRow({
        id: 'r-' + (index + 1),
        submissionId: 'sub-' + (index + 1),
        versionNumber,
        studentId: 'W250' + (index + 1),
        studentName: 'Student ' + (index + 1),
      }),
    );
    const groups = groupSatResults(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ versions: [1, 2, 3], total: 4 });
  });

  it('buckets missing examId defensively instead of dropping rows', () => {
    const rows = [
      baseRow({ id: 'r-1', examId: '', examTitle: '' }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        examId: '',
        examTitle: 'Practice Test 06',
        studentId: 'W2502',
        studentName: 'Brian T.',
      }),
    ];
    const groups = groupSatResults(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      examId: '__missing_exam__',
      examTitle: 'Untitled exam',
      total: 2,
    });
  });

  it('sorts null dates last and nulls latestSubmittedAt when no valid dates exist', () => {
    const rows = [
      baseRow({ id: 'r-zoe', studentId: 'W2509', studentName: 'Zoe Z.', submittedAt: null }),
      baseRow({
        id: 'r-amy',
        submissionId: 'sub-amy',
        studentId: 'W2501',
        studentName: 'Amy A.',
        submittedAt: '2026-08-30T08:00:00Z',
      }),
      baseRow({
        id: 'r-solo',
        submissionId: 'sub-solo',
        examId: 'exam-B',
        examTitle: 'Practice Test 07',
        studentId: 'W2601',
        studentName: 'Solo S.',
        submittedAt: null,
      }),
    ];
    const groups = groupSatResults(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.examId).toBe('exam-A');
    expect(groups[1]?.examId).toBe('exam-B');
    const byId = groupById(groups);
    expect(byId.get('exam-A')?.attempts.map((attempt) => attempt.studentName)).toEqual([
      'Amy A.',
      'Zoe Z.',
    ]);
    expect(byId.get('exam-A')?.latestSubmittedAt).toBe('2026-08-30T08:00:00Z');
    expect(byId.get('exam-B')?.latestSubmittedAt).toBeNull();
  });

  it('sorts groups by latestSubmittedAt desc, tie examTitle asc', () => {
    const rows = [
      baseRow({
        id: 'r-b',
        examId: 'exam-B',
        examTitle: 'Beta',
        submittedAt: '2026-08-31T08:00:00Z',
      }),
      baseRow({
        id: 'r-a',
        submissionId: 'sub-a',
        examId: 'exam-A',
        examTitle: 'Alpha',
        submittedAt: '2026-08-30T08:00:00Z',
      }),
      baseRow({
        id: 'r-c',
        submissionId: 'sub-c',
        examId: 'exam-C',
        examTitle: 'Alpha',
        submittedAt: '2026-08-30T08:00:00Z',
      }),
    ];
    const groups = groupSatResults(rows);
    expect(groups.map((group) => group.examId)).toEqual(['exam-B', 'exam-A', 'exam-C']);
  });

  it('never mutates inputs', () => {
    const rows = [
      baseRow({ id: 'r-1', studentName: 'Ananda S.', totalScore: 1200 }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        studentId: 'W2502',
        studentName: 'Brian T.',
        totalScore: 1300,
      }),
    ];
    const rowsSnapshot = JSON.parse(JSON.stringify(rows)) as SatResultSummary[];
    Object.freeze(rows);
    const groups = groupSatResults(rows);
    expect(groups).not.toBe(rows);
    expect(rows).toEqual(rowsSnapshot);

    const groupsSnapshot = JSON.parse(JSON.stringify(groups)) as SatExamGroup[];
    Object.freeze(groups);
    const filtered = filterSatGroups(groups, { needle: 'ananda', scoreFilter: 'all' });
    expect(filtered).not.toBe(groups);
    expect(groups).toEqual(groupsSnapshot);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).not.toBe(groups[0]);
    expect(filtered[0]?.attempts).not.toBe(groups[0]?.attempts);
  });

  it('rounds avgScore to the nearest integer over scored totals only', () => {
    const rounding = groupSatResults([
      baseRow({ id: 'r-1', studentId: 'W2501', studentName: 'Ananda S.', totalScore: 1400 }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        studentId: 'W2502',
        studentName: 'Brian T.',
        totalScore: 1401,
      }),
    ]);
    expect(rounding[0]).toMatchObject({ scored: 2, avgScore: 1401 });

    const mixed = groupSatResults([
      baseRow({ id: 'r-1', studentId: 'W2501', studentName: 'Ananda S.', totalScore: 1200 }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        outcomeStatus: 'pending',
        studentId: 'W2502',
        studentName: 'Brian T.',
        totalScore: null,
      }),
      baseRow({
        id: 'r-3',
        submissionId: 'sub-3',
        outcomeStatus: 'invalidated_proctor',
        studentId: 'W2503',
        studentName: 'Cara L.',
        totalScore: null,
      }),
    ]);
    expect(mixed[0]).toMatchObject({ total: 3, scored: 1, avgScore: 1200 });
  });
});

describe('groupSatAccessGroups', () => {
  it('groups schedules under exams and keeps pinned versions separate', () => {
    const groups = groupSatAccessGroups([
      { scheduleId: 'schedule-20', accessLinkId: 'link-20', accessLinkName: 'New link', accessLinkState: 'active', examId: 'exam-A', examTitle: 'SAT', versionNumber: 20, cohortName: 'B', attemptCount: 2, submittedCount: 2, scoredCount: 1, pendingCount: 1, invalidatedCount: 0, latestSubmittedAt: '2026-09-02T00:00:00Z' },
      { scheduleId: 'schedule-12', accessLinkId: null, accessLinkName: 'Previous Student Access', accessLinkState: null, examId: 'exam-A', examTitle: 'SAT', versionNumber: 12, cohortName: '', attemptCount: 1, submittedCount: 1, scoredCount: 0, pendingCount: 0, invalidatedCount: 1, latestSubmittedAt: '2026-09-01T00:00:00Z' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ examId: 'exam-A', total: 3, scored: 1, pending: 1, invalidated: 1, versions: [12, 20] });
    expect(groups[0]?.accessGroups?.map(({ scheduleId }) => scheduleId)).toEqual(['schedule-20', 'schedule-12']);
  });

  it('filters states within a schedule without moving attempts between groups', () => {
    const attempts = [
      { resultId: 'r-1', attemptId: 'a-1', outcomeStatus: 'scored' as const, releaseStatus: 'ready', totalScore: 1300, scheduleId: 'schedule-1', examId: 'exam-A', examTitle: 'SAT', versionNumber: 20, studentId: 'S1', studentName: 'A Student', studentEmail: null, cohortName: 'Group', submittedAt: null },
      { resultId: null, attemptId: 'a-2', outcomeStatus: 'unscored' as const, releaseStatus: '', totalScore: null, scheduleId: 'schedule-1', examId: 'exam-A', examTitle: 'SAT', versionNumber: 20, studentId: 'S2', studentName: 'B Student', studentEmail: null, cohortName: 'Group', submittedAt: null },
      { resultId: 'r-3', attemptId: 'a-3', outcomeStatus: 'invalidated_timeout' as const, releaseStatus: 'invalidated', totalScore: null, scheduleId: 'schedule-2', examId: 'exam-A', examTitle: 'SAT', versionNumber: 19, studentId: 'S3', studentName: 'C Student', studentEmail: null, cohortName: 'Other', submittedAt: null },
    ];
    expect(filterSatAttempts(attempts, { needle: 'student', scoreFilter: 'unavailable' }).map(({ attemptId }) => attemptId)).toEqual(['a-2', 'a-3']);
  });
});

describe('filterSatGroups', () => {
  it('computes null avgScore for an all-pending group', () => {
    const groups = groupSatResults([
      baseRow({ id: 'r-1', outcomeStatus: 'pending', totalScore: null }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        outcomeStatus: 'pending',
        studentId: 'W2502',
        studentName: 'Brian T.',
        totalScore: null,
      }),
    ]);
    expect(groups[0]).toMatchObject({
      total: 2,
      scored: 0,
      pending: 2,
      invalidated: 0,
      avgScore: null,
    });
    expect(
      filterSatGroups(groups, { needle: '', scoreFilter: 'available' }),
    ).toEqual([]);
    const kept = filterSatGroups(groups, { needle: '', scoreFilter: 'unavailable' });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ visibleAttempts: expect.any(Array) });
    expect(kept[0]?.visibleAttempts).toHaveLength(2);
    expect(kept[0]).toMatchObject({ hiddenCount: 0 });
  });

  it('counts both invalidation kinds and nulls the average', () => {
    const groups = groupSatResults([
      baseRow({ id: 'r-1', outcomeStatus: 'invalidated_proctor', totalScore: null }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        outcomeStatus: 'invalidated_timeout',
        studentId: 'W2502',
        studentName: 'Brian T.',
        totalScore: null,
      }),
    ]);
    expect(groups[0]).toMatchObject({
      total: 2,
      scored: 0,
      pending: 0,
      invalidated: 2,
      avgScore: null,
    });
    expect(
      filterSatGroups(groups, { needle: '', scoreFilter: 'available' }),
    ).toEqual([]);
    const kept = filterSatGroups(groups, { needle: '', scoreFilter: 'unavailable' });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.visibleAttempts).toHaveLength(2);
  });

  it('excludes scored-status rows with null totalScore from scored count and average', () => {
    const groups = groupSatResults([
      baseRow({ id: 'r-1', totalScore: 1400 }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        studentId: 'W2502',
        studentName: 'Brian T.',
        totalScore: 1200,
      }),
      baseRow({
        id: 'r-3',
        submissionId: 'sub-3',
        studentId: 'W2503',
        studentName: 'Cara L.',
        totalScore: null,
      }),
    ]);
    expect(groups[0]).toMatchObject({ total: 3, scored: 2, avgScore: 1300 });

    const available = filterSatGroups(groups, { needle: '', scoreFilter: 'available' });
    expect(available).toHaveLength(1);
    expect(available[0]?.visibleAttempts).toHaveLength(2);
    expect(available[0]).toMatchObject({ hiddenCount: 1 });

    const unavailable = filterSatGroups(groups, { needle: '', scoreFilter: 'unavailable' });
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.visibleAttempts).toHaveLength(1);
    expect(unavailable[0]?.visibleAttempts[0]?.totalScore).toBeNull();
    expect(unavailable[0]).toMatchObject({ hiddenCount: 2 });
  });

  it('treats empty and whitespace needles as no search', () => {
    const groups = groupSatResults([
      baseRow({ id: 'r-1' }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        studentId: 'W2502',
        studentName: 'Brian T.',
      }),
    ]);
    for (const needle of ['', '   ', '\t \n']) {
      const filtered = filterSatGroups(groups, { needle, scoreFilter: 'all' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.visibleAttempts).toHaveLength(2);
      expect(filtered[0]).toMatchObject({ hiddenCount: 0 });
    }
  });

  it('counts unknown outcome strings in total only and never throws', () => {
    const groups = groupSatResults([
      baseRow({
        id: 'r-1',
        outcomeStatus: 'archived' as unknown as SatResultSummary['outcomeStatus'],
        totalScore: 1500,
      }),
    ]);
    expect(groups[0]).toMatchObject({
      total: 1,
      scored: 0,
      pending: 0,
      invalidated: 0,
      avgScore: null,
    });
    expect(
      filterSatGroups(groups, { needle: '', scoreFilter: 'available' }),
    ).toEqual([]);
    const kept = filterSatGroups(groups, { needle: '', scoreFilter: 'unavailable' });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.visibleAttempts).toHaveLength(1);
  });

  it('keeps the whole group on exam-title match and narrows on student match with hiddenCount', () => {
    const groups = groupSatResults([
      baseRow({ id: 'r-1', studentId: 'W2501', studentName: 'Ananda S.', cohortName: 'Morning' }),
      baseRow({
        id: 'r-2',
        submissionId: 'sub-2',
        studentId: 'W2502',
        studentName: 'Brian T.',
        cohortName: 'Evening',
      }),
      baseRow({
        id: 'r-3',
        submissionId: 'sub-3',
        studentId: 'W2503',
        studentName: 'Cara L.',
        cohortName: 'Morning',
      }),
    ]);

    const byTitle = filterSatGroups(groups, { needle: 'practice test', scoreFilter: 'all' });
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0]?.visibleAttempts).toHaveLength(3);
    expect(byTitle[0]).toMatchObject({ hiddenCount: 0 });

    const byStudent = filterSatGroups(groups, { needle: 'ananda', scoreFilter: 'all' });
    expect(byStudent).toHaveLength(1);
    expect(byStudent[0]?.visibleAttempts).toHaveLength(1);
    expect(byStudent[0]?.visibleAttempts[0]?.studentName).toBe('Ananda S.');
    expect(byStudent[0]).toMatchObject({ hiddenCount: 2 });

    const byId = filterSatGroups(groups, { needle: 'w2502', scoreFilter: 'all' });
    expect(byId).toHaveLength(1);
    expect(byId[0]?.visibleAttempts.map((attempt) => attempt.studentName)).toEqual(['Brian T.']);

    const byCohort = filterSatGroups(groups, { needle: 'morning', scoreFilter: 'all' });
    expect(byCohort).toHaveLength(1);
    expect(byCohort[0]?.visibleAttempts).toHaveLength(2);
    expect(byCohort[0]).toMatchObject({ hiddenCount: 1 });

    expect(
      filterSatGroups(groups, { needle: 'zzz-no-match', scoreFilter: 'all' }),
    ).toEqual([]);

    const upper = filterSatGroups(groups, { needle: 'ANANDA', scoreFilter: 'all' });
    expect(upper[0]?.visibleAttempts).toHaveLength(1);
  });

  it('applies score filter before search and drops empty groups', () => {
    const groups = groupSatResults([
      baseRow({ id: 'r-a1', examId: 'exam-A', totalScore: 1200 }),
      baseRow({
        id: 'r-a2',
        submissionId: 'sub-a2',
        examId: 'exam-A',
        outcomeStatus: 'pending',
        studentId: 'W2502',
        studentName: 'Brian T.',
        totalScore: null,
      }),
      baseRow({
        id: 'r-b1',
        submissionId: 'sub-b1',
        examId: 'exam-B',
        examTitle: 'Practice Test 07',
        outcomeStatus: 'pending',
        studentId: 'W2601',
        studentName: 'Solo S.',
        totalScore: null,
      }),
    ]);

    const available = filterSatGroups(groups, { needle: '', scoreFilter: 'available' });
    expect(available.map((group) => group.examId)).toEqual(['exam-A']);
    expect(available[0]?.visibleAttempts).toHaveLength(1);
    expect(available[0]?.visibleAttempts[0]?.outcomeStatus).toBe('scored');

    const unavailable = filterSatGroups(groups, { needle: '', scoreFilter: 'unavailable' });
    expect(unavailable).toHaveLength(2);
    const byId = new Map(unavailable.map((group) => [group.examId, group]));
    expect(byId.get('exam-A')?.visibleAttempts).toHaveLength(1);
    expect(byId.get('exam-A')?.visibleAttempts[0]?.outcomeStatus).toBe('pending');
    expect(byId.get('exam-B')?.visibleAttempts).toHaveLength(1);
  });
});
