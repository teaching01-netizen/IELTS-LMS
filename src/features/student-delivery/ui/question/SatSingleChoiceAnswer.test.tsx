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

  it('strikes the whole eliminated content and keeps the sr status', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set(['a'])} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const radio = screen.getByRole('radio', { name: /Option A.*First answer/i });
    const content = document.getElementById('sat-answer-q1-0-content')!;
    expect(content.className).toMatch(/line-through/);
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
    // The glyph is drawn (ABC + strike), not a generic crossed-out icon.
    const glyph = cut.querySelector('[data-sat-eliminator-glyph="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveTextContent('ABC');
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

  it('keeps the cut badge on a crossed-out choice and restores without answering', () => {
    const onChange = vi.fn();
    const onToggleElimination = vi.fn();
    // Elimination mode deliberately OFF: a crossed-out choice stays recoverable
    // without re-arming the mode.
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set(['b'])} eliminationMode={false} disabled={false} onChange={onChange} onToggleElimination={onToggleElimination} />);
    const undo = screen.getByRole('button', { name: 'Undo option B' });
    // One control, one shape: the crossed-out box keeps the ABC cut badge
    // instead of swapping it for the word "Undo".
    expect(undo.querySelector('[data-sat-eliminator-glyph="true"]')).toHaveTextContent('ABC');
    expect(undo).not.toHaveTextContent('Undo');
    expect(undo).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(undo);
    expect(onToggleElimination).toHaveBeenCalledWith('b');
    expect(onChange).not.toHaveBeenCalled();
    // Only the crossed-out choice carries a control while the mode is off.
    expect(screen.queryByRole('button', { name: 'Eliminate option A' })).toBeNull();
  });

  it('wears the same badge in both states, with the applied one dashed and muted', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set(['a'])} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const cut = screen.getByRole('button', { name: 'Undo option A' });
    const open = screen.getByRole('button', { name: 'Eliminate option B' });
    expect(cut).toHaveAttribute('data-sat-cut-choice-state', 'cut');
    expect(open).toHaveAttribute('data-sat-cut-choice-state', 'open');
    const cutGlyph = cut.querySelector('[data-sat-eliminator-glyph="true"]')!;
    const openGlyph = open.querySelector('[data-sat-eliminator-glyph="true"]')!;
    // Same badge in both states: the difference is its paint, never a word.
    expect(cutGlyph).toHaveTextContent(openGlyph.textContent!);
    expect(cutGlyph.className).toContain('border-dashed');
    expect(openGlyph.className).not.toContain('border-dashed');
  });

  it('strikes the option letter along with the choice content', () => {
    render(<SatSingleChoiceAnswer questionId="q1" options={options} eliminatedOptionIds={new Set(['a'])} eliminationMode disabled={false} onChange={vi.fn()} onToggleElimination={vi.fn()} />);
    const label = screen.getByRole('radio', { name: /Option A.*First answer/i }).closest('label')!;
    const marker = label.querySelector('[aria-hidden="true"].rounded-full');
    expect(marker).not.toBeNull();
    expect(marker!.className).toContain('line-through');
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
