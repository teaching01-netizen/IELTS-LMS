import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentHeader } from '../StudentHeader';

describe('StudentHeader controls by exam type', () => {
  it('keeps IELTS controls at their natural width instead of scrolling them sideways', () => {
    render(
      <StudentHeader
        examType="Academic"
        testTakerId="W502002"
        timeRemaining={3560}
        onOpenAccessibility={vi.fn()}
      />,
    );

    const controls = screen.getByTestId('student-header-controls-slot');
    expect(controls).toHaveClass('shrink-0');
    expect(controls).not.toHaveClass('overflow-x-auto');
  });

  it('keeps the ACT controls slot unchanged', () => {
    render(
      <StudentHeader examType="ACT" testTakerId="A1" timeRemaining={3560} onOpenAccessibility={vi.fn()} />,
    );

    expect(screen.getByTestId('student-header-controls-slot')).toHaveClass('overflow-x-auto');
  });
});
