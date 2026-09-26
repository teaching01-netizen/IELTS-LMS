import { useEffect, useRef, type RefObject } from "react";
import { SelectionFloatingLayer } from "./SelectionFloatingLayer";
import { SelectionHighlight } from "./SelectionHighlight";
import { SelectionHandle } from "./SelectionHandle";
import { SelectionLoupe } from "./SelectionLoupe";
import type { SelectionPresentation, SelectionPointerState } from "../domain/selectionTypes";
import { selectionMovesEndpoint } from "../domain/selectionTypes";
import { selectionContainsPoint } from "../engine/selectionGeometry";
import type { SelectionHandlePointerEvent } from "./useStudentSelectionGesture";
import "../styles/selection.css";

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
 * IT ALSO OWNS PRESS DISPATCH, because "what did this finger mean" is intent,
 * and a press that lands on a selection must be resolved in capture, before any
 * part of the page can act on it. One physical pointerdown may hold exactly ONE
 * intent:
 *
 *   action menu → a command, passed through untouched
 *   handle      → a drag may BEGIN only inside an ENDPOINT's outward zone, and
 *                 only the SESSION may say which endpoint that is — the press is
 *                 REPORTED (`beginHandleAdjustment`) and this layer acts on the
 *                 answer; a press that acquires neither endpoint is the
 *                 selection's own body
 *   body        → the selected text is a no-drag zone: preserved and consumed,
 *                 never dismissed, never reaching the prose's own pointerdown
 *   outside     → dismissed in this same capture pass; consumed exactly when
 *                 an owned gesture or product's native-selection path would
 *                 otherwise start — one press, one intent; controls keep theirs
 *
 * Without the middle row, a short selection's two 44px endpoint boxes overlap
 * over the highlighted text and a press in the MIDDLE grabs an endpoint; without
 * the body row it reaches the prose and the same press dismisses the old
 * selection AND starts a new one. Both are the same violation: two intents in
 * one pointerdown.
 *
 * WHICH endpoint a press grabs is deliberately NOT decided here. It used to be —
 * this layer resolved it to know what to consume, and the gesture's entry had to
 * resolve it again to know what to move, so one press was arbitrated twice from
 * two snapshots of the paint. The layer that reports a press does not have to own
 * the rule; the session that owns the selection measures the paint the handles
 * were drawn from and answers once. What this layer still owns is the OTHER half —
 * whether the press belongs to the selection at all, which is what it consumes.
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
  /**
   * Report a press on a resting selection. Returns whether a handle drag began:
   * the endpoint is the session's decision, over both endpoints' measured
   * geometry, so a caller reports the press and reads the verdict — it neither
   * names an edge nor guesses whether one was acquired.
   */
  beginHandleAdjustment: (event: SelectionHandlePointerEvent) => boolean;
  /** Re-report the current session range when its resting body is tapped. */
  activateCurrentSelection: () => boolean;
  dismiss: () => void;
  /**
   * Whether this press would reach the gesture's own pointerdown — the same
   * guards, answered by the one place that owns them (`wouldBeginGesture` on
   * the hook's return). The outside branch asks it so one pointerdown can
   * dismiss the selection AND be consumed when it would otherwise begin the
   * next owned gesture. The separate owned-selection predicate covers another
   * text root in the same product scope; controls keep their press in either case.
   */
  wouldBeginGesture: (event: Event) => boolean;
  /** Keep an action control's press from also beginning a new selection gesture. */
  ignoreGesturePress: (event: Event) => void;
  /** Whether this outside press would start owned selection in another root. */
  wouldStartOwnedSelection: (event: Event) => boolean;
}

/**
 * One press, as the gesture's entry takes it: where the finger landed, and the
 * control the browser delivered it to. Nothing about what it MEANS.
 *
 * `currentTarget` is one of the two controls whenever the press landed on one —
 * that is where the browser delivers the moves, and on a platform that ignores
 * pointer capture (a synthetic pointer, a renderer without the API) the only
 * element they can arrive at. Otherwise it is null and the drag falls back to the
 * gesture's own root: the prose underneath is re-rendered as the selection
 * changes and would take its listeners with it, so it may never be the element a
 * drag holds.
 */
