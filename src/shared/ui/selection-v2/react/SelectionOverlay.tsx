import React, { useEffect, useRef, type RefObject } from 'react';
import { SelectionFloatingLayer } from './SelectionFloatingLayer';
import { SelectionHighlight } from './SelectionHighlight';
import { SelectionHandle } from './SelectionHandle';
import { SelectionLoupe } from './SelectionLoupe';
import type { SelectionPresentation, SelectionPointerState } from '../domain/selectionTypes';
import { selectionMovesEndpoint } from '../domain/selectionTypes';
import type { SelectionHandlePointerEvent } from './useStudentSelectionGesture';
import '../styles/selection.css';

/**
 * Everything the student sees of a selection the exam owns, and nothing else.
 *
 * Presentation only: it is handed geometry, it reports pointer intents back, and
 * it never resolves a caret, measures a range or decides what an action means.
 * That boundary is what lets IELTS, SAT and every future product share one
 * selection engine while keeping their own commands.
 *
 * It paints LINES, HANDLES and the MAGNIFIER, and it owns dismissal — because
 * dismissal is about the student's intent rather than a product's rules: a tap
 * anywhere outside the selection, or Escape, ends it. It does NOT own a menu.
 *
 * It used to take an `actions` prop and render the shared menu for a product.
 * That path had no caller, and it could not have one: this overlay only exists
 * where the exam owns the selection, while a product's toolbar must also appear
 * for the browser's own selection (a mouse, a keyboard shift-arrow, a platform
 * where the OS selection is the honest one) — SAT's toolbar is raised in exactly
 * that state, with nothing here to paint and no owned selection to point at. So
 * the menu is rendered by whoever owns the toolbar, and the unwired prop is gone
 * rather than kept warm for a product that cannot use it.
 */

export interface SelectionOverlaySelection extends SelectionPresentation {
  /**
   * The two positions the pointer has. The lens's BOX follows `finger`; its
   * CONTENT follows `caret`, which is the boundary the engine resolved — see
   * `SelectionPointerState`.
   */
  pointer: SelectionPointerState | null;
  /** True while a handle is being dragged. */
  adjusting: boolean;
  beginHandleAdjustment: (edge: 'start' | 'end', event: SelectionHandlePointerEvent) => void;
  dismiss: () => void;
}

export interface SelectionOverlayProps {
  selection: SelectionOverlaySelection;
  /** Accessible names for the two handle controls. */
  handleLabels?: { start: string; end: string } | undefined;
  /** Shown while a hold is claiming text or a handle is moving. */
  loupe?: { sourceRef: RefObject<HTMLElement | null>; enabled?: boolean | undefined } | undefined;
}

export function SelectionOverlay({
  selection,
  handleLabels = { start: 'Adjust selection start', end: 'Adjust selection end' },
  loupe,
}: SelectionOverlayProps) {
  const visible = selection.phase !== 'idle' && selection.selectionText.length > 0;
  // The finger comes from the selection itself: it is the engine that follows it,
  // and a second place to pass a position would be a second thing to keep in step.
  const pointer = selection.pointer;
  // How far the caret has travelled through text positions, for the two
  // precision indicators that answer a change with a tick. Read off the pointer
  // because the caret is: one owner, one fact.
  const snapRevision = pointer?.snapRevision ?? 0;
  const loupeOpen = visible
    && loupe !== undefined
    && loupe.enabled !== false
    && pointer !== null
    && selectionMovesEndpoint(selection.phase);

  const dismissRef = useRef(selection.dismiss);
  dismissRef.current = selection.dismiss;

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape belongs to this surface, not to a menu: one key, one meaning, and
      // it is the same key that dismisses a system selection menu.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      dismissRef.current();
    };
    // A pointer down outside the selection is a student saying "not this". The
    // layer itself opts out of hit testing entirely, so anything that reaches
    // this listener is outside the paint — but the chrome the exam draws for the
    // selection is not "outside": a press on a handle is a drag, and a press on
    // the product's contextual menu is a command, so both read as being inside it.
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Element
        && target.closest('[data-selection-action-menu], [data-student-selection-handle]')) return;
      dismissRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [visible]);

  if (!visible) return null;

  const gripStyle = (event: React.PointerEvent<HTMLElement>): SelectionHandlePointerEvent => ({
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    currentTarget: event.currentTarget,
    preventDefault: () => event.preventDefault(),
  });

  return (
    <SelectionFloatingLayer open label="Selection">
      <SelectionHighlight rects={selection.rects} />

      {selection.startHandle ? (
        <SelectionHandle
          handle={selection.startHandle}
          label={handleLabels.start}
          // Only the endpoint actually under the finger is "held", so the other
          // one stays settled instead of swelling along with it.
          held={selection.adjusting && selection.phase === 'adjusting-start'}
          snapRevision={snapRevision}
          onPointerDown={(event) => selection.beginHandleAdjustment('start', gripStyle(event))}
        />
      ) : null}
      {selection.endHandle ? (
        <SelectionHandle
          handle={selection.endHandle}
          label={handleLabels.end}
          held={selection.adjusting && selection.phase === 'adjusting-end'}
          snapRevision={snapRevision}
          onPointerDown={(event) => selection.beginHandleAdjustment('end', gripStyle(event))}
        />
      ) : null}

      {loupeOpen && loupe && pointer ? (
        <SelectionLoupe
          open
          fingerPoint={pointer.finger}
          caretPoint={pointer.caret}
          snapRevision={snapRevision}
          sourceRef={loupe.sourceRef}
        />
      ) : null}
    </SelectionFloatingLayer>
  );
}
