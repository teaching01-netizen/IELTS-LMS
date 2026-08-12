import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from '../Dialog';

describe('Dialog module', () => {
  it('exports the Dialog root component', () => {
    expect(Dialog).toBeTruthy();
  });

  it('does not close when nested content prevents Escape', () => {
    const onClose = vi.fn();
    const { getByRole } = render(
      <Dialog isOpen onClose={onClose}>
        <button type="button" onKeyDown={(event) => event.preventDefault()}>
          Nested control
        </button>
      </Dialog>,
    );

    fireEvent.keyDown(getByRole('button', { name: 'Nested control' }), { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
