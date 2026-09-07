import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../RequireAuth';
import { AuthSessionProvider } from '../authSession';
import { authService } from '../../../services/authService';

function renderSessionRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthSessionProvider>
        <Routes>
          <Route
            path="/student/:scheduleId/:studentId"
            element={(
              <RequireAuth allowedRoles={['student']}>
                <div>student session</div>
              </RequireAuth>
            )}
          />
          <Route path="/student/:scheduleId" element={<div>check-in</div>} />
        </Routes>
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

describe('RequireAuth free-form access codes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['/student/sched-1/alice'],
    ['/student/sched-1/guest-alpha_01'],
    ['/student/sched-1/abc123'],
    ['/student/sched-1/W250334'],
  ])('allows anonymous exam access for free-form code %s', async (path) => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    renderSessionRoute(path);
    expect(await screen.findByText('student session')).toBeInTheDocument();
  });

  it.each([['/student/sched-1/precheck'], ['/student/sched-1/register']])(
    'still sends reserved segment %s back to check-in',
    async (path) => {
      vi.spyOn(authService, 'getSession').mockResolvedValue(null);
      renderSessionRoute(path);
      expect(await screen.findByText('check-in')).toBeInTheDocument();
    },
  );

  it('still sends a blank code back to check-in', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    render(
      <MemoryRouter initialEntries={['/student/sched-1/%20%20']}>
        <AuthSessionProvider>
          <Routes>
            <Route
              path="/student/:scheduleId/:studentId"
              element={(
                <RequireAuth allowedRoles={['student']}>
                  <div>student session</div>
                </RequireAuth>
              )}
            />
            <Route path="/student/:scheduleId" element={<div>check-in</div>} />
          </Routes>
        </AuthSessionProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('check-in')).toBeInTheDocument();
  });
});
