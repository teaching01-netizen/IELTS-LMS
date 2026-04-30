import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDragToPan } from './useDragToPan';

type StudentZoomableMediaProps = {
  sources: string[];
  alt: string;
  label: string;
  hint?: string | undefined;
  className?: string | undefined;
  imageClassName?: string | undefined;
  modalImageClassName?: string | undefined;
  zoomStep?: number | undefined;
  renderOverlay?: ((zoom: number) => React.ReactNode) | undefined;
  renderInteractiveOverlay?: (() => React.ReactNode) | undefined;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.8;
const DEFAULT_ZOOM = 1.35;
const TOUCH_OPEN_GUARD_MS = 650;

const INITIAL_PINCH_STATE = {
  active: false,
  startDistance: 0,
  startZoom: DEFAULT_ZOOM,
};

function getTouchDistance(firstTouch: Pick<Touch, 'clientX' | 'clientY'>, secondTouch: Pick<Touch, 'clientX' | 'clientY'>): number {
  return Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY);
}

export function StudentZoomableMedia({
  sources,
  alt,
  label,
  hint = 'Tap to zoom',
  className,
  imageClassName,
  modalImageClassName,
  zoomStep = 0.2,
  renderOverlay,
  renderInteractiveOverlay,
}: StudentZoomableMediaProps) {
  const normalizedSources = useMemo(
    () => sources.map((source) => source.trim()).filter(Boolean),
    [sources],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const ignoreBackdropClickUntilRef = useRef(0);
  const pinchStateRef = useRef(INITIAL_PINCH_STATE);
  const zoomViewportPan = useDragToPan<HTMLDivElement>(zoom > 1);

  const currentSource = normalizedSources[sourceIndex] ?? '';
  const hasMultipleSources = normalizedSources.length > 1;

  useEffect(() => {
    setSourceIndex(0);
  }, [normalizedSources]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    const timer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      window.clearTimeout(timer);
    };
  }, [isOpen]);

  const handleContextMenu = (event: React.SyntheticEvent) => {
    event.preventDefault();
  };

  const handleOpen = useCallback((reason: 'tap' | 'gesture' = 'tap') => {
    if (!currentSource) {
      return;
    }

    if (reason === 'gesture') {
      ignoreBackdropClickUntilRef.current = Date.now() + TOUCH_OPEN_GUARD_MS;
    }

    setZoom(DEFAULT_ZOOM);
    pinchStateRef.current = INITIAL_PINCH_STATE;
    setIsOpen(true);
  }, [currentSource]);

  const handleClose = useCallback(() => {
    pinchStateRef.current = INITIAL_PINCH_STATE;
    ignoreBackdropClickUntilRef.current = 0;
    setIsOpen(false);
  }, []);

  const handleImageError = () => {
    if (!hasMultipleSources) {
      return;
    }

    setSourceIndex((currentIndex) => Math.min(currentIndex + 1, normalizedSources.length - 1));
  };

  const clampZoom = useCallback(
    (nextZoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(nextZoom * 100) / 100)),
    [],
  );

  const handleThumbnailTouchStart = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (event.touches.length < 2) {
        return;
      }

      event.preventDefault();
      handleOpen('gesture');
    },
    [handleOpen],
  );

  const handleThumbnailTouchMove = useCallback((event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length < 2) {
      return;
    }

    event.preventDefault();
  }, []);

  const adjustZoom = (delta: number) => {
    setZoom((currentZoom) => clampZoom(currentZoom + delta));
  };

  const imageZoomStyle = {
    width: `${Math.round(zoom * 100)}%`,
    maxWidth: 'none',
  } as React.CSSProperties;

  const annotationScale = zoom / DEFAULT_ZOOM;

  if (!currentSource) {
    return null;
  }

  const imageContent = (
    <div className="relative">
      <img
        src={currentSource}
        alt={alt}
        className={`h-auto w-full object-contain select-none ${imageClassName ?? ''}`}
        loading="lazy"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={handleImageError}
        onContextMenu={handleContextMenu}
        onDragStart={handleContextMenu}
        style={{
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          touchAction: 'manipulation',
        }}
      />
      {renderOverlay ? (
        <div className="pointer-events-none absolute inset-0">
          {renderOverlay(1)}
        </div>
      ) : null}
      {renderInteractiveOverlay ? (
        <div className="absolute inset-0">
          {renderInteractiveOverlay()}
        </div>
      ) : null}
      {!renderInteractiveOverlay ? (
        <div className="absolute left-3 top-3 rounded-full bg-gray-950/75 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-white shadow-lg">
          Zoom
        </div>
      ) : null}
      {!renderInteractiveOverlay ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-gray-950/75 to-transparent px-3 py-2">
          <div className="inline-flex items-center rounded-full bg-white/95 px-3 py-1 text-[length:var(--student-meta-font-size)] font-bold text-gray-900 shadow-sm">
            {hint}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {renderInteractiveOverlay ? (
        <div
          onContextMenu={handleContextMenu}
          onTouchStart={handleThumbnailTouchStart}
          onTouchMove={handleThumbnailTouchMove}
          className={`group relative block w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 text-left ${className ?? ''}`}
        >
          {imageContent}
          <div className="border-t border-gray-200 bg-white px-3 py-2">
            <button
              type="button"
              onClick={() => handleOpen('tap')}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[length:var(--student-meta-font-size)] font-bold text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
              aria-label={`${label}. ${hint}`}
              title={hint}
            >
              Open zoom view
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => handleOpen('tap')}
          onContextMenu={handleContextMenu}
          onTouchStart={handleThumbnailTouchStart}
          onTouchMove={handleThumbnailTouchMove}
          className={`group relative block w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 text-left ${className ?? ''}`}
          aria-label={`${label}. ${hint}`}
          title={hint}
        >
          {imageContent}
        </button>
      )}

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] bg-gray-950/80 backdrop-blur-sm p-3 md:p-6"
              role="dialog"
              aria-modal="true"
              aria-label={`${label} zoomed view`}
              onClick={(event) => {
                if (Date.now() < ignoreBackdropClickUntilRef.current) {
                  event.preventDefault();
                  return;
                }
                handleClose();
              }}
              onContextMenu={handleContextMenu}
            >
              <div
                className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                onContextMenu={handleContextMenu}
              >
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 md:px-6">
                  <div className="min-w-0">
                    <div className="text-[length:var(--student-meta-font-size)] font-black uppercase tracking-[0.24em] text-gray-500">
                      Zoomed View
                    </div>
                    <div className="truncate text-[length:var(--student-control-font-size)] font-bold text-gray-900">
                      {label}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => adjustZoom(-zoomStep)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
                      aria-label="Zoom out image"
                    >
                      <Minus size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom(DEFAULT_ZOOM)}
                      className="rounded-full border border-gray-200 bg-white px-3 py-2 text-[length:var(--student-control-font-size)] font-bold text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
                      aria-label="Reset image zoom"
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustZoom(zoomStep)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
                      aria-label="Zoom in image"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      ref={closeButtonRef}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
                      aria-label="Close image zoom"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div
                  className="flex-1 overflow-auto bg-gray-100 p-4 md:p-6"
                  data-testid="zoomable-media-viewport"
                  style={zoomViewportPan.dragStyle}
                  onMouseDown={zoomViewportPan.dragHandlers.onMouseDown}
                  onTouchStart={(event) => {
                    if (event.touches.length === 2) {
                      const firstTouch = event.touches[0];
                      const secondTouch = event.touches[1];
                      if (!firstTouch || !secondTouch) {
                        return;
                      }

                      zoomViewportPan.cancelDrag();
                      pinchStateRef.current = {
                        active: true,
                        startDistance: getTouchDistance(firstTouch, secondTouch),
                        startZoom: zoom,
                      };
                      event.preventDefault();
                      return;
                    }

                    if (pinchStateRef.current.active) {
                      return;
                    }

                    zoomViewportPan.dragHandlers.onTouchStart(event);
                  }}
                  onTouchMove={(event) => {
                    if (!pinchStateRef.current.active) {
                      return;
                    }

                    if (event.touches.length < 2) {
                      pinchStateRef.current = INITIAL_PINCH_STATE;
                      return;
                    }

                    const firstTouch = event.touches[0];
                    const secondTouch = event.touches[1];
                    if (!firstTouch || !secondTouch || pinchStateRef.current.startDistance <= 0) {
                      return;
                    }

                    const currentDistance = getTouchDistance(firstTouch, secondTouch);
                    const scale = currentDistance / pinchStateRef.current.startDistance;
                    setZoom(clampZoom(pinchStateRef.current.startZoom * scale));
                    event.preventDefault();
                  }}
                  onTouchEnd={() => {
                    if (pinchStateRef.current.active) {
                      pinchStateRef.current = INITIAL_PINCH_STATE;
                    }
                  }}
                  onTouchCancel={() => {
                    if (pinchStateRef.current.active) {
                      pinchStateRef.current = INITIAL_PINCH_STATE;
                    }
                  }}
                >
                  <div className="mx-auto flex min-h-full w-full justify-center">
                    <div
                      className="relative"
                      style={{
                        width: `${Math.round(zoom * 100)}%`,
                        minWidth: `${Math.round(zoom * 100)}%`,
                      }}
                    >
                      <img
                        src={currentSource}
                        alt={alt}
                        className={`block h-auto w-full object-contain ${modalImageClassName ?? ''}`}
                        draggable={false}
                        referrerPolicy="no-referrer"
                        onError={handleImageError}
                        onContextMenu={handleContextMenu}
                        onDragStart={handleContextMenu}
                        style={{
                          ...imageZoomStyle,
                          WebkitTouchCallout: 'none',
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                        }}
                      />
                      {renderOverlay ? <div className="pointer-events-none absolute inset-0">{renderOverlay(annotationScale)}</div> : null}
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 bg-white px-4 py-3 md:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[length:var(--student-meta-font-size)] text-gray-600">
                      Zoom only. Save and download controls are disabled here.
                    </p>
                    {hasMultipleSources ? (
                      <p className="text-[length:var(--student-meta-font-size)] font-semibold text-gray-500">
                        Alternate image sources are being used if needed.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
