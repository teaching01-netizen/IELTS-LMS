import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentAccessLinkEntryRoute } from '../StudentAccessLinkEntryRoute';
import type { PublicStudentAccessLink } from '../../contracts/access-link/PublicStudentAccessLink';

const mocks = vi.hoisted(() => ({
  studentEntry: vi.fn(),
  link: null as PublicStudentAccessLink | null,
  error: null as Error | null,
  isLoading: false,
}));

vi.mock('../../../auth/api/authSession', () => ({
  useAuthSession: () => ({ studentEntry: mocks.studentEntry }),
}));

vi.mock('../../api/access-link/studentAccessLinkQueries', () => ({
  useStudentAccessLink: () => ({
    data: mocks.link,
    error: mocks.error,
    isLoading: mocks.isLoading,
  }),
}));

function liveLink(overrides: Partial<PublicStudentAccessLink> = {}): PublicStudentAccessLink {
  return {
    id: 'link-public-1',
    examTitle: 'Digital SAT',
    providerKey: 'sat',
    versionNumber: 4,
    name: 'Saturday Class',
    audienceType: 'anyone',
    audienceLabel: null,
    accessMode: 'open',
    availabilityType: 'anytime',
    opensAt: null,
    closesAt: null,
    status: 'live',
    ...overrides,
  };
}

function DestinationProbe() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}</div>;
}

function renderRoute() {
  render(
    <MemoryRouter initialEntries={['/join/link-public-1']}>
      <Routes>
        <Route path="/join/:accessLinkId" element={<StudentAccessLinkEntryRoute />} />
        <Route path="/student/:scheduleId/:studentId" element={<DestinationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function enterIdentity() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Student' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ADA@example.com' } });
}

beforeEach(() => {
  mocks.studentEntry.mockReset();
  mocks.link = liveLink();
  mocks.error = null;
  mocks.isLoading = false;
  window.localStorage.clear();
});

describe('StudentAccessLinkEntryRoute', () => {
  it('uses the public link id only, omits student code for open links, and navigates with the server-issued handoff', async () => {
    mocks.studentEntry.mockResolvedValue({
      user: { id: 'user-1', email: 'ada@example.com', role: 'student', state: 'active' },
      csrfToken: 'csrf',
      expiresAt: '2026-08-29T00:00:00.000Z',
      scheduleId: 'internal-schedule-1',
      studentCode: 'guest-server-issued',
    });
    renderRoute();

    expect(screen.queryByLabelText('Student code')).not.toBeInTheDocument();
    enterIdentity();
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => expect(mocks.studentEntry).toHaveBeenCalledWith({
      accessLinkId: 'link-public-1',
      wcode: '',
      email: 'ada@example.com',
      studentName: 'Ada Student',
    }));
    expect(await screen.findByTestId('destination')).toHaveTextContent(
      '/student/internal-schedule-1/guest-server-issued',
    );
  });

  it('requires and forwards a code for selected-student links', async () => {
    mocks.link = liveLink({
      audienceType: 'selected_students',
      audienceLabel: 'Scholarship Cohort',
      accessMode: 'student_code',
    });
    mocks.studentEntry.mockResolvedValue({
      user: { id: 'user-2', email: 'ada@example.com', role: 'student', state: 'active' },
      csrfToken: 'csrf',
      expiresAt: '2026-08-29T00:00:00.000Z',
      scheduleId: 'internal-schedule-2',
      studentCode: 'W123456',
    });
    renderRoute();

    enterIdentity();
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(await screen.findByText('Enter the student code provided by your teacher.')).toBeInTheDocument();
    expect(mocks.studentEntry).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Student code'), { target: { value: 'w123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(mocks.studentEntry).toHaveBeenCalledWith(expect.objectContaining({
      accessLinkId: 'link-public-1',
      wcode: 'W123456',
    })));
  });

  it('renders availability as a terminal entry state and never authenticates before the window opens', () => {
    mocks.link = liveLink({
      availabilityType: 'scheduled',
      opensAt: '2026-09-01T02:00:00.000Z',
      closesAt: '2026-09-01T06:00:00.000Z',
      status: 'upcoming',
    });
    renderRoute();

    expect(screen.getByRole('heading', { name: "This exam isn’t open yet" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/i })).not.toBeInTheDocument();
    expect(mocks.studentEntry).not.toHaveBeenCalled();
  });
});
