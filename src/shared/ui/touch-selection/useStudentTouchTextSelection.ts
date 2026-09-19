import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  caretPositionAtPoint,
  clampTextPointTo,
  defaultWordSegmenter,
  expandToWordAt,
  type TextPoint,
  type WordSegmenter,
} from './touchSelectionPoint';
import {
  createTouchSelectionRange,
  createTouchSelectionRangeWithin,
  touchSelectionRects,
  type TouchSelectionRect,
} from './touchSelectionRange';

/**
 * Text selection the exam owns, for devices where the platform's own selection
 * cannot be used.
 *
 * THE PROBLEM THIS EXISTS FOR
 *
 * During a real exam, a touch student long-presses a passage to highlight it. The
 * platform sees a text selection and paints its own edit menu over the passage —
 * Copy, Look Up, Search, Share. Blocking `contextmenu` does not remove it, and
 * `-webkit-touch-callout: none` does not either: both were shipped and an iPad
 * still showed the menu. The only lever that removes it is never letting a
 * browser selection exist, which is `user-select: none` on the exam prose — and
 * that is also what deletes highlighting unless something else supplies the
 * selection.
 *
 * So this hook supplies it, with a DOM `Range` that is NEVER installed into
 * `window.getSelection()`. The platform therefore has no selection to decorate,
 * and the range feeds the same capture functions the desktop path uses — the
 * annotation anchors are computed from character offsets and the toolbars
 * measure themselves from a stored anchor, so nothing downstream needs the
 * platform's selection to exist.
 *
 * WHY THE BROWSER HAS TO BE TOLD BEFOREHAND
 *
 * Suppressing the platform's selection is only half of owning a gesture. With
 * `touch-action: auto` the browser is entitled to read the first pixels of a drag
 * as a pan, and when it does it takes the touch away with `pointercancel` — at
 * which point the selection is discarded, on a surface where the platform's own
 * selection does not exist either. Nothing selects at all, and no test in jsdom
 * can see it, because jsdom never runs a real scrolling gesture.
 *
 * So the hook marks its root (`data-student-owned-touch-selection`), and the
 * stylesheet turns that marker into `touch-action: none` for as long as an armed
 * tool can select. The declaration has to be in place before the finger lands —
 * which is why it is a layout effect — and it is deliberately NOT set for the
 * long-press contract, where a drag is meant to scroll.
 *
 * TWO CONTRACTS, DECIDED BY WHAT THE STUDENT HAS ALREADY SAID
 *
 * `activation: 'long-press'` (the default) reserves the gesture: a touch must
 * rest inside the tolerance for `longPressMs` before the text belongs to the
 * exam, and until then any movement is the platform's scroll. It is the right
 * contract for a surface that is merely selectable, because a drag there is
 * far more likely to be reading than marking.
 *
 * `activation: 'drag'` is for a surface where the student has ALREADY declared
 * the intent by arming a tool. Requiring the hold on top of that was a trap: a
 * finger that starts dragging immediately — which is how touch selection is
 * performed almost everywhere else — used to cancel the gesture permanently, and
 * with the platform's own selection suppressed there was then no way to select
 * text at all. So in this mode a drag past the same tolerance CLAIMS the text
 * instead of abandoning it, and a hold still takes the word under the finger. A
 * tap that does neither still selects nothing.
 *
 * WHY THE MOUSE PATH IS HERE TOO
 *
 * `@media (pointer: coarse)` matches an iPad even with a trackpad attached, so
 * the CSS that suppresses the platform menu also suppresses mouse selection
 * there. A mouse drag is therefore owned immediately, with no long press — there
 * is no long press on a trackpad, and a desktop with a fine pointer never
 * reaches this hook at all.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No `touchstart` prevention and no prevention while the gesture is still a
 * candidate: a finger that moves before the hold completes is scrolling, and
 * that gesture is handed back to the browser untouched. Scrolling is suppressed
 * only once the selection is owned, and only for the duration of that gesture.
 */

