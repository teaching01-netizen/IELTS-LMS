import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSatTextAnnotation, emptySatAnnotations } from '../../domain/satResponses';
import { clearSatGestureOrigin, clearSatSelectionGesture, markSatPointerDown } from './satSelectionDragGuard';
import { SatAnnotatedContent } from './SatAnnotatedContent';
import { SatAnnotationViewContext, type SatAnnotationView } from './SatAnnotationViewContext';

const content = (text = 'A tree grows.') => ({ version: 1 as const, nodes: [{ type: 'paragraph' as const, id: 'p', text }] });

function view(overrides: Partial<SatAnnotationView> = {}): SatAnnotationView {
  return {
    activeAnnotationId: null,
    openEditorActive: true,
    openEditor: vi.fn(),
    ...overrides,
  };
}

// Gesture state is module-level by design (one gesture at a time); tests must
// not inherit each other's presses.
beforeEach(() => {
  clearSatGestureOrigin();
  clearSatSelectionGesture();
});

function renderContent(props: Partial<React.ComponentProps<typeof SatAnnotatedContent>> = {}, annotationView = view()) {
  return render(
    <SatAnnotationViewContext.Provider value={annotationView}>
      <SatAnnotatedContent
        content={content()}
        annotations={emptySatAnnotations()}
        region="stimulus"
        enabled
        {...props}
      />
    </SatAnnotationViewContext.Provider>,
  );
}

/** Select the first `length` characters of the block and finish the gesture. */
function selectText(container: HTMLElement, from: number, to: number) {
  const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild!;
  const range = document.createRange();
  range.setStart(leaf, from);
  range.setEnd(leaf, to);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.pointerUp(container.querySelector('[data-sat-annotation-region]')!);
}

