import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createSelectionSession, type SelectionSession } from '../engine/selectionSession';
import { followPointer, type PointerFollow } from '../engine/pointerCapture';
import { createFrameScheduler, type FrameScheduler } from '../engine/selectionScheduler';
import { createAutoScrollRunner, type AutoScrollRunner } from '../engine/selectionAutoScroll';
import {
  createWordSegmentCache,
  defaultGraphemeSegmenter,
  defaultWordSegmenter,
} from '../domain/selectionSegmenter';
import type { SelectionActivation, SelectionEffect } from '../domain/selectionMachine';
import {
  IDLE_SELECTION,
  selectionMovesEndpoint,
  type CaretGeometry,
  type SelectionPointerState,
  type SelectionPresentation,
  type SelectionRect,
  type TextPoint,
} from '../domain/selectionTypes';
import { caretGeometryFromTextPoint } from '../engine/selectionGeometry';
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
  /** Identity of the question/surface that owns this transient range. */
  scopeKey?: string | undefined;
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
  /** Whether this physical pointer belongs to the app-owned gesture. */
  isOwnedPointer?: ((event: PointerEvent) => boolean) | undefined;
  /** Whether an outside press would start a product-owned native selection. */
  wouldStartOwnedSelection?: ((event: Event) => boolean) | undefined;
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
  /**
   * The haptic half of a caret crossing: one short buzz when the resolved caret
   * moves to a DIFFERENT text position, and never a continuous one.
   *
   * Injected like every other platform seam here (`resolveCaretAtPoint`,
   * `isOwnedPointer`, `requestFrame`), and for the same reason: the Vibration
   * API ships in Chrome for Android and Samsung Internet and does not exist in
   * iOS Safari at all, so the honest default is a feature-detected function that
   * is simply absent there — while a test can pass a spy and assert that it
   * fires once per new offset, is throttled, and never becomes a hum, which it
   * could not assert against a device anyway. Returning false means "the platform
   * declined"; that is always allowed and never an error.
   */
  vibrate?: ((milliseconds: number) => boolean) | undefined;
  /**
   * The clock the haptic floor reads, injected beside `vibrate` for the reason
   * the repo's DI rule gives: time is a dependency. With the clock as a seam a
   * test drives the window exactly; without one it can only spy `Date.now` and
   * arrange its timestamps to clear production's `lastHapticAt = 0` sentinel.
   */
  now?: (() => number) | undefined;
  /** Test seam: frames are injectable, so "one read per frame" is assertable. */
  requestFrame?: ((callback: () => void) => number) | undefined;
  cancelFrame?: ((handle: number) => void) | undefined;
}

/** The slice of a React pointer event a handle needs, so a test can supply one. */
export interface SelectionHandlePointerEvent {
  pointerId: number;
  pointerType?: string | undefined;
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
  preventDefault?: (() => void) | undefined;
}

export interface StudentSelectionGesture extends SelectionPresentation {
  /** Where a menu may hang: the union box of the painted lines. */
  anchorRect: SelectionRect | null;
  /**
   * The two positions the pointer has: where the hand is, and what the text
   * resolved to. See `SelectionPointerState` — the lens's BOX follows `finger`
   * and its CONTENT follows `caret`, and conflating them is what makes a tick
   * drift through whitespace instead of snapping to a character.
   */
  pointer: SelectionPointerState | null;
  /** True while the finger is moving an endpoint of a resting selection. */
  adjusting: boolean;
  /**
   * Report a press on a resting selection, and answer with what became of it.
   *
   * The press is reported as a coordinate and the element the finger landed on —
   * nothing else. The endpoint it adjusts is the SESSION's decision, taken once,
   * by measured geometry over both endpoints against the paint the session owns
   * (`resolveHandleAcquisition`, called from `grab`) — not by the caller naming an
   * edge, and not by which control the paint order happened to put under the
   * finger.
   *
   * True when a drag BEGAN — the caller has authoritative knowledge that this
   * press is the handle's, and no part of the page may also act on it. False when
   * it acquired neither endpoint (the selection's own body, or outside it) and
   * when the machine refused it: nothing started, and nothing was consumed.
   */
  beginHandleAdjustment: (event: SelectionHandlePointerEvent) => boolean;
  /** Re-report the unchanged session range when the student taps its resting body. */
  activateCurrentSelection: () => boolean;
  /** Dismiss the selection: a tap outside, Escape, or a completed action. */
  dismiss: () => void;
  /**
   * Whether this pointerdown would reach the gesture's own handler — the
   * guards before the ownership check, answered in one place because two
   * copies of those guards would be two answers (see the hook).
   *
   * `SelectionOverlay` asks it about an OUTSIDE press: having dismissed, it
   * must consume exactly the presses that would otherwise begin the next
   * owned gesture under this same pointerdown, while toolbars, inputs and every
   * other control still receive theirs.
   */
  wouldBeginGesture: (event: Event) => boolean;
  /** Whether an outside press would start the product's native selection path. */
  wouldStartOwnedSelection: (event: Event) => boolean;
}

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function defaultIsExcludedTarget(target: EventTarget | null): boolean {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest(EDITABLE_SELECTOR) != null;
}

function defaultIsOwnedPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch';
}

function isSatSelectionRoot(root: HTMLElement): boolean {
  return root.matches('[data-sat-selection-protected="true"]');
}

function isAppOwnedSelectionRoot(root: HTMLElement): boolean {
  return isSatSelectionRoot(root) || root.matches('[data-student-highlightable="true"]');
}

function nativeSelectionIntersectsRoot(selection: Selection, root: HTMLElement): boolean {
  if (selection.isCollapsed || selection.rangeCount === 0) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    try {
      if (selection.getRangeAt(index).intersectsNode(root)) return true;
    } catch {
      // A stale range is not evidence that the protected surface owns it.
    }
  }
  return (selection.anchorNode !== null && root.contains(selection.anchorNode))
    || (selection.focusNode !== null && root.contains(selection.focusNode));
}

interface PointerRecord {
  x: number;
  y: number;
  pointerId: number;
  pointerType: string;
}

/** One haptic tick's length: a tap, not a buzz — short enough to count as feedback. */
const CARET_HAPTIC_MS = 8;

/**
 * At most one tick per this long.
 *
 * The caret only ever changes on a real boundary crossing, but a fast drag can
 * cross several in a few frames, and without a floor the tick becomes a hum —
 * continuous vibration is an alarm, not a confirmation. The floor is what keeps
 * "only on a new offset" true in feel as well as in causality.
 */
const CARET_HAPTIC_THROTTLE_MS = 50;

/**
 * The platform's own haptic, or nothing at all.
 *
 * FEATURE-DETECTED RATHER THAN ASSUMED: `navigator.vibrate` is simply absent on
 * iOS — Safari does not expose the Taptic Engine to web content and no amount of
 * feature detection changes that — so "not there" is the ordinary case on the
 * device most likely to be held, and it must cost nothing and throw nothing.
 * A browser that has it may still refuse (a silent profile, a permission), and a
 * refusal is an answer, not a fault.
 */
function platformVibrate(milliseconds: number): boolean {
  if (typeof navigator === 'undefined') return false;
  // Called on `navigator` itself rather than extracted: a bound or borrowed
  // reference is the one way a platform's own implementation can reject `this`.
  if (typeof navigator.vibrate !== 'function') return false;
  try {
    return navigator.vibrate(milliseconds);
  } catch {
    return false;
  }
}

