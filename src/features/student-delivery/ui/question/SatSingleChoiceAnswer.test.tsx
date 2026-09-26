import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SatSingleChoiceAnswer } from './SatSingleChoiceAnswer';

const content = (id: string, text: string) => ({ version: 1 as const, nodes: [{ type: 'paragraph' as const, id, text }] });
const options = [
  { id: 'a', content: content('a', 'First answer') },
  { id: 'b', content: content('b', 'Second answer') },
];

describe('SatSingleChoiceAnswer', () => {
  it('keeps a native labelled radio inside the visible focus surface', () => {
    const onChange = vi.fn();
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode={false} disabled={false} onChange={onChange} onToggleElimination={vi.fn()} />);
    const radio = screen.getByRole('radio', { name: /Option A.*First answer/i });
    expect(radio.closest('label')).toHaveClass('sat-answer-choice');
    fireEvent.click(screen.getByText('First answer'));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('announces eliminated state without fading the answer surface', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set(['a'])} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const radio = screen.getByRole('radio', { name: /Option A.*First answer/i });
    expect(radio).toHaveAccessibleDescription(/eliminated/i);
    expect(radio.closest('label')?.className).not.toMatch(/opacity-/);
    expect(screen.getByRole('button', { name: 'Undo option A' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('SatSingleChoiceAnswer Bluebook answer system (Phase 6)', () => {
  it('sizes rows to 52px min-height with 8px radius and a 1px answer-border token', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode={false} disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const label = screen.getByRole('radio', { name: /Option A.*First answer/i }).closest('label')!;
    // Tokenized geometry: canonical names (Lane 1 owns values).
    expect(label.className).toContain('var(--sat-answer-min-height)');
    expect(label.className).toContain('var(--sat-answer-radius)');
    expect(label.className).toContain('var(--sat-answer-border)');
  });

  it('carries structure with borders, never shadow utilities', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode={false} disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const label = screen.getByRole('radio', { name: /Option A.*First answer/i }).closest('label')!;
    expect(label.className).not.toMatch(/shadow-/);
  });

  it('renders a 28px circle marker with a 2px border', () => {
    const { container } = render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode={false} disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const marker = container.querySelector('[aria-hidden="true"].rounded-full');
    expect(marker).not.toBeNull();
    expect(marker!.className).toMatch(/h-7|28px|sat-choice-marker-size/);
    expect(marker!.className).toMatch(/border-2|2px/);
  });

  it('marks selection with a stronger accent border plus accent-soft tint, never a flooded blue fill', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} value="a" eliminatedOptionIds={new Set()} eliminationMode={false} disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const label = screen.getByRole('radio', { name: /Option A.*First answer/i }).closest('label')!;
    expect(label.className).toContain('var(--sat-accent');
    expect(label.className).toContain('var(--sat-accent-soft)');
    // The row itself never floods blue: selected fill lives on the marker only.
    expect(label.className).not.toContain('bg-[var(--sat-accent)]');
  });

  it('draws ONE strike across the eliminated row and keeps the sr status', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set(['a'])} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const radio = screen.getByRole('radio', { name: /Option A.*First answer/i });
    const label = radio.closest('label')!;
    const strike = label.querySelector('[data-sat-elimination-line="true"]');
    expect(strike).not.toBeNull();
    expect(strike!.className).toContain('sat-choice-elimination-line');
    // Anchored to the marker's center line, so letter and content share one Y.
    const marker = label.querySelector('[aria-hidden="true"].rounded-full')!;
    expect(strike!.parentElement).toBe(marker.parentElement);
    // No per-node decoration: line-through cannot cross equations, lists, or
    // mixed structured content as a single stroke.
    expect(marker.className).not.toContain('line-through');
    expect(document.getElementById('sat-answer-q1-0-content')!.className).not.toContain('line-through');
    expect(radio).toHaveAccessibleDescription(/eliminated/i);
  });

  it('keeps eliminator toggles at 44px touch targets', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Eliminate option A' });
    expect(toggle.className).toMatch(/h-11|44px|sat-control-target/);
    expect(toggle.className).toMatch(/w-11|44px|sat-control-target/);
  });
});

