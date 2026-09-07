import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSatTextAnnotation, emptySatAnnotations } from '../../domain/satResponses';
import { SatAnnotatedContent } from './SatAnnotatedContent';
import { SatAnnotationModeContext } from './SatAnnotationModeContext';

describe('SAT annotation decoration', () => {
  it('creates an anchored highlight on selection completion only while the mode is enabled', () => {
    const onChange = vi.fn();
    const content = { version: 1 as const, nodes: [{ type: 'paragraph' as const, id: 'p', text: 'A tree grows.' }] };
    const annotations = emptySatAnnotations();
    const view = (mode: 'none' | 'highlight') => <SatAnnotationModeContext.Provider value={mode}>
      <SatAnnotatedContent content={content} annotations={annotations} region="stimulus" enabled onChange={onChange} />
    </SatAnnotationModeContext.Provider>;
    const { container, rerender } = render(view('none'));
    const select = () => {
      const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild!;
      const range = document.createRange();
      range.setStart(leaf, 2); range.setEnd(leaf, 6);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      fireEvent.pointerUp(container.firstChild!);
    };
    select();
    expect(onChange).not.toHaveBeenCalled();
    rerender(view('highlight'));
    select();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ annotations: [expect.objectContaining({ kind: 'highlight', anchor: {
      nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree', prefix: 'A ', suffix: ' grows.',
    } })] }));
    onChange.mockClear();
    fireEvent.pointerUp(document);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('recomputes recovered ranges when content changes without a response edit', () => {
    const annotations = emptySatAnnotations();
    annotations.annotations = [createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree' })];
    const content = (text: string) => ({ version: 1 as const, nodes: [{ type: 'paragraph' as const, id: 'p', text }] });
    const { container, rerender } = render(<SatAnnotatedContent content={content('A tree grows.')} annotations={annotations} region="stimulus" enabled />);
    expect(container.querySelector('[data-sat-highlight]')).toHaveTextContent('tree');
    rerender(<SatAnnotatedContent content={content('Today a tree grows.')} annotations={annotations} region="stimulus" enabled />);
    expect(container.querySelector('[data-sat-highlight]')).toHaveTextContent('tree');
  });
});
