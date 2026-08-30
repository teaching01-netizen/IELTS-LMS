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
    expect(screen.getByRole('button', { name: 'Restore option A' })).toHaveAttribute('aria-pressed', 'true');
  });
});
