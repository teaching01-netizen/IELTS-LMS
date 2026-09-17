/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the pane is a 2D pannable surface, not a control: it is focusable only to give the pointer's pan a keyboard equivalent (arrow keys), it is labelled with the figure it shows, and every change of scale stays on the named controls in the strip above. */
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acquireBodyScrollLock, releaseBodyScrollLock } from "../../../../components/ui/bodyScrollLock";
import { SAT_COPY } from "../../domain/satCopy";
import { satOverlayZClass } from "../primitives/satOverlayZ";
import { SatContrastContext } from "../reading/SatContrastContext";
import type {
  SatImageEnlargeGeometry,
  SatImageEnlargeView,
} from "../../../exam-rendering/api/structuredContentEnlarge";
import { useSatImageWindowGeometry, useSatImageZoom } from "../../hooks/useSatImageZoom";
import { SatImageStrip } from "./SatImageStrip";

/**
 * The high-magnification inspection workspace for a figure (Bluebook shot 4).
 *
 * This is not a floating card or separate viewer application: it is the *same* view —
 * same zoom, same focal point, same strip order — expanded into an Apple Quick Look-style
 * floating inspection panel over a blurred exam backdrop. Because the view lives with the
 * image rather than in this layer, entering and leaving full screen never costs
 * the student their place in the figure.
 *
 * Visual hierarchy (Quick Look model):
 *   Layer 1 — exam (unchanged, behind)
 *   Layer 2 — backdrop: blurred/tinted material overlay, absorbs pointer events
 *   Layer 3 — floating inspection panel: nearly viewport-sized, rounded, shadowed
 *   Layer 4 — toolbar + image stage inside panel
 *
 * Immersive and modal (`role="dialog"`, `aria-modal="true"`, focus trap):
 * the exam behind is completely occluded and protected from background interactions.
 * Escape and the strip's exit control ("Exit full screen") return focus smoothly
 * back to the opener.
 *
 * Layer imageViewer (89): above Help/Shortcuts (88), below the break veil.
 */
export interface SatImageViewerProps {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
  view: SatImageEnlargeView;
  geometry: SatImageEnlargeGeometry;
  onViewChange: (view: SatImageEnlargeView) => void;
  returnFocusSelector?: string | undefined;
  /** Centre of the figure on screen when it was expanded, in viewport pixels. */
  origin?: { x: number; y: number } | undefined;
}

/** Below this finger separation a pinch ratio is noise, not an intent. */
const PINCH_MIN_SEPARATION = 24;

