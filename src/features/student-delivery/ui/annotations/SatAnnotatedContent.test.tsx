import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSatTextAnnotation, emptySatAnnotations, SAT_ANNOTATION_LIMIT } from '../../domain/satResponses';
import { clearSatGestureOrigin, clearSatSelectionGesture, isSatSelectionGestureEcho, markSatPointerDown } from './satSelectionDragGuard';
import { SatAnnotatedContent } from './SatAnnotatedContent';
import { SatAnnotationViewContext, type SatAnnotationView } from './SatAnnotationViewContext';
import { StudentExamInteractionScopeProvider } from '@shared/ui/touch-selection/StudentExamInteractionScope';

const content = (text = 'A tree grows.') => ({ version: 1 as const, nodes: [{ type: 'paragraph' as const, id: 'p', text }] });

/**
 * An armed, writable passage — the state most of these cases are about.
 *
 * The armed mode is spelled out rather than defaulted into, so the two cases
 * that turn it off read as the deliberate exception they are.
 */
function view(overrides: Partial<SatAnnotationView> = {}): SatAnnotationView {
  return {
    activeAnnotationId: null,
    openEditorActive: true,
    annotationModeEnabled: true,
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

let restoreMarkGeometry: (() => void) | null = null;
afterEach(() => {
  restoreMarkGeometry?.();
  restoreMarkGeometry = null;
});

/**
 * Give the rendered marks a line to sit on.
 *
 * jsdom has no layout, so every box would report zero and the dots would (rightly)
 * not render at all; this is the same stubbing the DOM helpers are tested with, so
 * the maths runs against the geometry the browser would report.
 */
function stubMarkLines(tops: Record<string, number>) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const id = this.getAttribute('data-sat-annotation-id');
    const top = id === null ? undefined : tops[id];
    return top === undefined
      ? ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect)
      : ({ top, left: 0, width: 600, height: 20, right: 600, bottom: top + 20, x: 0, y: top } as DOMRect);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

/**
 * Render the passage. `ownedTouchSelection` stands for the session scope the
 * route declares: it defaults OFF here, exactly as it is outside real student
 * delivery, so a case that needs it has to say so.
 */
function renderContent(
  props: Partial<React.ComponentProps<typeof SatAnnotatedContent>> = {},
  annotationView = view(),
  options: { ownedTouchSelection?: boolean } = {},
) {
  return render(
    <StudentExamInteractionScopeProvider ownedTouchSelection={options.ownedTouchSelection ?? false}>
      <SatAnnotationViewContext.Provider value={annotationView}>
        <SatAnnotatedContent
          content={content()}
          annotations={emptySatAnnotations()}
          region="stimulus"
          enabled
          {...props}
        />
      </SatAnnotationViewContext.Provider>
    </StudentExamInteractionScopeProvider>,
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
    expect(container.querySelector('[data-sat-selection-protected="true"]')).not.toBeNull();
    const { container: readOnly } = renderContent({ enabled: false });
    expect(readOnly.querySelector('[data-sat-annotation-region]')).toBeNull();
    expect(readOnly.querySelector('[data-sat-highlight-preview]')).toBeNull();
    expect(readOnly.querySelector('[data-sat-selection-protected="true"]')).not.toBeNull();
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

  // Anti-cheat friction, at the gesture. The anchor is serialized by the time the
  // report happens, so the live selection has already done its job — and while it
  // stays live the platform is free to paint its Copy / Look Up / Search / Share
  // bar over the passage, which blocking `contextmenu` does not fully suppress on
  // touch. The anchor, not the selection, is what the toolbar acts on.
  it('retires the native selection once the anchor is captured', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }));
    selectText(container, 2, 6);

    expect(onSelectionCaptured).toHaveBeenCalledTimes(1);
    expect(window.getSelection()?.rangeCount).toBe(0);
    // What the toolbar still needs survived the clear: the span itself.
    expect(onSelectionCaptured.mock.calls[0]![0]).toMatchObject({
      nodeId: 'stimulus:p',
      startOffset: 2,
      endOffset: 6,
      exact: 'tree',
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

  // The non-negotiable rule, at the gesture: an unarmed exam captures nothing.
  // The browser's own selection still happens — that is not ours to prevent —
  // but nothing is serialized, reported, or shown.
  it('reports nothing while annotation is unarmed, however much text is selected', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ annotationModeEnabled: false, onSelectionCaptured }));
    selectText(container, 2, 6);
    expect(onSelectionCaptured).not.toHaveBeenCalled();
    // The native selection is left exactly as the browser made it: unarming
    // stops our annotation system, it does not fight the platform.
    expect(window.getSelection()?.isCollapsed).toBe(false);

    // Arming the same passage restores capture with no other change, which is
    // what makes the mode the only thing that mattered.
    const armed = renderContent({}, view({ annotationModeEnabled: true, onSelectionCaptured }));
    selectText(armed.container, 2, 6);
    expect(onSelectionCaptured).toHaveBeenCalledTimes(1);
  });

  it('keeps painted marks as plain text while unarmed, with their ink intact', () => {
    const annotations = emptySatAnnotations();
    annotations.annotations = [createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree', color: 'blue' })];
    const openEditor = vi.fn();
    const { container } = renderContent({ annotations }, view({ annotationModeEnabled: false, openEditor }));
    const mark = container.querySelector<HTMLElement>('[data-sat-highlight="true"]')!;

    // Still the student's work: OFF means stop creating and editing, never hide.
    expect(container.querySelector('[data-sat-highlight-color="blue"]')).toHaveTextContent('tree');
    // …and never a control. Tapping it opens nothing, and no assistive tech
    // announces an action that is not available.
    expect(mark).not.toHaveAttribute('role');
    expect(mark).not.toHaveAttribute('tabindex');
    expect(mark).not.toHaveAttribute('data-sat-annotation-control');
    expect(mark).not.toHaveAttribute('aria-label');
    fireEvent.click(mark);
    expect(openEditor).not.toHaveBeenCalled();
  });

  // The margin dots are part of what the student wrote, not part of the tool:
  // arming decides whether marks are editable, never whether they are visible.
  it('keeps the note dots while unarmed', () => {
    restoreMarkGeometry = stubMarkLines({ a1: 40 });
    const annotations = emptySatAnnotations();
    annotations.annotations = [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', id: 'a1', startOffset: 2, endOffset: 6, exact: 'tree', note: 'Cooler here' }),
    ];
    const { container } = renderContent({ annotations }, view({ annotationModeEnabled: false }));
    expect(container.querySelector('[data-sat-note-marker="a1"]')).not.toBeNull();
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

  it('leaves the passage as text: a note is announced in the tools, never drawn into the sentence', () => {
    const text = 'A tree grows.';
    const annotations = emptySatAnnotations();
    annotations.annotations = [
      { ...createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree', color: 'yellow' }), note: 'Cooler here' },
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 7, endOffset: 12, exact: 'grows', color: 'blue' }),
    ];
    const { container } = renderContent({ annotations });
    const written = container.querySelector('[data-sat-highlight-color="yellow"]')!;
    const bare = container.querySelector('[data-sat-highlight-color="blue"]')!;

    // The attribute means what it says: it used to carry the mark's id on every
    // mark, note or not. It stays, because it is how the passage reports which
    // highlights carry a note — that is a fact about the mark, not decoration.
    expect(written).toHaveAttribute('data-sat-annotation-note', 'true');
    expect(bare).not.toHaveAttribute('data-sat-annotation-note');
    // But nothing is drawn into the sentence for it: the note glyph that used to
    // ride the mark made annotated prose look marked-up, and the note is already
    // one press away in the mark's own tools.
    expect(container.querySelector('[data-sat-note-mark]')).toBeNull();
    expect(written).toHaveTextContent('tree');
    // The label tells assistive tech (and every sighted student reading the tool)
    // which action the mark offers, which is where that answer belongs.
    expect(written).toHaveAttribute('aria-label', expect.stringContaining('Edit note'));
    expect(bare).toHaveAttribute('aria-label', expect.stringContaining('Add note'));
  });

  it('carries the note on the mark exactly once, however the mark wraps', () => {
    const text = 'A tree that grows in shade and drops its leaves in autumn.';
    const annotations = emptySatAnnotations();
    annotations.annotations = [{
      ...createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 12, exact: 'tree that ' }),
      note: 'Compare the two claims',
    }];
    const { container } = renderContent({ annotations, content: content(text) });
    // A mark split across rendered lines is still ONE mark with one note.
    expect(container.querySelectorAll('[data-sat-highlight="true"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-sat-annotation-note="true"]')).toHaveLength(1);
  });

  /*
   * The margin dots. The pane says what the student wrote; these say where, which
   * used to mean opening the pane and reading quotes. Two properties matter and
   * are what these cases pin: a dot appears only for a phrase someone actually
   * wrote about, and it appears OUTSIDE the sentence.
   */
  describe('note markers in the margin', () => {
    const at = { kind: 'highlight' as const, nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree' };

    /** One noted phrase and one bare highlight beside it. */
    function passage(note: string | undefined) {
      const annotations = emptySatAnnotations();
      annotations.annotations = [
        createSatTextAnnotation({ ...at, id: 'a1', color: 'blue', ...(note ? { note } : {}) }),
        createSatTextAnnotation({ ...at, id: 'a2', color: 'pink', startOffset: 7, endOffset: 12, exact: 'grows' }),
      ];
      return annotations;
    }

    it('dots the phrase the note was written about, in that highlight’s ink, outside the sentence', () => {
      restoreMarkGeometry = stubMarkLines({ a1: 40, a2: 90 });
      const { container } = renderContent({ annotations: passage('Cooler here') });

      const layer = container.querySelector('[data-sat-note-markers="true"]')!;
      expect(layer).toHaveAttribute('aria-hidden', 'true');
      const dot = layer.querySelector('[data-sat-note-marker="a1"]')!;
      // The same ink as the highlight, which is the same dot its card shows in
      // the pane: one object, seen at both ends.
      expect(dot).toHaveAttribute('data-sat-note-marker-color', 'blue');
      expect(dot.getAttribute('style')).toContain('var(--sat-swatch-blue');
      // Level with the mark's line, in the content box's coordinates.
      expect(dot.getAttribute('style')).toContain('top: 50px');

      // A highlight nobody wrote about stays a plain highlight.
      expect(layer.querySelector('[data-sat-note-marker="a2"]')).toBeNull();

      // And nothing is drawn into the sentence: the dot lives in the margin
      // layer, never inside the mark's own box.
      const mark = container.querySelector('[data-sat-highlight-color="blue"]')!;
      expect(mark.querySelector('[data-sat-note-marker]')).toBeNull();
      expect(mark).toHaveTextContent('tree');
      expect(layer.closest('[data-sat-annotation-region]')?.contains(layer)).toBe(true);
    });

    it('is decoration only: no target, no name, nothing to announce twice', () => {
      restoreMarkGeometry = stubMarkLines({ a1: 40 });
      const { container } = renderContent({ annotations: passage('Cooler here') });
      const dot = container.querySelector('[data-sat-note-marker="a1"]')!;
      expect(dot.tagName).toBe('SPAN');
      // The mark's own label already says "Edit note"; a second control in the
      // margin would be a second answer to the same question.
      expect(dot).not.toHaveAttribute('role');
      expect(dot).not.toHaveAttribute('tabindex');
      expect(dot).not.toHaveAttribute('aria-label');
      expect(container.querySelector('[data-sat-note-markers] button')).toBeNull();
      expect(container.querySelector('[data-sat-note-markers]')!.className).toContain('pointer-events-none');
      // Never focusable, so the tab order through the passage is unchanged.
      expect(dot.querySelectorAll('a, button, input, textarea, [tabindex]')).toHaveLength(0);
    });

    it('gives the mark its dot the moment the note is written', () => {
      restoreMarkGeometry = stubMarkLines({ a1: 40 });
      const { container, rerender } = render(
        <SatAnnotationViewContext.Provider value={view()}>
          <SatAnnotatedContent content={content()} annotations={passage(undefined)} region="stimulus" enabled />
        </SatAnnotationViewContext.Provider>,
      );
      // Highlighted but not written about: the passage shows no trace, which is
      // the whole rule the pane follows too.
      expect(container.querySelector('[data-sat-note-markers]')).toBeNull();

      rerender(
        <SatAnnotationViewContext.Provider value={view()}>
          <SatAnnotatedContent content={content()} annotations={passage('Cooler here')} region="stimulus" enabled />
        </SatAnnotationViewContext.Provider>,
      );
      expect(container.querySelector('[data-sat-note-marker="a1"]')).not.toBeNull();
    });

    it('collapses two notes on one line to a single dot', () => {
      restoreMarkGeometry = stubMarkLines({ a1: 40, a2: 42 });
      const annotations = emptySatAnnotations();
      annotations.annotations = [
        createSatTextAnnotation({ ...at, id: 'a1', note: 'First' }),
        createSatTextAnnotation({ ...at, id: 'a2', startOffset: 7, endOffset: 12, exact: 'grows', note: 'Second' }),
      ];
      const { container } = renderContent({ annotations });
      expect(container.querySelectorAll('[data-sat-note-marker]')).toHaveLength(1);
    });

    it('stays out of a read-only passage, where notes cannot be written at all', () => {
      restoreMarkGeometry = stubMarkLines({ a1: 40 });
      const { container } = renderContent({ annotations: passage('Cooler here') }, view({ openEditorActive: false }));
      expect(container.querySelector('[data-sat-note-markers]')).toBeNull();
    });
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

type PointCapable = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

/**
 * The owned touch gesture, end to end.
 *
 * This is the touch case. Once the app claims the physical touch pointer, the
 * exam disables native text selection and creates the range itself. These
 * cases pin that the owned range reaches the very
 * same capture the desktop selection does, while `window.getSelection()` stays
 * empty the whole time. The empty selection is the point: it is what the
 * platform attaches its Copy / Find / Look Up bar to.
 *
 * jsdom has no hit test, so hit testing is stubbed at the boundary the hook
 * takes it from. Everything else — the hold, the
 * tolerance, the ordering, the capture — runs for real.
 */
describe('SAT owned touch selection', () => {
  let restoreEnvironment: (() => void) | null = null;

  afterEach(() => {
    restoreEnvironment?.();
    restoreEnvironment = null;
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
  });

  function stubCoarsePointerDevice() {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('pointer: coarse'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    return () => {
      window.matchMedia = original;
    };
  }

  function stubHitTest(leaf: Text) {
    const capable = document as PointCapable;
    const original = capable.caretPositionFromPoint;
    capable.caretPositionFromPoint = (x: number) => ({ offsetNode: leaf, offset: Math.round(x) });
    return () => {
      if (original) capable.caretPositionFromPoint = original;
      else delete capable.caretPositionFromPoint;
    };
  }

  function longPressAndDrag(clientX: number[]) {
    const region = document.querySelector('[data-sat-annotation-region]')!;
    vi.useFakeTimers();
    fireEvent.pointerDown(region, { pointerType: 'touch', pointerId: 1, clientX: clientX[0], clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    for (const x of clientX.slice(1)) {
      fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 10 });
    }
    fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1 });
  }

  it('owns only touch selection on a protected exam root and suppresses late native ranges', () => {
    window.getSelection()?.removeAllRanges();
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }), { ownedTouchSelection: true });
    const region = container.querySelector('[data-sat-annotation-region]') as HTMLElement;
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;

    fireEvent.pointerDown(region, { pointerType: 'touch', pointerId: 8, clientX: 2, clientY: 10 });
    expect(region).toHaveAttribute('data-student-selection-owner', 'app');

    const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });
    fireEvent(region, selectStart);
    expect(selectStart.defaultPrevented).toBe(true);

    const range = document.createRange();
    range.setStart(leaf, 0);
    range.setEnd(leaf, 4);
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(onSelectionCaptured).not.toHaveBeenCalled();
  });

  it('leaves mouse and editor selections on the browser path', () => {
    window.getSelection()?.removeAllRanges();
    const { container } = renderContent({}, view(), { ownedTouchSelection: true });
    const region = container.querySelector('[data-sat-annotation-region]') as HTMLElement;
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;

    fireEvent.pointerDown(region, { pointerType: 'mouse', pointerId: 9, clientX: 2, clientY: 10 });
    expect(region).not.toHaveAttribute('data-student-selection-owner');
    const range = document.createRange();
    range.setStart(leaf, 0);
    range.setEnd(leaf, 4);
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    expect(window.getSelection()?.toString()).toBe('A tr');

    window.getSelection()?.removeAllRanges();
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = 'edit me';
    region.append(editor);
    fireEvent.pointerDown(editor, { pointerType: 'touch', pointerId: 10, clientX: 2, clientY: 10 });
    expect(region).not.toHaveAttribute('data-student-selection-owner');
    const editorSelectStart = new Event('selectstart', { bubbles: true, cancelable: true });
    fireEvent(editor, editorSelectStart);
    expect(editorSelectStart.defaultPrevented).toBe(false);
    const editorSelection = document.createRange();
    editorSelection.setStart(editor.firstChild!, 0);
    editorSelection.setEnd(editor.firstChild!, 4);
    window.getSelection()?.addRange(editorSelection);
    fireEvent(document, new Event('selectionchange'));
    expect(window.getSelection()?.toString()).toBe('edit');
  });

  it('declares the owned drag to the browser while the mode is armed and only then', () => {
    const armed = stubCoarsePointerDevice();
    const { container } = renderContent({}, view({}), { ownedTouchSelection: true });
    expect(container.querySelector('[data-student-owned-touch-selection="true"]')).not.toBeNull();
    armed();

    // Mode off: no selection is coming, so the passage keeps its scrolling.
    const off = stubCoarsePointerDevice();
    const disabled = renderContent({}, view({ annotationModeEnabled: false }), {
      ownedTouchSelection: true,
    });
    expect(
      disabled.container.querySelector('[data-student-owned-touch-selection="true"]'),
    ).toBeNull();
    off();

    // Outside a real exam session the platform owns everything, as before.
    const preview = stubCoarsePointerDevice();
    const previewed = renderContent({}, view({}));
    expect(
      previewed.container.querySelector('[data-student-owned-touch-selection="true"]'),
    ).toBeNull();
    preview();
  });

  it('captures an anchor from a hold-and-drag without ever making a browser selection', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }), { ownedTouchSelection: true });
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    longPressAndDrag([2, 4, 6]);

    expect(onSelectionCaptured).toHaveBeenCalledWith({
      nodeId: 'stimulus:p',
      startOffset: 2,
      endOffset: 6,
      exact: 'tree',
      prefix: 'A ',
      suffix: ' grows.',
    });
    expect(isSatSelectionGestureEcho()).toBe(true);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it('retires answer activation before the annotation limit rejects an owned range', () => {
    const onLimitReached = vi.fn();
    const annotations = {
      version: 2 as const,
      legacyQuestionNote: '',
      annotations: Array.from({ length: SAT_ANNOTATION_LIMIT }, () =>
        createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 0, endOffset: 1, exact: 'A' }),
      ),
    };
    const { container } = renderContent({ annotations, onLimitReached }, view(), { ownedTouchSelection: true });
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    longPressAndDrag([2, 4, 6]);

    expect(onLimitReached).toHaveBeenCalledOnce();
    expect(isSatSelectionGestureEcho()).toBe(true);
  });

  it('takes the word under the hold when the finger never travels', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }), { ownedTouchSelection: true });
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    // Offset 7 is the "g" of "grows": a hold, a release, and nothing else.
    longPressAndDrag([7]);

    expect(onSelectionCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ exact: 'grows', startOffset: 7, endOffset: 12 }),
    );
  });

  it('captures an armed drag that never pauses for a hold', () => {
    // The way a student actually selects on a touch screen: press and drag, no
    // pause. The prose here has no platform selection to fall back on, so a
    // gesture that cancels itself on the first 8 pixels of travel left nothing
    // that could select the text at all.
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }), { ownedTouchSelection: true });
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    const region = document.querySelector('[data-sat-annotation-region]')!;
    vi.useFakeTimers();
    fireEvent.pointerDown(region, { pointerType: 'touch', pointerId: 1, clientX: 2, clientY: 10 });
    // Vertical travel past the tolerance, with the horizontal coordinate — which
    // is the character offset here — unchanged.
    fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: 2, clientY: 25 });
    fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: 6, clientY: 25 });
    fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1 });

    expect(onSelectionCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree' }),
    );
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it('owns nothing while the annotation mode is off, which is all a platform selection ever did', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ annotationModeEnabled: false, onSelectionCaptured }), { ownedTouchSelection: true });
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    longPressAndDrag([2, 6]);

    expect(onSelectionCaptured).not.toHaveBeenCalled();
  });

  it('declares nothing outside a real exam session, so a preview keeps the platform selection', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }));
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    // Scope defaults to false: the same physical touch and hit test, no ownership.
    longPressAndDrag([2, 6]);
    expect(onSelectionCaptured).not.toHaveBeenCalled();
  });

  it('owns a physical touch gesture even when the primary pointer is fine', () => {
    const onSelectionCaptured = vi.fn();
    const { container } = renderContent({}, view({ onSelectionCaptured }), { ownedTouchSelection: true });
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild as Text;
    const originalMatchMedia = window.matchMedia;
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      window.matchMedia = originalMatchMedia;
    };
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;

    longPressAndDrag([2, 6]);
    expect(onSelectionCaptured).toHaveBeenCalledWith(expect.objectContaining({ exact: 'tree' }));
    expect(container.querySelector('[data-sat-selection-protected="true"]')).toHaveAttribute('data-student-selection-owner', 'app');
    expect(window.getSelection()?.rangeCount).toBe(0);
  });
});
