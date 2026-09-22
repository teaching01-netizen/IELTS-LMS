import React, { useEffect, useRef, type RefObject } from 'react';
import { SelectionFloatingLayer } from './SelectionFloatingLayer';
import { SelectionHighlight } from './SelectionHighlight';
import { SelectionHandle } from './SelectionHandle';
import { SelectionLoupe } from './SelectionLoupe';
import type { SelectionPresentation, SelectionPointerState } from '../domain/selectionTypes';
import { selectionMovesEndpoint } from '../domain/selectionTypes';
import { canAcquireSelectionHandle, handleAcquisitionFor, selectionContainsPoint } from '../engine/selectionGeometry';
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
 * anywhere outside the selection, or Escape, ends it — decided HERE, in this
 * capture pass, not somewhere further down the event path. It does NOT own a
 * menu.
 *
 * IT ALSO OWNS PRESS ARBITRATION, because "what did this finger mean" is intent,
 * not geometry. One physical pointerdown may hold exactly ONE intent, resolved
 * here in capture before any part of the page can act on it:
 *
 *   action menu → a command, passed through untouched
 *   handle      → a drag may BEGIN only from the handle's outward zone
 *                 (`canAcquireSelectionHandle`); a press anywhere else on the
 *                 — possibly overlapping — 44px box is the selection's body
 *   body        → the selected text is a no-drag zone: preserved and consumed,
 *                 never dismissed, never reaching the prose's own pointerdown
 *   outside     → dismissed in this same capture pass; consumed exactly when
 *                 the gesture's own pointerdown would otherwise see it — one
 *                 press, one intent, every other control keeps its press
 *
 * Without the middle row, a short selection's two 44px endpoint boxes overlap
 * over the highlighted text and a press in the MIDDLE grabs an endpoint; without
 * the body row it reaches the prose and the same press dismisses the old
 * selection AND starts a new one. Both are the same violation: two intents in
 * one pointerdown.
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
  /**
   * Whether this press would reach the gesture's own pointerdown — the same
   * guards, answered by the one place that owns them (`wouldBeginGesture` on
   * the hook's return). The outside branch asks it so one pointerdown can
   * dismiss the selection AND be consumed when it would otherwise begin the
   * next one, while toolbars, inputs and every other control keep their press.
   */
  wouldBeginGesture: (event: Event) => boolean;
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
  // The current paint, read live by the listeners below: rects and handles are
  // re-measured every frame, and a listener bound once must not arbitrate
  // today's press with yesterday's geometry.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape belongs to this surface, not to a menu: one key, one meaning, and
      // it is the same key that dismisses a system selection menu.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      dismissRef.current();
    };

    /** Consume one press: nothing below this listener may learn it happened. */
    const consume = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    // Capture phase — the intents that must be decided BEFORE anything in the
    // page can act on them. The chrome the exam draws for the selection is not
    // "outside": a press on the product's contextual menu is a command, and a
    // press on a handle is a drag — but only from the handle's outward zone.
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-selection-action-menu]')) return;
      const { clientX, clientY } = event as PointerEvent;
      const current = selectionRef.current;
      // Handle and body arbitration only govern a RESTING selection; a grab
      // outside `selected` is refused by the session anyway. A second finger
      // during a live gesture falls to the outside branch below, which ends
      // the gesture with the same effects the prose's own pointerdown used to
      // produce — while consuming the press, so it cannot double as anything.
      const resting = current.phase === 'selected';
      const handleElement = target instanceof Element
        ? target.closest('[data-student-selection-handle]')
        : null;
      if (handleElement) {
        if (!resting) return;
        const edge = handleElement.getAttribute('data-student-selection-handle') === 'start' ? 'start' : 'end';
        const { handle, line } = handleAcquisitionFor(current, edge);
        if (handle && canAcquireSelectionHandle(handle, line, clientX, clientY)) return;
        // Inside the box but not in the outward zone: the boxes overlap the
        // text, so this press is ON the selection — the body's intent.
        consume(event);
        return;
      }
      if (resting && selectionContainsPoint(current.rects, clientX, clientY)) {
        // The selected text is a no-drag zone: preserve the selection, open
        // nothing, move nothing, and let this pointerdown END here rather than
        // both dismissing the old selection and starting a new one.
        consume(event);
        return;
      }
      // Outside: dismiss HERE, in capture — the literal rule (one press, one
      // intent): this same physical press ends the old selection, and when the
      // gesture's own pointerdown would otherwise see it, it is consumed so it
      // can never also be the beginning of a new one (the prose would
      // otherwise find `idle` and open a hidden `selected → idle → pending`).
      // Presses the gesture would never handle — the product's toolbar, an
      // answer field, any control — are dismissed but NOT consumed: they
      // cannot reach the gesture's handler anyway, so consumption would only
      // break the rest of the page. Menu and handle presses resolved above.
      dismissRef.current();
      if (current.wouldBeginGesture(event)) consume(event);
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