export type StudentTouchSelectionActivation = 'long-press' | 'drag';

export interface StudentTouchTextSelectionOptions {
  /** Whether the owned gesture runs at all: exam scope AND an armed tool. */
  enabled: boolean;
  /**
   * How the gesture claims the text.
   *
   * `'long-press'` (default): rest inside the tolerance for `longPressMs`, and a
   * finger that travels before then is scrolling. `'drag'`: the surface has
   * already been armed, so travelling past the tolerance claims the text rather
   * than cancelling — a hold still takes the word under the finger.
   */
  activation?: StudentTouchSelectionActivation | undefined;
  /** The element the gesture must begin inside — a passage, a prose block. */
  rootRef: RefObject<HTMLElement | null>;
  /**
   * Pointer coordinate → text position.
   *
   * Injected rather than reached for, because the hit test is the one part of
   * this gesture that cannot be exercised without a layout engine: jsdom has
   * neither `caretPositionFromPoint` nor a rendered text line. Everything else
   * here — the hold, the tolerance, the ordering, the reporting — is decided by
   * this hook and tested through this seam.
   */
  resolveCaretAtPoint: (x: number, y: number) => TextPoint | null;
  /** Called once per completed gesture, with the range the exam owns. */
  onSelect: (range: Range, text: string) => void;
  /**
   * The text the selection may not leave — a paragraph, a surface. A drag that
   * crosses it selects up to the edge it crossed.
   */
  boundaryFor?: ((start: TextPoint) => Element | null) | undefined;
  /** Targets that keep native behavior: answer fields and note editors. */
  isExcludedTarget?: ((target: EventTarget | null) => boolean) | undefined;
  /** Whether the platform's own selection is suppressed on this device. */
  isCoarsePointer?: (() => boolean) | undefined;
  /** How long a touch must rest before it claims the text. */
  longPressMs?: number | undefined;
  /** How far a touch may travel during the hold before it is scrolling. */
  moveTolerancePx?: number | undefined;
}

export interface StudentTouchTextSelectionState {
  /** True while the gesture owns the text and the overlay should paint. */
  active: boolean;
  selectionText: string;
  rects: TouchSelectionRect[];
}

interface Gesture {
  pointerId: number;
  pointerType: string;
  originX: number;
  originY: number;
  start: TextPoint;
  boundary: Element | null;
  focus: TextPoint | null;
  phase: 'pending' | 'selecting';
}

const IDLE: StudentTouchTextSelectionState = { active: false, selectionText: '', rects: [] };

