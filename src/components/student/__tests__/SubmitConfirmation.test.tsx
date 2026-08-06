import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubmitConfirmation } from '../SubmitConfirmation';

describe('SubmitConfirmation', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SubmitConfirmation
        isOpen={false}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows confirm title when all questions are answered', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={10}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    expect(screen.getByText('Ready to Submit?')).toBeInTheDocument();
  });

  it('shows warning title when there are unanswered questions', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    expect(screen.getByText('Confirm Submission')).toBeInTheDocument();
  });

  it('displays unanswered count', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={3}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    expect(screen.getByText(/You have 7 unanswered questions/)).toBeInTheDocument();
  });

  it('displays flagged count', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={10}
        totalQuestions={10}
        flaggedCount={3}
      />,
    );
    expect(screen.getByText(/3 flagged questions/)).toBeInTheDocument();
  });

  it('calls onClose when Review Answers is clicked', () => {
    const onClose = vi.fn();
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={onClose}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    fireEvent.click(screen.getByText('Review Answers'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when Submit Section is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
        answeredCount={10}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    fireEvent.click(screen.getByText('Submit Section'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows time remaining when provided', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={10}
        totalQuestions={10}
        flaggedCount={0}
        timeRemaining={125}
      />,
    );
    expect(screen.getByText('02:05')).toBeInTheDocument();
  });

  it('blocks submit when unansweredSubmissionPolicy is block', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
        unansweredSubmissionPolicy="block"
      />,
    );
    const submitButton = screen.getByText('Submit Section');
    expect(submitButton).toBeDisabled();
  });

  it('allows submit when unansweredSubmissionPolicy is confirm', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
        unansweredSubmissionPolicy="confirm"
      />,
    );
    const submitButton = screen.getByText('Submit Section');
    expect(submitButton).not.toBeDisabled();
  });

  it('shows block message when policy is block and has unanswered', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
        unansweredSubmissionPolicy="block"
      />,
    );
    expect(screen.getByText(/You must answer all questions before submitting/)).toBeInTheDocument();
  });

  it('shows answered count and total', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={7}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    expect(screen.getByText('7/10')).toBeInTheDocument();
  });

  it('does not show time remaining when not provided', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={10}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    expect(screen.queryByText(/Time remaining/)).not.toBeInTheDocument();
  });

  it('exposed the confirmation as a labelled modal dialog (FEX-070)', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm Submission' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('tabindex', '-1');
  });

  it('labelled the icon-only close button (FEX-070)', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={10}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('moved focus into the dialog when it opened (FEX-070)', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole('dialog', { name: 'Confirm Submission' }),
    );
  });

  it('trapped Tab and Shift+Tab inside the dialog (FEX-070)', () => {
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    const closeButton = screen.getByRole('button', { name: 'Close' });
    const reviewButton = screen.getByRole('button', { name: 'Review Answers' });
    const submitButton = screen.getByRole('button', { name: 'Submit Section' });

    // Forward Tab from the last control wraps to the first.
    submitButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    // Shift+Tab from the first control wraps to the last.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submitButton);

    // Middle controls are not intercepted (the handler leaves non-wrapping
    // Tabs to the browser default).
    reviewButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(reviewButton);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(reviewButton);

    // Focus straying outside the dialog is pulled back in on Tab.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      outside.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(closeButton);
      outside.focus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(submitButton);
    } finally {
      outside.remove();
    }
  });

  it('closed on Escape (FEX-070)', () => {
    const onClose = vi.fn();
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={onClose}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restored focus to the previously focused element when it closed (FEX-070)', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open confirmation';
    document.body.appendChild(trigger);
    trigger.focus();
    try {
      const props = {
        onClose: () => {},
        onConfirm: () => {},
        answeredCount: 5,
        totalQuestions: 10,
        flaggedCount: 0,
      };
      const { rerender } = render(<SubmitConfirmation isOpen={false} {...props} />);
      rerender(<SubmitConfirmation isOpen={true} {...props} />);
      expect(document.activeElement).not.toBe(trigger);
      rerender(<SubmitConfirmation isOpen={false} {...props} />);
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
    }
  });

  it('kept focus trapped when the parent re-rendered with a new onClose identity (FEX-070)', () => {
    // Regression: the parent passes an inline onClose that changes identity
    // on every render (StudentApp re-renders each second while the dialog is
    // open), and a focus effect keyed on onClose would restore focus to the
    // trigger and reset the tab position on every tick. The effect must run
    // only when isOpen changes and must keep reading the latest onClose.
    const trigger = document.createElement('button');
    trigger.textContent = 'Open confirmation';
    document.body.appendChild(trigger);
    trigger.focus();
    try {
      const base = {
        onConfirm: () => {},
        answeredCount: 5,
        totalQuestions: 10,
        flaggedCount: 0,
      };
      const { rerender } = render(
        <SubmitConfirmation isOpen={false} {...base} onClose={() => {}} />,
      );
      rerender(<SubmitConfirmation isOpen={true} {...base} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog', { name: 'Confirm Submission' });
      expect(document.activeElement).toBe(dialog);

      const reviewButton = screen.getByRole('button', { name: 'Review Answers' });
      reviewButton.focus();
      const latestOnClose = vi.fn();
      rerender(<SubmitConfirmation isOpen={true} {...base} onClose={latestOnClose} />);
      expect(document.activeElement).toBe(reviewButton);

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(latestOnClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(reviewButton);
    } finally {
      trigger.remove();
    }
  });

  it('wrapped Shift+Tab from the dialog container to the last control (FEX-070)', () => {
    // The container is the initial focus target (tabIndex=-1); Shift+Tab from
    // it must behave like Shift+Tab from the first control instead of
    // escaping into the page.
    render(
      <SubmitConfirmation
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        answeredCount={5}
        totalQuestions={10}
        flaggedCount={0}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm Submission' });
    dialog.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Submit Section' }));
  });
});
