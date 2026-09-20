import React, { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudentTouchSelectionDiagnosticsProvider, useStudentTouchSelectionDiagnostics } from '../StudentTouchSelectionDiagnostics';
import { useStudentSelectionGesture } from '../../selection-v2/react/useStudentSelectionGesture';
import { StudentExamInteractionScopeProvider } from '../StudentExamInteractionScope';
import { FormattedText } from '../../../../components/student/FormattedText';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function renderSurface(debug: boolean) {
  return render(<StudentTouchSelectionDiagnosticsProvider enabled={debug}>
    <StudentExamInteractionScopeProvider ownedTouchSelection>
      <FormattedText text="Alpha beta gamma" highlightEnabled highlightToolMode="highlight" />
    </StudentExamInteractionScopeProvider>
  </StudentTouchSelectionDiagnosticsProvider>);
}

it('keeps diagnostics absent unless explicitly enabled', () => {
  renderSurface(false);
  expect(screen.queryByRole('region', { name: 'Touch selection diagnostics' })).toBeNull();
  expect(window.__studentTouchSelectionDebug).toBeUndefined();
});

it('shows actual listener, DOM events, capture outcome, and cleans up on exit', () => {
  vi.useFakeTimers();
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const { container, unmount } = renderSurface(true);
  const root = container.querySelector('[data-student-highlightable]')!;
  const node = root.firstChild!;
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: (x: number) => ({ offsetNode: node, offset: x }) });
  try {
    fireEvent.pointerDown(root, { pointerId: 1, pointerType: 'touch', clientX: 6, clientY: 10 });
    fireEvent.pointerMove(root, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 30 });
    fireEvent.pointerUp(root, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 30 });
    act(() => { vi.advanceTimersByTime(250); });
    const panel = screen.getByRole('region', { name: 'Touch selection diagnostics' });
    expect(panel).toHaveTextContent('"listenerAttached": true');
    expect(panel).toHaveTextContent('"pointerDownSeen": true');
    expect(panel).toHaveTextContent('"captureSucceeded": true');
    expect(panel).toHaveTextContent('"mutationApplied": true');
    expect(window.getSelection()?.toString()).toBe('');
    expect(root.querySelector('mark')).toHaveTextContent('beta');
    unmount();
    expect(window.__studentTouchSelectionDebug).toBeUndefined();
  } finally { delete (document as Document & { caretPositionFromPoint?: unknown }).caretPositionFromPoint; }
});

const coarse = () => true;
function DelayedRoot({ visible }: { visible: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const diagnostics = useStudentTouchSelectionDiagnostics(root, { surface: 'delayed test root', enabled: true, ownedTouchSelection: true, toolModeOrAnnotationMode: 'highlight' });
  useStudentSelectionGesture({ enabled: true, activation: 'drag', rootRef: root, diagnostics, resolveCaretAtPoint: () => null, onSelect: () => {}, isCoarsePointer: coarse });
  return visible ? <div ref={root}>Late root</div> : null;
}

it('exposes a genuinely late root as a DOM event with no hook listener', () => {
  vi.useFakeTimers();
  const view = (visible: boolean) => <StudentTouchSelectionDiagnosticsProvider enabled><DelayedRoot visible={visible} /></StudentTouchSelectionDiagnosticsProvider>;
  const { rerender } = render(view(false));
  rerender(view(true));
  fireEvent.pointerDown(screen.getByText('Late root'), { pointerId: 1, pointerType: 'touch' });
  act(() => { vi.advanceTimersByTime(250); });
  const panel = screen.getByRole('region', { name: 'Touch selection diagnostics' });
  expect(panel).toHaveTextContent('"rootExists": true');
  expect(panel).toHaveTextContent('"rootExistsAtEffect": false');
  expect(panel).toHaveTextContent('"listenerAttached": false');
  expect(panel).toHaveTextContent('"markerPresent": false');
  expect(panel).toHaveTextContent('dom:pointerdown');
  expect(panel).toHaveTextContent('"pointerDownSeen": false');
});

it('attaches when the actual IELTS component enables its conditional root', () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const view = (enabled: boolean) => <StudentTouchSelectionDiagnosticsProvider enabled>
    <StudentExamInteractionScopeProvider ownedTouchSelection>
      <FormattedText text="Alpha beta gamma" highlightEnabled={enabled} highlightToolMode="highlight" />
    </StudentExamInteractionScopeProvider>
  </StudentTouchSelectionDiagnosticsProvider>;
  const { rerender } = render(view(false));
  expect(window.__studentTouchSelectionDebug?.snapshot().surfaces[0]).toMatchObject({ rootExists: false, enabled: false });
  rerender(view(true));
  expect(window.__studentTouchSelectionDebug?.snapshot().surfaces[0]).toMatchObject({ rootExists: true, rootExistsAtEffect: true, enabled: true, listenerAttached: true, listenerRootMatches: true, markerPresent: true });
});
