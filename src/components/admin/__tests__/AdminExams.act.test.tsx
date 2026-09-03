import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminExams } from '../AdminExams';
import type { ExamListProps } from '../../../features/exam-authoring/contracts/examList';

describe('AdminExams ACT Science creation', () => {
  it('creates an ACT Science draft without changing the IELTS create options', () => {
    const onCreateExam = vi.fn() as unknown as ExamListProps['onCreateExam'];

    render(
      <AdminExams
        onNavigate={vi.fn()}
        exams={[]}
        onEditExam={vi.fn()}
        onCreateExam={onCreateExam}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Exam' }));

    expect(screen.getByRole('button', { name: /Academic Full/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GT Full/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'ACT Science One-section ACT Science practice' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /ACT Science/i })[0]);
    fireEvent.change(screen.getByPlaceholderText('e.g. Academic Practice Test 5'), {
      target: { value: 'ACT Science Practice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create & Open Builder' }));

    expect(onCreateExam).toHaveBeenCalledWith('ACT Science Practice', 'ACT', 'ACT Science');
  });
});
