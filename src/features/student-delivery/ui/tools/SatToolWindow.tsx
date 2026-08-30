import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { GripHorizontal, Maximize2, Minimize2, Minus, X } from "lucide-react";
import { animate, useReducedMotion } from "motion/react";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { satMotion } from "../motion/satMotion";

interface Point {
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}
interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type CompactDetent = "medium" | "large" | "full";

export interface SatToolWindowProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  collapsible?: boolean;
  keepMountedOnClose?: boolean;
  prewarmWhenClosed?: boolean;
  interactionDisabled?: boolean;
}

const DESKTOP_WIDTH = 720;
const DESKTOP_HEIGHT = 620;
const MIN_FLOATING_WIDTH = 480;
const MIN_FLOATING_HEIGHT = 360;
const EDGE_GAP = 16;
// Keep the Bluebook-like floating utility on regular-width iPads. Compact
// presentation is based on available geometry, never pointer type alone.
const COMPACT_TOOL_QUERY = "(max-width: 639px), (max-height: 560px)";
const SHORT_TOOL_QUERY = "(max-height: 560px)";
const COMPACT_MEDIUM_RATIO = 0.55;
const COMPACT_LARGE_RATIO = 0.76;
const COMPACT_MIN_HEIGHT = 360;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function capturePointer(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    /* Synthetic events can lack an active pointer. */
  }
}

function releasePointer(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture?.(pointerId);
  } catch {
    /* The pointer may already be released by the browser. */
  }
}