export function useStudentSelectionGesture(
  options: StudentSelectionGestureOptions,
): StudentSelectionGesture {
  const {
    enabled,
    activation = 'long-press',
    rootRef,
    scopeKey = '',
    resolveCaretAtPoint,
    onSelect,
    boundaryFor,
    isExcludedTarget = defaultIsExcludedTarget,
    isOwnedPointer = defaultIsOwnedPointer,
    wouldStartOwnedSelection = () => false,
    longPressMs = 350,
    moveTolerancePx = 8,
    clearOnSelect = false,
    scrollContainer,
    diagnostics,
    requestFrame,
    cancelFrame,
    vibrate = platformVibrate,
    now = Date.now,
  } = options;

  const [presentation, setPresentation] = useState<SelectionPresentation>(IDLE_SELECTION);

  // Live values behind a ref so the listeners never rebind mid-gesture. Rebinding
  // would drop the release that completes the very selection being captured, and
  // arming or disarming during a drag must not lose it either.
  const live = useRef({
    enabled, activation, resolveCaretAtPoint, onSelect, boundaryFor, isExcludedTarget,
    isOwnedPointer, wouldStartOwnedSelection, longPressMs, moveTolerancePx, clearOnSelect, scrollContainer,
    diagnostics, vibrate, now,
  });
  live.current = {
    enabled, activation, resolveCaretAtPoint, onSelect, boundaryFor, isExcludedTarget,
    isOwnedPointer, wouldStartOwnedSelection, longPressMs, moveTolerancePx, clearOnSelect, scrollContainer,
    diagnostics, vibrate, now,
  };

  // Segmentation is built once: ICU segmentation is not free, and a propagating
  // drag republishes many times a second.
  const wordCache = useMemo(() => createWordSegmentCache(), []);
  const segmenter = useMemo(() => defaultWordSegmenter(), []);
  // Built once beside the word segmenter, and for the same reason: a handle drag
  // republishes many times a second, and the session's own memo is what makes
  // each of those a lookup rather than a rescan of the node.
  const graphemes = useMemo(() => defaultGraphemeSegmenter(), []);
  const session = useRef<SelectionSession | null>(null);
  const scopeKeyRef = useRef(scopeKey);
  /** Legacy highlightable surfaces keep touch ownership only while their range rests. */
  const satTouchOwnership = useRef(false);

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
  const initialOptions = useRef({ activation, moveTolerancePx, segmenter, words: wordCache, graphemes });
  const ensureSession = useCallback((): SelectionSession => {
    if (!session.current) {
      const first = initialOptions.current;
      session.current = createSelectionSession({
        activation: first.activation,
        moveTolerancePx: first.moveTolerancePx,
        segmenter: first.segmenter,
        words: first.words,
        graphemes: first.graphemes,
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
  /**
   * Where the endpoint the session ADOPTED actually is on screen.
   *
   * Derived from the session's own moving endpoint — never from the raw finger
   * and never from the candidate coordinate that was handed to it — so boundary
   * clamping, handle crossover and word expansion are already applied by the
   * time the lens is pointed at it, and the tick cannot describe a range the
   * student cannot see. Measured in the frame (below), never in an event.
   */
  const resolvedCaret = useRef<CaretGeometry | null>(null);
  /**
   * The endpoint the last caret measurement was taken from — the thing a change
   * is a change AGAINST.
   *
   * Compared as `{node, offset}`, never as coordinates: two frames that resolve
   * the same boundary are the same caret whether the finger moved 3px or 30, and
   * a comparison in pixels would tick inside a character, which is exactly the
   * causality this exists to get right.
   */
  const caretEndpoint = useRef<TextPoint | null>(null);
  /** The snap key: how many times the caret has been at a DIFFERENT position. */
  const snapRevision = useRef(0);
  /** When the last haptic fired, so the tick can never become a hum. */
  const lastHapticAt = useRef(0);
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
    const satTextBlockFor = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;
      return element?.closest('[data-content-text-node]') ?? null;
    };
    const startBlock = range ? satTextBlockFor(range.startContainer) : null;
    const endBlock = range ? satTextBlockFor(range.endContainer) : null;
    live.current.diagnostics?.record('range:created', {
      rangeText: range?.toString().slice(0, 200) ?? '',
      rangeCollapsed: range?.collapsed ?? null,
      rangeStartConnected: range?.startContainer.isConnected ?? null,
      rangeEndConnected: range?.endContainer.isConnected ?? null,
      rangeStartInsideRoot: !!range && !!rootRef.current?.contains(range.startContainer),
      rangeEndInsideRoot: !!range && !!rootRef.current?.contains(range.endContainer),
      rangeWithinSingleSatTextBlock: startBlock !== null && startBlock === endBlock,
      rangeStartSatBlockId: startBlock?.getAttribute('data-content-text-node') ?? null,
      rangeEndSatBlockId: endBlock?.getAttribute('data-content-text-node') ?? null,
    });
    live.current.diagnostics?.record('range', {
      rangeText: range?.toString().slice(0, 200) ?? '',
      rangeCollapsed: range?.collapsed ?? null,
      rangeRectCount: paint.rects.length,
      rangeStartInsideRoot: !!range && !!rootRef.current?.contains(range.startContainer),
      rangeEndInsideRoot: !!range && !!rootRef.current?.contains(range.endContainer),
      rangeWithinSingleSatTextBlock: startBlock !== null && startBlock === endBlock,
      rangeStartSatBlockId: startBlock?.getAttribute('data-content-text-node') ?? null,
      rangeEndSatBlockId: endBlock?.getAttribute('data-content-text-node') ?? null,
      // The granularity the span is spelled in travels with every published
      // frame, beside the span itself: it is the session's state, and a trace that
      // records what was selected without recording which of the two models
      // produced it cannot answer the one question the distinction exists for.
      granularity: active.granularity(),
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
   * Say that the caret moved — on the haptic channel.
   *
   * Only ever called from where `{node, offset}` was seen to change, so there is
   * exactly one definition of "a new caret offset" in this engine and it is the
   * same one the visual tick is driven by. The floor below is the difference
   * between a device that answers every crossing and one that hums.
   */
  const tickCaret = useCallback(() => {
    const buzz = live.current.vibrate;
    if (!buzz) return;
    // Read through the injected clock: time is a dependency here exactly as
    // `vibrate` is, and a floor the test cannot drive would be assertable only
    // by spying the machine's own clock.
    const at = live.current.now();
    if (at - lastHapticAt.current < CARET_HAPTIC_THROTTLE_MS) return;
    lastHapticAt.current = at;
    try {
      buzz(CARET_HAPTIC_MS);
    } catch {
      // A platform that refuses is not a failure worth breaking a frame over.
    }
  }, []);

  /**
   * Resolve, measure and publish — from a frame, and nowhere else.
   *
   * The finger's latest position is resolved against the text only when the
   * session says the position means something for the phase it is in, so a
   * pending gesture that has not travelled yet costs no layout work at all.
   *
   * THE SNAPPED CARET IS RESOLVED HERE TOO, in this same frame and immediately
   * after the caret resolution: one pass over layout per frame, and never a
   * second reader on `pointermove` — which is also what keeps the caret and the
   * range it describes measured at the same instant.
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

    // After the session has adopted the move: its endpoint is the source of
    // truth, and it is measured only while an endpoint is actually moving —
    // the phases in which the lens may be open. Outside them there is nothing to
    // magnify, and reading a caret on every scroll frame of a resting selection
    // would be a layout read for a lens that is not on screen.
    const endpoint = selectionMovesEndpoint(active.phase()) ? active.movingEndpoint() : null;

    // THE SNAP KEY IS THIS COMPARISON, and nothing else. Same node and offset →
    // no revision, no tick, no haptic: a finger travelling inside one glyph is
    // invisible to everything downstream. A different position advances the
    // revision once, and that single number is what the marker and the grip
    // spring from. Re-appearing after the gesture ended is not a change either —
    // the endpoint it came back to is compared against the one it left as, and
    // an opening lens has its own entrance.
    const previous = caretEndpoint.current;
    if (
      endpoint
      && previous
      && (previous.node !== endpoint.node || previous.offset !== endpoint.offset)
    ) {
      snapRevision.current += 1;
      tickCaret();
    }
    caretEndpoint.current = endpoint;
    resolvedCaret.current = endpoint ? caretGeometryFromTextPoint(endpoint) : null;

    publish();
  }, [ensureSession, publish, rootRef, tickCaret]);
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
    resolvedCaret.current = null;
    caretEndpoint.current = null;
    pointerIsText.current = false;
    handleTarget.current = null;
    satTouchOwnership.current = false;
    const root = rootRef.current;
    const precontactSatOwner = !!root
      && isSatSelectionRoot(root)
      && live.current.enabled
      && live.current.activation === 'drag';
    if (!precontactSatOwner && root?.getAttribute('data-student-selection-owner') === 'app') {
      root.removeAttribute('data-student-selection-owner');
    }
  }, [clearHoldTimer, detachScrollSuppressor, ensureSession, releaseBinding, rootRef]);

  const dismiss = useCallback(() => {
    currentEffects.current(ensureSession().dismiss());
  }, [ensureSession]);

  // A Range belongs to the question whose text nodes created it. Reset at the
  // session owner when that identity changes, before the replacement question
  // can paint or receive another pointer event.
  useLayoutEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    detachAll();
    setPresentation(IDLE_SELECTION);
    live.current.diagnostics?.record('scope-reset', {
      scopeReset: true,
      claimed: false,
      rangeText: '',
      rangeCollapsed: null,
      rangeRectCount: 0,
    });
  }, [detachAll, scopeKey]);

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

  /**
   * Would this press reach the gesture's own pointerdown? — every guard BEFORE
   * the ownership check, in one place.
   *
   * Two callers ask the same question: this handler, and `SelectionOverlay`,
   * which must CONSUME an outside press that would otherwise arrive here and —
   * with the selection already dismissed — begin a new one under the same
   * physical press (the hidden `selected → idle → pending` transition). Two
   * copies of these guards would be two answers, which is exactly how they
   * drift; the overlay consults this function rather than reimplementing it.
   */
  const wouldBeginGesture = useCallback((event: Event): boolean => {
    const config = live.current;
    const pointer = event as PointerEvent;
    if (!config.enabled) return false;
    if (!config.isOwnedPointer(pointer)) return false;
    if (typeof pointer.button === 'number' && pointer.button > 0) return false;
    const root = rootRef.current;
    if (!root) return false;
    if (event.target instanceof Node && !root.contains(event.target)) return false;
    if (config.isExcludedTarget(event.target)) return false;
    return true;
  }, [rootRef]);

  const wouldStartOwnedSelectionOutside = useCallback((event: Event): boolean => {
    const config = live.current;
    return config.enabled && config.wouldStartOwnedSelection(event);
  }, []);

  const handleDown = useCallback((event: PointerEvent) => {
    const config = live.current;
    config.diagnostics?.record('pointerdown', { pointerDownSeen: true, pointerType: event.pointerType, pointerId: event.pointerId, eventTarget: describeTouchSelectionNode(event.target instanceof Node ? event.target : null), targetInsideRoot: event.target instanceof Node && !!rootRef.current?.contains(event.target) });
    if (!wouldBeginGesture(event)) return;

    const root = rootRef.current;
    if (!root) return;

    const active = ensureSession();

    // A press that arrives while something is already owned ENDS that gesture
    // and starts nothing — one physical pointerdown holds exactly one intent
    // (docs/selectionui.md). It is either a second finger — two-finger scrolling
    // and pinch-zoom are how a student reads a passage, and the machine hands
    // the whole gesture back (the same effects a dismissal produces) so the
    // page scrolls as it would without this engine — or a press arriving
    // before the claim has painted anything for an overlay to arbitrate. While
    // a selection IS painted, `SelectionOverlay` dismisses and consumes these
    // in its capture pass, so they never get here; this is the same rule for
    // the presses it does not see.
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
    lastPointer.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType || 'unknown' };
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
  }, [dismiss, ensureSession, rootRef, wouldBeginGesture]);

  const handleMove = useCallback((event: PointerEvent) => {
    const config = live.current;
    config.diagnostics?.record('pointermove', { pointerMoveSeen: true });
    const active = ensureSession();
    if (active.pointerId() === null || event.pointerId !== active.pointerId()) return;

    // The move is folded into the next frame, not resolved here: this handler must
    // not read layout, and a hundred of them in one frame must cost one.
    lastPointer.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType || 'unknown' };
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

  /**
   * The ONE way a pointer's gesture ends.
   *
   * Every terminal signal funnels through here — a release (from the captured
   * element or from the document backup), a `pointercancel`, a lost capture, a
   * backgrounded app — because cleanup spread across callers is exactly how a
   * loupe stays open: each path forgot a different ref, and the machine sat in
   * `adjusting-*` under a lens nobody could close. The order is the invariant:
   *
   *   1. a normal release FLUSHES the final scheduled geometry first (the exam
   *      is handed the range the student was looking at, not the frame before
   *      it); a cancel reports nothing — a gesture the platform took is not one
   *      the student meant;
   *   2. the machine takes its transition — `selected` for a release, idle for
   *      a cancel — and runs its effects (capture released, auto-scroll stopped,
   *      the range committed);
   *   3. the presentation refs are cleared, so `pointer` is null before the next
   *      painted frame even if a phase were to linger in one render;
   *   4. the resting state is published immediately.
   *
   * A duplicate terminal signal (an event reaching both the element and the
   * document backup) is rejected by the pointer-id guard in step 0 — one
   * physical release, exactly one end.
   */
  const finishPointer = useCallback((pointerId: number, reason: 'release' | 'cancel') => {
    live.current.diagnostics?.record(reason === 'release' ? 'pointerup' : 'pointercancel', {
      [reason === 'release' ? 'pointerUpSeen' : 'pointerCancelSeen']: true,
    });
    const active = ensureSession();
    if (active.pointerId() === null || pointerId !== active.pointerId()) return;

    if (reason === 'release') {
      // THE frame that must not wait — see the scheduler: a release that let
      // the last move draw itself would commit one frame of stale geometry.
      ensureScheduler().flush();
      currentEffects.current(active.release(pointerId));
    } else {
      currentEffects.current(active.cancel(pointerId));
    }

    // Presentation cleanup, in ONE place (the invariant above).
    lastPointer.current = null;
    pointerIsText.current = false;
    resolvedCaret.current = null;
    handleTarget.current = null;
    // Publish NOW — the resting state is what the next paint must show — and
    // queue ONE more frame for a release. The commit that follows this handler
    // (the product raising its toolbar, a mark being applied) can move the
    // passage, and a paint measured BEFORE that commit is a handle sitting over
    // the wrong words until something unrelated re-measures it: a finger that
    // then aims at the drawn handle finds prose instead. The extra frame is the
    // same self-healing re-measure the release path always had; a cancel needs
    // none, because it ends in `clear` with everything re-measured from idle.
    publish();
    if (reason === 'release') ensureScheduler().schedule();
  }, [ensureScheduler, ensureSession, publish]);

  const handleUp = useCallback((event: PointerEvent) => {
    // The release position is deliberately NOT adopted: it carries no new
    // information about where the text ends. A finger that travelled sent a
    // pointermove first, and a release that arrives without one — a synthetic
    // event, a browser that reports zeroes for a lifted pointer — would otherwise
    // yank the selection back to the coordinate (0, 0) at the exact moment it is
    // committed.
    finishPointer(event.pointerId, 'release');
  }, [finishPointer]);

  const handleCancel = useCallback((event: PointerEvent) => {
    finishPointer(event.pointerId, 'cancel');
  }, [finishPointer]);

  currentHandlers.current = { move: handleMove, up: handleUp, cancel: handleCancel };

  /**
   * The gesture's ONE entry for a press on a resting selection
   * (docs/selectionui.md #8).
   *
   * It reports the press to the session and performs what the session's answer
   * implies — that is the whole of it. The endpoint used to be resolved HERE, over
   * a `presentation` snapshot of a frame that had already been painted, and again
   * in `SelectionOverlay` over the same snapshot before deciding what to consume:
   * one press arbitrated twice, in two layers, each free to keep its own copy of
   * the answer in step. The session now decides once, from the paint IT measures —
   * the very span the handles were drawn around — because the two 44px controls
   * overlap on any selection narrower than they are: the control a press was
   * delivered to is not the endpoint it belongs to, and arbitration that starts
   * from that control throws away a press the other endpoint was entitled to.
   *
   * A refusal is reported as `false` rather than performed here: the layer that
   * received the press is the one that knows what a refusal MEANS for it — the
   * selection's own body, or a press outside it — and it consumes accordingly
   * instead of treating the press as a dismissal.
   */
  const beginHandleAdjustment = useCallback((event: SelectionHandlePointerEvent): boolean => {
    if (!live.current.enabled) return false;
    // The session decides, and it decides from the span the last frame painted:
    // the handles were drawn around the range the student can see, so that is the
    // range the grab has to mean. It refuses anything but a resting selection.
    const effects = ensureSession().grab({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      root: rootRef.current,
    });
    if (!effects) return false;
    event.preventDefault?.();
    // The handle is the capture target, so the drag keeps arriving after the
    // finger leaves the 12px dot it started on.
    handleTarget.current = event.currentTarget instanceof Element ? event.currentTarget : rootRef.current;
    lastPointer.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType ?? lastPointer.current?.pointerType ?? 'unknown' };
    pointerIsText.current = false;
    currentEffects.current(effects);
    ensureScheduler().schedule();
    return true;
  }, [ensureScheduler, ensureSession, rootRef]);

  const activateCurrentSelection = useCallback((): boolean => {
    const config = live.current;
    if (!config.enabled) return false;
    const active = ensureSession();
    if (active.phase() !== 'selected') return false;
    const range = active.range();
    if (!range || range.collapsed) return false;
    const root = rootRef.current;
    const satTextBlockFor = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;
      return element?.closest('[data-content-text-node]') ?? null;
    };
    const startBlock = satTextBlockFor(range.startContainer);
    const endBlock = satTextBlockFor(range.endContainer);
    config.diagnostics?.record('selection-activated', {
      rangeText: range.toString().slice(0, 200),
      rangeCollapsed: range.collapsed,
      rangeStartConnected: range.startContainer.isConnected,
      rangeEndConnected: range.endContainer.isConnected,
      rangeStartInsideRoot: !!root?.contains(range.startContainer),
      rangeEndInsideRoot: !!root?.contains(range.endContainer),
      rangeWithinSingleSatTextBlock: startBlock !== null && startBlock === endBlock,
      rangeStartSatBlockId: startBlock?.getAttribute('data-content-text-node') ?? null,
      rangeEndSatBlockId: endBlock?.getAttribute('data-content-text-node') ?? null,
      onSelectCalled: true,
    });
    try {
      config.onSelect(range, range.toString());
    } catch (error) {
      config.diagnostics?.record('onSelect:error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    if (config.clearOnSelect) currentEffects.current(active.dismiss());
    return true;
  }, [ensureSession, rootRef]);

  const onDocumentPointerDown = useCallback((event: PointerEvent) => {
    const root = rootRef.current;
    if (!root || !isAppOwnedSelectionRoot(root)) return;
    const config = live.current;
    const targetInsideRoot = event.target instanceof Node && root.contains(event.target);
    if (isSatSelectionRoot(root) && config.enabled && config.activation === 'drag') {
      config.diagnostics?.record('selection-owner', {
        ownerMarkerPresent: root.getAttribute('data-student-selection-owner') === 'app',
        pointerType: event.pointerType,
        targetInsideRoot,
        excludedTarget: config.isExcludedTarget(event.target),
      });
      return;
    }
    if (
      config.enabled
      && config.isOwnedPointer(event)
      && targetInsideRoot
      && !config.isExcludedTarget(event.target)
    ) {
      satTouchOwnership.current = true;
      root.dataset['studentSelectionOwner'] = 'app';
      config.diagnostics?.record('touch-selection-owner', { ownerMarkerPresent: true, pointerType: event.pointerType });
      return;
    }
    if (config.isOwnedPointer(event) && targetInsideRoot && config.isExcludedTarget(event.target)) {
      satTouchOwnership.current = false;
      if (root.getAttribute('data-student-selection-owner') === 'app') {
        root.removeAttribute('data-student-selection-owner');
      }
      config.diagnostics?.record('touch-selection-owner', { ownerMarkerPresent: false, pointerType: event.pointerType, excludedTarget: true });
      return;
    }
    if (!config.isOwnedPointer(event)) {
      // A mouse or pen may dismiss a resting touch selection, but the marker
      // stays effective until that Selection v2 Range actually ends (for
      // example, closing its toolbar is not an end).
      const ownedRangeStillExists = satTouchOwnership.current && ensureSession().phase() !== 'idle';
      if (!ownedRangeStillExists) {
        satTouchOwnership.current = false;
        if (root.getAttribute('data-student-selection-owner') === 'app') {
          root.removeAttribute('data-student-selection-owner');
        }
      }
      config.diagnostics?.record('touch-selection-owner', {
        ownerMarkerPresent: root.getAttribute('data-student-selection-owner') === 'app',
        pointerType: event.pointerType,
        preservedForOwnedRange: ownedRangeStillExists,
      });
    }
  }, [ensureSession, rootRef]);

  const onSatSelectStart = useCallback((event: Event) => {
    const root = rootRef.current;
    if (!root || !isSatSelectionRoot(root) || root.getAttribute('data-student-selection-owner') !== 'app') return;
    if (!(event.target instanceof Node) || !root.contains(event.target)) return;
    if (live.current.isExcludedTarget(event.target)) return;
    if (event.cancelable) event.preventDefault();
    live.current.diagnostics?.record('selectstart-suppressed', {
      ownerMarkerPresent: root.getAttribute('data-student-selection-owner') === 'app',
      defaultPrevented: event.defaultPrevented,
    });
  }, [rootRef]);

  const onSatSelectionChange = useCallback(() => {
    const root = rootRef.current;
    if (!root || !isSatSelectionRoot(root) || root.getAttribute('data-student-selection-owner') !== 'app') return;
    const nativeSelection = window.getSelection();
    if (!nativeSelection || !nativeSelectionIntersectsRoot(nativeSelection, root)) return;
    if (defaultIsExcludedTarget(nativeSelection.anchorNode) || defaultIsExcludedTarget(nativeSelection.focusNode)) return;
    const details = {
      nativeRangeCount: nativeSelection.rangeCount,
      nativeSelectionCollapsed: nativeSelection.isCollapsed,
      anchorInsideSatRoot: nativeSelection.anchorNode !== null && root.contains(nativeSelection.anchorNode),
      focusInsideSatRoot: nativeSelection.focusNode !== null && root.contains(nativeSelection.focusNode),
      nativeRangeTextLength: Array.from({ length: nativeSelection.rangeCount }, (_, index) => {
        try {
          return nativeSelection.getRangeAt(index).toString().length;
        } catch {
          return 0;
        }
      }).reduce((total, length) => total + length, 0),
      customRangeTextLength: ensureSession().range()?.toString().length ?? 0,
      ownerMarkerPresent: true,
      pointerType: lastPointer.current?.pointerType ?? null,
      userSelect: getComputedStyle(root).userSelect,
      webkitUserSelect: getComputedStyle(root).getPropertyValue('-webkit-user-select'),
      touchAction: getComputedStyle(root).touchAction,
      visualViewport: typeof window.visualViewport === 'undefined' || !window.visualViewport
        ? null
        : { width: window.visualViewport.width, height: window.visualViewport.height, scale: window.visualViewport.scale },
      visibilityState: document.visibilityState,
    };
    live.current.diagnostics?.record('native-selection-leak', details);
    nativeSelection.removeAllRanges();
    live.current.diagnostics?.record('native-selection-suppressed', details);
  }, [ensureSession, rootRef]);

  const onKeyboardSelectionStart = useCallback((event: KeyboardEvent) => {
    if (!event.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const root = rootRef.current;
    if (!root || !isAppOwnedSelectionRoot(root)) return;
    if (isSatSelectionRoot(root) && live.current.enabled && live.current.activation === 'drag') return;
    satTouchOwnership.current = false;
    if (root.getAttribute('data-student-selection-owner') === 'app') {
      root.removeAttribute('data-student-selection-owner');
    }
  }, [rootRef]);

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
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    root?.addEventListener('selectstart', onSatSelectStart, true);
    document.addEventListener('selectionchange', onSatSelectionChange);
    document.addEventListener('keydown', onKeyboardSelectionStart, true);

    return () => {
      live.current.diagnostics?.listener(null);
      root?.removeEventListener('pointerdown', handleDown);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      root?.removeEventListener('selectstart', onSatSelectStart, true);
      document.removeEventListener('selectionchange', onSatSelectionChange);
      document.removeEventListener('keydown', onKeyboardSelectionStart, true);
      detachAll();
      setPresentation(IDLE_SELECTION);
    };
  }, [detachAll, enabled, handleDown, onDocumentPointerDown, onKeyboardSelectionStart, onSatSelectStart, onSatSelectionChange, rootRef]);

  /**
   * Tell the browser, before any pointer lands, that armed SAT text belongs to
   * the app. Pointer type changes presentation, never selection ownership.
   *
   * Set for exactly the contract where a drag means "this text": an armed tool.
   * A layout effect establishes both native-selection and touch ownership before
   * contact. SAT's browser-selection guard stays active for the entire armed
   * session, including mouse and pen input.
   *
   * The long-press contract is never marked: there a drag is a scroll, and taking
   * the gesture away from the browser would break the very reading motion the mode
   * exists to preserve.
   */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || activation !== 'drag') return;

    root.dataset['studentOwnedTouchSelection'] = 'true';
    const isSatRoot = isSatSelectionRoot(root);
    if (isSatRoot) root.dataset['studentSelectionOwner'] = 'app';
    return () => {
      delete root.dataset['studentOwnedTouchSelection'];
      if (isSatRoot && root.getAttribute('data-student-selection-owner') === 'app') {
        root.removeAttribute('data-student-selection-owner');
      }
    };
  }, [activation, enabled, rootRef]);

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
    // Gated on PHYSICAL ownership, not merely on a remembered coordinate: the
    // loupe may only exist while the session holds a live pointer (see
    // `SelectionPointerState`), so a stale `lastPointer` can never stand in for
    // contact that ended, and even a phase that lingered as `adjusting-*` for
    // one render cannot keep a ghost lens on screen.
    pointer: ((session.current?.pointerId() ?? null) !== null) && lastPointer.current
      ? {
          pointerType: lastPointer.current.pointerType,
          finger: { x: lastPointer.current.x, y: lastPointer.current.y },
          caret: resolvedCaret.current,
          snapRevision: snapRevision.current,
        }
      : null,
    adjusting: presentation.phase === 'adjusting-start' || presentation.phase === 'adjusting-end',
    beginHandleAdjustment,
    activateCurrentSelection,
    dismiss,
    wouldBeginGesture,
    wouldStartOwnedSelection: wouldStartOwnedSelectionOutside,
  };
}
