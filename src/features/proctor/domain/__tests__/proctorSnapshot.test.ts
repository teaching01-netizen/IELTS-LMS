import { describe, expect, it } from 'vitest';
import type { ProctorAlert, SessionAuditLog } from '../../../../types';
import {
  applyConfirmedStudentAction,
  emptyOverlay,
  mergeAuditWindow,
  reconcileAlertWindow,
  reconcileFullCollection,
  type CollectionOverlay,
} from '../proctorSnapshot';

type Row = { id: string; value: string };

function overlay(upserts: Row[] = [], deletes: string[] = []): CollectionOverlay<Row> {
  return { upserts: new Map(upserts.map((row) => [row.id, row])), deletes: new Set(deletes) };
}

function alert(id: string, minute: number, overrides: Partial<ProctorAlert> = {}): ProctorAlert {
  return {
    id,
    severity: 'high',
    type: 'VIOLATION_DETECTED',
    studentName: 'Student',
    studentId: 'student',
    timestamp: `2026-01-01T09:${String(minute).padStart(2, '0')}:00.000Z`,
    message: 'Tab switch detected.',
    isAcknowledged: false,
    ...overrides,
  };
}

const NO_IDS: ReadonlySet<string> = new Set();
const serverOnly = () => false;

describe('reconcileFullCollection', () => {
  it('treats a row the server no longer returns as deleted', () => {
    expect(reconcileFullCollection([{ id: 'a', value: '1' }], emptyOverlay<Row>())).toEqual([{ id: 'a', value: '1' }]);
    expect(reconcileFullCollection([], emptyOverlay<Row>())).toEqual([]);
  });

  it('shows pending upserts over, and pending deletes out of, the server rows', () => {
    const server = [{ id: 'a', value: 'server' }, { id: 'b', value: 'server' }];
    expect(
      reconcileFullCollection(server, overlay([{ id: 'a', value: 'mine' }, { id: 'c', value: 'new' }], ['b'])),
    ).toEqual([{ id: 'a', value: 'mine' }, { id: 'c', value: 'new' }]);
  });

  it('keeps a pending delete hidden even when a read still returns the row', () => {
    expect(reconcileFullCollection([{ id: 'a', value: 'server' }], overlay([], ['a']))).toEqual([]);
  });
});

describe('reconcileAlertWindow', () => {
  const base = { limit: 3, acknowledged: NO_IDS, reopened: NO_IDS, isLocalOnly: serverOnly };

  it('marks an alert acknowledged when it leaves a window that is not full', () => {
    const result = reconcileAlertWindow({ ...base, server: [alert('b', 2)], previous: [alert('a', 1), alert('b', 2)] });
    expect(result.map((row) => [row.id, row.isAcknowledged])).toEqual([['b', false], ['a', true]]);
  });

  it('does not treat a row pushed out of a full window as acknowledged', () => {
    const full = [alert('d', 4), alert('c', 3), alert('b', 2)];
    const result = reconcileAlertWindow({ ...base, server: full, previous: [alert('a', 1)] });
    expect(result.find((row) => row.id === 'a')?.isAcknowledged).toBe(false);
  });

  it('keeps an acknowledgement this client sent when a delayed read still returns the alert unacknowledged', () => {
    const result = reconcileAlertWindow({ ...base, server: [alert('a', 1)], previous: [], acknowledged: new Set(['a']) });
    expect(result[0]?.isAcknowledged).toBe(true);
  });

  it('shows a display-only reopen over a server acknowledgement', () => {
    const result = reconcileAlertWindow({
      ...base,
      server: [],
      previous: [alert('a', 1, { isAcknowledged: true })],
      acknowledged: new Set(['a']),
      reopened: new Set(['a']),
    });
    expect(result[0]?.isAcknowledged).toBe(false);
  });

  it('keeps client-only alerts the server never returns', () => {
    const local = alert('auto-rule-notify:1', 5);
    const result = reconcileAlertWindow({
      ...base,
      server: [],
      previous: [local],
      isLocalOnly: (row) => row.id.startsWith('auto-rule-notify:'),
    });
    expect(result).toEqual([local]);
  });
});

describe('mergeAuditWindow', () => {
  const entry = (id: string, minute: number, actor = 'Proctor'): SessionAuditLog => ({
    id,
    timestamp: `2026-01-01T09:${String(minute).padStart(2, '0')}:00.000Z`,
    actor,
    actionType: 'STUDENT_WARN',
    sessionId: 'sched-1',
  });

  it('keeps older entries a newest-N window omits and lets the server copy win', () => {
    const merged = mergeAuditWindow([entry('a', 1), entry('b', 2, 'old')], [entry('b', 2, 'new'), entry('c', 3)]);
    expect(merged.map((row) => [row.id, row.actor])).toEqual([['c', 'Proctor'], ['b', 'new'], ['a', 'Proctor']]);
  });
});

describe('applyConfirmedStudentAction', () => {
  const session = { status: 'active', warnings: 0, violations: [] as Array<{ id: string; type: string; severity: string; timestamp: string; description: string }> };
  const detail = { message: 'Eyes on screen', violationId: 'v-1', at: '2026-01-01T09:00:00.000Z' };

  it('records a warning as a status, count, and violation', () => {
    expect(applyConfirmedStudentAction(session, 'warn', detail)).toEqual({
      status: 'warned',
      warnings: 1,
      violations: [{ id: 'v-1', type: 'PROCTOR_WARNING', severity: 'medium', timestamp: detail.at, description: 'Eyes on screen' }],
    });
  });

  it.each([
    ['pause', 'paused'],
    ['resume', 'active'],
    ['terminate', 'terminated'],
  ] as const)('maps %s to %s', (action, status) => {
    expect(applyConfirmedStudentAction(session, action, detail).status).toBe(status);
  });
});
