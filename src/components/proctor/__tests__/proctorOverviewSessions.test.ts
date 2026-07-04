import { describe, expect, it } from 'vitest';
import type { ExamGroup } from '../../../types';
import {
  filterPastSessionGroups,
  getOverviewBucket,
  parsePastSessionStatusFilter,
  type PastSessionStatusFilter,
} from '../proctorOverviewSessions';

function buildGroup(overrides: Partial<ExamGroup>): ExamGroup {
  return {
    id: overrides.id ?? 'group-1',
    scheduleId: overrides.scheduleId ?? overrides.id ?? 'sched-1',
    examId: 'exam-1',
    examTitle: 'Mock Exam',
    cohortName: 'Cohort A',
    scheduledStartTime: '2026-01-01T00:10:00.000Z',
    runtimeStatus: 'not_started',
    isReadyToStart: false,
    currentLiveSection: null,
    studentCount: 0,
    activeCount: 0,
    joinReadyCount: 0,
    joinTotalCount: 0,
    violationCount: 0,
    status: 'scheduled',
    plannedDurationMinutes: 180,
    ...overrides,
  };
}

describe('proctor overview session bucketing', () => {
  it('moves completed and cancelled groups to Past', () => {
    expect(getOverviewBucket(buildGroup({ runtimeStatus: 'completed', status: 'completed' }))).toBe('past');
    expect(getOverviewBucket(buildGroup({ runtimeStatus: 'cancelled', status: 'cancelled' }))).toBe('past');
  });

  it('keeps scheduled, ready, live, and paused groups in Active', () => {
    expect(getOverviewBucket(buildGroup({ runtimeStatus: 'not_started', status: 'scheduled' }))).toBe('active');
    expect(getOverviewBucket(buildGroup({ runtimeStatus: 'not_started', status: 'scheduled', isReadyToStart: true }))).toBe(
      'active',
    );
    expect(getOverviewBucket(buildGroup({ runtimeStatus: 'live', status: 'live' }))).toBe('active');
    expect(getOverviewBucket(buildGroup({ runtimeStatus: 'paused', status: 'live' }))).toBe('active');
  });

  it('filters Past without leaking active groups', () => {
    const groups = [
      buildGroup({ id: 'scheduled', runtimeStatus: 'not_started', status: 'scheduled' }),
      buildGroup({ id: 'completed', runtimeStatus: 'completed', status: 'completed' }),
      buildGroup({ id: 'cancelled', runtimeStatus: 'cancelled', status: 'cancelled' }),
      buildGroup({ id: 'live', runtimeStatus: 'live', status: 'live' }),
    ];

    expect(filterPastSessionGroups(groups, 'all').map((group) => group.id)).toEqual(['completed', 'cancelled']);
    expect(filterPastSessionGroups(groups, 'completed').map((group) => group.id)).toEqual(['completed']);
    expect(filterPastSessionGroups(groups, 'cancelled').map((group) => group.id)).toEqual(['cancelled']);
  });

  it('preserves the incoming order of matching Past groups', () => {
    const filter: PastSessionStatusFilter = 'all';
    const groups = [
      buildGroup({ id: 'cancelled-first', runtimeStatus: 'cancelled', status: 'cancelled' }),
      buildGroup({ id: 'completed-second', runtimeStatus: 'completed', status: 'completed' }),
    ];

    expect(filterPastSessionGroups(groups, filter).map((group) => group.id)).toEqual([
      'cancelled-first',
      'completed-second',
    ]);
  });

  it('parses Past status filters and rejects unknown input', () => {
    expect(parsePastSessionStatusFilter('all')).toBe('all');
    expect(parsePastSessionStatusFilter('completed')).toBe('completed');
    expect(parsePastSessionStatusFilter('cancelled')).toBe('cancelled');
    expect(parsePastSessionStatusFilter('archived')).toBeNull();
  });
});