describe('SAT annotation rendering', () => {
  it('marks the region as annotatable only when the section allows it', () => {
    const { container } = renderContent();
    expect(container.querySelector('[data-sat-annotation-region="stimulus"]')).toHaveAttribute('data-sat-highlight-preview', 'true');
    const { container: readOnly } = renderContent({ enabled: false });
    expect(readOnly.querySelector('[data-sat-annotation-region]')).toBeNull();
    expect(readOnly.querySelector('[data-sat-highlight-preview]')).toBeNull();
  });

  it('reports a completed selection upward without applying anything itself', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }));
    selectText(container, 2, 6);
    expect(onSelectionCaptured).toHaveBeenCalledWith({
      nodeId: 'stimulus:p',
      startOffset: 2,
      endOffset: 6,
      exact: 'tree',
      prefix: 'A ',
      suffix: ' grows.',
    });
  });

  it('ignores a collapsed selection and pointers outside the annotatable region', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }));
    // Collapsed range: no intent.
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild!;
    const collapsed = document.createRange();
    collapsed.setStart(leaf, 2);
    collapsed.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(collapsed);
    fireEvent.pointerUp(container.querySelector('[data-sat-annotation-region]')!);
    expect(onSelectionCaptured).not.toHaveBeenCalled();
    // Pointer landing outside the component (the toolbar case) is a command.
    selectText(container, 2, 6);
    expect(onSelectionCaptured).toHaveBeenCalledTimes(1);
  });

  it('never reports a selection while annotations are disabled for this section', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({ enabled: false }, view({ enabled: false, onSelectionCaptured }));
    // Disabled sections render plain content: no annotatable text nodes and no
    // annotation region, so there is nothing to capture form.
    expect(container.querySelector('[data-content-text-node]')).toBeNull();
    expect(container.querySelector('[data-sat-annotation-region]')).toBeNull();
    fireEvent.pointerUp(container.firstElementChild!);
    expect(onSelectionCaptured).not.toHaveBeenCalled();
  });

  it('recomputes recovered ranges when content changes without a response edit', () => {
    const annotations = emptySatAnnotations();
    annotations.annotations = [createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree' })];
    const { container, rerender } = render(
      <SatAnnotationViewContext.Provider value={view()}>
        <SatAnnotatedContent content={content('A tree grows.')} annotations={annotations} region="stimulus" enabled />
      </SatAnnotationViewContext.Provider>,
    );
    expect(container.querySelector('[data-sat-highlight]')).toHaveTextContent('tree');
    rerender(
      <SatAnnotationViewContext.Provider value={view()}>
        <SatAnnotatedContent content={content('Today a tree grows.')} annotations={annotations} region="stimulus" enabled />
      </SatAnnotationViewContext.Provider>,
    );
    expect(container.querySelector('[data-sat-highlight]')).toHaveTextContent('tree');
  });

  it('paints each ink with its own token and underlines with the text token', () => {
    const annotations = emptySatAnnotations();
    annotations.annotations = [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree', color: 'blue' }),
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 7, endOffset: 12, exact: 'grows', color: 'pink' }),
      createSatTextAnnotation({ kind: 'underline', nodeId: 'stimulus:p', startOffset: 0, endOffset: 1, exact: 'A' }),
    ];
    const { container } = renderContent({ annotations });
    const styles = [...container.querySelectorAll<HTMLElement>('[data-sat-highlight], [data-sat-underline]')]
      .map((element) => element.getAttribute('style') ?? '')
      .join(' ');
    // Ink is a token with a paper-compatible fallback, never a literal in TSX.
    expect(styles).toContain('var(--sat-highlight-bg-blue');
    expect(styles).toContain('var(--sat-highlight-bg-pink');
    expect(styles).toContain('var(--sat-underline');
    expect(container.querySelector('[data-sat-highlight-color="blue"]')).toHaveTextContent('tree');
    expect(container.querySelector('[data-sat-highlight-color="pink"]')).toHaveTextContent('grows');
  });

  it('keeps multi-line marks as inline accessible controls that open their editor', () => {
    const text = 'A long supporting-material sentence that wraps across several lines.';
    const annotations = emptySatAnnotations();
    annotations.annotations = [createSatTextAnnotation({
      kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: text.length - 1,
      exact: text.slice(2, -1),
    })];
    const openEditor = vi.fn();
    const { container } = render(
      <SatAnnotationViewContext.Provider value={view({ openEditor })}>
        <SatAnnotatedContent content={content(text)} annotations={annotations} region="stimulus" enabled />
      </SatAnnotationViewContext.Provider>,
    );
    const mark = container.querySelector<HTMLElement>('[data-sat-highlight="true"]')!;
    expect(mark.tagName).toBe('SPAN');
    expect(mark).toHaveAttribute('role', 'button');
    expect(mark).toHaveAttribute('tabindex', '0');
    expect(mark).toHaveAttribute('data-sat-annotation-control', 'true');
    expect(mark.style.boxDecorationBreak).toBe('clone');
    fireEvent.click(mark);
    expect(openEditor).toHaveBeenCalledWith(annotations.annotations[0]);
    // Space activates too: the mark is a real control for AT and keyboards.
    fireEvent.keyDown(mark, { key: ' ' });
    expect(openEditor).toHaveBeenCalledTimes(2);
  });

  it('opens a mark on a tap but leaves a drag ending on it to the new selection', () => {
    const text = 'A tree grows.';
    const annotations = emptySatAnnotations();
    annotations.annotations = [createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree' })];
    const openEditor = vi.fn();
    const { container } = render(
      <SatAnnotationViewContext.Provider value={view({ openEditor })}>
        <SatAnnotatedContent content={content(text)} annotations={annotations} region="stimulus" enabled />
      </SatAnnotationViewContext.Provider>,
    );
    const mark = container.querySelector<HTMLElement>('[data-sat-highlight="true"]')!;

    // A press that travelled before releasing is a selection, not a tap: the
    // student is marking new text, so the editor must not steal the toolbar.
    markSatPointerDown(10, 200);
    fireEvent.click(mark, { clientX: 120, clientY: 200 });
    expect(openEditor).not.toHaveBeenCalled();

    // A press that stayed put is a tap.
    markSatPointerDown(10, 200);
    fireEvent.click(mark, { clientX: 12, clientY: 201 });
    expect(openEditor).toHaveBeenCalledWith(annotations.annotations[0]);
  });

  it('renders marks as plain decoration in a read-only context', () => {
    const annotations = emptySatAnnotations();
    annotations.annotations = [createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree' })];
    // Read-only = marks paint but are not controls (blocked exam, previews).
    const { container } = renderContent({ annotations }, view({ openEditorActive: false }));
    const mark = container.querySelector('[data-sat-highlight="true"]')!;
    expect(mark).not.toHaveAttribute('role');
    expect(mark).not.toHaveAttribute('data-sat-annotation-control');
  });
});
