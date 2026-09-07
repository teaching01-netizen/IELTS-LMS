import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createSatTextAnnotation } from '../../domain/satResponses';
import { SatAnnotationNoteEditor } from './SatAnnotationNoteEditor';

it('flushes pending note persistence on blur and close', () => {
  const onFlush = vi.fn();
  const onClose = vi.fn();
  render(<SatAnnotationNoteEditor annotation={createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 0, endOffset: 4, exact: 'tree' })}
    onChange={vi.fn()} onClose={onClose} onDelete={vi.fn()} onFlush={onFlush} />);
  fireEvent.blur(screen.getByRole('textbox', { name: 'Note for selected text' }));
  expect(onFlush).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(onFlush).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledOnce();
});
