import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { StudentSessionRoute } from '../StudentSessionRoute';

const imports = vi.hoisted(() => ({ sat: 0, ielts: 0 }));
const routeData = vi.hoisted(() => vi.fn());

vi.mock('../../../auth/api/authSession', () => ({
  useAuthSession: () => ({ status: 'authenticated', logoutAll: vi.fn() }),
}));
vi.mock('@student/hooks/useStudentSessionRouteData', () => ({
  useStudentSessionRouteData: (...args: unknown[]) => routeData(...args),
}));
vi.mock('../SatStudentDeliveryBranch', () => {
  imports.sat += 1;
  return { SatStudentDeliveryBranch: () => <div>SAT branch</div> };
});
vi.mock('../IeltsStudentDeliveryBranch', () => {
  imports.ielts += 1;
  return { IeltsStudentDeliveryBranch: () => <div>IELTS branch</div> };
});

it('imports only the resolved provider branch and keeps its own loading surface', async () => {
  const common = {
    error: null, retry: vi.fn(), runtimeSnapshot: null, refreshRuntime: vi.fn(),
    answerInvariantRollout: null, liveSocketConnected: false, satAttemptUpdateToken: 0,
    satBootstrapSeed: null,
  };
  routeData.mockReturnValue({ ...common, providerKey: 'unknown', isLoading: true, state: null, attemptSnapshot: null });
  const { rerender } = render(
    <MemoryRouter initialEntries={['/student/schedule/candidate']}>
      <Routes>
        <Route path="/student/:scheduleId/:studentId" element={<StudentSessionRoute />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  expect(imports).toEqual({ sat: 0, ielts: 0 });

  routeData.mockReturnValue({ ...common, providerKey: 'ielts', isLoading: false, state: {}, attemptSnapshot: null });
  rerender(
    <MemoryRouter initialEntries={['/student/schedule/candidate']}>
      <Routes><Route path="/student/:scheduleId/:studentId" element={<StudentSessionRoute />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText('IELTS branch')).toBeInTheDocument();
  expect(imports).toEqual({ sat: 0, ielts: 1 });

  routeData.mockReturnValue({ ...common, providerKey: 'sat', isLoading: false, state: {}, attemptSnapshot: { id: 'attempt', candidateId: 'candidate' } });
  rerender(
    <MemoryRouter initialEntries={['/student/schedule/candidate']}>
      <Routes><Route path="/student/:scheduleId/:studentId" element={<StudentSessionRoute />} /></Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText('Loading Digital SAT…')).toBeInTheDocument();
  expect(screen.queryByText('Loading Exam…')).not.toBeInTheDocument();
  expect(await screen.findByText('SAT branch')).toBeInTheDocument();
  expect(imports).toEqual({ sat: 1, ielts: 1 });
});