/** Controls whose own text behavior is the platform's business, not ours. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function defaultIsExcludedTarget(target: EventTarget | null): boolean {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest(EDITABLE_SELECTOR) != null;
}

function defaultIsCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function useStudentTouchTextSelection(
  options: StudentTouchTextSelectionOptions,
): StudentTouchTextSelectionState {
  const {
    enabled,
    activation = 'long-press',
    rootRef,
    resolveCaretAtPoint,
    onSelect,
    boundaryFor,
    isExcludedTarget = defaultIsExcludedTarget,
    isCoarsePointer = defaultIsCoarsePointer,
    longPressMs = 350,
    moveTolerancePx = 8,
  } = options;

  const [state, setState] = useState<StudentTouchTextSelectionState>(IDLE);

  // Live values behind a ref so the listeners never rebind mid-gesture:
  // re-binding would drop the release that completes the very selection being
  // captured, and arming or disarming during a drag must not lose it either.
  const live = useRef({
    enabled,
    activation,
    resolveCaretAtPoint,
    onSelect,
    boundaryFor,
    isExcludedTarget,
    isCoarsePointer,
    longPressMs,
    moveTolerancePx,
  });
  live.current = {
    enabled,
    activation,
    resolveCaretAtPoint,
    onSelect,
    boundaryFor,
    isExcludedTarget,
    isCoarsePointer,
    longPressMs,
    moveTolerancePx,
  };

  const gesture = useRef<Gesture | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownedRange = useRef<Range | null>(null);
  const scrollSuppressor = useRef<((event: Event) => void) | null>(null);

  // Segmentation for the word a hold lands on. Built once: ICU segmentation is
  // not free, and a drag republishes many times a second.
  const segmenter = useRef<WordSegmenter | null | undefined>(undefined);
  if (segmenter.current === undefined) segmenter.current = defaultWordSegmenter();

  useEffect(() => {
    if (!enabled) return;

    const clearHoldTimer = () => {
      if (holdTimer.current === null) return;
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };

    const detachScrollSuppressor = () => {
      if (!scrollSuppressor.current) return;
      document.removeEventListener('touchmove', scrollSuppressor.current);
      scrollSuppressor.current = null;
    };

    /**
     * Stop the page scrolling under an owned selection. Attached when the
     * gesture claims the text and removed the instant it ends, so the exam's
     * ordinary scrolling keeps the browser's fast path the rest of the time.
     */
    const attachScrollSuppressor = () => {
      if (scrollSuppressor.current) return;
      const suppress = (event: Event) => {
        if (gesture.current?.phase !== 'selecting') return;
        if (event.cancelable) event.preventDefault();
      };
      scrollSuppressor.current = suppress;
      document.addEventListener('touchmove', suppress, { passive: false });
    };

    const publish = (range: Range | null) => {
      ownedRange.current = range;
      setState({
        active: gesture.current?.phase === 'selecting',
        selectionText: range?.toString() ?? '',
        rects: touchSelectionRects(range),
      });
    };

    const reset = () => {
      gesture.current = null;
      clearHoldTimer();
      detachScrollSuppressor();
      ownedRange.current = null;
      setState(IDLE);
    };

    /**
     * What the gesture currently selects.
     *
     * A drag between two positions wins. When it does not — the finger has not
     * moved yet, or moved back to where it started — the word under the hold is
     * the selection, which is what a long press means everywhere else in the
     * platform and the only useful answer when no drag has happened.
     */
    const rangeFor = (current: Gesture): Range | null => {
      if (current.focus) {
        const dragged = current.boundary
          ? createTouchSelectionRangeWithin(current.boundary, current.start, current.focus)
          : createTouchSelectionRange(current.start, current.focus);
        if (dragged) return dragged;
      }
      const word = expandToWordAt(current.start, segmenter.current ?? null);
      if (!word) return null;
      return createTouchSelectionRange(
        { node: current.start.node, offset: word.start },
        { node: current.start.node, offset: word.end },
      );
    };

    const claim = () => {
      const current = gesture.current;
      if (!current || current.phase === 'selecting') return;
      current.phase = 'selecting';
      // The boundary is resolved once, at the hold: it answers "which block is
      // this gesture about", and that is a fact about where the press landed.
      const boundary = live.current.boundaryFor?.(current.start) ?? null;
      current.boundary = boundary
        ? clampTextPointTo(current.start, boundary) === null
          ? null
          : boundary
        : null;
      if (current.boundary) {
        current.start = clampTextPointTo(current.start, current.boundary) ?? current.start;
      }
      attachScrollSuppressor();
      publish(rangeFor(current));
    };

    const abandon = () => {
      gesture.current = null;
      clearHoldTimer();
      detachScrollSuppressor();
      ownedRange.current = null;
      // The state is idled too, not just the gesture. A gesture can be
      // abandoned after it already claimed the text (a second finger landing,
      // a mode switched off), and leaving the overlay painted would show a
      // selection that no longer exists and no longer belongs to anyone.
      // `IDLE` is a module constant, so setting it over itself is a no-op.
      setState(IDLE);
    };

    const finish = (report: boolean) => {
      const current = gesture.current;
      if (!current) return;
      const captured = ownedRange.current;
      const owned = current.phase === 'selecting';
      reset();
      if (!report || !owned || !captured) return;
      live.current.onSelect(captured, captured.toString());
    };

    const onPointerDown = (event: PointerEvent) => {
      const config = live.current;
      if (!config.enabled) return;
      if (!config.isCoarsePointer()) return;
      if (typeof event.button === 'number' && event.button > 0) return;

      // A second finger while a gesture is live is the PLATFORM's gesture:
      // two-finger scrolling and pinch-zoom are how a student reads a passage,
      // and the finger already down belongs to something. Everything is handed
      // back — including a selection that had already been claimed — and no new
      // gesture starts, so the page scrolls as it would without this hook.
      if (gesture.current) {
        abandon();
        return;
      }

      if (config.isExcludedTarget(event.target)) return;
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) return;

      const start = config.resolveCaretAtPoint(event.clientX, event.clientY);
      if (!start) return;

      gesture.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType ?? '',
        originX: event.clientX,
        originY: event.clientY,
        start,
        boundary: null,
        focus: null,
        phase: 'pending',
      };

      if (event.pointerType === 'mouse') {
        // No long press exists on a trackpad or a mouse, and on a coarse-pointer
        // device the platform selection is suppressed, so the drag is ours from
        // its first pixel.
        claim();
        return;
      }

      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        claim();
      }, config.longPressMs);
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;

      if (current.phase === 'pending') {
        const travelled = Math.hypot(event.clientX - current.originX, event.clientY - current.originY);
        if (travelled <= live.current.moveTolerancePx) return;
        if (live.current.activation === 'drag') {
          // The tool is armed, so the movement means "this", not "scroll me".
          // Claim and fall through, so the very movement that claimed it also
          // becomes the far end of the selection.
          claim();
        } else {
          // The finger is going somewhere: this is a scroll, and scrolling is
          // the browser's. Nothing is captured and nothing is prevented.
          abandon();
          return;
        }
      }

      const focus = live.current.resolveCaretAtPoint(event.clientX, event.clientY);
      if (!focus) return;
      current.focus = focus;
      publish(rangeFor(current));
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      finish(true);
    };

    const onPointerCancel = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      finish(false);
    };

    const root = rootRef.current;
    root?.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);

    return () => {
      root?.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      gesture.current = null;
      clearHoldTimer();
      detachScrollSuppressor();
      ownedRange.current = null;
    };
  }, [enabled, rootRef]);

  /**
   * Tell the browser, before any finger lands, that this drag is the app's.
   *
   * Set for exactly the contract where a drag means "this text": an armed tool
   * on a coarse pointer. A layout effect rather than an effect, because the
   * attribute has to be true by the time the element the student can touch has
   * been painted; leaving that gap would leave a window in which the browser
   * still owns the gesture and cancels it.
   *
   * The long-press contract is never marked: there a drag is a scroll, and taking
   * the gesture away from the browser would break the very reading motion the
   * mode exists to preserve.
   */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || activation !== 'drag' || !isCoarsePointer()) return;

    root.dataset['studentOwnedTouchSelection'] = 'true';
    return () => {
      delete root.dataset['studentOwnedTouchSelection'];
    };
  }, [activation, enabled, isCoarsePointer, rootRef]);

  // Disarming mid-gesture (the student turns Highlights off, or the phase ends)
  // must not leave an overlay painted over a mode that no longer exists.
  useEffect(() => {
    if (enabled) return;
    setState((previous) => (previous.active || previous.rects.length > 0 ? IDLE : previous));
  }, [enabled]);

  return state;
}

/**
 * The default coordinate resolver, spelled out so a host component can pass it
 * without knowing which of the two platform hit tests its browser ships.
 */
export function browserCaretResolver(
  doc: Document = document,
): (x: number, y: number) => TextPoint | null {
  return (x, y) => caretPositionAtPoint(doc, x, y);
}
