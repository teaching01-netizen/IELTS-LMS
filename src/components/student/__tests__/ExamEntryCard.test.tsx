import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExamEntryCard } from '../ExamEntryCard';
import { createDefaultConfig } from '../../../constants/examDefaults';

const config = createDefaultConfig('Academic', 'Academic');

describe('ExamEntryCard waiting room', () => {
  it('shows a connecting status while the session is still preparing', () => {
    render(<ExamEntryCard config={config} examTitle="Test" status="connecting" />);
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your connection');
  });

  it('shows a waiting-for-proctor status once the session is connected', () => {
    render(<ExamEntryCard config={config} examTitle="Test" status="waiting" />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the proctor to start the exam');
  });

  it('surfaces a gentle status detail without blocking the wait', () => {
    render(
      <ExamEntryCard
        config={config}
        examTitle="Test"
        status="connecting"
        statusDetail="We're having trouble reaching the server. Stay on this page — your place is saved and we'll keep trying."
      />,
    );
    expect(screen.getByText(/having trouble reaching the server/i)).toBeInTheDocument();
  });

  it('keeps the exam facts labelled with the muted, AA-checked meta style', () => {
    render(<ExamEntryCard config={config} examTitle="Test" candidateName="Ada Lovelace" />);
    expect(screen.getByText('Candidate').className).toContain('exam-entry-meta-label');
    expect(screen.getByText('Exam').className).toContain('exam-entry-meta-label');
  });
});
