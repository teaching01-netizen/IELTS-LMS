import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SatTextAnchor } from '../../domain/satResponses';
import { SAT_ANNOTATION_LIMIT } from '../../domain/satResponses';
import type { SatAnnotationRegion } from '../../domain/satAnnotationIdentity';
import { useSatAnnotationView } from './SatAnnotationViewContext';
import {
  captureSatTextRange,
  captureSatTextSelection,
  isSatSelectionInsideAnnotationUi,
  satAnnotationBlockForPoint,
} from './satTextSelection';
import { markSatPointerDown, markSatSelectionGestureEnded } from './satSelectionDragGuard';
import { useStudentExamInteractionScope } from '@shared/ui/touch-selection/StudentExamInteractionScope';
import { useStudentTouchSelectionDiagnostics } from '@shared/ui/touch-selection/StudentTouchSelectionDiagnostics';
import { browserCaretResolver } from '@shared/ui/selection-v2/engine/selectionPoint';
import { nearestScrollableAncestor } from '@shared/ui/selection-v2/engine/selectionAutoScroll';
import { useStudentSelectionGesture } from '@shared/ui/selection-v2/react/useStudentSelectionGesture';

const SAT_SELECTION_EXCLUDED_TARGETS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), button, a, [role="button"], [role="math"]';

function isSatSelectionExcludedTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  // Interactive marks are still SAT prose: a drag through one makes a new
  // range, while SelectionOverlay consumes a resting-range press before the
  // mark's click handler opens its editor.
  if (element?.closest('[data-sat-annotation-control="true"]')) return false;
  return element?.closest(SAT_SELECTION_EXCLUDED_TARGETS) != null
    || (target instanceof Node && isSatSelectionInsideAnnotationUi(target));
}

function isSatSelectionPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch' || event.pointerType === 'mouse' || event.pointerType === 'pen';
}

interface UseSatAnnotationSelectionOptions {
  rootRef: RefObject<HTMLDivElement | null>;
  region: SatAnnotationRegion;
  selectionScopeKey?: string | undefined;
  enabled: boolean;
  annotationCount: number;
  onLimitReached?: (() => void) | undefined;
}

