import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GradingRoute } from '../GradingRoute';

vi.mock('../../../auth/api/authSession', () => ({
  useOptionalAuthSession: () => ({ session: { user: { id: 'grader-1', displayName: 'Grace' } } }),
}));

vi.mock('@components/admin/GradingSessionList', () => ({
  GradingSessionList: ({ onSessionSelect }: { onSessionSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSessionSelect('session-1')}>open session list item</button>
  ),
}));

vi.mock('@components/admin/GradingSessionDetail', () => ({
  GradingSessionDetail: ({ sessionId, onBack, onStudentSelect }: { sessionId: string; onBack: () => void; onStudentSelect: (id: string) => void }) => (
    <div>
      <p>session {sessionId}</p>
      <button type="button" onClick={() => onStudentSelect('submission-7')}>review student</button>
      <button type="button" onClick={onBack}>back to sessions</button>
    </div>
  ),
}));

vi.mock('@components/admin/StudentReviewWorkspace', () => ({
  StudentReviewWorkspace: ({ submissionId, onBack }: { submissionId: string; onBack: () => void }) => (
    <div>
      <p>reviewing {submissionId}</p>
      <button type="button" onClick={onBack}>back to session</button>
    </div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="url">{location.pathname + location.search}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/grading" element={<><GradingRoute /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GradingRoute URL selection', () => {
  it('drills in and back through validated search parameters, keeping unrelated ones', () => {
    renderAt('/admin/grading?tab=pending');
    fireEvent.click(screen.getByRole('button', { name: 'open session list item' }));
    expect(screen.getByText('session session-1')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/admin/grading?tab=pending&session=session-1');

    fireEvent.click(screen.getByRole('button', { name: 'review student' }));
    expect(screen.getByText('reviewing submission-7')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('session=session-1&submission=submission-7');

    fireEvent.click(screen.getByRole('button', { name: 'back to session' }));
    expect(screen.getByText('session session-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'back to sessions' }));
    expect(screen.getByRole('button', { name: 'open session list item' })).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/admin/grading?tab=pending');
  });

  it('reopens the same student on refresh or a shared link', () => {
    renderAt('/admin/grading?session=session-1&submission=submission-7');
    expect(screen.getByText('reviewing submission-7')).toBeInTheDocument();
  });

  it('ignores ids that are not grading ids', () => {
    renderAt('/admin/grading?session=%3Cscript%3E&submission=../../etc');
    expect(screen.getByRole('button', { name: 'open session list item' })).toBeInTheDocument();
  });
});
