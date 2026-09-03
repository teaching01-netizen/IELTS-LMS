import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRoot } from '../AdminRoot';

const mockLogout = vi.fn();

vi.mock('../../../auth/api/authSession', () => ({
  useAuthSession: () => ({ logout: mockLogout }),
}));

vi.mock('@admin/hooks/useAdminRootController', () => ({
  useAdminRootController: () => ({
    contextValue: {
      onNavigate: vi.fn(),
      defaults: {},
      setDefaults: vi.fn(),
      isInitialized: true,
      initError: null,
    },
    currentView: 'exams',
    initError: null,
    isInitialized: true,
    navItems: [],
    notificationCount: 0,
    reload: vi.fn(),
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
  }),
}));

describe('AdminRoot exit action', () => {
  beforeEach(() => {
    mockLogout.mockReset();
    mockLogout.mockResolvedValue(undefined);
  });

  it('logs out and returns to the login page', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/admin/exams']}>
        <Routes>
          <Route path="/admin/exams" element={<AdminRoot />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Exit Admin' }));

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
