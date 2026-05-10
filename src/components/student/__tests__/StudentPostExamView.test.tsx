import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentPostExamView } from '../StudentPostExamView';

describe('StudentPostExamView', () => {
  it('shows completion copy and student info rows when not terminated', () => {
    const onExit = vi.fn();

    render(
      <StudentPostExamView
        isProctorTerminated={false}
        proctorNote={null}
        studentInfo={[
          { label: 'Student Name', value: 'Alice Roe' },
          { label: 'Student ID', value: 'A-01' },
        ]}
        onExit={onExit}
        finalSubmitOverlay={<div data-testid="final-overlay">overlay</div>}
      />,
    );

    expect(screen.getByRole('heading', { name: /ielts examination complete/i })).toBeInTheDocument();
    expect(screen.getByText(/congratulations!/i)).toBeInTheDocument();
    expect(screen.getByText('Alice Roe')).toBeInTheDocument();
    expect(screen.getByText('A-01')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /exit exam platform/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('final-overlay')).toBeInTheDocument();
  });

  it('shows termination copy and proctor note when terminated', () => {
    render(
      <StudentPostExamView
        isProctorTerminated
        proctorNote="Policy violation"
        studentInfo={[]}
        onExit={() => {}}
        finalSubmitOverlay={null}
      />,
    );

    expect(screen.getByRole('heading', { name: /session terminated/i })).toBeInTheDocument();
    expect(screen.getByText(/terminated by the proctor/i)).toBeInTheDocument();
    expect(screen.getByText('Policy violation')).toBeInTheDocument();
  });
});