describe('SatSingleChoiceAnswer cut-choice control', () => {
  it('offers the cut icon only while the eliminator is armed', () => {
    const { unmount } = render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode={false} disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    // Mode off, nothing crossed out: the rows are exactly the plain answer rows.
    expect(screen.queryByRole('button', { name: 'Eliminate option A' })).toBeNull();
    unmount();
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const cut = screen.getByRole('button', { name: 'Eliminate option A' });
    expect(cut).toHaveAttribute('aria-pressed', 'false');
    // The glyph names THIS choice — its letter in the strike circle — never the
    // header's ABC toggle.
    const glyph = cut.querySelector('[data-sat-eliminator-glyph="choice"]');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveTextContent('A');
    expect(glyph).not.toHaveTextContent('ABC');
  });

  it('crosses a choice out without ever selecting it', () => {
    const onChange = vi.fn();
    const onToggleElimination = vi.fn();
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode disabled={false} onChange={onChange} onToggleElimination={onToggleElimination} />);
    const cut = screen.getByRole('button', { name: 'Eliminate option A' });
    // Outside the label: a button nested in a <label> would activate the radio,
    // so crossing out could answer the question.
    expect(cut.closest('label')).toBeNull();
    fireEvent.click(cut);
    expect(onToggleElimination).toHaveBeenCalledWith('a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('replaces the cut glyph with a visible Undo, and Undo restores the cut glyph', () => {
    const onChange = vi.fn();
    const onToggleElimination = vi.fn();
    // Elimination mode deliberately OFF: a crossed-out choice stays recoverable
    // without re-arming the mode.
    const { rerender } = render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set(['b'])} eliminationMode={false} disabled={false} onChange={onChange} onToggleElimination={onToggleElimination} />);
    const undo = screen.getByRole('button', { name: 'Undo option B' });
    // Real exam applied state: the cut glyph is gone and the row offers the
    // word "Undo" — compact dark text, no badge, no pill.
    expect(undo).toHaveTextContent('Undo');
    expect(undo.querySelector('[data-sat-eliminator-glyph]')).toBeNull();
    expect(undo).toHaveAttribute('data-sat-cut-choice-state', 'cut');
    expect(undo).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(undo);
    expect(onToggleElimination).toHaveBeenCalledWith('b');
    expect(onChange).not.toHaveBeenCalled();
    // Only the crossed-out choice carries a control while the mode is off.
    expect(screen.queryByRole('button', { name: 'Eliminate option A' })).toBeNull();

    // The domain mutation lands: the choice is open again, so its own cut
    // glyph is back (armed mode) and there is no Undo left to press.
    rerender(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode disabled={false} onChange={onChange} onToggleElimination={onToggleElimination} />);
    expect(screen.queryByRole('button', { name: 'Undo option B' })).toBeNull();
    const restored = screen.getByRole('button', { name: 'Eliminate option B' });
    expect(restored.querySelector('[data-sat-eliminator-glyph="choice"]')).toHaveTextContent('B');
    const restoredLabel = screen.getByRole('radio', { name: /Option B.*Second answer/i }).closest('label')!;
    expect(restoredLabel.querySelector('[data-sat-elimination-line="true"]')).toBeNull();
  });

  it('keeps a crossed-out row on the normal answer card, with no dashed outline or fade', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set(['a'])} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const cut = screen.getByRole('button', { name: 'Undo option A' });
    const open = screen.getByRole('button', { name: 'Eliminate option B' });
    expect(cut).toHaveAttribute('data-sat-cut-choice-state', 'cut');
    expect(open).toHaveAttribute('data-sat-cut-choice-state', 'open');
    const label = screen.getByRole('radio', { name: /Option A.*First answer/i }).closest('label')!;
    // The crossed-out card keeps its border and geometry; the only ink that
    // changes is the strike line and the muted content colour.
    expect(label.className).toContain('var(--sat-answer-border)');
    expect(label.className).not.toMatch(/border-dashed|opacity-/);
  });

  it('never offers a cut control on the selected answer', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} value="a" eliminatedOptionIds={new Set()} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Eliminate option A' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo option A' })).toBeNull();
    // The other choices still offer theirs.
    expect(screen.getByRole('button', { name: 'Eliminate option B' })).toBeInTheDocument();
  });

  it('selecting a choice still saves the answer normally', () => {
    const onChange = vi.fn();
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set()} eliminationMode disabled={false} onChange={onChange} onToggleElimination={vi.fn()} />);
    fireEvent.click(screen.getByText('Second answer'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
