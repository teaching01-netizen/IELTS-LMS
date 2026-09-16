import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSatTextAnnotation } from '../../domain/satResponses';
import { SatAnnotationNoteEditor } from './SatAnnotationNoteEditor';

function renderEditor(overrides: Partial<React.ComponentProps<typeof SatAnnotationNoteEditor>> = {}) {
  const props = {
    annotation: createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 0, endOffset: 4, exact: 'tree' }),
    onChange: vi.fn(),
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onFlush: vi.fn(),
    ...overrides,
  };
  render(<SatAnnotationNoteEditor {...props} />);
  return props;
}

afterEach(() => {
  vi.useRealTimers();
});

it('flushes pending note persistence on blur and close', () => {
  const props = renderEditor();
  fireEvent.blur(screen.getByRole('textbox', { name: 'Your note' }));
  expect(props.onFlush).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(props.onFlush).toHaveBeenCalledTimes(2);
  expect(props.onClose).toHaveBeenCalledOnce();
});

it('prompts with human language and puts the caret in the field on open', () => {
  renderEditor();
  const field = screen.getByRole('textbox', { name: 'Your note' });
  expect(field).toHaveAttribute('placeholder', 'Add a quick note…');
  expect(document.activeElement).toBe(field);
});

it('autosaves after idle typing and confirms with a transient Saved state', () => {
  vi.useFakeTimers();
  const props = renderEditor();
  const field = screen.getByRole('textbox', { name: 'Your note' });
  fireEvent.change(field, { target: { value: 'Remember this' } });
  // Nothing is written while the student is still typing.
  expect(props.onChange).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(800);
  });
  expect(props.onChange).toHaveBeenCalledWith('Remember this');
  expect(screen.getByTestId('sat-note-saved')).toHaveTextContent('Saved');
  // …and the reassurance fades: there is no permanent Save affordance.
  act(() => {
    vi.advanceTimersByTime(1200);
  });
  expect(screen.queryByTestId('sat-note-saved')).not.toBeInTheDocument();
});

it('commits the draft when the card is closed, so typing then Done never loses a note', () => {
  const props = renderEditor();
  const field = screen.getByRole('textbox', { name: 'Your note' });
  fireEvent.change(field, { target: { value: 'Check the evidence' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(props.onChange).toHaveBeenCalledWith('Check the evidence');
});

it('offers deletion for the mark the note hangs off', () => {
  const props = renderEditor();
  fireEvent.click(screen.getByRole('button', { name: 'Delete this note' }));
  expect(props.onDelete).toHaveBeenCalledOnce();
});
