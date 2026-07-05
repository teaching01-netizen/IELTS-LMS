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
});
