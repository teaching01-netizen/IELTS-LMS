import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { StudentQuestionNumber } from '../StudentQuestionNumber';

describe('StudentQuestionNumber', () => {
  it('renders the default question number as a quiet neutral badge', () => {
    const { getByText } = render(<StudentQuestionNumber number={38} />);
    const number = getByText('38');

    expect(number).toHaveClass(
      'inline-flex',
      'h-6',
      'min-w-[1.75rem]',
      'border-2',
      'border-gray-300',
      'text-gray-700',
    );
    expect(number).not.toHaveClass('bg-blue-800');
    // Accent stays reserved for meaningful state.
    expect(number).not.toHaveClass('border-blue-500');
    expect(number).not.toHaveClass('text-blue-600');
  });

  it('keeps the question number neutral when a legacy active flag is provided', () => {
    const { getByText } = render(
      <StudentQuestionNumber number={39} isActive />,
    );
    const number = getByText('39');

    expect(number).toHaveClass('bg-white', 'border-gray-300', 'text-gray-700');
    expect(number).not.toHaveClass('bg-blue-800', 'border-blue-800', 'text-white');
  });
});
