import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SatConfirmDialog, SatFormDialog } from '../ConfirmDialog';

describe('SatConfirmDialog', () => {
  it('renders the alert with its name, description, and both answers', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SatConfirmDialog
        open
        title="Finish this SAT session?"
        description="The session will be completed for the cohort."
        confirmLabel="Finish Session"
        destructive
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('alertdialog', { name: 'Finish this SAT session?' })).toBeInTheDocument();
    expect(screen.getByText('The session will be completed for the cohort.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish Session' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels from the Cancel answer', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SatConfirmDialog
        open
        title="End this attempt?"
        description="This ends the student’s current attempt."
        confirmLabel="End Attempt"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SatConfirmDialog
        open
        title="Finish this SAT session?"
        description="The session will be completed for the cohort."
        confirmLabel="Finish Session"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(
      <SatConfirmDialog
        open={false}
        title="Finish this SAT session?"
        description="The session will be completed for the cohort."
        confirmLabel="Finish Session"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('SatFormDialog', () => {
  it('exposes a named dialog that contains the form and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <SatFormDialog open eyebrow="Digital SAT" title="New Session" onClose={onClose}>
        <form aria-label="New session form">
          <input aria-label="Session name" readOnly />
        </form>
      </SatFormDialog>,
    );
    expect(screen.getByRole('dialog', { name: 'New Session' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'New session form' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the Close button', () => {
    const onClose = vi.fn();
    render(
      <SatFormDialog open eyebrow="Digital SAT" title="New SAT" onClose={onClose}>
        <form aria-label="New SAT form">
          <input aria-label="SAT exam name" readOnly />
        </form>
      </SatFormDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(
      <SatFormDialog open={false} eyebrow="Digital SAT" title="New SAT" onClose={vi.fn()}>
        <form aria-label="New SAT form" />
      </SatFormDialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('carries the workspace scope on portal overlay and content so positioning survives outside .sat-product', () => {
    // Radix portals mount at document.body, escaping the `.sat-product`
    // ancestor in SatRoot. The scope class must ride on the portal nodes
    // themselves or the centered-card CSS never matches (bottom-left pileup).
    render(
      <SatFormDialog open eyebrow="Digital SAT" title="New SAT" onClose={vi.fn()}>
        <form aria-label="New SAT form">
          <input aria-label="SAT exam name" readOnly />
        </form>
      </SatFormDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'New SAT' });
    expect(dialog).toHaveClass('sat-product');
    expect(dialog).toHaveClass('sat-dialog-center');
    const overlay = document.querySelector('.sat-dialog-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass('sat-product');
  });
});

describe('SatConfirmDialog portal scope', () => {
  it('carries the workspace scope on alert overlay and content', () => {
    render(
      <SatConfirmDialog
        open
        title="Finish this SAT session?"
        description="The session will be completed for the cohort."
        confirmLabel="Finish Session"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Finish this SAT session?' });
    expect(dialog).toHaveClass('sat-product');
    expect(dialog).toHaveClass('sat-dialog-center');
    const overlay = document.querySelector('.sat-dialog-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass('sat-product');
  });
});