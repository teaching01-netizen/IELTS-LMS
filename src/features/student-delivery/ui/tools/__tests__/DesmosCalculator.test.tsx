import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesmosCalculator } from '../DesmosCalculator';

describe('DesmosCalculator', () => {
  it('embeds the official College Board scientific and graphing calculators', () => {
    render(<DesmosCalculator mode="scientific" />);

    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');

    expect(scientific).toHaveAttribute(
      'src',
      'https://www.desmos.com/testing/collegeboard/scientific?embed',
    );
    expect(graphing).toHaveAttribute(
      'src',
      'https://www.desmos.com/testing/collegeboard/graphing?embed',
    );
    expect(scientific).toHaveClass('block');
    expect(graphing).toHaveClass('hidden');
  });

  it('keeps both embeds mounted when switching modes', () => {
    const { rerender } = render(<DesmosCalculator mode="scientific" />);
    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');

    fireEvent.load(scientific);
    fireEvent.load(graphing);
    rerender(<DesmosCalculator mode="graphing" />);

    expect(scientific).toBeInTheDocument();
    expect(graphing).toBeInTheDocument();
    expect(scientific).toHaveClass('hidden');
    expect(graphing).toHaveClass('block');
    expect(screen.queryByText('Loading calculator…')).not.toBeInTheDocument();
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
