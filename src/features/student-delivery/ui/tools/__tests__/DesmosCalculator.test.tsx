import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { desmosEmbedUrl } from '../../../infrastructure/desmos/desmosTypes';
import { DesmosCalculator } from '../DesmosCalculator';

describe('DesmosCalculator', () => {
  it('loads only the selected calculator until another mode is activated', () => {
    render(<DesmosCalculator mode="scientific" />);

    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');

    // Phase 03 deliberate contract change: the embed carries the explicit
    // exam locale (SAT_EXAM_LOCALE). Base path + ?embed marker preserved.
    expect(scientific).toHaveAttribute('src', desmosEmbedUrl('scientific'));
    expect(scientific.getAttribute('src')).toContain('lang=en');
    expect(scientific).toHaveClass('block');
    expect(
      screen.queryByTitle('Desmos graphing calculator, College Board testing version'),
    ).not.toBeInTheDocument();
  });

  it('keeps an activated embed mounted when switching modes', () => {
    const { rerender } = render(<DesmosCalculator mode="scientific" />);
    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');

    fireEvent.load(scientific);
    rerender(<DesmosCalculator mode="graphing" />);
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    fireEvent.load(graphing);

    expect(scientific).toBeInTheDocument();
    expect(graphing).toBeInTheDocument();
    expect(scientific).toHaveClass('hidden');
    expect(graphing).toHaveClass('block');
    expect(screen.queryByText('Loading calculator…')).not.toBeInTheDocument();
    // Both frames share the frozen exam locale so reveal never reloads.
    expect(graphing.getAttribute('src')).toContain('lang=en');
  });

  it('requests the exam locale explicitly and never inherits the browser locale', () => {
    render(<DesmosCalculator mode="graphing" />);
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    expect(graphing).toHaveAttribute('src', desmosEmbedUrl('graphing'));
    expect(graphing.getAttribute('src')).toContain('lang=en');
    expect(graphing.getAttribute('src')).toContain('?embed');
  });

  it('lets the scientific frame be its natural height while graphing keeps its canvas floor', () => {
    const { rerender } = render(<DesmosCalculator mode="scientific" />);
    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');
    // Scientific: no artificial min-h stretch (the R6 void fix).
    expect(scientific.className).not.toContain('min-h-[320px]');
    rerender(<DesmosCalculator mode="graphing" prewarmInactiveModes />);
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    // Graphing: graph canvas legitimately fills the window.
    expect(graphing.className).toContain('min-h-[320px]');
  });

  it('removes the calculator iframe from keyboard interaction when the proctor pauses the exam', async () => {
    const { rerender } = render(<DesmosCalculator mode="graphing" />);
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    graphing.focus();
    expect(document.activeElement).toBe(graphing);

    rerender(<DesmosCalculator mode="graphing" disabled />);
    await waitFor(() => expect(document.activeElement).not.toBe(graphing));
    expect(graphing).toHaveAttribute('tabindex', '-1');
    expect(graphing).toHaveAttribute('inert', '');
    expect(screen.getByText('Paused by proctor')).toBeInTheDocument();
  });
});
