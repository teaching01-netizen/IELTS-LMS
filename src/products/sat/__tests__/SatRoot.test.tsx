import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatRoot } from '../SatRoot';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('../../../features/auth/authSession', () => ({ useAuthSession: authMock }));

function renderRoot(role: 'admin' | 'builder' | 'proctor' | 'grader' = 'admin') {
  authMock.mockReturnValue({
    session: { user: { role, displayName: 'Alex Staff', email: 'alex@example.com' } },
    logout: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={['/sat/exams']}>
      <Routes>
        <Route path="/sat" element={<SatRoot />}>
          <Route path="exams" element={<div>SAT exam content</div>} />
        </Route>
        <Route path="/admin/exams" element={<div>IELTS exams destination</div>} />
        <Route path="/admin/grading" element={<div>IELTS grading destination</div>} />
        <Route path="/proctor" element={<div>IELTS proctor destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SatRoot', () => {
  beforeEach(() => authMock.mockReset());

  it('keeps the SAT workspace to three primary admin destinations', () => {
    renderRoot('admin');
    expect(screen.getAllByText('Exam Library').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Results').length).toBeGreaterThan(0);
    expect(screen.queryByText('Grading')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('switches back to the IELTS workspace instead of mixing providers in SAT navigation', () => {
    renderRoot('admin');
    fireEvent.click(screen.getAllByRole('button', { name: /digital sat/i })[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'IELTS' }));
    expect(screen.getByText('IELTS exams destination')).toBeInTheDocument();
  });

  it('gives proctors sessions and results without exposing exam authoring', () => {
    renderRoot('proctor');
    expect(screen.queryByText('Exam Library')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Results').length).toBeGreaterThan(0);
  });
});
