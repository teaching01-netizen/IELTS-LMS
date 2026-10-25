import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSatScrollMemory } from '../useSatListReturn';

function Shell() {
  useSatScrollMemory();
  return <main id="sat-main"><Outlet /></main>;
}
function Questions() {
  const navigate = useNavigate();
  return <button data-sat-exam-section="questions" aria-current="page" onClick={() => navigate('/sat/exams/e1/settings')}>Go to settings</button>;
}
function Settings() {
  const [ready, setReady] = useState(false);
  return ready ? <button data-sat-exam-section="settings" aria-current="page">Settings ready</button> : <button onClick={() => setReady(true)}>Resolve settings</button>;
}

describe('exam section arrival', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('waits for the destination section, then restores its scroll and keyboard position', async () => {
    sessionStorage.setItem('sat-scroll:/sat/exams/e1/settings', '420');
    render(<MemoryRouter initialEntries={['/sat/exams/e1']}><Routes><Route element={<Shell />}>
      <Route path="/sat/exams/e1" element={<Questions />} />
      <Route path="/sat/exams/e1/settings" element={<Settings />} />
    </Route></Routes></MemoryRouter>);
    screen.getByRole('button', { name: 'Go to settings' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Go to settings' }));
    expect(window.scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve settings' }));
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({ top: 420, behavior: 'instant' }));
    expect(screen.getByRole('button', { name: 'Settings ready' })).toHaveFocus();
  });

  it('does not steal focus from input that became active while a section loaded', async () => {
    function EditingSettings() {
      return <><button data-sat-exam-section="settings" aria-current="page">Settings</button><input aria-label="Timing" ref={(input) => input?.focus()} /></>;
    }
    render(<MemoryRouter initialEntries={['/sat/exams/e1']}><Routes><Route element={<Shell />}>
      <Route path="/sat/exams/e1" element={<Questions />} />
      <Route path="/sat/exams/e1/settings" element={<EditingSettings />} />
    </Route></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Go to settings' }));
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' }));
    expect(screen.getByRole('textbox', { name: 'Timing' })).toHaveFocus();
  });
});
