import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSatReadingPreferences } from '../../domain/satReadingPreferences';
import { SatQuestionWorkspace } from './SatQuestionWorkspace';

describe('SAT reading focus layout', () => {
  it('uses one pane on mobile and restores passage and question scroll independently', () => {
    const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 767px)', media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    const { container, unmount } = render(<SatQuestionWorkspace split stimulus={<p>Passage text</p>} question={<p>Question text</p>}
      readingPreferences={createSatReadingPreferences()} onSplitRatioChange={vi.fn()} />);
    try {
      const passage = container.querySelector<HTMLElement>('[data-sat-passage-scroll]')!;
      const question = container.querySelector<HTMLElement>('[data-sat-question-scroll]')!;
      expect(question).not.toBeVisible();
      passage.scrollTop = 120; fireEvent.scroll(passage);
      fireEvent.click(screen.getByRole('button', { name: 'Question' }));
      expect(passage).not.toBeVisible();
      expect(question).toBeVisible();
      question.scrollTop = 40; fireEvent.scroll(question);
      fireEvent.click(screen.getByRole('button', { name: 'Passage' }));
      expect(passage.scrollTop).toBe(120);
      fireEvent.click(screen.getByRole('button', { name: 'Question' }));
      expect(question.scrollTop).toBe(40);
      expect(screen.queryByRole('slider', { name: 'Passage and question width' })).not.toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }
  });
  it('expands either pane and restores the previous split ratio and scroll positions', () => {
    const onSplitRatioChange = vi.fn();
    const { container } = render(<SatQuestionWorkspace split stimulus={<p>Passage text</p>} question={<p>Question text</p>}
      readingPreferences={{ ...createSatReadingPreferences(), splitRatio: 0.6 }} onSplitRatioChange={onSplitRatioChange} />);
    const passage = container.querySelector<HTMLElement>('[data-sat-passage-scroll]')!;
    const question = container.querySelector<HTMLElement>('[data-sat-question-scroll]')!;
    passage.scrollTop = 120; fireEvent.scroll(passage);
    question.scrollTop = 40; fireEvent.scroll(question);
    fireEvent.click(screen.getByRole('button', { name: 'Expand passage' }));
    expect(question).not.toBeVisible();
    expect(passage).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Return to split' }));
    expect(question).toBeVisible();
    expect(onSplitRatioChange).toHaveBeenLastCalledWith(0.6);
    expect(passage.scrollTop).toBe(120);
    expect(question.scrollTop).toBe(40);
    fireEvent.click(screen.getByRole('button', { name: 'Expand question' }));
    expect(passage).not.toBeVisible();
    expect(question).toBeVisible();
  });
});
