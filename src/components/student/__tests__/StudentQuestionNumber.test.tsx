import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { StudentQuestionNumber } from '../StudentQuestionNumber';

describe('StudentQuestionNumber', () => {
  it('renders the default question number as the shared square blue badge', () => {
    const { getByText } = render(<StudentQuestionNumber number={38} />);
    const number = getByText('38');

    expect(number).toHaveClass(
      'inline-flex',
      'h-6',
      'min-w-[1.75rem]',
      'border-2',
      'border-blue-500',
      'text-blue-600',
    );
    expect(number).not.toHaveClass('bg-blue-800');
  });

  it('keeps the active question visibly selected inside the same square', () => {
    const { getByText } = render(
      <StudentQuestionNumber number={39} isActive />,
    );
    const number = getByText('39');

    expect(number).toHaveClass('bg-blue-800', 'border-blue-800', 'text-white');
  });
});
