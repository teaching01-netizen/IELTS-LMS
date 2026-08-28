import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExamListProps } from '../../../features/exam-authoring/contracts/examList';
import { AdminExams } from '../AdminExams';

function buildProps(): ExamListProps {
  return {
    onNavigate: vi.fn(),
    exams: [],
    onEditExam: vi.fn(),
    onCreateExam: vi.fn(),
  };
}

describe('AdminExams empty state', () => {
  it('guides the first exam creation when the library is empty', () => {
    render(<AdminExams {...buildProps()} />);

    expect(screen.getByRole('heading', { name: 'No exams yet' })).toBeInTheDocument();
    expect(
      screen.getByText('Create your first exam to start building an assessment and make it available to students.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create your first exam' }));

    expect(screen.getByRole('heading', { name: 'Create New Exam' })).toBeInTheDocument();
  });
});
