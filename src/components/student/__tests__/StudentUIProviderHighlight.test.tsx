import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { StudentUIProvider, useStudentUI } from '../providers/StudentUIProvider';

function HighlightHarness() {
  const { state, actions } = useStudentUI();
  return (
    <>
      <output>{state.accessibilitySettings.highlightToolMode}</output>
      <button type="button" onClick={actions.toggleHighlightMode}>Toggle highlight</button>
      <button type="button" onClick={actions.toggleEraseMode}>Toggle erase</button>
    </>
  );
}

describe('StudentUIProvider highlight actions', () => {
  it('toggles erase mode on and back off', () => {
    render(
      <StudentUIProvider>
        <HighlightHarness />
      </StudentUIProvider>,
    );

    expect(screen.getByText('off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle erase' }));
    expect(screen.getByText('erase')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle erase' }));
    expect(screen.getByText('off')).toBeInTheDocument();
  });

  it('switches symmetrically between highlight and erase modes', () => {
    render(
      <StudentUIProvider>
        <HighlightHarness />
      </StudentUIProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle erase' }));
    expect(screen.getByText('erase')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle highlight' }));
    expect(screen.getByText('highlight')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle highlight' }));
    expect(screen.getByText('off')).toBeInTheDocument();
  });
});
