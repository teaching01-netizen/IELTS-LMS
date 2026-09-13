import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type TransitionEvent as ReactTransitionEvent } from "react";
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import { satOverlayZClass } from "../primitives/satOverlayZ";
import { useSatMediaQuery } from "../useSatMediaQuery";
import {
  loadSatToolViewState,
  saveSatToolViewState,
  type SatToolViewState,
} from "../../infrastructure/satToolStateStore";
import type { SatToolKind } from "../../domain/satToolSizePolicy";
import {
  SAT_FLOATING_TOOL_CHROME,
  SAT_TOOL_GEOMETRY_MIN_H,
  SAT_TOOL_GEOMETRY_MIN_W,
  clampSatToolGeometry,
  loadSatToolGeometry,
  saveSatToolGeometry,
  type SatToolGeometry,
} from "../../infrastructure/satToolGeometryStore";
import {
  alignToSafeArea,
  dragExceeded,
  resizeGeometry,
  satToolSafeArea,
  type SatResizeEdge,
} from "./satToolPointer";
import { SatToolDiscoveryHint } from "./SatToolDiscoveryHint";

export interface SatFloatingToolProps {
  title: string;
  open: boolean;
  geometryKey: string | null;
  defaultGeometry: SatToolGeometry;
  resizable?: boolean | undefined;
  disabled?: boolean | undefined;
  /**
   * Keep one mounted tree while closed (hidden + inert + aria-hidden) so
   * open only flips visibility — never remounts. Required for the Desmos
   * prewarm contract: the same ready iframe nodes revealed on open.
   * Default unmounts on close (Reference behavior).
   */
  keepAlive?: boolean | undefined;
  /**
   * Rendered between the title and close. Must stay a single row no taller
   * than the header close target. Never rendered on the compact sheet.
   */
  headerControls?: ReactNode | undefined;
  /** Active tool gets stronger elevation (set from the last-focused tool). */
  active?: boolean | undefined;
  /** Fired on pointerdown anywhere in the window so the owner can mark it active. */
  onActivate?: (() => void) | undefined;
  /**
   * Optional content minimum. Defaults assume the per-tool size policy
   * (Calculator 400x480, Reference 360x420, otherwise the store floor)
   * until the Phase-02 size policy lands and replaces the fallback.
   */
  minSize?: { w: number; h: number } | undefined;
  /**
   * Optional content maximum. Defaults to the narrower of 620px and 48vw
   * of width by safe height until the Phase-02 size policy lands.
   */
  maxSize?: { w: number; h: number } | undefined;
  /**
   * Phase-02 view-state key for this tool's module-attempt
   * (satToolViewKey family). Carries the toolHintSeen flag. Optional so
   * existing call sites keep compiling; when absent the hint flag uses the
   * HINT_SEEN_PREFIX localStorage fallback only.
   */
  viewStateKey?: string | null | undefined;
  /**
   * Reference-only controlled collapse flag (R-01: presence + ARIA only;
   * R-03 owns the collapse state machine + motion). Undefined = expanded.
   */
  collapsed?: boolean | undefined;
  /**
   * Reference-only collapse toggle (R-01 renders the chrome; R-03 wires
   * the behavior). Calculator never passes this.
   */
  onToggleCollapse?: (() => void) | undefined;
  onClose: () => void;
  children: ReactNode;
}

const DEFAULT_W = 420;
const DEFAULT_H = 520;

/**
 * First-open hint flag per tool title. Primary source is the Phase-02
 * view-state store (toolHintSeen keyed by SatToolKind); the HINT_SEEN_PREFIX
 * localStorage entry survives only as a read/write fallback when the store
 * is unreachable (no viewStateKey or storage throws), keeping the key family
 * and boolean shape identical.
 */
const HINT_SEEN_PREFIX = "sat-tool-hint-seen:v1:";

function toolKindForTitle(title: string): SatToolKind | null {
  if (title === "Calculator") return "calculator";
  if (title === "Reference Sheet") return "reference";
  return null;
}

function readHintSeenFallback(title: string): boolean {
  try {
    return window.localStorage.getItem(HINT_SEEN_PREFIX + title) === "1";
  } catch {
    return false;
  }
}

function writeHintSeenFallback(title: string): void {
  try {
    window.localStorage.setItem(HINT_SEEN_PREFIX + title, "1");
  } catch {
    /* Hint memory must never block the exam. */
  }
}

function readHintSeen(title: string, viewStateKey: string | null): boolean {
  const kind = toolKindForTitle(title);
  if (kind && viewStateKey) {
    try {
      const stored: SatToolViewState = loadSatToolViewState(viewStateKey);
      if (stored.toolHintSeen[kind] === true) return true;
    } catch {
      /* fall through to the local fallback below */
    }
  }
  return readHintSeenFallback(title);
}