function cssPixels(name: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeInsets(): Insets {
  return {
    top: cssPixels("--student-safe-top"),
    right: cssPixels("--student-safe-right"),
    bottom: cssPixels("--student-safe-bottom"),
    left: cssPixels("--student-safe-left"),
  };
}

function floatingBounds() {
  const safe = safeInsets();
  return {
    left: safe.left + EDGE_GAP,
    top: safe.top + EDGE_GAP,
    right: window.innerWidth - safe.right - EDGE_GAP,
    bottom: window.innerHeight - safe.bottom - EDGE_GAP,
  };
}

function defaultSize(): Size {
  const bounds = floatingBounds();
  return {
    width: Math.min(DESKTOP_WIDTH, Math.max(MIN_FLOATING_WIDTH, bounds.right - bounds.left)),
    height: Math.min(DESKTOP_HEIGHT, Math.max(MIN_FLOATING_HEIGHT, bounds.bottom - bounds.top)),
  };
}

function defaultPosition(size: Size): Point {
  const bounds = floatingBounds();
  return {
    x: Math.max(bounds.left, bounds.right - size.width - 12),
    y: Math.max(bounds.top, Math.min(bounds.top + 68, bounds.bottom - size.height)),
  };
}

function compactAvailableHeight(): number {
  const safe = safeInsets();
  return Math.max(0, window.innerHeight - safe.top - safe.bottom);
}

function compactHeightForAvailable(
  detent: Exclude<CompactDetent, "full">,
  available: number
): number {
  const ratio = detent === "medium" ? COMPACT_MEDIUM_RATIO : COMPACT_LARGE_RATIO;
  const preferred = Math.round(available * ratio);
  return Math.min(available, Math.max(Math.min(COMPACT_MIN_HEIGHT, available), preferred));
}

function compactHeightFor(detent: Exclude<CompactDetent, "full">): number {
  return compactHeightForAvailable(detent, compactAvailableHeight());
}

function nearestCompactDetentForHeight(
  height: number,
  available: number
): Exclude<CompactDetent, "full"> {
  const medium = compactHeightForAvailable("medium", available);
  const large = compactHeightForAvailable("large", available);
  return Math.abs(height - medium) <= Math.abs(height - large) ? "medium" : "large";
}

export function resolveCompactDetentIntent({
  height,
  velocity,
  available,
  cancelled,
}: {
  height: number;
  velocity: number;
  available: number;
  cancelled: boolean;
}): CompactDetent {
  const minimum = compactHeightForAvailable("medium", available);
  const projected = clamp(height + (cancelled ? 0 : velocity * 0.12), minimum, available);
  if (!cancelled && projected >= available * 0.9) return "full";
  return nearestCompactDetentForHeight(projected, available);
}

const resizeCursor: Record<ResizeDirection, string> = {
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  nw: "nwse-resize",
};

export function SatToolWindow({
  title,
  open,
  onClose,
  children,
  collapsible = false,
  keepMountedOnClose = false,
  prewarmWhenClosed = false,
  interactionDisabled = false,
}: SatToolWindowProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const compactAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
  const compactHeightRef = useRef(compactHeightFor("large"));
  const reduceMotion = useReducedMotion();
  const compact = useSatMediaQuery(COMPACT_TOOL_QUERY);
  const shortViewport = useSatMediaQuery(SHORT_TOOL_QUERY);
  const [size, setSize] = useState<Size>(() => defaultSize());
  const [position, setPosition] = useState<Point>(() => defaultPosition(defaultSize()));
  const [collapsed, setCollapsed] = useState(false);
  const [compactDetent, setCompactDetent] = useState<CompactDetent>("large");
  const [compactHeight, setCompactHeight] = useState(() => compactHeightRef.current);
  const [hasOpened, setHasOpened] = useState(open);

  const setCompactHeightNow = useCallback((height: number) => {
    compactHeightRef.current = height;
    setCompactHeight(height);
  }, []);

  const stopCompactAnimation = useCallback(() => {
    compactAnimationRef.current?.stop();
    compactAnimationRef.current = null;
  }, []);

  const settleCompactHeight = useCallback(
    (target: number, velocity = 0, onComplete?: () => void) => {
      stopCompactAnimation();
      if (reduceMotion) {
        setCompactHeightNow(target);
        onComplete?.();
        return;
      }
      compactAnimationRef.current = animate(compactHeightRef.current, target, {
        ...satMotion.detent,
        velocity,
        onUpdate: setCompactHeightNow,
        onComplete: () => {
          compactAnimationRef.current = null;
          setCompactHeightNow(target);
          onComplete?.();
        },
      });
    },
    [reduceMotion, setCompactHeightNow, stopCompactAnimation]
  );

  useEffect(() => {
    if (open) setHasOpened(true);
    else setCollapsed(false);
  }, [open]);

  useEffect(() => {
    if (!compact || !open) return;
    const syncCompactGeometry = () => {
      if (shortViewport) {
        stopCompactAnimation();
        setCompactDetent("full");
        return;
      }
      setCompactDetent((current) => {
        const next = current === "full" ? "large" : current;
        stopCompactAnimation();
        setCompactHeightNow(compactHeightFor(next));
        return next;
      });
    };
    syncCompactGeometry();
    window.addEventListener("resize", syncCompactGeometry);
    return () => window.removeEventListener("resize", syncCompactGeometry);
  }, [compact, open, setCompactHeightNow, shortViewport, stopCompactAnimation]);

  const keepInViewport = useCallback((next: Point, currentSize: Size) => {
    const bounds = floatingBounds();
    const maxX = Math.max(bounds.left, bounds.right - currentSize.width);
    const maxY = Math.max(bounds.top, bounds.bottom - currentSize.height);
    return { x: clamp(next.x, bounds.left, maxX), y: clamp(next.y, bounds.top, maxY) };
  }, []);

  const fitSizeToViewport = useCallback((next: Size): Size => {
    const bounds = floatingBounds();
    const availableWidth = Math.max(MIN_FLOATING_WIDTH, bounds.right - bounds.left);
    const availableHeight = Math.max(MIN_FLOATING_HEIGHT, bounds.bottom - bounds.top);
    return {
      width: clamp(next.width, MIN_FLOATING_WIDTH, availableWidth),
      height: clamp(next.height, MIN_FLOATING_HEIGHT, availableHeight),
    };
  }, []);

  useEffect(() => {
    if (!open || compact || collapsed) return;
    const onViewportResize = () => {
      setSize((currentSize) => {
        const fitted = fitSizeToViewport(currentSize);
        setPosition((currentPosition) => keepInViewport(currentPosition, fitted));
        return fitted;
      });
    };
    onViewportResize();
    window.addEventListener("resize", onViewportResize);
    return () => window.removeEventListener("resize", onViewportResize);
  }, [collapsed, compact, fitSizeToViewport, keepInViewport, open]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || interactionDisabled) return;
    const focusCloseButton = window.requestAnimationFrame(() => {
      if (compact) panelRef.current?.querySelector<HTMLElement>("[data-sat-tool-close]")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
        return;
      }
      if (!compact || event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), iframe:not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ].filter(
        (element) => element.getClientRects().length > 0 || element === document.activeElement
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusCloseButton);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [compact, interactionDisabled, onClose, open]);

  useEffect(
    () => () => {
      pointerCleanupRef.current?.();
      stopCompactAnimation();
    },
    [stopCompactAnimation]
  );

  useEffect(() => {
    if (!interactionDisabled) return;
    pointerCleanupRef.current?.();
    stopCompactAnimation();
  }, [interactionDisabled, stopCompactAnimation]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (compact || interactionDisabled || event.button !== 0) return;
    event.preventDefault();
    pointerCleanupRef.current?.();
    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    capturePointer(captureTarget, pointerId);
    const start = { x: event.clientX, y: event.clientY };
    const origin = position;
    const onMove = (moveEvent: PointerEvent) => {
      setPosition(
        keepInViewport(
          {
            x: origin.x + moveEvent.clientX - start.x,
            y: origin.y + moveEvent.clientY - start.y,
          },
          size
        )
      );
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      releasePointer(captureTarget, pointerId);
      pointerCleanupRef.current = null;
    };
    pointerCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup, { once: true });
    window.addEventListener("pointercancel", cleanup, { once: true });
  };

  const beginResize = (direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) => {
    if (compact || collapsed || interactionDisabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pointerCleanupRef.current?.();

    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    capturePointer(captureTarget, pointerId);
    const start = { x: event.clientX, y: event.clientY };
    const originPosition = position;
    const originSize = size;
    const originRight = originPosition.x + originSize.width;
    const originBottom = originPosition.y + originSize.height;
    const bounds = floatingBounds();
    const body = document.body;
    const previousCursor = body.style.cursor;
    const previousUserSelect = body.style.userSelect;
    body.style.cursor = resizeCursor[direction];
    body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      let left = originPosition.x;
      let right = originRight;
      let top = originPosition.y;
      let bottom = originBottom;

      if (direction.includes("w"))
        left = clamp(originPosition.x + dx, bounds.left, originRight - MIN_FLOATING_WIDTH);
      if (direction.includes("e"))
        right = clamp(originRight + dx, originPosition.x + MIN_FLOATING_WIDTH, bounds.right);
      if (direction.includes("n"))
        top = clamp(originPosition.y + dy, bounds.top, originBottom - MIN_FLOATING_HEIGHT);
      if (direction.includes("s"))
        bottom = clamp(originBottom + dy, originPosition.y + MIN_FLOATING_HEIGHT, bounds.bottom);

      setPosition({ x: left, y: top });
      setSize({ width: right - left, height: bottom - top });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      releasePointer(captureTarget, pointerId);
      body.style.cursor = previousCursor;
      body.style.userSelect = previousUserSelect;
      pointerCleanupRef.current = null;
    };
    pointerCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup, { once: true });
    window.addEventListener("pointercancel", cleanup, { once: true });
  };

  const beginCompactResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!compact || shortViewport || collapsed || interactionDisabled || event.button !== 0) return;
    event.preventDefault();
    pointerCleanupRef.current?.();
    stopCompactAnimation();

    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    capturePointer(captureTarget, pointerId);
    const available = compactAvailableHeight();
    const originHeight = compactDetent === "full" ? available : compactHeightRef.current;
    const minimum = compactHeightFor("medium");
    const startY = event.clientY;
    let latestHeight = originHeight;
    let releaseVelocity = 0;
    let lastY = event.clientY;
    let lastTime = event.timeStamp || performance.now();
    setCompactHeightNow(originHeight);
    setCompactDetent("large");

    const onMove = (moveEvent: PointerEvent) => {
      latestHeight = clamp(originHeight + startY - moveEvent.clientY, minimum, available);
      setCompactHeightNow(latestHeight);
      const now = moveEvent.timeStamp || performance.now();
      const elapsed = Math.max(1, now - lastTime);
      const sampleVelocity = (-(moveEvent.clientY - lastY) / elapsed) * 1000;
      releaseVelocity = releaseVelocity * 0.65 + sampleVelocity * 0.35;
      lastY = moveEvent.clientY;
      lastTime = now;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      releasePointer(captureTarget, pointerId);
      pointerCleanupRef.current = null;
    };
    const settle = (cancelled: boolean) => {
      cleanup();
      const next = resolveCompactDetentIntent({
        height: latestHeight,
        velocity: releaseVelocity,
        available,
        cancelled,
      });
      if (next === "full") {
        setCompactDetent("large");
        settleCompactHeight(available, releaseVelocity, () => setCompactDetent("full"));
        return;
      }
      setCompactDetent(next);
      settleCompactHeight(
        compactHeightForAvailable(next, available),
        cancelled ? 0 : releaseVelocity
      );
    };
    const onPointerUp = () => settle(false);
    const onPointerCancel = () => settle(true);
    pointerCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerCancel, { once: true });
  };

  const toggleCompactExpansion = () => {
    if (interactionDisabled) return;
    setCollapsed(false);
    const available = compactAvailableHeight();
    if (compactDetent === "full" && !shortViewport) {
      setCompactHeightNow(available);
      setCompactDetent("large");
      settleCompactHeight(compactHeightFor("large"));
      return;
    }
    if (shortViewport) {
      setCompactDetent("full");
      return;
    }
    setCompactDetent("large");
    settleCompactHeight(available, 0, () => setCompactDetent("full"));
  };

  if (!open && (!keepMountedOnClose || (!hasOpened && !prewarmWhenClosed))) return null;

  const compactFullscreen = compact && (shortViewport || compactDetent === "full");
  const expandedClass = compact
    ? compactFullscreen
      ? "fixed left-[var(--student-safe-left)] right-[var(--student-safe-right)] top-[var(--student-safe-top)] bottom-[var(--student-safe-bottom)]"
      : "fixed left-[var(--student-safe-left)] right-[var(--student-safe-right)] bottom-[var(--student-safe-bottom)]"
    : "fixed";
  const collapsedClass = compact
    ? "fixed left-[var(--student-safe-left)] right-[var(--student-safe-right)] bottom-[var(--student-safe-bottom)] min-h-14"
    : "fixed min-h-14";
  const floatingStyle = compact
    ? collapsed || compactFullscreen
      ? undefined
      : { height: compactHeight }
    : {
        left: position.x,
        top: position.y,
        width: size.width,
        ...(collapsed ? {} : { height: size.height }),
      };
  const presentation = compact
    ? compactFullscreen
      ? "compact-fullscreen"
      : "compact-sheet"
    : "floating";

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={compact && !collapsed ? true : undefined}
      aria-label={title}
      tabIndex={-1}
      inert={interactionDisabled ? true : undefined}
      data-sat-tool-window
      data-sat-tool-interaction-disabled={interactionDisabled ? true : undefined}
      data-sat-tool-presentation={presentation}
      data-sat-tool-detent={compact ? (compactFullscreen ? "full" : compactDetent) : undefined}
      data-sat-tool-resizable={!collapsed && (!compact || !shortViewport) ? true : undefined}
      className={`sat-ui ${open ? "sat-tool-surface-enter" : ""} ${collapsed ? collapsedClass : expandedClass} z-[70] flex min-h-0 flex-col overflow-hidden border border-[var(--sat-divider)] bg-[var(--sat-surface)] shadow-[0_20px_55px_rgba(0,0,0,0.24)] ${compact && !compactFullscreen && !collapsed ? "rounded-t-[12px]" : "rounded-[8px]"}`}
      style={floatingStyle}
    >
      <div className="relative z-30 flex min-h-14 shrink-0 items-center gap-1 bg-[var(--sat-tool-chrome)] px-2 text-[var(--sat-tool-text)]">
        {!collapsed && (!compact || !shortViewport) ? (
          <div
            aria-hidden="true"
            data-sat-titlebar-resize-handle
            data-sat-compact-resize-handle={compact ? true : undefined}
            onPointerDown={(event) =>
              compact ? beginCompactResize(event) : beginResize("n", event)
            }
            className="sat-touch-target sat-tool-pressable grid shrink-0 touch-none place-items-center rounded-[6px] cursor-ns-resize hover:bg-[var(--sat-tool-hover)]"
          >
            <GripHorizontal className="h-5 w-5 text-[var(--sat-tool-text)]/75" aria-hidden="true" />
          </div>
        ) : null}
        <div
          data-sat-titlebar-move-handle={!compact ? true : undefined}
          onPointerDown={!compact ? beginDrag : undefined}
          className={`flex min-h-11 min-w-0 flex-1 touch-none items-center px-1 ${compact ? "" : "cursor-grab active:cursor-grabbing"}`}
        >
          <h2 className="sat-type-control-secondary truncate font-semibold">{title}</h2>
        </div>
        {compact ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleCompactExpansion}
            disabled={interactionDisabled || (shortViewport && compactFullscreen)}
            className="sat-touch-target sat-tool-pressable grid place-items-center rounded-[6px] text-[var(--sat-tool-text)] hover:bg-[var(--sat-tool-hover)] disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-tool-text)]"
            aria-label={
              compactFullscreen ? `Restore ${title} size` : `Expand ${title} to full screen`
            }
          >
            {compactFullscreen ? (
              <Minimize2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        ) : null}
        {collapsible ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (!interactionDisabled) setCollapsed((value) => !value);
            }}
            disabled={interactionDisabled}
            className="sat-touch-target sat-tool-pressable inline-flex items-center gap-1.5 rounded-[6px] px-2 sat-type-control-secondary font-semibold text-[var(--sat-tool-text)] hover:bg-[var(--sat-tool-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-tool-text)]"
            aria-label={collapsed ? `Restore ${title}` : `Collapse ${title}`}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{collapsed ? "Restore" : "Collapse"}</span>
          </button>
        ) : null}
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          disabled={interactionDisabled}
          data-sat-tool-close
          className="sat-touch-target sat-tool-pressable grid place-items-center rounded-[6px] text-[var(--sat-tool-text)] hover:bg-[var(--sat-tool-hover)] disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-tool-text)]"
          aria-label={`Close ${title}`}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {!collapsed ? <div className="min-h-0 flex-1">{children}</div> : null}
      {!compact && !collapsed ? <ResizeHandles onResizeStart={beginResize} /> : null}
    </div>
  );

  if (keepMountedOnClose) {
    const closedPrewarm = !open && prewarmWhenClosed;
    return (
      <div
        hidden={!open && !closedPrewarm}
        aria-hidden={!open ? true : undefined}
        inert={!open ? true : undefined}
        className={
          closedPrewarm
            ? "fixed inset-0 invisible pointer-events-none"
            : compact && !collapsed
              ? "sat-backdrop-enter fixed inset-0 z-[69] bg-black/20"
              : undefined
        }
        data-sat-tool-prewarmed={closedPrewarm ? true : undefined}
        data-sat-tool-backdrop={open && compact && !collapsed ? true : undefined}
      >
        {panel}
      </div>
    );
  }

  return compact && !collapsed ? (
    <div className="sat-backdrop-enter fixed inset-0 z-[69] bg-black/20" data-sat-tool-backdrop>
      {panel}
    </div>
  ) : (
    panel
  );
}

function ResizeHandles({
  onResizeStart,
}: {
  onResizeStart: (direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const handle = (direction: ResizeDirection, className: string) => (
    <div
      key={direction}
      aria-hidden="true"
      data-sat-resize-handle={direction}
      onPointerDown={(event) => onResizeStart(direction, event)}
      className={`absolute z-20 touch-none ${className}`}
    />
  );

  return (
    <>
      {handle("n", "top-0 left-11 right-11 h-4 cursor-ns-resize")}
      {handle("e", "right-0 bottom-11 top-11 w-4 cursor-ew-resize")}
      {handle("s", "bottom-0 left-11 right-11 h-4 cursor-ns-resize")}
      {handle("w", "left-0 bottom-11 top-11 w-4 cursor-ew-resize")}
      {handle("ne", "right-0 top-0 h-11 w-11 cursor-nesw-resize")}
      {handle("se", "bottom-0 right-0 h-11 w-11 cursor-nwse-resize")}
      {handle("sw", "bottom-0 left-0 h-11 w-11 cursor-nesw-resize")}
      {handle("nw", "left-0 top-0 h-11 w-11 cursor-nwse-resize")}
    </>
  );
}
