import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useStudentSelectionGesture } from '../react/useStudentSelectionGesture';

/**
 * The second text surface: native Ranges anchored in Selection-v2's own
 * presentation DOM (loupe clone, floating layer, handles) must be destroyed
 * exactly like source-root Ranges — and editables must survive.
 *
 * jsdom cannot reproduce the iPadOS long-press recognizer, so these prove the
 * contract instead: non-selectable clone + killer breaker + classified trace.
 */

function setup(options: { enabled?: boolean } = {}) {
  const host = document.createElement('div');
  host.innerHTML =
    '<div id="root" data-sat-selection-protected="true">'
    + '<p data-content-text-node="p1">alpha beta gamma</p>'
    + '<button id="excluded">tap</button>'
    + '</div>';
  document.body.append(host);
  const root = host.querySelector('#root') as HTMLElement;
  const prose = root.querySelector('p') as HTMLElement;
  const proseText = prose.firstChild as Text;
  const record = vi.fn();
  const rootRef = { current: root };
  const view = renderHook(() =>
    useStudentSelectionGesture({
      enabled: options.enabled ?? true,
      activation: 'drag',
      rootRef,
      resolveCaretAtPoint: () => ({ node: proseText, offset: 0 }),
      onSelect: vi.fn(),
      diagnostics: { record, listener: vi.fn() },
    }),
  );
  return { host, root, prose, proseText, record: record as Mock, view };
}

function leakRecords(record: Mock, stage = 'native-selection-leak') {
  return record.mock.calls
    .filter(([s]) => s === stage)
    .map(([, details]) => details as Record<string, unknown>);
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('native-selection breaker beyond the source root', () => {
  it('destroys a Range anchored in the loupe clone and classifies it', () => {
    const { root, record, view } = setup();
    expect(root.getAttribute('data-student-selection-owner')).toBe('app');

    const layer = document.createElement('div');
    layer.setAttribute('data-selection-floating-layer', 'portal');
    const clone = document.createElement('div');
    clone.setAttribute('data-selection-loupe-source', 'true');
    clone.textContent = 'alpha beta';
    layer.append(clone);
    document.body.append(layer);

    const range = document.createRange();
    range.setStart(clone.firstChild!, 0);
    range.setEnd(clone.firstChild!, 4);
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    expect(window.getSelection()?.rangeCount).toBe(0);
    const leaks = leakRecords(record);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.['anchorOrigin']).toBe('loupe-clone');
    expect(leaks[0]?.['intersectsSelectionV2Layer']).toBe(true);
    expect(leaks[0]?.['loupeOpen']).toBe(true);
    view.unmount();
  });

  it('destroys a Range anchored in the floating layer / handle chrome', () => {
    const { record, view } = setup();

    const layer = document.createElement('div');
    layer.setAttribute('data-selection-floating-layer', 'portal');
    const handle = document.createElement('button');
    handle.setAttribute('data-student-selection-handle', 'true');
    handle.textContent = 'grip';
    layer.append(handle);
    document.body.append(layer);

    const range = document.createRange();
    range.setStart(handle.firstChild!, 0);
    range.setEnd(handle.firstChild!, 2);
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    expect(window.getSelection()?.rangeCount).toBe(0);
    const leaks = leakRecords(record);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.['anchorOrigin']).toBe('handle');
    view.unmount();
  });

  it('still destroys a source-root Range (existing behavior preserved)', () => {
    const { proseText, record, view } = setup();

    const range = document.createRange();
    range.setStart(proseText, 0);
    range.setEnd(proseText, 4);
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    expect(window.getSelection()?.rangeCount).toBe(0);
    const leaks = leakRecords(record);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.['anchorOrigin']).toBe('source-root');
    view.unmount();
  });

  it('preserves a legitimate editable Range', () => {
    const { root, record, view } = setup();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = 'edit me';
    root.append(editor);

    const range = document.createRange();
    range.setStart(editor.firstChild!, 0);
    range.setEnd(editor.firstChild!, 4);
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    expect(window.getSelection()?.toString()).toBe('edit');
    expect(leakRecords(record)).toHaveLength(0);
    view.unmount();
  });

  it('ignores collapsed native selections', () => {
    const { proseText, record, view } = setup();

    const range = document.createRange();
    range.setStart(proseText, 2);
    range.collapse(true);
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    expect(leakRecords(record)).toHaveLength(0);
    view.unmount();
  });
});

describe('scoped touchstart guard', () => {
  it('prevents a touch beginning on SAT prose while armed', () => {
    const { prose, view } = setup();
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    fireEvent(prose, event);
    expect(event.defaultPrevented).toBe(true);
    view.unmount();
  });

  it('leaves excluded controls and non-prose touches alone', () => {
    const { root, view } = setup();
    const button = root.querySelector('#excluded') as HTMLElement;

    const onButton = new Event('touchstart', { bubbles: true, cancelable: true });
    fireEvent(button, onButton);
    expect(onButton.defaultPrevented).toBe(false);

    const onRoot = new Event('touchstart', { bubbles: true, cancelable: true });
    fireEvent(root, onRoot);
    expect(onRoot.defaultPrevented).toBe(false);
    view.unmount();
  });

  it('does nothing when the surface is not armed', () => {
    const { prose, view } = setup({ enabled: false });
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    fireEvent(prose, event);
    expect(event.defaultPrevented).toBe(false);
    view.unmount();
  });
});