function writeHintSeen(title: string, viewStateKey: string | null): void {
  const kind = toolKindForTitle(title);
  if (kind && viewStateKey) {
    try {
      const current: SatToolViewState = loadSatToolViewState(viewStateKey);
      saveSatToolViewState(viewStateKey, {
        ...current,
        toolHintSeen: { ...current.toolHintSeen, [kind]: true },
      });
    } catch {
      /* store write failed — still persist the local fallback below */
    }
  }
  writeHintSeenFallback(title);
}

/**
 * Content minimum fallback keyed by tool until the shared size policy
 * exists. R-06 B5: Reference matches the D3 policy (480x320); the stale
 * 360x420 row only affected direct mounts (tests, debug route) — the panel
 * passes minSize explicitly so production was already right.
 */
function defaultMinSizeForTitle(title: string): { w: number; h: number } {
  if (title === "Calculator") return { w: 400, h: 480 };
  if (title === "Reference Sheet") return { w: 480, h: 320 };
  return { w: SAT_TOOL_GEOMETRY_MIN_W, h: SAT_TOOL_GEOMETRY_MIN_H };
}

/** Content maximum fallback: narrower of 620px and 48vw by safe height. */
function defaultMaxSizeForViewport(viewport: { w: number; h: number }): { w: number; h: number } {
  return {
    w: Math.max(SAT_TOOL_GEOMETRY_MIN_W, Math.min(620, Math.floor(viewport.w * 0.48))),
    h: Math.max(SAT_TOOL_GEOMETRY_MIN_H, viewport.h - 32),
  };
}

function viewportSize(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight };
}

function pointerIdMismatch(sessionId: number, event: React.PointerEvent): boolean {
  const id = event.pointerId;
  return typeof id === "number" && id !== sessionId;
}

function tryCapture(node: HTMLElement, pointerId: number): void {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    /* Pointer capture is unavailable in this host; the gesture still tracks. */
  }
}

function suppressSelection(on: boolean): void {
  try {
    if (on) document.documentElement.classList.add("sat-tool-noselect");
    else document.documentElement.classList.remove("sat-tool-noselect");
  } catch {
    /* Selection suppression must never block the exam. */
  }
}

interface DragSession {
  startX: number;
  startY: number;
  origin: SatToolGeometry;
  live: boolean;
  pointerId: number;
}

interface ResizeSession {
  edge: SatResizeEdge;
  startX: number;
  startY: number;
  origin: SatToolGeometry;
  pointerId: number;
  pending: { x: number; y: number } | null;
  frame: number | null;
  committed: boolean;
  // R-03 anchor-preserving resize (reference only): scroll anchor captured at
  // startResize. anchorRatio is null when the document is non-scrollable
  // (scrollHeight <= clientHeight) or the scroll node is missing. Pure local
  // extension field — satToolPointer.ts stays untouched.
  anchorRatio: number | null;
  anchorAbs: number;
}

/**
 * The seven pointer-only resize targets. The SE corner keeps the single
 * resize-handle node (role separator, keyboard support); these layers are
 * non-button pointer surfaces with no role and no keyboard handling.
 */
const SAT_RESIZE_EDGES: readonly SatResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "sw"];

/**
 * Shared floating-tool shell (tool-window primitive): the one chrome both
 * exam tools render through — header, quiet grip, title, optional header
 * controls, close, content viewport, corner resize grip. Draggable by header
 * (mouse + arrow keys when the grip handle is focused), resizable from the
 * corner grip when the resizable prop is set. Positions persist per
 * module-attempt for the session.
 *
 * Non-modal on every breakpoint: open tools never trap focus, so Calculator
 * and Reference coexist with the exam and with each other. Escape closes
 * the tool itself. Focus reports to the opener on close. Compact viewports
 * keep the bottom-sheet (no drag/resize by design). Blocked shells render
 * inert + dimmed with positions kept; drag/resize/keys all gate on disabled.
 *
 * Gesture handoff: every pointer/keyboard gesture runs through small named
 * handlers below that all commit through the same persist/clamp pipeline,
 * so the direct-manipulation layer can extend the gesture math without
 * touching markup, probe attributes, or CSS structure.
 *
 * Direct manipulation (Phase 07): the whole title bar drags with grab and
 * grabbing cursors behind a small movement threshold; pointer capture plus
 * selection suppression keep fast gestures alive; seven edge and corner
 * layers join the SE handle for eight-direction resize; lift is shadow plus
 * border only; release settles within a small assist radius; the first-open
 * hint teaches the gesture once per tool; local tooltips keep pointer
 * optional; Escape cancels an active drag and restores the pre-drag rect.
 */
