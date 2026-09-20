import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createSelectionSession, type SelectionSession } from '../engine/selectionSession';
import { followPointer, type PointerFollow } from '../engine/pointerCapture';
import { createFrameScheduler, type FrameScheduler } from '../engine/selectionScheduler';
import { createAutoScrollRunner, type AutoScrollRunner } from '../engine/selectionAutoScroll';
import { createWordSegmentCache, defaultWordSegmenter } from '../domain/selectionSegmenter';
import type { SelectionActivation, SelectionEffect } from '../domain/selectionMachine';
import {
  IDLE_SELECTION,
  type SelectionEdge,
  type SelectionPresentation,
  type SelectionRect,
  type TextPoint,
} from '../domain/selectionTypes';
import { describeTouchSelectionNode, type TouchSelectionDiagnostics } from '../../touch-selection/touchSelectionDiagnostics';

/**
 * Text selection the exam owns, for devices where the platform's own cannot be
 * used.
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
 * and the range feeds the same capture functions the desktop path uses: the
 * annotation anchors are computed from character offsets and the toolbars measure
 * themselves from a stored anchor, so nothing downstream needs the platform's
 * selection to exist.
 *
 * WHAT THIS MODULE IS, AND WHERE THE REST LIVES
 *
 * This is the ADAPTER. It owns the browser-facing half of the gesture — which
 * element captured the pointer, which timer is armed, which frame is drawn, what
 * React paints — and it owns no answer about what is selected. That answer is the
 * session's (`engine/selectionSession`), which is why a handle drag can no longer
 * disagree with the range the student can see: both come from one derivation.
 * Everything below that is a pure function of coordinates and text
 * (`engine/selectionPoint`, `engine/selectionRange`, `engine/selectionGeometry`,
 * `domain/selectionMachine`, `domain/selectionSegmenter`), and everything above it
 * is presentation (`react/SelectionOverlay` and its parts).
 *
 * The gesture is driven by explicit transitions rather than by refs that have to
 * agree with each other, the pointer is captured instead of drags being tracked
 * on `document`, and every geometry read happens inside one animation frame (see
 * `engine/selectionScheduler`) so a stream of pointermove events costs one caret
 * resolution, one Range and one `getClientRects()` — never read/write thrashing
 * between two events.
 *
 * WHY THE BROWSER HAS TO BE TOLD BEFOREHAND
 *
 * Suppressing the platform's selection is only half of owning a gesture. With
 * `touch-action: auto` the browser is entitled to read the first pixels of a drag
 * as a pan, and when it does it takes the touch away with `pointercancel` — at
 * which point the selection is discarded, on a surface where the platform's own
 * selection does not exist either. So an armed surface marks its root
 * (`data-student-owned-touch-selection`), and the stylesheet turns that marker
 * into `touch-action: none`. The declaration has to be in place before the finger
 * lands, which is why it is a layout effect, and it is deliberately NOT set for
 * the long-press contract, where a drag is meant to scroll.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No `touchstart` prevention and no prevention while the gesture is still a
 * candidate: a finger that moves before the hold completes is scrolling, and that
 * gesture is handed back to the browser untouched. Scrolling is suppressed only
 * once the selection is owned, and only for the duration of that gesture.
 */

export interface StudentSelectionGestureOptions {
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
  activation?: SelectionActivation | undefined;
  /** The element the gesture must begin inside — a passage, a prose block. */
  rootRef: RefObject<HTMLElement | null>;
  /**
   * Pointer coordinate → text position. The surface bounds hit testing so a
   * browser caret outside its unselectable prose cannot become an anchor.
   *
   * Injected rather than reached for, because the hit test is the one part of
   * this gesture that cannot be exercised without a layout engine: jsdom has
   * neither `caretPositionFromPoint` nor a rendered text line. Everything else —
   * the hold, the tolerance, the ordering, the frame — is decided below this
   * seam and tested through it.
   */
  resolveCaretAtPoint: (x: number, y: number, root: HTMLElement) => TextPoint | null;
  /** Called once per completed selection, with the range the exam owns. */
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
  /**
   * Report the selection and clear it, instead of leaving it for the student to
   * act on.
   *
   * For a surface whose tool has ALREADY decided what a selection means — an
   * armed highlight colour, where the drag itself is the command — resting is
   * wrong: the mark is applied on release, and a selection left painted over it
   * would be asking a question the student already answered.
   */
  clearOnSelect?: boolean | undefined;
  /** The element that scrolls, for edge auto-scroll during a handle drag. */
  scrollContainer?: ((root: HTMLElement) => HTMLElement | null) | undefined;
  /** Opt-in, local diagnostics supplied by the session boundary. */
  diagnostics?: TouchSelectionDiagnostics | undefined;
  /** Test seam: frames are injectable, so "one read per frame" is assertable. */
  requestFrame?: ((callback: () => void) => number) | undefined;
  cancelFrame?: ((handle: number) => void) | undefined;
}

