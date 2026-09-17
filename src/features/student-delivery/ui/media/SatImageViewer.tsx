/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the pane is a 2D pannable surface, not a control: it is focusable only to give the pointer's pan a keyboard equivalent (arrow keys), it is labelled with the figure it shows, and every change of scale stays on the named controls in the strip above. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { SAT_COPY } from "../../domain/satCopy";
import { satOverlayZClass } from "../primitives/satOverlayZ";
import type {
  SatImageEnlargeGeometry,
  SatImageEnlargeView,
} from "../../../exam-rendering/api/structuredContentEnlarge";
import { useSatImageWindowGeometry, useSatImageZoom } from "../../hooks/useSatImageZoom";
import { SatImageStrip } from "./SatImageStrip";

/**
 * The high-magnification presentation of a figure (Bluebook shot 4).
 *
 * This is not a separate viewer application: it is the *same* view — same zoom,
 * same focal point, same strip order — given a bigger window, with the rest of
 * the exam suppressed behind a light scrim. Because the view lives with the
 * image rather than in this layer, entering and leaving full screen never costs
 * the student their place in the figure.
 *
 * It should feel like the figure expanding, not like a second thing opening, so
 * the card grows from the spot the figure occupies on screen (the origin is
 * measured by the control that asked for this) and the scrim fades in rather
 * than appearing. Reduce Motion zeroes both, through the shell's existing guard.
 *
 * Deliberately non-modal (`aria-modal="false"`, no focus trap, no
 * backdrop-click-to-close): the exam behind stays reachable, a stray press can
 * never dismiss what the student is studying, and the scrim is light enough that
 * the question is still legible as "underneath this". Escape and the strip's own
 * exit control are the two ways out, both instant and both obvious.
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
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

  // Growth origin, resolved against where the card actually landed. Set in a
  // layout effect so the very first painted frame already carries it — a
  // late origin would animate from the wrong corner.
  useLayoutEffect(() => {
    if (!props.open) return;
    const card = cardRef.current;
    if (!card || !props.origin) return;
    const rect = card.getBoundingClientRect();
    setExpandOrigin(
      Math.round(props.origin.x - rect.left) + "px " + Math.round(props.origin.y - rect.top) + "px",
    );
  }, [props.open, props.origin]);

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

  if (!props.open) return null;
  const zoomed = controller.zoom > 1;

  return (
    <div
      className={
        "sat-ui fixed inset-0 flex items-center justify-center p-4 sm:p-8 " +
        satOverlayZClass("imageViewer")
      }
      data-testid="sat-image-viewer"
    >
      {/* Suppress, don't dramatize: the question stays recognisably underneath,
          dimmed just enough that attention stops going to it. No blur — an exam
          behind frosted glass is noise, not depth. */}
      <div aria-hidden="true" className="sat-figure-scrim absolute inset-0 bg-black/40" />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        style={expandOrigin ? { transformOrigin: expandOrigin } : undefined}
        className={
          "relative flex max-h-full w-full max-w-[880px] flex-col overflow-hidden rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-[var(--sat-shadow-modal)]" +
          (expandOrigin ? " sat-figure-expand" : "")
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
        <div
          ref={viewportRef}
          data-sat-image-viewport=""
          data-sat-image-dragging={dragging ? "true" : undefined}
          role="group"
          tabIndex={0}
          aria-label={props.alt}
          className={
            "flex max-h-[70dvh] min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--sat-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] " +
            (zoomed ? "touch-none cursor-grab active:cursor-grabbing" : "")
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
          // Double-click is the expert's zoom: anchored where the student
          // actually clicked, so the point they were reading stays put.
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
            className={
              "max-h-full max-w-full select-none object-contain" + (measured ? " sat-figure-zoom" : "")
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
}
