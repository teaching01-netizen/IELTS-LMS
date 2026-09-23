import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StudentSession } from '../../../../types';
import { StudentDetail } from '../SatSessionRoomStudents';

const student: StudentSession = {
  id: 'attempt-1',
  studentId: 'A001',
  name: 'Ananda S.',
  email: 'ananda@example.com',
  scheduleId: 'sched-1',
  status: 'active',
  currentSection: 'reading',
  timeRemaining: 900,
  runtimeStatus: 'live',
  runtimeCurrentSection: 'reading',
  runtimeSectionStatus: 'live',
  runtimeTimeRemainingSeconds: 900,
  runtimeModuleRole: 'base',
  runtimeModuleRemainingSeconds: 600,
  violations: [],
  warnings: 0,
  lastActivity: '2026-09-20T02:00:00Z',
  examId: 'sat-1',
  examName: 'Practice Test 06',
};

function renderDetail(overrides: Partial<Parameters<typeof StudentDetail>[0]> = {}) {
  return render(
    <StudentDetail
      student={student}
      runtime={null}
      variant="operational"
      pendingActions={new Set()}
      blocked={false}
      onAddTime={vi.fn()}
      onWarn={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onTerminate={vi.fn()}
      {...overrides}
    />,
  );
}

describe('StudentDetail inspector priority', () => {
  it('puts violation details before exam state for flagged review records', () => {
    renderDetail({
      variant: 'review',
      student: {
        ...student,
        warnings: 1,
        violations: [{
          id: 'violation-1',
          type: 'tab_switch',
          severity: 'warning',
          timestamp: '2026-09-20T02:01:00Z',
          description: 'You left the exam screen.',
        }],
      },
    });

    const attention = screen.getByRole('region', { name: 'Attention 2' });
    const examState = screen.getByRole('region', { name: 'Exam state' });
    expect(attention.compareDocumentPosition(examState) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(attention).getByText('tab switch')).toBeInTheDocument();
    expect(within(attention).getByText('You left the exam screen.')).toBeInTheDocument();
  });

  it('shows healthy review state quietly after exam state', () => {
    renderDetail({ variant: 'review' });
    const examState = screen.getByRole('region', { name: 'Exam state' });
    const attention = screen.getByRole('region', { name: 'Attention 0' });
    expect(examState.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(attention).getByText('No current warnings or integrity events.')).toBeInTheDocument();
  });

  it('emphasizes current section and module timing during operation', () => {
    renderDetail();
    expect(screen.getByRole('region', { name: 'Current student state' })).toBeInTheDocument();
    expect(screen.getByText('Module 1')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Attention 0' })).toBeInTheDocument();
  });

  it('keeps terminated attempt clocks available and disables actions when blocked', () => {
    renderDetail({ student: { ...student, status: 'terminated' }, blocked: true });
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Student actions' }));
    expect(screen.getByRole('menuitem', { name: 'Add 5 minutes…' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'End attempt…' })).toBeDisabled();
  });
});
