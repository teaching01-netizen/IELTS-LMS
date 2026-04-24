import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '../Header';
import { createInitialExamState } from '../../services/examAdapterService';

describe('Header (preview)', () => {
  it('invokes onOpenPreview when clicking Preview', () => {
    const state = createInitialExamState('Preview Exam', 'Academic');
    const onOpenPreview = vi.fn();

    render(
      <Header
        state={state}
        onUpdateState={() => {}}
        onReturnToAdmin={() => {}}
        onNavigateToConfig={() => {}}
        onNavigateToReview={() => {}}
        onOpenPreview={onOpenPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /preview exam/i }));

    expect(onOpenPreview).toHaveBeenCalledTimes(1);
  });
});