function pressOn(event: Event, pressed: Element | null): SelectionHandlePointerEvent {
  const pointer = event as PointerEvent;
  return {
    pointerId: pointer.pointerId,
    pointerType: pointer.pointerType,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    currentTarget: pressed,
    preventDefault: () => {
      if (event.cancelable) event.preventDefault();
    },
  };
}

const ACTION_TARGET_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
].join(",");

function isActionTarget(target: EventTarget | null): boolean {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest(ACTION_TARGET_SELECTOR) != null;
}

export interface SelectionOverlayProps {
  selection: SelectionOverlaySelection;
  /** Scale for visible chrome in a product-owned visual space; measured rects stay viewport-based. */
  visualScale?: number | undefined;
  /** Physical-viewport portal root, when the product owns one. */
  portalContainer?: HTMLElement | null | undefined;
  /** Accessible names for the two handle controls. */
  handleLabels?: { start: string; end: string } | undefined;
  /** Shown while a hold is claiming text or a handle is moving. */
  loupe?: { sourceRef: RefObject<HTMLElement | null>; enabled?: boolean | undefined } | undefined;
  /** Called when the visual range itself ends. */
  onSelectionCleared?: (() => void) | undefined;
  /** Return true after dismissing contextual tools to keep the range for one Escape. */
  onEscape?: (() => boolean) | undefined;
}

