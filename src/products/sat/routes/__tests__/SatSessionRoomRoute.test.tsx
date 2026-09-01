import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatSessionRoomRoute } from '../SatSessionRoomRoute';

const controllerMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/proctor/hooks/useProctorRouteController', () => ({ useProctorRouteController: controllerMock }));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { displayName: 'SAT Proctor', email: 'p@example.com' } } }),
}));
vi.mock('../../../../features/proctor/infrastructure/proctorGateway', () => ({
  examDeliveryService: {
    extendStudentAttempt: vi.fn(), warnStudent: vi.fn(), pauseStudentAttempt: vi.fn(), resumeStudentAttempt: vi.fn(), terminateStudentAttempt: vi.fn(),
  },
}));

const schedule = {
  id: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'Practice Test 06', proctorDisplayName: 'Practice Test 06',
  gradingDisplayName: 'Practice Test 06', publishedVersionId: 'v1', cohortName: 'Morning', startTime: '2026-08-30T02:00:00Z',
  endTime: '2026-08-30T06:00:00Z', plannedDurationMinutes: 180, deliveryMode: 'proctor_start', autoStart: false, autoStop: false,
  status: 'live', createdAt: '2026-08-30T00:00:00Z', createdBy: 'Admin', updatedAt: '2026-08-30T00:00:00Z',
};
const runtime = {
  id: 'runtime-1', scheduleId: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'Practice Test 06', cohortName: 'Morning',
  deliveryMode: 'proctor_start', status: 'live', timingModel: 'cohort_section_v3', actualStartAt: '2026-08-30T02:00:00Z', actualEndAt: null,
  activeSectionKey: 'reading', currentSectionKey: 'reading', currentSectionRemainingSeconds: 1603, waitingForNextSection: false, isOverrun: false,
  totalPausedSeconds: 0, sections: [{ sectionKey: 'reading', label: 'Reading & Writing · Module 1', order: 1, plannedDurationMinutes: 32,
    gapAfterMinutes: 0, status: 'live', availableAt: null, actualStartAt: '2026-08-30T02:00:00Z', actualEndAt: null, pausedAt: null,
    accumulatedPausedSeconds: 0, extensionMinutes: 0 }], createdAt: '2026-08-30T02:00:00Z', updatedAt: '2026-08-30T02:05:00Z',
};
const student = {
  id: 'attempt-1', studentId: 'W2501', name: 'Ananda S.', email: 'a@example.com', scheduleId: 'sched-1', status: 'active',
  currentSection: 'reading', timeRemaining: 1500, runtimeStatus: 'live', runtimeCurrentSection: 'reading', runtimeTimeRemainingSeconds: 1500,
  violations: [], warnings: 0, lastActivity: '2026-08-30T02:05:00Z', examId: 'sat-1', examName: 'Practice Test 06',
};

describe('SatSessionRoomRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
  });

  it('opens the controller explicitly in the SAT provider boundary', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(controllerMock).toHaveBeenCalledWith({ providerKey: 'sat', initialScheduleId: 'sched-1' });
    expect(screen.getAllByText('Reading & Writing · Module 1')).toHaveLength(2);
    expect(screen.getByText('Server-authoritative session clock')).toBeInTheDocument();
    expect(screen.getAllByText('Ananda S.')).toHaveLength(2);
  });

  it('marks loaded session data stale and disables risky actions while reconnecting', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: 'Network unavailable', isLoading: false,
      lastSuccessfulRefreshAt: '2026-08-30T02:05:00.000Z', reload: vi.fn(), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Data may be out of date');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
