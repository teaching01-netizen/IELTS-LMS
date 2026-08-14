import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TableCompletionSlotCell } from '../TableCompletionSlotCell';

vi.mock('../ProtectedInput', () => ({
  ProtectedInput: ({ value, onChange, sessionId: _sessionId, studentId: _studentId, ...props }: any) => (
    <input
      {...props}
      value={value ?? ''}
      onChange={(e) => onChange(e)}
      data-testid={`protected-input-${props.name}`}
    />
  ),
}));

vi.mock('../FormattedText', () => ({
  FormattedText: ({ text, highlightSurfaceId, className }: any) => (
    <span data-highlight-surface-id={highlightSurfaceId} className={className}>{text}</span>
  ),
}));

const defaultProps = {
  slotId: 'slot-1',
  highlightSurfaceIdPrefix: 'question:table-1:slot-1',
  isActive: false,
  isFlagged: false,
  promptPrefixText: 'The answer is',
  promptSuffixText: '.',
  slotNumber: 1,
  answerValue: '',
  ariaLabel: 'Answer for slot 1',
  highlightEnabled: false,
  security: { preventAutofill: true, preventAutocorrect: true },
  onChange: vi.fn(),
  renderFlagButton: (slotId: string) => <button data-testid={`flag-${slotId}`}>Flag</button>,
};

describe('TableCompletionSlotCell', () => {
  it('renders the cell with slot number', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders prefix and suffix text', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText('The answer is')).toBeInTheDocument();
    expect(screen.getByText('.')).toBeInTheDocument();
    expect(screen.getByText('The answer is')).toHaveAttribute(
      'data-highlight-surface-id',
      'question:table-1:slot-1:prefix',
    );
    expect(screen.getByText('.')).toHaveAttribute(
      'data-highlight-surface-id',
      'question:table-1:slot-1:suffix',
    );
  });

  it('renders the input with correct aria-label', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByLabelText('Answer for slot 1')).toBeInTheDocument();
  });

  it('calls onChange when input value changes', () => {
    const onChange = vi.fn();
    render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} onChange={onChange} />
          </tr>
        </tbody>
      </table>,
    );
    const input = screen.getByLabelText('Answer for slot 1');
    fireEvent.change(input, { target: { value: 'new answer' } });
    expect(onChange).toHaveBeenCalledWith('new answer');
  });

  it('renders the flag button', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId('flag-slot-1')).toBeInTheDocument();
  });

  it('applies active ring style when isActive is true', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} isActive={true} />
          </tr>
        </tbody>
      </table>,
    );
    const td = container.querySelector('td');
    expect(td?.className).toContain('ring-2');
    expect(td?.className).toContain('ring-blue-800');
  });

  it('applies flagged background when isFlagged is true', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} isFlagged={true} />
          </tr>
        </tbody>
      </table>,
    );
    const td = container.querySelector('td');
    expect(td?.className).toContain('bg-amber-50');
  });

  it('does not apply active ring when isActive is false', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} isActive={false} />
          </tr>
        </tbody>
      </table>,
    );
    const td = container.querySelector('td');
    expect(td?.className).not.toContain('ring-2');
  });

  it('does not apply flagged background when isFlagged is false', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} isFlagged={false} />
          </tr>
        </tbody>
      </table>,
    );
    const td = container.querySelector('td');
    expect(td?.className).not.toContain('bg-amber-50');
  });

  it('sets the td id based on slotId', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} />
          </tr>
        </tbody>
      </table>,
    );
    const td = container.querySelector('td');
    expect(td?.id).toBe('question-slot-1');
  });

  it('passes answerValue to the input', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} answerValue="my answer" />
          </tr>
        </tbody>
      </table>,
    );
    const input = screen.getByLabelText('Answer for slot 1');
    expect(input).toHaveValue('my answer');
  });

  it('renders different slot numbers correctly', () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCompletionSlotCell {...defaultProps} slotNumber={5} />
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
