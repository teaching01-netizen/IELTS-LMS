import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SatRoomEntryPanel } from '../room/SatRoomEntryPanel';

function panel(status: 'ready' | 'loading' | 'error' | 'unavailable') {
  return (
    <SatRoomEntryPanel
      entryUrl={null}
      cohortName="Morning"
      status={status}
      identificationInstructions=""
      startInstructions=""
      onRetry={vi.fn()}
      onOpenShare={vi.fn()}
      onPresent={vi.fn()}
    />
  );
}

describe('SatRoomEntryPanel notice dismissal', () => {
  it('closes the join-details failure and re-arms after a successful cycle', () => {
    const { rerender } = render(panel('error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Student joining details could not load.');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // A later failure is a new message: loading in between re-arms the close.
    rerender(panel('loading'));
    rerender(panel('error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Student joining details could not load.');
  });
});
