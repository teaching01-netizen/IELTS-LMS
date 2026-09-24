import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { StudentSessionRoute } from '../StudentSessionRoute';

const imports = vi.hoisted(() => ({ sat: 0, ielts: 0 }));
vi.mock('../../../auth/api/authSession', () => ({
  useAuthSession: () => ({ status: 'authenticated', logoutAll: vi.fn() }),
}));
vi.mock('@student/hooks/useStudentSessionRouteData', () => ({
  useStudentSessionRouteData: () => ({
    error: null, retry: vi.fn(), runtimeSnapshot: null, refreshRuntime: vi.fn(),
    answerInvariantRollout: null, liveSocketConnected: false, satAttemptUpdateToken: 0,
    satBootstrapSeed: null, providerKey: 'ielts', isLoading: false, state: {},
    attemptSnapshot: null,
  }),
}));
vi.mock('../SatStudentDeliveryBranch', () => {
  imports.sat += 1;
  return { SatStudentDeliveryBranch: () => <div>SAT cold entry</div> };
});
vi.mock('../IeltsStudentDeliveryBranch', () => {
  imports.ielts += 1;
  return { IeltsStudentDeliveryBranch: () => <div>IELTS cold entry</div> };
});

it('loads only the IELTS branch on a cold IELTS entry', async () => {
  render(
    <MemoryRouter initialEntries={['/student/schedule/candidate']}>
      <Routes><Route path="/student/:scheduleId/:studentId" element={<StudentSessionRoute />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText('IELTS cold entry')).toBeInTheDocument();
  expect(imports).toEqual({ sat: 0, ielts: 1 });
});
