import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../RequireAuth';
import { AuthSessionProvider } from '../authSession';
import { authService } from '../../../services/authService';

function renderProtectedRoute(allowedRoles: Array<'admin' | 'builder' | 'proctor' | 'grader' | 'student'>) {
  render(
    <MemoryRouter initialEntries={['/student/sched-1/W250334']}>
      <AuthSessionProvider>
        <Routes>
          <Route
            path="/student/:scheduleId/:studentId"
            element={(
              <RequireAuth allowedRoles={allowedRoles}>
                <div>student session</div>
              </RequireAuth>
            )}
          />
          <Route path="/admin/exams" element={<div>admin exams</div>} />
        </Routes>
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows authenticated admins to stay on student session routes when the route permits admin access', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue({
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        displayName: 'Admin User',
        role: 'admin',
        state: 'active',
      },
      csrfToken: 'csrf-1',
      expiresAt: '2026-01-01T12:00:00.000Z',
    });

    renderProtectedRoute(['admin', 'student']);

    expect(await screen.findByText('student session')).toBeInTheDocument();
    expect(screen.queryByText('admin exams')).not.toBeInTheDocument();
  });

  it('allows registered students to access session routes without web auth session', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);

    renderProtectedRoute(['student']);

    // This should NOT redirect to login - students with wcode should access exam directly
    // Currently this fails because RequireAuth redirects to login when session is null
    expect(await screen.findByText('student session')).toBeInTheDocument();
  });
});
