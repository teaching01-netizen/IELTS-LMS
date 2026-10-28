import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollisionWarning } from '../PresenceIndicator';

describe('CollisionWarning', () => {
  it('is a modal alert dialog that takes focus and cancels on Escape', () => {
    const onProceed = vi.fn();
    const onCancel = vi.fn();
    render(<CollisionWarning otherProctorName="Other Proctor" onProceed={onProceed} onCancel={onCancel} />);

    const dialog = screen.getByRole('alertdialog', { name: 'Potential Conflict' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onProceed).not.toHaveBeenCalled();
  });
});
