import { useEffect, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatRoot } from '../SatRoot';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('../../../features/auth/authSession', () => ({ useAuthSession: authMock }));

/**
 * The boundary is replaced by a recorder.
 *
 * What this file pins is not the room's behavior but where the boundary lives:
 * the exam-level provider must survive builder -> preview -> release, because a
 * remount destroys the room and any edit it has not acknowledged. Counting
 * effect mounts is the only way to see that from the shell, and it needs no
 * socket.
 */
const boundary = vi.hoisted(() => ({ mounts: 0, unmounts: 0, examIds: [] as string[] }));
vi.mock('../../../features/exam-authoring/realtime/coedit', () => ({
  SatAuthoringCollaborationBoundary: ({
    examId,
    children,
  }: {
    examId: string;
    children: ReactNode;
  }) => {
    useEffect(() => {
      boundary.mounts += 1;
      boundary.examIds.push(examId);
      return () => {
        boundary.unmounts += 1;
      };
    }, [examId]);
    return (
      <div data-testid="coedit-boundary" data-exam-id={examId}>
        {children}
      </div>
    );
  },
}));

function renderSat(entry: string) {
  authMock.mockReturnValue({
    session: { user: { role: 'admin', displayName: 'Alex Staff', email: 'alex@example.com' } },
    logout: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/sat" element={<SatRoot />}>
          <Route
            path="exams/:examId"
            element={
              <div>
                Authoring content
                <Link to="/sat/exams/ex-1/preview">Preview exam</Link>
                <Link to="/sat/exams/ex-1/release">Release exam</Link>
              </div>
            }
          />
          <Route
            path="exams/:examId/preview"
            element={
              <div>
                Preview content
                <Link to="/sat/exams/ex-1">Back to exam</Link>
              </div>
            }
          />
          <Route path="exams/:examId/release" element={<div>Release content</div>} />
          <Route path="exams/:examId/access" element={<div>Access content</div>} />
          <Route path="sessions/:scheduleId" element={<div>Session room content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('SatRoot collaboration boundary', () => {
  beforeEach(() => {
    authMock.mockReset();
    boundary.mounts = 0;
    boundary.unmounts = 0;
    boundary.examIds = [];
  });

  it('opens the exam room for the authoring surface', () => {
    renderSat('/sat/exams/ex-1');
    expect(screen.getByTestId('coedit-boundary')).toHaveAttribute('data-exam-id', 'ex-1');
    expect(boundary.mounts).toBe(1);
  });

  it.each([
    ['/sat/exams/ex-1/preview', 'Preview content'],
    ['/sat/exams/ex-1/release', 'Release content'],
    ['/sat/exams/ex-1/access', 'Access content'],
    ['/sat/exams/ex-1/preview/', 'Preview content'],
  ])('keeps the room open on %s', (entry, content) => {
    renderSat(entry);
    expect(screen.getByText(content)).toBeInTheDocument();
    expect(screen.getByTestId('coedit-boundary')).toHaveAttribute('data-exam-id', 'ex-1');
    expect(boundary.mounts).toBe(1);
  });

  it('carries one room across builder -> preview -> release instead of reopening it', () => {
    renderSat('/sat/exams/ex-1');
    expect(boundary.mounts).toBe(1);

    fireEvent.click(screen.getByRole('link', { name: 'Preview exam' }));
    expect(screen.getByText('Preview content')).toBeInTheDocument();
    expect(boundary.mounts).toBe(1);
    expect(boundary.unmounts).toBe(0);

    fireEvent.click(screen.getByRole('link', { name: 'Back to exam' }));
    expect(screen.getByText('Authoring content')).toBeInTheDocument();
    expect(boundary.mounts).toBe(1);

    fireEvent.click(screen.getByRole('link', { name: 'Release exam' }));
    expect(screen.getByText('Release content')).toBeInTheDocument();
    expect(boundary.mounts).toBe(1);
    expect(boundary.unmounts).toBe(0);
    expect(boundary.examIds).toEqual(['ex-1']);
  });

  it('does not open an exam room for a non-authoring SAT route', () => {
    renderSat('/sat/sessions/s-1');
    expect(screen.getByText('Session room content')).toBeInTheDocument();
    expect(screen.queryByTestId('coedit-boundary')).not.toBeInTheDocument();
    expect(boundary.mounts).toBe(0);
  });
});