export function SatImageViewer(props: SatImageViewerProps) {
  const contrast = useContext(SatContrastContext);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expandOrigin, setExpandOrigin] = useState<string | undefined>(undefined);
  const titleId = useId();

  // The same image, a different window: the geometry is re-measured here so the
  // clamp and the focal point describe *this* pane.
  const geometry = useSatImageWindowGeometry({
    windowRef: viewportRef,
    imageRef,
    enabled: props.open,
    naturalFallback: props.geometry.natural,
  });
  const measured = geometry.viewport.width > 0;
  const controller = useSatImageZoom({
    view: props.view,
    geometry,
    onViewChange: props.onViewChange,
  });

  const focusBack = useCallback(() => {
    if (props.returnFocusSelector) {
      const el = document.querySelector<HTMLElement>(props.returnFocusSelector);
      if (el) {
        el.focus();
        return;
      }
    }
    if (openerRef.current?.isConnected) openerRef.current.focus();
  }, [props.returnFocusSelector]);

  // Growth origin, resolved against where the panel actually landed. Set in a
  // layout effect so the very first painted frame already carries it — a
  // late origin would animate from the wrong corner.
  useLayoutEffect(() => {
    if (!props.open) return;
    const panel = panelRef.current;
    if (!panel || !props.origin) return;
    const rect = panel.getBoundingClientRect();
    setExpandOrigin(
      Math.round(props.origin.x - rect.left) + "px " + Math.round(props.origin.y - rect.top) + "px",
    );
  }, [props.open, props.origin]);

  useEffect(() => {
    if (!props.open) return;
    acquireBodyScrollLock();
    return () => {
      releaseBodyScrollLock();
    };
  }, [props.open]);

  // Focus-back: explicit selector wins; otherwise the opener captured at open
  // time (the strip's Full screen control).
  useEffect(() => {
    if (!props.open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    toolbarRef.current?.focus();
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
      focusBack();
    };
    // Capture, so the full-screen view answers Escape before the exam's own
    // Escape partition (which stands down on a default-prevented event): the
    // layer on top of the screen is the one that closes.
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose identity churns; open-state is the stable seam.
  }, [props.open, focusBack]);

  // Wheel zoom needs a non-passive listener: React's root `onWheel` is passive,
  // so preventDefault there would neither stop the browser zoom nor the scroll.
  useEffect(() => {
    const element = viewportRef.current;
    if (!props.open || !element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      controller.zoomAtPoint(
        {
          x: event.clientX - rect.left - rect.width / 2,
          y: event.clientY - rect.top - rect.height / 2,
        },
        event.deltaY < 0 ? 1 : -1,
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomAtPoint is stable; re-subscribing on every render would only churn.
  }, [props.open, controller.zoomAtPoint]);

  // Focus trap for modal dialog
  const handleDialogKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const container = panelRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([disabled])'
    );
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }
  }, []);

  if (!props.open || typeof document === "undefined") return null;
  const zoomed = controller.zoom > 1;

  const viewer = (
    /* The dialog root doubles as the backdrop pointer absorber: it covers the
       full viewport so the exam behind cannot receive pointer or keyboard
       interaction while the viewer is open. */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-sat-contrast={contrast}
      data-testid="sat-image-viewer"
      onKeyDown={handleDialogKeyDown}
      className={
        "sat-ui fixed inset-0 flex h-[100dvh] w-[100dvw] items-center justify-center overflow-hidden " +
        satOverlayZClass("imageViewer")
      }
      // Clicks on the backdrop (outside the panel) close the viewer.
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
          focusBack();
        }
      }}
    >
      {/* Layer 2: Backdrop material — blurred/tinted overlay that softens the
          exam behind. The student can perceive exam positioning faintly but
          cannot read text or interact with answers. */}
      <div
        data-sat-image-backdrop=""
        className="sat-figure-scrim pointer-events-none absolute inset-0 bg-[var(--sat-viewer-backdrop,rgba(242,242,247,0.72))] backdrop-blur-[20px] backdrop-saturate-150"
        aria-hidden="true"
      />

      {/* Layer 3: Floating inspection panel — nearly viewport-sized, crisp,
          with restrained border-radius and shadow. The panel itself is never
          blurred; only the exam behind the backdrop is. */}
      <div
        ref={panelRef}
        data-sat-image-panel=""
        style={expandOrigin ? { transformOrigin: expandOrigin } : undefined}
        className={
          "relative flex flex-col overflow-hidden " +
          "rounded-2xl border border-[var(--sat-divider-soft,rgba(60,60,67,0.18))] " +
          "bg-[var(--sat-surface,#ffffff)] " +
          "shadow-[0_2px_6px_rgba(0,0,0,0.05),0_18px_60px_rgba(0,0,0,0.18)] " +
          /* Responsive viewport-relative geometry: ~90-95% of usable viewport
             with comfortable outer breathing room. */
          "h-[min(900px,calc(100dvh-48px))] w-[min(1440px,calc(100vw-48px))] " +
          /* Narrow viewport overrides */
          "max-sm:h-[calc(100dvh-24px)] max-sm:w-[calc(100vw-24px)] max-sm:rounded-xl " +
          (expandOrigin ? "sat-figure-expand" : "")
        }
      >
        <h2 id={titleId} className="sr-only">
          {SAT_COPY.imageViewer.title}
        </h2>
        <SatImageStrip
          label={props.alt}
          toolbarRef={toolbarRef}
          zoom={controller.zoom}
          canZoomIn={controller.canZoomIn}
          canZoomOut={controller.canZoomOut}
          dirty={controller.dirty}
          fullScreen
          onZoomIn={controller.zoomIn}
          onZoomOut={controller.zoomOut}
          onReset={controller.reset}
          onToggleFullScreen={() => {
            props.onClose();
            focusBack();
          }}
        />
          {/* Layer 4: Image stage — the image element owns the full available
              space via h-full w-full, and object-contain paints the image as
              large as possible while preserving aspect ratio. This is the
              critical difference from max-h-full max-w-full: the element BOX
              fills the stage, so a 500px intrinsic image scales up to use a
              1400px stage. The zoom geometry model (satImageContentBox) derives
              the actual painted content size from the element box, so this
              architecture is fully compatible. */}
          <div
            ref={viewportRef}
            data-sat-image-viewport=""
            data-sat-image-dragging={dragging ? "true" : undefined}
            role="group"
            tabIndex={0}
            aria-label={props.alt}
            className={
              "flex min-h-0 flex-1 items-center justify-center overflow-hidden " +
              "bg-[var(--sat-surface-subtle,#f2f2f7)] " +
              /* Stage padding: breathing room so image doesn't touch panel edges */
              "p-6 max-sm:p-3 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] " +
              (zoomed
                ? "touch-none " + (dragging ? "cursor-grabbing" : "cursor-grab")
                : "cursor-default")
            }
            // The keyboard path to the same capability the pointer has: arrows
            // move the figure, and the strip remains the way to change scale.
            onKeyDown={(event) => {
              if (!zoomed) return;
              const PAN_STEP = 40;
              const deltas: Record<string, { dx: number; dy: number }> = {
                ArrowLeft: { dx: PAN_STEP, dy: 0 },
                ArrowRight: { dx: -PAN_STEP, dy: 0 },
                ArrowUp: { dx: 0, dy: PAN_STEP },
                ArrowDown: { dx: 0, dy: -PAN_STEP },
              };
              const delta = deltas[event.key];
              if (!delta) return;
              event.preventDefault();
              controller.panBy(delta.dx, delta.dy);
            }}
            // Double-click inside the fullscreen viewer is the expert's zoom:
            // anchored where the student actually clicked, so the point they
            // were reading stays put. (In the embedded context, double-click
            // opens fullscreen instead — these are deliberately different.)
            onDoubleClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              controller.zoomAtPoint(
                {
                  x: event.clientX - rect.left - rect.width / 2,
                  y: event.clientY - rect.top - rect.height / 2,
                },
                1,
              );
            }}
            onContextMenu={(event) => {
              if (zoomed) event.preventDefault();
            }}
            onPointerDown={(event) => {
              pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              if (pointersRef.current.size === 2) {
                const [first, second] = [...pointersRef.current.values()];
                if (first && second) {
                  pinchRef.current = { distance: Math.hypot(first.x - second.x, first.y - second.y) };
                }
                dragRef.current = null;
                setDragging(false);
                return;
              }
              if (!zoomed) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
              setDragging(true);
            }}
            onPointerMove={(event) => {
              if (!pointersRef.current.has(event.pointerId)) return;
              pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              const pinch = pinchRef.current;
              if (pointersRef.current.size >= 2 && pinch) {
                const [first, second] = [...pointersRef.current.values()];
                if (!first || !second) return;
                const distance = Math.hypot(first.x - second.x, first.y - second.y);
                if (distance < PINCH_MIN_SEPARATION) return;
                const ratio = distance / Math.max(pinch.distance, PINCH_MIN_SEPARATION);
                if (Math.abs(ratio - 1) < 0.02) return;
                pinchRef.current = { distance };
                const rect = event.currentTarget.getBoundingClientRect();
                controller.zoomAtPoint(
                  {
                    x: (first.x + second.x) / 2 - rect.left - rect.width / 2,
                    y: (first.y + second.y) / 2 - rect.top - rect.height / 2,
                  },
                  ratio > 1 ? 1 : -1,
                );
                return;
              }
              const drag = dragRef.current;
              if (!drag || drag.id !== event.pointerId) return;
              const dx = event.clientX - drag.x;
              const dy = event.clientY - drag.y;
              if (dx === 0 && dy === 0) return;
              dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
              controller.panBy(dx, dy);
            }}
            onPointerUp={(event) => {
              pointersRef.current.delete(event.pointerId);
              if (pointersRef.current.size < 2) pinchRef.current = null;
              if (dragRef.current?.id === event.pointerId) {
                dragRef.current = null;
                setDragging(false);
              }
            }}
            onPointerCancel={(event) => {
              pointersRef.current.delete(event.pointerId);
              if (pointersRef.current.size < 2) pinchRef.current = null;
              if (dragRef.current?.id === event.pointerId) {
                dragRef.current = null;
                setDragging(false);
              }
            }}
          >
            <img
              ref={imageRef}
              src={props.src}
              alt={props.alt}
              draggable={false}
              data-sat-image-fullscreen-image=""
              // The transition stays off until this pane has measured itself: the
              // stored view is derived for the embedded window, and easing the
              // correction from one window to the other would look like a slide.
              //
              // CRITICAL: h-full w-full (not max-h-full max-w-full) makes the
              // image element own the full stage box. object-contain then paints
              // the image as large as possible within that box, upscaling a small
              // intrinsic image to fill the available space. The zoom geometry
              // model reads offsetWidth/offsetHeight to derive the content box,
              // so this is fully compatible.
              className={
                "h-full w-full select-none object-contain" + (measured ? " sat-figure-zoom" : "")
              }
              style={
                controller.transform
                  ? {
                      transform:
                        "translate(" +
                        controller.transform.offsetX +
                        "px, " +
                        controller.transform.offsetY +
                        "px) scale(" +
                        controller.transform.zoom +
                        ")",
                      transformOrigin: "center",
                    }
                  : undefined
              }
            />
          </div>
      </div>
    </div>
  );

  return createPortal(viewer, document.body);
}
