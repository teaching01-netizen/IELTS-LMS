import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSatReadingPreferences } from '../../domain/satReadingPreferences';
import { SatQuestionWorkspace } from './SatQuestionWorkspace';

describe('SAT reading layout', () => {
  it('keeps both panes available on mobile without layout mode controls', () => {
    const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 767px)', media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    const { container, unmount } = render(<SatQuestionWorkspace split stimulus={<p>Passage text</p>} question={<p>Question text</p>}
      readingPreferences={createSatReadingPreferences()} onSplitRatioChange={vi.fn()} />);
    try {
      const splitRoot = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
      const passage = container.querySelector<HTMLElement>('[data-sat-passage-scroll]')!;
      const question = container.querySelector<HTMLElement>('[data-sat-question-scroll]')!;
      expect(splitRoot).toHaveClass('min-w-0');
      expect(passage).toHaveClass('min-w-0', 'overflow-y-auto');
      expect(question).toHaveClass('min-w-0', 'overflow-y-auto');
      expect(passage).toHaveAttribute('data-student-exam-scroll-owner');
      expect(question).toHaveAttribute('data-student-exam-scroll-owner');
      expect(passage).toBeVisible();
      expect(question).toBeVisible();
      expect(screen.queryByRole('group', { name: /layout/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Passage only' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Question only' })).not.toBeInTheDocument();
      expect(screen.queryByRole('slider', { name: 'Passage and question width' })).not.toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }
  });
  it('keeps the desktop split divider without layout mode controls', () => {
    const onSplitRatioChange = vi.fn();
    const { container } = render(<SatQuestionWorkspace split stimulus={<p>Passage text</p>} question={<p>Question text</p>}
      readingPreferences={{ ...createSatReadingPreferences(), splitRatio: 0.6 }} onSplitRatioChange={onSplitRatioChange} />);
    const splitRoot = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    const passage = container.querySelector<HTMLElement>('[data-sat-passage-scroll]')!;
    const question = container.querySelector<HTMLElement>('[data-sat-question-scroll]')!;
    expect(splitRoot).toHaveClass('min-w-0');
    expect(passage).toHaveClass('min-w-0', 'overflow-y-auto');
    expect(question).toHaveClass('min-w-0', 'overflow-y-auto');
    expect(passage).toHaveAttribute('data-student-exam-scroll-owner');
    expect(question).toHaveAttribute('data-student-exam-scroll-owner');
    expect(passage).toBeVisible();
    expect(question).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Passage only' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Question only' })).not.toBeInTheDocument();
    const divider = screen.getByRole('slider', { name: 'Passage and question width' });
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(onSplitRatioChange).toHaveBeenLastCalledWith(0.62);
  });
});