export function SatFloatingTool(props: SatFloatingToolProps) {
  const compact = useSatMediaQuery("(max-width: 639px), (max-height: 560px)");
  // Wave A R-02 option (ii): the compact tool sheet is an explicitly
  // non-modal bottom sheet like the desktop panel — no aria-modal, no Tab
  // trap. The exclusive machine keeps owning popover modality, so at most
  // one aria-modal=true surface is ever open (single-modal rule).
  const [geometry, setGeometry] = useState<SatToolGeometry>(() => ({
    x: props.defaultGeometry.x,
    y: props.defaultGeometry.y,
    w: props.defaultGeometry.w || DEFAULT_W,
    h: props.defaultGeometry.h || DEFAULT_H,
  }));
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [enterMotion, setEnterMotion] = useState(true);
  const [hintSeen, setHintSeen] = useState(() => readHintSeen(props.title, props.viewStateKey ?? null));
  const interactive = !props.disabled;
  // R-01 reference variant (D1): single title-keyed guard matching the
  // existing helpers (toolKindForTitle, defaultMinSizeForTitle). Every R-01
  // JSX/className/style delta sits behind isReference; the Calculator path
  // stays character-identical.
  const isReference = props.title === "Reference Sheet";
  const dragRef = useRef<DragSession | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const lastCommittedRef = useRef(geometry);
  const hintSeenRef = useRef(hintSeen);
  const mountedRef = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);
  // ── R-03 window phase (Reference collapse extension) ────────────────────
  //   CLOSED    — !open (Reference unmounts; keepAlive path untouched)
  //   OPEN      — open && !dragging && !resizing && !collapsed
  //   DRAGGING  — open && dragRef.current?.live (pointer past 4px) — transient, ref-driven
  //   RESIZING  — open && resizeRef.current?.committed — transient, ref-driven
  //   COLLAPSED — open && collapsed && !compact (desktop only; compact masks it)
  // COLLAPSED composes with geometry (x/y/w retained) but never with
  // DRAGGING/RESIZING: starting a drag/resize while COLLAPSED operates on the
  // header strip only (position changes; height stays header height). Toggle
  // while DRAGGING/RESIZING is deferred until finishDrag/finishResize settles.
  // R-04: hydrate `collapsed` from the view-state store when the `collapsed`
  // field lands (persist intent via saveSatToolViewState hunk in handoff).
  // Until then local useState(false) is the source of truth.
  // TODO(R-04): init from loadSatToolViewState(viewStateKey).collapsed.
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const { onToggleCollapse: onToggleCollapseProp } = props;
  const externallyControlled = props.collapsed !== undefined || onToggleCollapseProp !== undefined;
  const collapsed = externallyControlled ? props.collapsed === true : internalCollapsed;
  // Reset self-managed collapse when the window fully closes (Reference
  // unmounts on close): a close mid-collapse must not leave a stuck
  // collapsed/collapsing class on the next fresh open. Externally controlled
  // collapse is owned by the parent and survives close by design.
  const wasOpenRef = useRef(props.open);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = props.open;
    if (wasOpen && !props.open && !externallyControlled) {
      collapsedRef.current = false;
      setInternalCollapsed(false);
    }
  }, [props.open, externallyControlled]);
  const [collapsing, setCollapsing] = useState(false);
  const collapsedRef = useRef(collapsed);
  const pendingCollapseRef = useRef(false);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const openGeometryRef = useRef<SatToolGeometry | null>(null);
  const collapsedHRef = useRef<number | null>(null);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);
  useEffect(() => {
    if (!props.open) {
      setCollapsing(false);
      pendingCollapseRef.current = false;
    }
  }, [props.open]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!props.geometryKey) return;
    const saved = loadSatToolGeometry(props.geometryKey);
    if (saved) {
      const next = clampSatToolGeometry(saved, viewportSize());
      lastCommittedRef.current = next;
      setGeometry(next);
    }
  }, [props.geometryKey]);

  // Re-arm the open motion every time the window opens (including the
  // keepAlive closed -> open flip). The class clears on animationend; where
  // that event never fires the class simply stays as the motion carrier.
  useEffect(() => {
    if (props.open) setEnterMotion(true);
  }, [props.open]);

  const persist = useCallback((next: SatToolGeometry) => {
    lastCommittedRef.current = next;
    setGeometry(next);
    if (props.geometryKey) saveSatToolGeometry(props.geometryKey, next);
  }, [props.geometryKey]);

  const markHintSeen = useCallback(() => {
    if (hintSeenRef.current) return;
    hintSeenRef.current = true;
    writeHintSeen(props.title, props.viewStateKey ?? null);
    // Synchronous hide: the first successful drag/resize flips state on the
    // live=true transition itself, never gated on animation or mount timing.
    setHintSeen(true);
  }, [props.title, props.viewStateKey]);

  const handleHintAnimationEnd = useCallback(() => {
    markHintSeen();
  }, [markHintSeen]);

  // R-03 first-placement top-right + manual-wins behavior contract (persistence
  // by R-04). Pure helper recorded here for the handoff; the panel keeps
  // owning `defaultGeometry` until R-04 relocates it.
  // function referenceFirstPlacement(
  //   viewport: { w: number; h: number },
  //   def: { w: number; h: number },
  // ): { x: number; y: number } {
  //   const safe = satToolSafeArea(viewport);
  //   return {
  //     x: Math.max(safe.x, safe.x + safe.w - def.w - 24),
  //     y: safe.y + 24,
  //   };
  // }
  // Manual-wins set-points: the two markHintSeen() gesture sites
  // (handleHeaderPointerMove live=true, commitResizePoint committed flip) are
  // R-04's hasBeenMoved/hasBeenResized set-points; once set, viewport changes
  // clamp via clampSatToolGeometry and never re-emit defaults.

  const scrollNodeForReference = useCallback((): HTMLElement | null => {
    return panelRef.current?.querySelector("[data-sat-tool-scroll]") ?? null;
  }, []);

  const measureCollapsedH = useCallback((): number => {
    const measured = headerRef.current?.getBoundingClientRect().height;
    if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
      collapsedHRef.current = measured;
      return measured;
    }
    if (typeof collapsedHRef.current === "number" && collapsedHRef.current > 0) {
      return collapsedHRef.current;
    }
    return 32; // R-01 --sat-ref-header-height fallback (measured header wins).
  }, []);

  const requestToggleCollapse = useCallback(() => {
    // Reference-only, desktop-only, enabled-only. Calculator paths never
    // reach here (no collapse chrome rendered there).
    if (compact || !interactive || !isReference) return;
    // Defer while a gesture owns the pointer: pendingCollapseRef fires after
    // finishDrag/finishResize settles (cancel-then-collapse order — Escape
    // during a deferred-pending gesture cancels the gesture first).
    if (dragRef.current || resizeRef.current) {
      pendingCollapseRef.current = !collapsedRef.current;
      return;
    }
    const next = !collapsedRef.current;
    if (next) {
      openGeometryRef.current = lastCommittedRef.current;
      measureCollapsedH();
    }
    collapsedRef.current = next;
    setCollapsing(true);
    // R-04 hunk (recorded, applied by R-04): persist { collapsed: next } to
    // the view-state store when the field lands. Never invent a new key.
    if (externallyControlled) onToggleCollapseProp?.();
    else setInternalCollapsed(next);
  }, [compact, interactive, isReference, externallyControlled, measureCollapsedH, onToggleCollapseProp]);

  const handleCollapseAnimationEnd = useCallback((event?: React.AnimationEvent) => {
    if (!mountedRef.current) return;
    // Ignore the discovery-hint lifetime animation bubbling through the body.
    const target = event?.target as HTMLElement | undefined;
    if (target && typeof target.closest === "function" && target.closest("[data-sat-tool-hint]")) return;
    setCollapsing(false);
  }, []);

  // Activation marks the window active for elevation only; z-index never moves.
  const handleWindowPointerDown = () => {
    props.onActivate?.();
  };

  const handleEnterAnimationEnd = () => {
    setEnterMotion(false);
  };

  const handleAlignTransitionEnd = (event: ReactTransitionEvent) => {
    if (event.propertyName === "left" || event.propertyName === "top") setAligning(false);
  };

  const finishDrag = useCallback((cancelled: boolean) => {
    const session = dragRef.current;
    dragRef.current = null;
    suppressSelection(false);
    setDragging(false);
    if (pendingCollapseRef.current) {
      pendingCollapseRef.current = false;
      requestToggleCollapse();
    }
    if (!session) return;
    if (cancelled) {
      if (session.live) persist(session.origin);
      return;
    }
    // Release assist: pointer drags only, on the desktop resizable branch.
    // Keyboard steps are already exact and never snap.
    if (!session.live || compact || props.resizable !== true) return;
    const committed = lastCommittedRef.current;
    const snapped = alignToSafeArea(committed, satToolSafeArea(viewportSize()));
    if (snapped.x !== committed.x || snapped.y !== committed.y) {
      setAligning(true);
      persist(snapped);
    }
  }, [compact, persist, props.resizable, requestToggleCollapse]);

  const commitResizePoint = useCallback((session: ResizeSession, point: { x: number; y: number }) => {
    const viewport = viewportSize();
    // R-03 collapsed retarget (reference only): north/south deltas adjust the
    // retained open geometry underneath; the rendered strip stays header
    // height until expand. Persisted geometry keeps the true open rect.
    const collapsedRetarget = isReference && collapsedRef.current && openGeometryRef.current !== null;
    const baseOrigin = collapsedRetarget
      ? (openGeometryRef.current as SatToolGeometry)
      : session.origin;
    const min = props.minSize ?? defaultMinSizeForTitle(props.title);
    const max = props.maxSize ?? defaultMaxSizeForViewport(viewport);
    const next = resizeGeometry(baseOrigin, session.edge, point.x - session.startX, point.y - session.startY, min, max);
    if (!session.committed) {
      session.committed = true;
      markHintSeen();
    }
    // Thread the same min/max into the committed rect: resizeGeometry pins
    // the content minimum (e.g. 400) but the legacy 2-arg clamp only floors
    // at 320, which would re-widen a west-edge stop back toward 420. The
    // min-aware pass keeps the committed width exactly at the stop.
    const pinned: SatToolGeometry = {
      x: next.x,
      y: next.y,
      w: Math.min(max.w, Math.max(min.w, next.w)),
      h: Math.min(max.h, Math.max(min.h, next.h)),
    };
    if (pinned.w === min.w && (session.edge.includes("w"))) {
      pinned.x = baseOrigin.x + baseOrigin.w - min.w;
    }
    if (pinned.h === min.h && (session.edge.includes("n"))) {
      pinned.y = baseOrigin.y + baseOrigin.h - min.h;
    }
    if (pinned.w === max.w && (session.edge.includes("w"))) {
      pinned.x = baseOrigin.x + baseOrigin.w - max.w;
    }
    if (pinned.h === max.h && (session.edge.includes("n"))) {
      pinned.y = baseOrigin.y + baseOrigin.h - max.h;
    }
    const committed = clampSatToolGeometry(pinned, viewport);
    if (collapsedRetarget) {
      // Retained open rect updates (persisted AND in geometry state); the
      // rendered strip stays header height because renderedH ignores
      // geometry.h while collapsed, so expand reveals the retargeted height.
      openGeometryRef.current = committed;
      persist(committed);
    } else {
      persist(committed);
    }
    // R-03 anchor-preserving resize (reference only, vertical edges): keep
    // the visible document anchor stable via scrollTop-ratio. Skipped while
    // collapsed (body hidden; anchor reapplied on expand), for
    // horizontal-only resizes, and when the scroll node is missing.
    if (
      isReference &&
      !collapsedRef.current &&
      (session.edge.includes("n") || session.edge.includes("s"))
    ) {
      const node = scrollNodeForReference();
      const { anchorRatio, anchorAbs } = session;
      if (node) {
        const applyAnchor = () => {
          if (!mountedRef.current || !node.isConnected) return;
          const span = node.scrollHeight - node.clientHeight;
          node.scrollTop = anchorRatio == null ? anchorAbs : Math.round(anchorRatio * Math.max(0, span));
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(applyAnchor);
        else applyAnchor();
      }
    }
  }, [isReference, markHintSeen, persist, props.maxSize, props.minSize, props.title, scrollNodeForReference]);

  const flushResizeFrame = useCallback(() => {
    const session = resizeRef.current;
    if (!session) return;
    const point = session.pending;
    session.pending = null;
    session.frame = null;
    if (!point) return;
    commitResizePoint(session, point);
  }, [commitResizePoint]);

  const finishResize = useCallback((cancelled: boolean) => {
    const session = resizeRef.current;
    resizeRef.current = null;
    const frame = session?.frame;
    if (frame !== null && frame !== undefined) {
      try {
        cancelAnimationFrame(frame);
      } catch {
        /* A missing frame host must never block the exam. */
      }
    }
    suppressSelection(false);
    setResizing(false);
    if (pendingCollapseRef.current) {
      pendingCollapseRef.current = false;
      requestToggleCollapse();
    }
    if (!session) return;
    if (cancelled) {
      if (session.committed) persist(session.origin);
      return;
    }
    // Land the final pointer position even when its frame never fired.
    if (session.pending) {
      const point = session.pending;
      session.pending = null;
      commitResizePoint(session, point);
    }
  }, [commitResizePoint, persist, requestToggleCollapse]);

  const handleHeaderPointerDown = (event: React.PointerEvent) => {
    if (compact || !interactive) return;
    if (event.isPrimary === false) return;
    if ((event.target as HTMLElement).closest("button,[role=button]")) return;
    event.preventDefault();
    props.onActivate?.();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: lastCommittedRef.current,
      live: false,
      pointerId: event.pointerId,
    };
    tryCapture(event.currentTarget as HTMLElement, event.pointerId);
    suppressSelection(true);
    // Lift applies on pointer down, before any movement: shadow plus border.
    setAligning(false);
    setDragging(true);
  };
  const handleHeaderPointerMove = (event: React.PointerEvent) => {
    const session = dragRef.current;
    // Accept move/up/cancel events matching the stored pointerId without
    // requiring implicit capture state; jsdom has no setPointerCapture and
    // tryCapture is best-effort only, so capture must never gate tracking.
    if (!session || pointerIdMismatch(session.pointerId, event)) return;
    if (!session.live) {
      if (!dragExceeded(session.startX, session.startY, event.clientX, event.clientY)) return;
      session.live = true;
      markHintSeen();
    }
    const origin = session.origin;
    persist(clampSatToolGeometry(
      {
        ...origin,
        x: origin.x + (event.clientX - session.startX),
        y: origin.y + (event.clientY - session.startY),
      },
      viewportSize(),
    ));
  };
  const handleEndDrag = (event?: React.PointerEvent) => {
    if (event && dragRef.current && pointerIdMismatch(dragRef.current.pointerId, event)) return;
    finishDrag(false);
  };
  const handleCancelDrag = (event?: React.PointerEvent) => {
    if (event && dragRef.current && pointerIdMismatch(dragRef.current.pointerId, event)) return;
    finishDrag(true);
  };

  const moveByKeyboard = (dx: number, dy: number) => {
    if (compact || !interactive) return;
    const current = lastCommittedRef.current;
    persist(clampSatToolGeometry(
      { ...current, x: current.x + dx, y: current.y + dy },
      viewportSize(),
    ));
  };

  const handleGripKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "ArrowLeft") { event.preventDefault(); moveByKeyboard(-step, 0); }
    else if (event.key === "ArrowRight") { event.preventDefault(); moveByKeyboard(step, 0); }
    else if (event.key === "ArrowUp") { event.preventDefault(); moveByKeyboard(0, -step); }
    else if (event.key === "ArrowDown") { event.preventDefault(); moveByKeyboard(0, step); }
  };

  const resizeByKeyboard = (dw: number, dh: number) => {
    if (compact || !interactive || !props.resizable) return;
    const viewport = viewportSize();
    const min = props.minSize ?? defaultMinSizeForTitle(props.title);
    const max = props.maxSize ?? defaultMaxSizeForViewport(viewport);
    const current = lastCommittedRef.current;
    persist(clampSatToolGeometry(
      {
        ...current,
        w: Math.min(max.w, Math.max(min.w, current.w + dw)),
        h: Math.min(max.h, Math.max(min.h, current.h + dh)),
      },
      viewport,
    ));
  };

  const startResize = (event: React.PointerEvent, edge: SatResizeEdge) => {
    if (compact || !interactive || !props.resizable) return;
    if (event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    props.onActivate?.();
    const nextSession: ResizeSession = {
      edge,
      startX: event.clientX,
      startY: event.clientY,
      origin: lastCommittedRef.current,
      pointerId: event.pointerId,
      pending: null,
      frame: null,
      committed: false,
      anchorRatio: null,
      anchorAbs: 0,
    };
    // R-03 anchor capture (reference only, expanded only): scrollTop-ratio
    // preserved around the persisted commit in commitResizePoint.
    if (isReference && !collapsedRef.current) {
      const node = scrollNodeForReference();
      if (node) {
        const span = node.scrollHeight - node.clientHeight;
        nextSession.anchorRatio = span > 0 ? node.scrollTop / span : null;
        nextSession.anchorAbs = node.scrollTop;
      }
    }
    resizeRef.current = nextSession;
    tryCapture(event.currentTarget as HTMLElement, event.pointerId);
    suppressSelection(true);
    setAligning(false);
    setResizing(true);
  };

  const handleResizePointerDown = (event: React.PointerEvent) => {
    startResize(event, "se");
  };
  const handleResizePointerMove = (event: React.PointerEvent) => {
    const session = resizeRef.current;
    // Same capture-independent rule as drag: match the stored pointerId;
    // setPointerCapture stays best-effort only.
    if (!session || pointerIdMismatch(session.pointerId, event)) return;
    session.pending = { x: event.clientX, y: event.clientY };
    if (session.frame !== null) return;
    if (typeof requestAnimationFrame === "function") {
      session.frame = requestAnimationFrame(flushResizeFrame);
    } else {
      flushResizeFrame();
    }
  };
  const handleEndResize = (event?: React.PointerEvent) => {
    if (event && resizeRef.current && pointerIdMismatch(resizeRef.current.pointerId, event)) return;
    finishResize(false);
  };
  const handleCancelResize = (event?: React.PointerEvent) => {
    if (event && resizeRef.current && pointerIdMismatch(resizeRef.current.pointerId, event)) return;
    finishResize(true);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "ArrowLeft") { event.preventDefault(); resizeByKeyboard(-step, 0); }
    else if (event.key === "ArrowRight") { event.preventDefault(); resizeByKeyboard(step, 0); }
    else if (event.key === "ArrowUp") { event.preventDefault(); resizeByKeyboard(0, -step); }
    else if (event.key === "ArrowDown") { event.preventDefault(); resizeByKeyboard(0, step); }
  };

  // Focus reports to the opener (TopBar tool button) when the tool closes.
  useEffect(() => {
    if (!props.open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [props.open]);

  // Non-modal sheet: Escape closes the tool itself, unless a pointer drag
  // or resize is in flight — then Escape cancels that gesture and restores
  // the pre-gesture rect instead. Tab always leaves (no trap on any
  // breakpoint, compact included). Focus stays free so exam + tools stay
  // co-usable.
  useEffect(() => {
    if (!props.open || props.disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (dragRef.current) {
        event.preventDefault();
        finishDrag(true);
        return;
      }
      if (resizeRef.current) {
        event.preventDefault();
        finishResize(true);
        return;
      }
      // ── R-03 D5 branch (documented contract change; Calculator path unchanged) ──
      if (isReference) {
        // Timed-exam safety: idle Escape on Reference is a no-op. preventDefault
        // so the keypress does not fall through to an exam-level handler.
        // (Alternative considered: stopPropagation too — rejected; the listener
        // lives on document and other non-destructive Escape consumers must
        // still observe the key. Revisit only if an exam-level Escape handler
        // proves destructive.)
        event.preventDefault();
        return;
      }
      event.preventDefault();
      props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose identity churns; key handling is the stable seam (R-03: + D5 reference branch).
  }, [props.open, props.disabled, finishDrag, finishResize, isReference]);

  // keepAlive: one mounted tree across open/close (closed renders hidden,
  // never unmounts) so prewarmed iframes keep node identity. Without it,
  // closed tools unmount as before (Reference behavior).
  if (!props.open && !props.keepAlive) return null;

  if (compact) {
    if (!props.open) {
      return (
        <div className="hidden" aria-hidden="true" inert data-sat-tool-window={props.title} data-sat-tool-presentation="compact-sheet">
          {props.children}
        </div>
      );
    }
    return (
      <div className="sat-backdrop-enter fixed inset-0 z-[83] flex items-end justify-center bg-black/20" data-sat-tool-backdrop>
        <div
          ref={panelRef}
          role="dialog"
          aria-label={props.title}
          inert={props.disabled}
          data-sat-tool-window={props.title}
          data-sat-tool-presentation="compact-sheet"
          data-sat-tool-interaction-disabled={props.disabled ? "true" : undefined}
          className="sat-ui flex max-h-[85dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[14px] border border-b-0 border-[var(--sat-divider)] bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-[0_-18px_60px_rgba(0,0,0,0.22)]"
        >
          <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-[var(--sat-divider-soft)] px-4">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{props.title}</span>
            <button type="button" onClick={props.onClose} aria-label={"Close " + props.title} data-sat-tool-close disabled={props.disabled} className="sat-touch-target grid w-11 place-items-center rounded hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{props.children}</div>
        </div>
      </div>
    );
  }

  // Legacy probe attributes (SatToolWindow-era e2e contract): the
  // accessibility spec addresses tools via data-sat-tool-window +
  // data-sat-tool-presentation (+ resizable/detent negatives). Keep them as
  // thin aliases over the floating implementation so the contract survives
  // the window-manager replacement.
  const presentation = compact ? "compact-sheet" : "floating";
  // keepAlive closed: SAME dialog node hidden — never unmounted — so
  // prewarmed iframe identity survives closed -> open. `hidden` removes it
  // from layout; inert + no dialog role keeps it out of the tab order/AT.
  const showActive = props.active === true && !props.disabled;
  const showHint = !compact && props.open && interactive && !hintSeen;
  // R-03 collapsed render: desktop Reference only; compact masks (never
  // clears) so desktop restore still sees `collapsed: true`. Calculator
  // paths are byte-identical — every branch below is isReference-gated.
  const collapsedEffective = isReference && collapsed && !compact;
  const collapsedSettled = collapsedEffective && !collapsing;
  const renderedH = collapsedEffective ? measureCollapsedH() : geometry.h;
  const collapseClass = !isReference || compact
    ? ""
    : collapsing
      ? (collapsed ? " sat-ref-collapsing" : " sat-ref-expanding")
      : (collapsed ? " sat-ref-collapsed" : "");
  return (
    <div
      ref={panelRef}
      role={props.open ? "dialog" : undefined}
      aria-label={props.title}
      aria-hidden={props.open ? undefined : true}
      hidden={props.open ? undefined : true}
      inert={props.disabled || !props.open}
      data-sat-tool-window={props.title}
      data-sat-tool-presentation={presentation}
      data-sat-tool-resizable={props.resizable && !compact ? "true" : undefined}
      data-sat-tool-interaction-disabled={props.disabled ? "true" : undefined}
      data-sat-floating-tool={props.open ? props.title : undefined}
      data-sat-tool-variant={isReference ? "reference" : undefined}
      data-dragging={dragging ? "true" : undefined}
      data-sat-resizing={resizing ? "true" : undefined}
      data-collapsed={collapsedEffective ? "true" : undefined}
      onPointerDown={handleWindowPointerDown}
      onAnimationEnd={handleEnterAnimationEnd}
      onTransitionEnd={handleAlignTransitionEnd}
      className={"sat-ui fixed " + satOverlayZClass("toolSheet") + " sat-tool-window flex flex-col overflow-hidden " + (isReference ? "rounded-none border border-[var(--sat-ref-border)] bg-white" : "rounded-[6px] border border-[var(--sat-tool-border)] bg-[var(--sat-surface)]") + " text-[var(--sat-text)] shadow-[var(--sat-shadow-floating)]" + (showActive ? " sat-tool-active" : " sat-tool-inactive") + (dragging ? " sat-tool-dragging sat-tool-window-lift" : "") + (resizing ? " sat-tool-resizing sat-tool-window-lift" : "") + (aligning ? " sat-tool-aligning" : "") + (props.open && enterMotion ? " sat-tool-enter" : "") + (props.disabled ? " opacity-70" : "") + (isReference ? " sat-tool-ref" : "") + collapseClass}
      style={{ left: geometry.x, top: geometry.y, width: geometry.w, height: renderedH }}
    >
      {isReference ? (
        <div
          ref={headerRef}
          data-sat-tool-header
          className="sat-tool-header-drag relative flex h-8 min-h-8 shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b border-[var(--sat-ref-border)] bg-[var(--sat-ref-header-bg)] ps-2 pe-1 text-[var(--sat-ref-header-fg)] active:cursor-grabbing"
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleEndDrag}
          onPointerCancel={handleCancelDrag}
        >
          <span
            role="button"
            tabIndex={props.disabled ? -1 : 0}
            aria-label={"Move " + props.title + ". Use arrow keys to move."}
            className="sat-tool-grip sat-tool-tip-anchor grid h-8 w-8 shrink-0 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            onKeyDown={handleGripKeyDown}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
            <span className="sat-tool-tip" aria-hidden="true">Move {props.title}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-start text-[12px] font-semibold leading-4">{props.title}</span>
          <span aria-hidden="true" className="sat-ref-dotgrip">
            <i /><i /><i /><i /><i /><i /><i /><i /><i />
          </span>
          {props.headerControls}
          <button type="button" onClick={requestToggleCollapse} aria-label={(collapsed ? "Expand " : "Collapse ") + props.title} aria-expanded={collapsed ? "false" : "true"} aria-controls="reference-sheet-content" data-sat-tool-collapse disabled={props.disabled} className="grid h-8 w-8 shrink-0 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50">
            <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded hover:bg-white/10">
              {collapsed ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
          </button>
          <button type="button" onClick={props.onClose} aria-label={"Close " + props.title} data-sat-tool-close disabled={props.disabled} className="grid h-8 w-8 shrink-0 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50">
            <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded hover:bg-white/10">
              <X className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        </div>
      ) : (
        <div
          data-sat-tool-header
          className="sat-tool-header-drag flex h-12 min-h-12 shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-[var(--sat-divider-soft)] pl-[14px] pr-[10px] active:cursor-grabbing"
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleEndDrag}
          onPointerCancel={handleCancelDrag}
        >
          <span
            role="button"
            tabIndex={props.disabled ? -1 : 0}
            aria-label={"Move " + props.title + ". Use arrow keys to move."}
            className="sat-tool-grip sat-tool-tip-anchor grid h-11 w-11 shrink-0 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            onKeyDown={handleGripKeyDown}
          >
            <GripVertical className="h-[18px] w-[18px] text-[var(--sat-text-secondary)]" aria-hidden="true" />
            <span className="sat-tool-tip" aria-hidden="true">Move {props.title}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{props.title}</span>
          {props.headerControls}
          <button type="button" onClick={props.onClose} aria-label={"Close " + props.title} data-sat-tool-close disabled={props.disabled} className="grid h-11 w-11 shrink-0 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50">
            <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded hover:bg-[var(--sat-surface-hover)]">
              <X className="h-5 w-5" aria-hidden="true" />
            </span>
          </button>
        </div>
      )}
      <div id={isReference ? "reference-sheet-content" : undefined} hidden={collapsedSettled ? true : undefined} onAnimationEnd={isReference ? handleCollapseAnimationEnd : undefined} className={"relative min-h-0 flex-1 overflow-hidden" + (isReference && !compact ? " sat-ref-collapsible sat-ref-fade sat-ref-clip" : "")}>
        {props.children}
        {showHint ? <SatToolDiscoveryHint onAnimationEnd={handleHintAnimationEnd} /> : null}
      </div>
      {props.resizable && !compact ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- separator is the ARIA resize-handle role; keyboard support is provided via tabIndex + Arrow keys (Wave B R-09).
        <div
          role="separator"
          tabIndex={props.disabled ? -1 : 0}
          aria-label={"Resize " + props.title + ". Use arrow keys to resize."}
          data-sat-resize-handle="se"
          className="sat-tool-tip-anchor absolute bottom-0 right-0 grid h-11 w-11 cursor-nwse-resize touch-none select-none place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleEndResize}
          onPointerCancel={handleCancelResize}
          onKeyDown={handleResizeKeyDown}
        >
          <span aria-hidden="true" className="grid h-8 w-8 place-items-center text-[var(--sat-text-secondary)]">
            <svg className="sat-tool-resize-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2 10 L10 2 M5.5 10 L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </span>
          <span className="sat-tool-tip" aria-hidden="true">Resize {props.title}</span>
        </div>
      ) : null}
      {props.resizable && !compact ? SAT_RESIZE_EDGES.map((edge) => (
        <div
          key={edge}
          data-sat-resize-edge={edge}
          aria-hidden="true"
          tabIndex={-1}
          className={"sat-tool-resize-edge sat-tool-resize-edge-" + edge}
          onPointerDown={(event) => startResize(event, edge)}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleEndResize}
          onPointerCancel={handleCancelResize}
        />
      )) : null}
    </div>
  );
}

export { SAT_FLOATING_TOOL_CHROME };
