import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SatConfirmDialog, SatFormDialog, isSatCreationDirty } from '../ConfirmDialog';

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

  it('scopes stacked form dialogs with unique title ids', () => {
    render(
      <>
        <SatFormDialog open eyebrow="Digital SAT" title="First sheet" onClose={vi.fn()}>
          <form aria-label="First form" />
        </SatFormDialog>
        <SatFormDialog open eyebrow="Digital SAT" title="Second sheet" onClose={vi.fn()}>
          <form aria-label="Second form" />
        </SatFormDialog>
      </>,
    );
    const first = screen.getByRole('dialog', { name: 'First sheet' });
    const second = screen.getByRole('dialog', { name: 'Second sheet' });
    expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
  });
});

describe('SatConfirmDialog id scoping', () => {
  it('scopes stacked alerts with unique title ids', () => {
    render(
      <>
        <SatConfirmDialog open title="First alert" description="First." confirmLabel="Go" onCancel={vi.fn()} onConfirm={vi.fn()} />
        <SatConfirmDialog open title="Second alert" description="Second." confirmLabel="Go" onCancel={vi.fn()} onConfirm={vi.fn()} />
      </>,
    );
    const first = screen.getByRole('alertdialog', { name: 'First alert' });
    const second = screen.getByRole('alertdialog', { name: 'Second alert' });
    expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
  });
});

describe('SatConfirmDialog dismissal + focus (additive)', () => {
  it('never dismisses on backdrop pointerDown (backdrop tap is not an answer)', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
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
    const dialog = screen.getByRole('alertdialog', { name: 'Finish this SAT session?' });
    const overlay = dialog.parentElement;
    expect(overlay).not.toBeNull();
    if (overlay) fireEvent.pointerDown(overlay);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Finish this SAT session?' })).toBeInTheDocument();
  });

  it('auto-focuses Cancel on open (static branch: the safe choice owns focus)', () => {
    render(
      <SatConfirmDialog
        open
        title="End this attempt?"
        description="This ends the attempt."
        confirmLabel="End Attempt"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });
});

describe('isSatCreationDirty', () => {
  it('is pristine for an empty title', () => {
    expect(isSatCreationDirty({ title: '' })).toBe(false);
  });

  it('treats whitespace-only title as pristine', () => {
    expect(isSatCreationDirty({ title: '   ' })).toBe(false);
  });

  it('is dirty for a typed title', () => {
    expect(isSatCreationDirty({ title: 'October Practice' })).toBe(true);
  });

  it('is dirty for cohort content with an empty title', () => {
    expect(isSatCreationDirty({ title: '', cohort: 'Morning' })).toBe(true);
  });

  it('is dirty for start and end content with an empty title', () => {
    expect(isSatCreationDirty({ title: '', start: '2099-09-01T10:00', end: '2099-09-01T13:00' })).toBe(true);
  });

  it('is pristine when every slot is empty', () => {
    expect(isSatCreationDirty({ title: '', cohort: '', exam: '', start: '', end: '' })).toBe(false);
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