/** The slice of a React pointer event a handle needs, so a test can supply one. */
export interface SelectionHandlePointerEvent {
  pointerId: number;
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
  preventDefault?: (() => void) | undefined;
}

export interface StudentSelectionGesture extends SelectionPresentation {
  /** Where a menu may hang: the union box of the painted lines. */
  anchorRect: SelectionRect | null;
  /** The finger's last known position, for the magnifier to sit under. */
  pointer: { x: number; y: number } | null;
  /** True while the finger is moving an endpoint of a resting selection. */
  adjusting: boolean;
  /** Wire a handle's pointerdown to this to start adjusting that edge. */
  beginHandleAdjustment: (edge: SelectionEdge, event: SelectionHandlePointerEvent) => void;
  /** Dismiss the selection: a tap outside, Escape, or a completed action. */
  dismiss: () => void;
}

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

interface PointerRecord {
  x: number;
  y: number;
  pointerId: number;
}

export function useStudentSelectionGesture(
  options: StudentSelectionGestureOptions,
): StudentSelectionGesture {
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
    clearOnSelect = false,
    scrollContainer,
    diagnostics,
    requestFrame,
    cancelFrame,
  } = options;

  const [presentation, setPresentation] = useState<SelectionPresentation>(IDLE_SELECTION);

  // Live values behind a ref so the listeners never rebind mid-gesture. Rebinding
  // would drop the release that completes the very selection being captured, and
  // arming or disarming during a drag must not lose it either.
  const live = useRef({
    enabled, activation, resolveCaretAtPoint, onSelect, boundaryFor, isExcludedTarget,
    isCoarsePointer, longPressMs, moveTolerancePx, clearOnSelect, scrollContainer,
    diagnostics,
  });
  live.current = {
    enabled, activation, resolveCaretAtPoint, onSelect, boundaryFor, isExcludedTarget,
    isCoarsePointer, longPressMs, moveTolerancePx, clearOnSelect, scrollContainer,
    diagnostics,
  };

  // Segmentation is built once: ICU segmentation is not free, and a propagating
  // drag republishes many times a second.
  const wordCache = useMemo(() => createWordSegmentCache(), []);
  const segmenter = useMemo(() => defaultWordSegmenter(), []);
  const session = useRef<SelectionSession | null>(null);

  /**
   * The selection itself, created on first use and kept for the hook's life.
   *
   * Created lazily rather than in an effect or in render: an effect would
   * recreate it whenever an option's identity changed — including mid-gesture,
   * when a caller re-renders — and render must stay free of it, since a session
   * is DOM state. The callback itself is identity-stable for the same reason the
   * listeners are: `detachAll`, and through it the pointerdown subscription,
   * depend on it, and a new identity mid-drag would tear down a live gesture.
   * The options it is created with are only the starting ones — every press
   * adopts the current activation and tolerance before it claims anything.
   */
  const initialOptions = useRef({ activation, moveTolerancePx, segmenter, words: wordCache });
  const ensureSession = useCallback((): SelectionSession => {
    if (!session.current) {
      const first = initialOptions.current;
      session.current = createSelectionSession({
        activation: first.activation,
        moveTolerancePx: first.moveTolerancePx,
        segmenter: first.segmenter,
        words: first.words,
      });
    }
    return session.current;
  }, []);

  // Presentation detail — what React needs beyond the session's own answers.
  const anchor = useRef<SelectionRect | null>(null);
  /**
   * Whether the last known pointer position is a position IN THE TEXT.
   *
   * A finger's press is one, and so is every move. A handle's grab is not: the
   * handle draws itself on the line's edge, tens of pixels from the character it
   * belongs to, so resolving a caret there would slide the endpoint the student
   * is about to drag before they have moved at all.
   */
  const pointerIsText = useRef(false);
  const lastPointer = useRef<PointerRecord | null>(null);
  const binding = useRef<PointerFollow | null>(null);
  const handleTarget = useRef<Element | null>(null);
  const scheduler = useRef<FrameScheduler | null>(null);
  const autoScroll = useRef<AutoScrollRunner | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollSuppressor = useRef<((event: Event) => void) | null>(null);
  const currentEffects = useRef<(effects: readonly SelectionEffect[]) => void>(() => {});
  const currentHandlers = useRef({
    move: (_event: PointerEvent) => {},
    up: (_event: PointerEvent) => {},
    cancel: (_event: PointerEvent) => {},
  });
  const runFrameRef = useRef<() => void>(() => {});
  const frameOptions = useRef({ requestFrame, cancelFrame });
  frameOptions.current = { requestFrame, cancelFrame };

  /* ------------------------------------------------------------------
   * The one geometry pass.
   * ------------------------------------------------------------------ */

  /**
   * Hand React the geometry of the selection the session owns.
   *
   * The session measures once — one range, one `getClientRects()` — and this
   * function's job is only to publish that to React and to the diagnostics. It
   * re-derives nothing: the range it paints is the range a handle drag will act
   * on, because both are the session's.
   */
  const publish = useCallback(() => {
    const active = ensureSession();
    const phase = active.phase();

    if (phase === 'idle') {
      anchor.current = null;
      setPresentation(IDLE_SELECTION);
      return;
    }

    const paint = active.paint(rootRef.current);
    const range = active.range();
    live.current.diagnostics?.record('range:created', {
      rangeText: range?.toString().slice(0, 200) ?? '',
      rangeCollapsed: range?.collapsed ?? null,
      rangeStartConnected: range?.startContainer.isConnected ?? null,
      rangeEndConnected: range?.endContainer.isConnected ?? null,
    });
    live.current.diagnostics?.record('range', {
      rangeText: range?.toString().slice(0, 200) ?? '',
      rangeCollapsed: range?.collapsed ?? null,
      rangeRectCount: paint.rects.length,
    });

    anchor.current = paint.anchorRect;
    setPresentation({
      id: active.presentationId(),
      phase,
      active: phase !== 'selected',
      selected: phase === 'selected',
      selectionText: paint.text,
      rects: paint.rects,
      startHandle: paint.startHandle,
      endHandle: paint.endHandle,
    });
  }, [ensureSession, rootRef]);

  /**
   * Resolve, measure and publish — from a frame, and nowhere else.
   *
   * The finger's latest position is resolved against the text only when the
   * session says the position means something for the phase it is in, so a
   * pending gesture that has not travelled yet costs no layout work at all.
   */
  const runFrame = useCallback(() => {
    const active = ensureSession();
    const root = rootRef.current;
    const pointer = lastPointer.current;
    if (root && pointer && pointerIsText.current && active.needsPoint(pointer.x, pointer.y)) {
      const point = live.current.resolveCaretAtPoint(pointer.x, pointer.y, root);
      live.current.diagnostics?.record('focus-caret', {
        focusCaretResolved: !!point,
        focusCaretInsideRoot: !!point && !!root.contains(point.node),
        focusConnected: point?.node.isConnected ?? null,
        focusOffset: point?.offset ?? null,
        focusNode: describeTouchSelectionNode(point?.node ?? null),
      });
      if (point) {
        currentEffects.current(
          active.move({ pointerId: pointer.pointerId, x: pointer.x, y: pointer.y, point }),
        );
      }
    }
    publish();
  }, [ensureSession, publish, rootRef]);
  runFrameRef.current = runFrame;

  /* ------------------------------------------------------------------ *
   * Effects — the only place transitions meet the DOM.
   * ------------------------------------------------------------------ */

  const clearHoldTimer = useCallback(() => {
    if (holdTimer.current === null) return;
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  const releaseBinding = useCallback(() => {
    binding.current?.release();
    binding.current = null;
  }, []);

  const detachScrollSuppressor = useCallback(() => {
    if (!scrollSuppressor.current) return;
    document.removeEventListener('touchmove', scrollSuppressor.current);
    scrollSuppressor.current = null;
  }, []);

  const detachAll = useCallback(() => {
    releaseBinding();
    clearHoldTimer();
    detachScrollSuppressor();
    autoScroll.current?.stop();
    scheduler.current?.cancel();
    ensureSession().reset();
    anchor.current = null;
    lastPointer.current = null;
    pointerIsText.current = false;
    handleTarget.current = null;
  }, [clearHoldTimer, detachScrollSuppressor, ensureSession, releaseBinding]);

  const dismiss = useCallback(() => {
    currentEffects.current(ensureSession().dismiss());
  }, [ensureSession]);

  /** Hand one pointer to the capture primitive, kept as the live follow. */
  const bindPointer = useCallback((pointerId: number, element: Element | null) => {
    releaseBinding();
    binding.current = followPointer(pointerId, element, {
      onMove: (event) => currentHandlers.current.move(event),
      onUp: (event) => currentHandlers.current.up(event),
      onCancel: (event) => currentHandlers.current.cancel(event),
    });
  }, [releaseBinding]);

  /**
   * The scheduler is created on demand and used for the whole life of the hook.
   *
   * Creating it in an effect would recreate it whenever an option's identity
   * changed — including mid-gesture, when a caller re-renders — and a gesture
   * that suddenly has two schedulers loses whichever frame the old one held.
   */
  const ensureScheduler = useCallback((): FrameScheduler => {
    if (!scheduler.current) {
      scheduler.current = createFrameScheduler(() => runFrameRef.current(), frameOptions.current);
    }
    return scheduler.current;
  }, []);

  const updateAutoScroll = useCallback((y: number) => {
    const root = rootRef.current;
    const container = root ? live.current.scrollContainer?.(root) ?? null : null;
    const phase = ensureSession().phase();
    const adjusting = phase === 'adjusting-start' || phase === 'adjusting-end';
    if (!container || !adjusting) {
      autoScroll.current?.stop();
      return;
    }
    const box = container.getBoundingClientRect();
    autoScroll.current?.update(y, { top: box.top, bottom: box.top + box.height });
  }, [ensureSession, rootRef]);

  currentEffects.current = (effects) => {
    const config = live.current;
    for (const effect of effects) {
      switch (effect.type) {
        case 'arm-hold': {
          clearHoldTimer();
          holdTimer.current = setTimeout(() => {
            holdTimer.current = null;
            const effects = ensureSession().hold();
            config.diagnostics?.record('claim', { claimed: ensureSession().phase() === 'selecting' });
            currentEffects.current(effects);
            ensureScheduler().schedule();
          }, config.longPressMs);
          break;
        }
        case 'disarm-hold':
          clearHoldTimer();
          break;

        case 'capture-pointer':
          bindPointer(effect.pointerId, handleTarget.current ?? rootRef.current);
          break;
        case 'release-pointer':
          releaseBinding();
          autoScroll.current?.stop();
          break;
        case 'suppress-scroll': {
          if (scrollSuppressor.current) break;
          const suppress = (event: Event) => {
            const phase = ensureSession().phase();
            if (phase === 'selected' || phase === 'idle') return;
            if (event.cancelable) event.preventDefault();
          };
          scrollSuppressor.current = suppress;
          document.addEventListener('touchmove', suppress, { passive: false });
          break;
        }
        case 'allow-scroll':
          detachScrollSuppressor();
          break;
        case 'commit': {
          const range = ensureSession().range();
          if (!range) break;
          config.diagnostics?.record('onSelect', { onSelectCalled: true });
          try {
            config.onSelect(range, range.toString());
          } catch (error) {
            config.diagnostics?.record('onSelect:error', { error: error instanceof Error ? error.message : String(error) });
            throw error;
          }
          if (config.clearOnSelect) currentEffects.current(ensureSession().dismiss());
          break;
        }
        case 'clear':
          detachAll();
          setPresentation(IDLE_SELECTION);
          break;
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * Gesture input.
   * ------------------------------------------------------------------ */

  const handleDown = useCallback((event: PointerEvent) => {
    const config = live.current;
    config.diagnostics?.record('pointerdown', { pointerDownSeen: true, pointerType: event.pointerType, pointerId: event.pointerId, eventTarget: describeTouchSelectionNode(event.target instanceof Node ? event.target : null), targetInsideRoot: event.target instanceof Node && !!rootRef.current?.contains(event.target) });
    if (!config.enabled) return;
    if (!config.isCoarsePointer()) return;
    if (typeof event.button === 'number' && event.button > 0) return;

    const root = rootRef.current;
    if (!root) return;
    if (event.target instanceof Node && !root.contains(event.target)) return;
    if (config.isExcludedTarget(event.target)) return;

    const active = ensureSession();

    // A press that arrives while something is already owned is a SECOND finger:
    // two-finger scrolling and pinch-zoom are how a student reads a passage, and
    // the machine hands the whole gesture back — including a resting selection —
    // so the page scrolls exactly as it would without this engine.
    if (active.phase() !== 'idle') {
      config.diagnostics?.record('abandon', { reason: 'second-pointer' });
      dismiss();
      return;
    }

    const start = config.resolveCaretAtPoint(event.clientX, event.clientY, root);
    config.diagnostics?.record('start-caret', { startCaretResolved: !!start, startCaretInsideRoot: !!start && root.contains(start.node), startConnected: start?.node.isConnected ?? null, startOffset: start?.offset ?? null, startNode: describeTouchSelectionNode(start?.node ?? null) });
    if (!start) return;

    // The session's options are the CURRENT ones: disarming or re-arming the tool
    // between gestures must change the next gesture, not the one that ended.
    active.adoptOptions(config.activation, config.moveTolerancePx);
    lastPointer.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    pointerIsText.current = true;
    handleTarget.current = root;
    currentEffects.current(
      active.press({
        pointerId: event.pointerId,
        pointerType: event.pointerType ?? '',
        x: event.clientX,
        y: event.clientY,
        point: start,
        boundaryFor: config.boundaryFor,
      }),
    );
  }, [dismiss, ensureSession, rootRef]);

  const handleMove = useCallback((event: PointerEvent) => {
    const config = live.current;
    config.diagnostics?.record('pointermove', { pointerMoveSeen: true });
    const active = ensureSession();
    if (active.pointerId() === null || event.pointerId !== active.pointerId()) return;

    // The move is folded into the next frame, not resolved here: this handler must
    // not read layout, and a hundred of them in one frame must cost one.
    lastPointer.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    pointerIsText.current = true;
    const before = active.phase();
    const effects = active.move({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });
    const phase = active.phase();
    if (before !== phase && (phase === 'selecting' || phase === 'extending')) {
      config.diagnostics?.record('claim', { claimed: true });
    }
    if (effects.length > 0) currentEffects.current(effects);

    // The finger may now be inside an edge band of the scrolling container, so the
    // selection keeps extending while the passage moves under it.
    updateAutoScroll(event.clientY);
    ensureScheduler().schedule();
  }, [ensureSession, ensureScheduler, updateAutoScroll]);

  const handleUp = useCallback((event: PointerEvent) => {
    live.current.diagnostics?.record('pointerup', { pointerUpSeen: true });
    const active = ensureSession();
    if (active.pointerId() === null || event.pointerId !== active.pointerId()) return;

    // The release position is deliberately NOT adopted: it carries no new
    // information about where the text ends. A finger that travelled sent a
    // pointermove first, and a release that arrives without one — a synthetic
    // event, a browser that reports zeroes for a lifted pointer — would otherwise
    // yank the selection back to the coordinate (0, 0) at the exact moment it is
    // committed.
    //
    // THE frame that must not wait: the range reported to the exam has to be the
    // one the student was looking at when they let go, not the frame before it.
    ensureScheduler().flush();
    currentEffects.current(active.release(event.pointerId));
    ensureScheduler().schedule();
  }, [ensureScheduler, ensureSession]);

  const handleCancel = useCallback((event: PointerEvent) => {
    live.current.diagnostics?.record('pointercancel', { pointerCancelSeen: true });
    const active = ensureSession();
    if (active.pointerId() === null || event.pointerId !== active.pointerId()) return;

    currentEffects.current(active.cancel(event.pointerId));
  }, [ensureSession]);

  currentHandlers.current = { move: handleMove, up: handleUp, cancel: handleCancel };

  const beginHandleAdjustment = useCallback((edge: SelectionEdge, event: SelectionHandlePointerEvent) => {
    if (!live.current.enabled) return;
    // The session decides, and it decides from the span the last frame painted:
    // the handles were drawn around the range the student can see, so that is the
    // range the grab has to mean. It refuses anything but a resting selection.
    const effects = ensureSession().grab({
      edge,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    if (!effects) return;
    event.preventDefault?.();
    // The handle is the capture target, so the drag keeps arriving after the
    // finger leaves the 12px dot it started on.
    handleTarget.current = event.currentTarget instanceof Element ? event.currentTarget : rootRef.current;
    lastPointer.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    pointerIsText.current = false;
    currentEffects.current(effects);
    ensureScheduler().schedule();
  }, [ensureScheduler, ensureSession, rootRef]);

  /* ------------------------------------------------------------------ *
   * Wiring.
   * ------------------------------------------------------------------ */

  useEffect(() => {
    if (!enabled) return;

    const root = rootRef.current;
    const config = live.current;
    config.diagnostics?.record('listener:effect', { rootExistsAtEffect: !!root });
    config.diagnostics?.listener(root);
    root?.addEventListener('pointerdown', handleDown);

    return () => {
      live.current.diagnostics?.listener(null);
      root?.removeEventListener('pointerdown', handleDown);
      detachAll();
      setPresentation(IDLE_SELECTION);
    };
  }, [detachAll, enabled, handleDown, rootRef]);

  /**
   * Tell the browser, before any finger lands, that this drag is the app's.
   *
   * Set for exactly the contract where a drag means "this text": an armed tool on
   * a coarse pointer. A layout effect rather than an effect, because the attribute
   * has to be true by the time the element the student can touch has been painted;
   * leaving that gap would leave a window in which the browser still owns the
   * gesture and cancels it.
   *
   * The long-press contract is never marked: there a drag is a scroll, and taking
   * the gesture away from the browser would break the very reading motion the mode
   * exists to preserve.
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
    dismiss();
  }, [dismiss, enabled]);

  const autoScrollRunner = useMemo(
    () =>
      createAutoScrollRunner(
        (dx, dy) => {
          const root = rootRef.current;
          const container = root ? live.current.scrollContainer?.(root) ?? null : null;
          container?.scrollBy(dx, dy);
        },
        // Each step changes the layout under the finger, so the selection is
        // re-measured on the next frame — through the same scheduler, so a scroll
        // and a move still cost one geometry pass between them.
        {
          onStep: () => ensureScheduler().schedule(),
          // The same frame source the geometry pass uses, so a test can drive a
          // scroll and a move on one clock instead of racing two.
          requestFrame: (callback) => {
            const injected = frameOptions.current.requestFrame;
            if (injected) return injected(callback);
            return typeof requestAnimationFrame === 'function'
              ? requestAnimationFrame(callback)
              : (setTimeout(callback, 16) as unknown as number);
          },
          cancelFrame: (handle) => {
            const injected = frameOptions.current.cancelFrame;
            if (injected) injected(handle);
            else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
            else clearTimeout(handle);
          },
        },
      ),
    [ensureScheduler, rootRef],
  );

  useEffect(() => {
    autoScroll.current = autoScrollRunner;
    return () => autoScrollRunner.stop();
  }, [autoScrollRunner]);

  /**
   * Reposition for as long as a selection exists.
   *
   * A stored rect goes stale on scroll, zoom, a line-spacing change or a pane
   * resize, and a highlight painted over the wrong sentence is worse than none.
   * Nothing here re-resolves the caret — the selected text does not change when
   * the page moves — so this is measurement only, still inside one frame.
   */
  useEffect(() => {
    if (presentation.phase === 'idle') return;
    const schedule = () => ensureScheduler().schedule();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const viewport = typeof window !== 'undefined' ? window.visualViewport ?? null : null;
    viewport?.addEventListener('scroll', schedule);
    viewport?.addEventListener('resize', schedule);
    const root = rootRef.current;
    const observer = typeof ResizeObserver === 'undefined' || !root ? null : new ResizeObserver(schedule);
    observer?.observe(root as Element);
    return () => {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      viewport?.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [ensureScheduler, presentation.phase, rootRef]);

  useEffect(() => () => {
    scheduler.current?.cancel();
    scheduler.current = null;
    autoScroll.current = null;
  }, []);

  return {
    ...presentation,
    anchorRect: anchor.current,
    pointer: lastPointer.current ? { x: lastPointer.current.x, y: lastPointer.current.y } : null,
    adjusting: presentation.phase === 'adjusting-start' || presentation.phase === 'adjusting-end',
    beginHandleAdjustment,
    dismiss,
  };
}
