import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditLogPanel } from '../AuditLogPanel';
import type { SessionAuditLog } from '../../../types';

const SESSION_ID = 'sess-1';

function makeLog(overrides: Partial<SessionAuditLog> & { id: string }): SessionAuditLog {
  return {
    timestamp: '2026-01-01T10:00:00.000Z',
    actor: 'Alice Proctor',
    actionType: 'SESSION_START',
    sessionId: SESSION_ID,
    ...overrides,
  };
}

const baseLogs: SessionAuditLog[] = [
  makeLog({ id: 'log-1', timestamp: '2026-01-01T10:00:00.000Z', actor: 'Alice Proctor', actionType: 'SESSION_START' }),
  makeLog({
    id: 'log-2',
    timestamp: '2026-01-01T11:00:00.000Z',
    actor: 'Bob Proctor',
    actionType: 'STUDENT_WARN',
    targetStudentId: 'STU-001',
    payload: { reason: 'noise' },
  }),
  makeLog({
    id: 'log-3',
    timestamp: '2026-01-01T12:00:00.000Z',
    actor: 'Alice Proctor',
    actionType: 'NOTE_CREATED',
    targetStudentId: 'STU-002',
  }),
];

function renderPanel(logs: SessionAuditLog[] = baseLogs, sessionId = SESSION_ID) {
  const onClose = vi.fn();
  const result = render(<AuditLogPanel auditLogs={logs} sessionId={sessionId} onClose={onClose} />);
  return { ...result, onClose };
}

function countText(s: string): string {
  return '3 entries for session ' + s;
}

describe('AuditLogPanel', () => {
  it('renders audit events with actor, action, target, and entry count', () => {
    renderPanel();
    expect(screen.getByText('Session Audit Trail')).toBeInTheDocument();
    expect(screen.getByText(countText(SESSION_ID))).toBeInTheDocument();
    expect(screen.getAllByText('Alice Proctor')).toHaveLength(2);
    expect(screen.getByText('Bob Proctor')).toBeInTheDocument();
    expect(screen.getByText('SESSION START')).toBeInTheDocument();
    expect(screen.getByText('STUDENT WARN')).toBeInTheDocument();
    expect(screen.getByText('NOTE CREATED')).toBeInTheDocument();
    expect(screen.getByText('STU-001')).toBeInTheDocument();
    expect(screen.getByText('STU-002')).toBeInTheDocument();
    expect(screen.getByText('View details')).toBeInTheDocument();
  });

  it('only shows logs for the current session', () => {
    const otherSessionLog = makeLog({
      id: 'log-other',
      actor: 'Other Guy',
      actionType: 'SESSION_START',
      sessionId: 'sess-other',
    });
    renderPanel([...baseLogs, otherSessionLog]);
    expect(screen.queryByText('Other Guy')).not.toBeInTheDocument();
    expect(screen.getByText(countText(SESSION_ID))).toBeInTheDocument();
  });

  it('renders payload event names in place of the raw action type', () => {
    const custom = makeLog({
      id: 'log-custom',
      timestamp: '2026-01-01T13:00:00.000Z',
      actor: 'System',
      actionType: 'AUTO_ACTION',
      payload: { event: 'CUSTOM_EVENT' },
    });
    renderPanel([...baseLogs, custom]);
    expect(screen.getByText('CUSTOM EVENT')).toBeInTheDocument();
  });

  it('filters events by actor via the search box', () => {
    renderPanel();
    const search = screen.getByPlaceholderText('Search logs...');
    fireEvent.change(search, { target: { value: 'bob' } });
    expect(screen.queryByText('Alice Proctor')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Proctor')).toBeInTheDocument();
    expect(screen.getByText('1 entries for session ' + SESSION_ID)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByText('Alice Proctor')).toHaveLength(2);
  });

  it('filters events by action type and clears filters', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    const select = screen.getByDisplayValue('All Actions');
    fireEvent.change(select, { target: { value: 'STUDENT_WARN' } });
    expect(screen.getByText('Bob Proctor')).toBeInTheDocument();
    expect(screen.queryByText('SESSION START')).not.toBeInTheDocument();
    expect(screen.queryByText('NOTE CREATED')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear Filters/i }));
    expect(screen.getByText('SESSION START')).toBeInTheDocument();
    expect(screen.getByText('NOTE CREATED')).toBeInTheDocument();
  });

  it('filters events by target student id', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    fireEvent.change(screen.getByPlaceholderText('Filter by student ID...'), {
      target: { value: 'stu-001' },
    });
    expect(screen.getByText('STU-001')).toBeInTheDocument();
    expect(screen.queryByText('STU-002')).not.toBeInTheDocument();
    // NOTE: events without a targetStudentId pass through the student-ID filter
    // (the panel only excludes logs that HAVE a non-matching targetStudentId).
    expect(screen.getByText('SESSION START')).toBeInTheDocument();
  });

  it('toggles timestamp sort order when the Timestamp header is clicked', () => {
    const { container } = renderPanel();
    const indexOf = (label: string) => container.textContent?.indexOf(label) ?? -1;
    // Default is newest-first: NOTE_CREATED, STUDENT_WARN, SESSION_START.
    expect(indexOf('NOTE CREATED')).toBeLessThan(indexOf('STUDENT WARN'));
    expect(indexOf('STUDENT WARN')).toBeLessThan(indexOf('SESSION START'));
    fireEvent.click(screen.getByText('Timestamp'));
    // Ascending: oldest first.
    expect(indexOf('SESSION START')).toBeLessThan(indexOf('STUDENT WARN'));
    expect(indexOf('STUDENT WARN')).toBeLessThan(indexOf('NOTE CREATED'));
  });

  it('sorts events by actor when the Actor header is clicked', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByText('Actor'));
    let text = container.textContent ?? '';
    // First click switches to actor sort, desc: Bob before Alice.
    expect(text.indexOf('Bob Proctor')).toBeLessThan(text.indexOf('Alice Proctor'));
    fireEvent.click(screen.getByText('Actor'));
    // Second click flips to asc: Alice before Bob.
    text = container.textContent ?? '';
    expect(text.indexOf('Alice Proctor')).toBeLessThan(text.indexOf('Bob Proctor'));
  });

  it('renders the empty state when there are no logs', () => {
    renderPanel([]);
    expect(screen.getByText('No audit logs found')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
    expect(screen.getByText('0 entries for session ' + SESSION_ID)).toBeInTheDocument();
  });

  it('renders the empty state when filters exclude every event', () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('Search logs...'), {
      target: { value: 'nobody-matches-this' },
    });
    expect(screen.getByText('No audit logs found')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const { onClose } = renderPanel();
    const buttons = screen.getAllByRole('button');
    const closeButton = buttons.find((button) => button.textContent === '');
    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('export buttons are no-ops (not crashes) with no rows to export', () => {
    renderPanel([]);
    expect(() => {
      fireEvent.click(screen.getByTitle('Export as CSV'));
      fireEvent.click(screen.getByTitle('Export as JSON'));
    }).not.toThrow();
    expect(screen.getByText('No audit logs found')).toBeInTheDocument();
  });
});
