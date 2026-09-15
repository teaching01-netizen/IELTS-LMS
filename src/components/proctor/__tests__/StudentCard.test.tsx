import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentCard } from '../StudentCard';
import type { StudentSession } from '../../../types';

// The proctor's between-sections signal. It is read straight off the runtime's
// `waiting_for_next_section` flag, which the projection used to force to false
// for every SAT schedule — so the badge could never appear on the one model
// that has an authored break. These cases pin that the flag reaches the card
// and that a live section shows nothing.
function session(overrides: Partial<StudentSession> = {}): StudentSession {
  return {
    id: 'student-1',
    studentId: 'STU-001',
    name: 'Jane Roe',
    email: 'jane@example.com',
    scheduleId: 'sched-1',
    status: 'active',
    currentSection: 'reading',
    timeRemaining: 1200,
    runtimeStatus: 'live',
    runtimeCurrentSection: 'reading',
    runtimeTimeRemainingSeconds: 1200,
    runtimeWaiting: false,
    violations: [],
    warnings: 0,
    lastActivity: '2026-01-01T00:12:00.000Z',
    examId: 'exam-1',
    examName: 'Mock Exam',
    ...overrides,
  };
}

function renderCard(overrides: Partial<StudentSession> = {}) {
  return render(
    <StudentCard
      session={session(overrides)}
      isSelected={false}
      isSelectionEnabled={false}
      isMultiSelected={false}
      onClick={vi.fn()}
      onAction={vi.fn()}
      onToggleSelection={vi.fn()}
    />,
  );
}

describe('StudentCard between-sections indicator', () => {
  it('shows the break chip while the runtime waits for the next section', () => {
    renderCard({ runtimeWaiting: true });

    expect(screen.getByText('on break')).toBeInTheDocument();
  });

  it('shows no break chip while a section is live', () => {
    renderCard({ runtimeWaiting: false });

    expect(screen.queryByText('on break')).not.toBeInTheDocument();
  });
});
