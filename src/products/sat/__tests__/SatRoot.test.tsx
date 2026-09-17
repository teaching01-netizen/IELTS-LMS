import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { examKeys } from '../../../features/exam-authoring/api/examQueries';
import { SatRoot } from '../SatRoot';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('../../../features/auth/authSession', () => ({ useAuthSession: authMock }));

/**
 * Exam pages mount the exam-level collaboration boundary, whose room waits for
 * the exam's draft pointer before it opens (see useSatAuthoringCollaboration).
 * The cache carries the exam so these layout tests stay on the render thread and
 * never reach for the room they are not asserting on.
 */
function withExamCache(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(examKeys.detail('ex-1'), {
    id: 'ex-1',
    currentDraftVersionId: 'version-1',
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

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

  it('moves keyboard focus to the main region from the skip link', () => {
    const { container } = renderRoot('admin');
    const skipLink = screen.getByRole('link', { name: /skip to main content/i });
    expect(skipLink).toHaveAttribute('href', '#sat-main');
    // jsdom does not perform anchor navigation, so resolve the link target
    // the way a browser would and verify it can receive keyboard focus.
    const target = container.querySelector(skipLink.getAttribute('href')!);
    expect(target).toHaveAttribute('tabindex', '-1');
    (target as HTMLElement).focus();
    expect(target).toHaveFocus();
  });

  it('exposes a compact mobile account control whose sign-out calls logout', () => {
    const logout = vi.fn();
    authMock.mockReturnValue({
      session: { user: { role: 'admin', displayName: 'Alex Staff', email: 'alex@example.com' } },
      logout,
    });
    render(
      <MemoryRouter initialEntries={['/sat/exams']}>
        <Routes>
          <Route path="/sat" element={<SatRoot />}>
            <Route path="exams" element={<div>SAT exam content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('menuitem', { name: /Alex Staff/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign Out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('keeps the sidebar on session, result and access pages', () => {
    authMock.mockReturnValue({
      session: { user: { role: 'admin', displayName: 'Alex Staff', email: 'alex@example.com' } },
      logout: vi.fn(),
    });
    for (const entry of ['/sat/sessions/sched-1', '/sat/results/res-1', '/sat/exams/ex-1/access']) {
      const { unmount } = render(
        withExamCache(
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/sat" element={<SatRoot />}>
                <Route path="sessions/:scheduleId" element={<div>Session room content</div>} />
                <Route path="results/:resultId" element={<div>Result detail content</div>} />
                <Route path="exams/:examId/access" element={<div>Access content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>,
        ),
      );
      expect(screen.getAllByRole('button', { name: 'Sign Out' }).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('hides all shell chrome on exam authoring pages', () => {
    authMock.mockReturnValue({
      session: { user: { role: 'admin', displayName: 'Alex Staff', email: 'alex@example.com' } },
      logout: vi.fn(),
    });
    render(
      withExamCache(
        <MemoryRouter initialEntries={['/sat/exams/ex-1']}>
          <Routes>
            <Route path="/sat" element={<SatRoot />}>
              <Route path="exams/:examId" element={<div>Builder content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      ),
    );
    expect(screen.getByText('Builder content')).toBeInTheDocument();
    // Desktop sidebar (workspace switcher + sign-out region) is gone on authoring pages.
    expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument();
  });

  it('gives proctors sessions and results without exposing exam authoring', () => {
    renderRoot('proctor');
    expect(screen.queryByText('Exam Library')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Results').length).toBeGreaterThan(0);
  });
});

describe('SatRoot shell polish', () => {
  beforeEach(() => authMock.mockReset());

  function renderAt(entry: string, role: 'admin' | 'builder' | 'proctor' | 'grader' = 'admin') {
    authMock.mockReturnValue({
      session: { user: { role, displayName: 'Alex Staff', email: 'alex@example.com' } },
      logout: vi.fn(),
    });
    return render(
      withExamCache(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/sat" element={<SatRoot />}>
              <Route path="exams" element={<div>Exam list content</div>} />
              <Route path="exams/:examId" element={<div>Authoring content</div>} />
              <Route path="exams/:examId/release" element={<div>Release content</div>} />
              <Route path="exams/:examId/preview" element={<div>Preview content</div>} />
              <Route path="exams/:examId/access" element={<div>Access content</div>} />
              <Route path="sessions/:scheduleId" element={<div>Session room content</div>} />
              <Route path="results/:resultId" element={<div>Result detail content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      ),
    );
  }

  it('covers the full navForRole matrix (builder/grader/proctor)', () => {
    const { unmount: u1 } = renderRoot('builder');
    expect(screen.getAllByText('Exam Library').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
    expect(screen.queryByText('Results')).not.toBeInTheDocument();
    u1();

    const { unmount: u2 } = renderRoot('grader');
    expect(screen.getAllByText('Results').length).toBeGreaterThan(0);
    expect(screen.queryByText('Exam Library')).not.toBeInTheDocument();
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
    u2();

    renderRoot('proctor');
    expect(screen.queryByText('Exam Library')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Results').length).toBeGreaterThan(0);
  });

  it.each([
    ['/sat/exams', true] as [string, boolean],
    ['/sat/exams/ex-1', false],
    ['/sat/exams/ex-1/release', false],
    ['/sat/exams/ex-1/preview/', false],
    ['/sat/exams/ex-1/access', true],
    ['/sat/sessions/s-1', true],
    ['/sat/results/r-1', true],
  ])('detail-regex matrix: %s shows chrome=%s', (entry, chrome) => {
    const { unmount } = renderAt(entry);
    if (chrome) {
      expect(screen.getAllByRole('button', { name: /digital sat/i }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('button', { name: 'Sign Out' }).length).toBeGreaterThan(0);
    } else {
      expect(screen.queryByRole('button', { name: /digital sat/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument();
    }
    unmount();
  });

  it('wraps route content in the reduced-motion route-fade gate', () => {
    const { container } = renderAt('/sat/exams');
    const main = container.querySelector('#sat-main');
    expect(main).not.toBeNull();
    expect(main!.querySelector(':scope > .sat-route-fade')).not.toBeNull();
  });

  it('calls logout once from the desktop sign-out button', () => {
    const logout = vi.fn();
    authMock.mockReturnValue({
      session: { user: { role: 'admin', displayName: 'Alex Staff', email: 'alex@example.com' } },
      logout,
    });
    render(
      <MemoryRouter initialEntries={['/sat/exams']}>
        <Routes>
          <Route path="/sat" element={<SatRoot />}>
            <Route path="exams" element={<div>SAT exam content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('renders shell chrome through solid-fallback staff tokens (no hardcoded alpha chrome)', () => {
    const { container } = renderAt('/sat/exams');
    const aside = container.querySelector('aside');
    const header = container.querySelector('header');
    const bottomNav = container.querySelector('nav.fixed[aria-label="Digital SAT"]');
    expect(aside).not.toBeNull();
    expect(header).not.toBeNull();
    expect(bottomNav).not.toBeNull();
    for (const el of [aside!, header!, bottomNav!]) {
      expect(el.className).toMatch(/var\(--sat-staff-/);
    }
  });

  it('keeps the bottom-nav safe-area inset expression', () => {
    const { container } = renderAt('/sat/exams');
    const bottomNav = container.querySelector('nav.fixed[aria-label="Digital SAT"]');
    expect(bottomNav).not.toBeNull();
    expect(bottomNav!.className).toContain('env(safe-area-inset-bottom)');
  });

  it('keeps shell content visible with reduced motion enabled', () => {
    // Motion sets opacity:0 inline at mount and animates to 1; the
    // .sat-route-fade CSS guard (F-A12) forces opacity:1 under
    // prefers-reduced-motion, so content can never stick mid-fade.
    // In jsdom the animation frame never fires, so assert the content
    // is mounted inside the gate (visibility is owned by CSS, not JS).
    const { container } = renderAt('/sat/exams');
    expect(screen.getByText('Exam list content')).toBeInTheDocument();
    const fade = container.querySelector('#sat-main > .sat-route-fade');
    expect(fade).not.toBeNull();
    expect(fade!.textContent).toContain('Exam list content');
  });
});