export function SelectionOverlay({
  selection,
  visualScale = 1,
  portalContainer,
  handleLabels = { start: "Adjust selection start", end: "Adjust selection end" },
  loupe,
  onSelectionCleared,
  onEscape,
}: SelectionOverlayProps) {
  const visible = selection.phase !== "idle" && selection.selectionText.length > 0;
  // The finger comes from the selection itself: it is the engine that follows it,
  // and a second place to pass a position would be a second thing to keep in step.
  const pointer = selection.pointer;
  // How far the caret has travelled through text positions, for the two
  // precision indicators that answer a change with a tick. Read off the pointer
  // because the caret is: one owner, one fact.
  const snapRevision = pointer?.snapRevision ?? 0;
  const loupeOpen =
    visible &&
    loupe !== undefined &&
    loupe.enabled !== false &&
    pointer !== null &&
    pointer.pointerType === "touch" &&
    selectionMovesEndpoint(selection.phase);

  const dismissRef = useRef(selection.dismiss);
  dismissRef.current = selection.dismiss;
  const clearSelectionRef = useRef(onSelectionCleared);
  clearSelectionRef.current = onSelectionCleared;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  // The current paint, read live by the listeners below: rects and handles are
  // re-measured every frame, and a listener bound once must not judge today's
  // press against yesterday's phase or lines.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.shiftKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
      ) {
        // Hand keyboard text selection back to the browser as its own path. The
        // gesture adapter removes touch ownership in capture; clearing this
        // resting visual range here also keeps its toolbar anchor in sync.
        dismissRef.current();
        clearSelectionRef.current?.();
        return;
      }
      // Escape belongs to this surface, not to a menu: one key, one meaning, and
      // it is the same key that dismisses a system selection menu.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (onEscapeRef.current?.() === true) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current();
      clearSelectionRef.current?.();
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
      if (target instanceof Element && target.closest("[data-selection-action-menu]")) return;
      const { clientX, clientY } = event as PointerEvent;
      const current = selectionRef.current;
      // Whether the press belongs to this selection is asked only while the
      // selection is RESTING — a press while a gesture is running is the
      // outside branch's, and a grab outside `selected` is refused by the
      // session anyway. A second finger during a live gesture therefore falls
      // to that branch, which ends the gesture with the same effects the
      // prose's own pointerdown used to produce — while consuming the press, so
      // it cannot double as anything.
      const resting = current.phase === "selected";
      // The selection's OWN chrome — its two endpoint controls — is never
      // "outside" it, gesture or no gesture: a second finger brushing a handle
      // mid-gesture changes nothing, where the same finger on the prose hands the
      // gesture back (below).
      const pressed =
        target instanceof Element ? target.closest("[data-student-selection-handle]") : null;
      const onOwnChrome = pressed !== null;
      if (onOwnChrome && !resting) return;
      if (resting) {
        const onSelectionBody = selectionContainsPoint(current.rects, clientX, clientY);
        // Text itself is a no-drag zone. In particular, a body tap after the
        // contextual tools were dismissed reactivates the owned Range without
        // asking handle acquisition to reinterpret that press.
        if (onSelectionBody && !onOwnChrome) {
          current.activateCurrentSelection();
          consume(event);
          return;
        }
        // The press is REPORTED, with its coordinates and the control it landed
        // on, and the answer is what this pass acts on — the session decides which
        // endpoint it grabs (one decision, one owner: two 44px boxes overlap on
        // any selection narrower than they are, and the one on top is decided by
        // render order, so a press inside the START's outward zone can be
        // delivered to the END control). A press that began a drag is consumed
        // here for the same reason every decided press is: one press, one intent,
        // and nothing below may act on it.
        const grabbed = current.beginHandleAdjustment(pressOn(event, pressed));
        // A drag that BEGAN is this press's whole meaning, and it is consumed for
        // the same reason every decided press is: one press, one intent, and
        // nothing below may act on it. A refusal lands here too when the press was
        // the selection's own CHROME or its painted BODY: the selected text is a
        // no-drag zone — preserve it, open nothing, move nothing — and let this
        // pointerdown END here rather than both dismissing the old selection and
        // starting a new one. A control's 44px box is larger than the zone that
        // may BEGIN a drag, so the rest of that box is body too.
        if (grabbed || onOwnChrome || onSelectionBody) {
          if (!grabbed && onSelectionBody) current.activateCurrentSelection();
          consume(event);
          return;
        }
      }
      // Outside: dismiss HERE, in capture — the literal rule (one press, one
      // intent): this same physical press ends the old selection, and when the
      // gesture's own pointerdown would otherwise see it, it is consumed so it
      // can never also be the beginning of a new one (the prose would
      // otherwise find `idle` and open a hidden `selected → idle → pending`).
      // Presses the gesture would never handle — the product's toolbar, an
      // answer field, or a mark's edit control — are dismissed but NOT
      // consumed: controls own the tap, even when their surface also allows a
      // drag to begin there. Menu and handle presses resolved above.
      dismissRef.current();
      clearSelectionRef.current?.();
      if (isActionTarget(target)) {
        current.ignoreGesturePress(event);
      } else if (current.wouldBeginGesture(event) || current.wouldStartOwnedSelection(event)) {
        consume(event);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <SelectionFloatingLayer open label="Selection" portalContainer={portalContainer}>
      <SelectionHighlight rects={selection.rects} />

      {selection.startHandle ? (
        <SelectionHandle
          handle={selection.startHandle}
          label={handleLabels.start}
          // Only the endpoint actually under the finger is "held", so the other
          // one stays settled instead of swelling along with it.
          held={selection.adjusting && selection.phase === "adjusting-start"}
          snapRevision={snapRevision}
          visualScale={visualScale}
        />
      ) : null}
      {selection.endHandle ? (
        <SelectionHandle
          handle={selection.endHandle}
          label={handleLabels.end}
          held={selection.adjusting && selection.phase === "adjusting-end"}
          snapRevision={snapRevision}
          visualScale={visualScale}
        />
      ) : null}

      {loupeOpen && loupe && pointer ? (
        <SelectionLoupe
          open
          fingerPoint={pointer.finger}
          caretPoint={pointer.caret}
          snapRevision={snapRevision}
          sourceRef={loupe.sourceRef}
          visualScale={visualScale}
        />
      ) : null}
    </SelectionFloatingLayer>
  );
}