/** Owns browser/app selection capture and the annotation-cap notice. */
export function useSatAnnotationSelection({
  rootRef,
  region,
  selectionScopeKey,
  enabled,
  annotationCount,
  onLimitReached,
}: UseSatAnnotationSelectionOptions) {
  const view = useSatAnnotationView();
  const { ownedTouchSelection } = useStudentExamInteractionScope();
  const diagnostics = useStudentTouchSelectionDiagnostics(rootRef, {
    surface: `SAT ${region}`,
    enabled: enabled && view.annotationModeEnabled && ownedTouchSelection,
    ownedTouchSelection,
    toolModeOrAnnotationMode: view.annotationModeEnabled,
  });
  const [limitNotice, setLimitNotice] = useState(false);
  const limitTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (limitTimer.current !== null) window.clearTimeout(limitTimer.current);
  }, []);

  const flashLimitNotice = useCallback(() => {
    setLimitNotice(true);
    onLimitReached?.();
    if (limitTimer.current !== null) window.clearTimeout(limitTimer.current);
    limitTimer.current = window.setTimeout(() => setLimitNotice(false), 6000);
  }, [onLimitReached]);

  const reportSelection = useRef<((anchor: SatTextAnchor) => void) | null>(null);
  reportSelection.current = view.onSelectionCaptured ?? null;
  const isExistingAnchor = view.isExistingAnchor;
  const modeEnabled = useRef(view.annotationModeEnabled);
  modeEnabled.current = view.annotationModeEnabled;
  const ownedTouchPointers = useRef(new Set<number>());

  const reportAnchor = useCallback((anchor: SatTextAnchor) => {
    if (annotationCount >= SAT_ANNOTATION_LIMIT && !isExistingAnchor?.(anchor)) {
      flashLimitNotice();
      return;
    }
    reportSelection.current?.(anchor);
  }, [annotationCount, flashLimitNotice, isExistingAnchor]);

  useEffect(() => {
    if (!enabled) return;

    const report = (event: Event) => {
      const root = rootRef.current;
      if (!root) return;
      const scope = root.parentElement ?? root;
      if (event.type === 'pointerup' && ownedTouchPointers.current.delete((event as PointerEvent).pointerId)) return;
      if (event.type === 'pointerup' && (!(event.target instanceof Node) || !scope.contains(event.target))) return;
      if (event.target instanceof Node && isSatSelectionInsideAnnotationUi(event.target)) return;

      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) markSatSelectionGestureEnded();
      if (!modeEnabled.current) return;

      const anchor = captureSatTextSelection(root, region, selection, { allowAnnotationControls: true });
      if (!anchor) return;
      selection?.removeAllRanges();
      reportAnchor(anchor);
    };

    const begin = (event: Event) => {
      const pointer = event as PointerEvent;
      const { clientX, clientY } = pointer;
      if (typeof clientX !== 'number' || typeof clientY !== 'number') return;
      markSatPointerDown(clientX, clientY);
      const root = rootRef.current;
      if (
        pointer.pointerType === 'touch'
        && ownedTouchSelection
        && modeEnabled.current
        && root
        && pointer.target instanceof Node
        && root.contains(pointer.target)
      ) {
        ownedTouchPointers.current.add(pointer.pointerId);
      }
    };
    const endOwnedTouch = (event: Event) => {
      if (event.type === 'pointercancel') ownedTouchPointers.current.delete((event as PointerEvent).pointerId);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) report(event);
    };

    document.addEventListener('pointerdown', begin, true);
    document.addEventListener('pointerup', report);
    document.addEventListener('pointercancel', endOwnedTouch);
    document.addEventListener('keyup', keyboard);
    return () => {
      document.removeEventListener('pointerdown', begin, true);
      document.removeEventListener('pointerup', report);
      document.removeEventListener('pointercancel', endOwnedTouch);
      document.removeEventListener('keyup', keyboard);
      ownedTouchPointers.current.clear();
    };
  }, [enabled, ownedTouchSelection, region, reportAnchor, rootRef]);

  const reportOwnedRange = useCallback((range: Range) => {
    markSatSelectionGestureEnded();
    const root = rootRef.current;
    if (!root) return;
    const anchor = captureSatTextRange(root, region, range, { allowAnnotationControls: true });
    diagnostics?.record('captureSatTextRange', { captureSucceeded: !!anchor, anchor: anchor ?? null });
    if (!anchor) return;
    reportAnchor(anchor);
    diagnostics?.record('reportAnchor', {
      anchorReported:
        !!reportSelection.current &&
        (annotationCount < SAT_ANNOTATION_LIMIT || isExistingAnchor?.(anchor) === true),
    });
  }, [annotationCount, diagnostics, region, reportAnchor, rootRef, isExistingAnchor]);

  const wouldStartOwnedSelection = useCallback((event: Event): boolean => {
    const pointer = event as PointerEvent;
    if (!isSatSelectionPointer(pointer)) return false;
    if (typeof pointer.button === 'number' && pointer.button !== 0) return false;
    const target = event.target instanceof Element
      ? event.target
      : event.target instanceof Node
        ? event.target.parentElement
        : null;
    if (!target || isSatSelectionExcludedTarget(target)) return false;
    const block = target.closest('[data-content-text-node]');
    const targetRoot = target.closest<HTMLElement>('[data-sat-selection-protected="true"]');
    const currentScope = rootRef.current?.dataset['satSelectionScope'];
    return block !== null
      && targetRoot !== null
      && targetRoot.contains(block)
      && currentScope !== undefined
      && targetRoot.dataset['satSelectionScope'] === currentScope;
  }, [rootRef]);

  const resolveCaretAtPoint = useMemo(
    () => browserCaretResolver(document, diagnostics),
    [diagnostics],
  );

  const selection = useStudentSelectionGesture({
    enabled: enabled && view.annotationModeEnabled && ownedTouchSelection,
    activation: 'drag',
    rootRef,
    scopeKey: selectionScopeKey,
    isOwnedPointer: isSatSelectionPointer,
    isExcludedTarget: isSatSelectionExcludedTarget,
    diagnostics,
    resolveCaretAtPoint,
    onSelect: reportOwnedRange,
    boundaryFor: satAnnotationBlockForPoint,
    wouldStartOwnedSelection,
    scrollContainer: nearestScrollableAncestor,
  });

  return { selection, limitNotice };
}
