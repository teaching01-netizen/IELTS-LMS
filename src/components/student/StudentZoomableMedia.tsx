import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import { isIeltsExamType, useStudentExamType } from './layout/studentExamTypeContext';
import { IMAGE_RETRY_DELAYS_MS } from '../../utils/imageUrl';

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
  openOnMount?: boolean | undefined;
  renderTrigger?: boolean | undefined;
  onDismiss?: (() => void) | undefined;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.8;
const DEFAULT_ZOOM = 1;

interface IntrinsicSize {
  width: number;
  height: number;
}

export function StudentZoomableMedia({
  sources,
  alt,
  label,
  className,
  imageClassName,
  modalImageClassName,
  zoomStep = 0.2,
  renderOverlay,
  openOnMount = false,
  renderTrigger = true,
  onDismiss,
}: StudentZoomableMediaProps) {
  // Memoize on contents, not array identity: callers typically pass a freshly
  // built array each render, which would defeat the memo and retrigger effects.
  const sourcesKey = sources.join('\u0000');
  const normalizedSources = useMemo(
    () => sources.map((source) => source.trim()).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourcesKey]
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  // Load recovery after the last source fails: `attempt` numbers each pass over
  // the sources and keys the <img>, so a retry is a fresh request; `loadStatus`
  // is what the frame shows meanwhile.
  const [attempt, setAttempt] = useState(0);
  const [loadStatus, setLoadStatus] = useState<'ready' | 'waiting' | 'failed'>('ready');
  const autoRetriesRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const handledFailureRef = useRef<string | null>(null);
  const focusAfterRetryRef = useRef(false);
  const [isOpen, setIsOpen] = useState(openOnMount);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [intrinsicSize, setIntrinsicSize] = useState<IntrinsicSize | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusRestoreTimerRef = useRef<number | null>(null);

  // IELTS gets a full-screen viewer; ACT keeps the framed card.
  const isIelts = isIeltsExamType(useStudentExamType());

  const safeSourceIndex = Math.min(sourceIndex, Math.max(0, normalizedSources.length - 1));
  const currentSource = normalizedSources[safeSourceIndex] ?? '';
  const hasMultipleSources = normalizedSources.length > 1;

  useEffect(() => {
    setSourceIndex(0);
    setLoadStatus('ready');
    autoRetriesRef.current = 0;
    handledFailureRef.current = null;
    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [normalizedSources]);

  // A retry the student asked for leaves focus where the image comes back.
  useEffect(() => {
    if (!focusAfterRetryRef.current) {
      return;
    }
    focusAfterRetryRef.current = false;
    (isOpen ? closeButtonRef : triggerButtonRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per retry, not on open/close
  }, [attempt]);

  useEffect(() => {
    return () => {
      if (focusRestoreTimerRef.current !== null) {
        window.clearTimeout(focusRestoreTimerRef.current);
        focusRestoreTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setIntrinsicSize(null);
    setFitScale(1);
    setZoom(DEFAULT_ZOOM);
  }, [currentSource]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const timer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [isOpen]);

  const handleContextMenu = (event: React.SyntheticEvent) => {
    event.preventDefault();
  };

  const recomputeFitScale = () => {
    if (!isOpen || !viewportRef.current || !intrinsicSize) {
      return;
    }

    const viewportRect = viewportRef.current.getBoundingClientRect();
    // Fit inside the padding so 100% never scrolls.
    const style = window.getComputedStyle(viewportRef.current);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const maxWidth = Math.max(1, viewportRect.width - padX);
    const maxHeight = Math.max(1, viewportRect.height - padY);
    const naturalWidth = Math.max(1, intrinsicSize.width);
    const naturalHeight = Math.max(1, intrinsicSize.height);
    const computed = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
    setFitScale(Number.isFinite(computed) && computed > 0 ? computed : 1);
  };

  useEffect(() => {
    recomputeFitScale();
    if (!isOpen) {
      return;
    }

    const handleViewportChange = () => {
      recomputeFitScale();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
    };
  }, [intrinsicSize, isOpen]);

  const handleOpen = () => {
    if (!currentSource) {
      return;
    }

    setZoom(DEFAULT_ZOOM);
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    if (focusRestoreTimerRef.current !== null) {
      window.clearTimeout(focusRestoreTimerRef.current);
    }
    focusRestoreTimerRef.current = window.setTimeout(() => {
      focusRestoreTimerRef.current = null;
      triggerButtonRef.current?.focus();
    }, 0);
    onDismiss?.();
  };

  const restartLoad = () => {
    setSourceIndex(0);
    setAttempt((value) => value + 1);
    setLoadStatus('ready');
  };

  const handleImageError = () => {
    // The thumbnail and an open viewer load the same source: one failure, one step.
    const failure = `${attempt}:${safeSourceIndex}`;
    if (handledFailureRef.current === failure) {
      return;
    }
    handledFailureRef.current = failure;
    if (safeSourceIndex < normalizedSources.length - 1) {
      setSourceIndex(safeSourceIndex + 1);
      return;
    }
    const delay = IMAGE_RETRY_DELAYS_MS[autoRetriesRef.current];
    if (delay === undefined) {
      setLoadStatus('failed');
      return;
    }
    autoRetriesRef.current += 1;
    setLoadStatus('waiting');
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      restartLoad();
    }, delay);
  };

  const handleRetry = () => {
    autoRetriesRef.current = 0;
    focusAfterRetryRef.current = true;
    restartLoad();
  };

  // Shown in place of the image while a retry waits, and once retries are spent.
  const renderLoadNotice = (tone: 'light' | 'dark') => (
    <div className="flex min-h-32 w-full flex-col items-center justify-center gap-3 px-4 py-6 text-center">
      <span role="status" className={`text-sm ${tone === 'dark' ? 'text-white/80' : 'text-gray-600'}`}>
        {loadStatus === 'failed' ? 'Image could not be loaded' : 'Loading image…'}
      </span>
      {loadStatus === 'failed' ? (
        <button
          type="button"
          onClick={handleRetry}
          className={
            tone === 'dark'
              ? 'h-11 rounded-full bg-white/15 px-5 text-[15px] font-semibold text-white transition-colors duration-100 hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80'
              : 'h-11 rounded-full border border-gray-300 bg-white px-5 text-[15px] font-semibold text-gray-800 transition-colors duration-100 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500'
          }
        >
          Try again
        </button>
      ) : null}
    </div>
  );

  const handleModalImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const nextWidth = event.currentTarget.naturalWidth;
    const nextHeight = event.currentTarget.naturalHeight;
    if (nextWidth > 0 && nextHeight > 0) {
      setIntrinsicSize({ width: nextWidth, height: nextHeight });
    }
  };

  const adjustZoom = (delta: number) => {
    setZoom((currentZoom) => {
      const nextZoom = Math.round((currentZoom + delta) * 100) / 100;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    });
  };

  const renderedWidthPx = intrinsicSize ? intrinsicSize.width * fitScale * zoom : null;
  const renderedHeightPx = intrinsicSize ? intrinsicSize.height * fitScale * zoom : null;
  const imageZoomStyle = intrinsicSize
    ? ({
        width: `${renderedWidthPx}px`,
        height: `${renderedHeightPx}px`,
        maxWidth: 'none',
      } as React.CSSProperties)
    : ({
        width: '100%',
        maxWidth: '100%',
      } as React.CSSProperties);

  const annotationScale = zoom / DEFAULT_ZOOM;

  const zoomedImage = loadStatus !== 'ready' ? (
    renderLoadNotice(isIelts ? 'dark' : 'light')
  ) : (
    <div
      className={`relative ${isIelts ? 'overflow-hidden rounded-md bg-white shadow-2xl' : ''}`}
      style={
        intrinsicSize
          ? {
              width: `${renderedWidthPx}px`,
              height: `${renderedHeightPx}px`,
            }
          : undefined
      }
    >
      <img
        key={attempt}
        src={currentSource}
        alt={alt}
        className={`block h-auto w-full object-contain ${modalImageClassName ?? ''}`}
        data-testid="zoom-media-image"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={handleImageError}
        onLoad={handleModalImageLoad}
        onContextMenu={handleContextMenu}
        onDragStart={handleContextMenu}
        style={{
          ...imageZoomStyle,
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
      />
      {renderOverlay ? (
        <div className="pointer-events-none absolute inset-0">{renderOverlay(annotationScale)}</div>
      ) : null}
    </div>
  );

  // Quick Look style: a full-screen cover outside the exam's zoomed shell, with
  // the title and Done on top and a zoom capsule at the bottom. Tapping the
  // empty area around the image closes it.
  const zoomControlClassName =
    'inline-flex size-11 items-center justify-center rounded-full text-white transition-colors duration-100 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-35 disabled:hover:bg-transparent';
  const ieltsViewer = (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[70] flex flex-col bg-neutral-950 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} zoomed view`}
      onContextMenu={handleContextMenu}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-2 pl-[max(1rem,var(--student-safe-left,0px))] pr-[max(1rem,var(--student-safe-right,0px))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span aria-hidden="true" />
        <h2 className="min-w-0 truncate text-center text-[17px] font-semibold">{label}</h2>
        <button
          type="button"
          onClick={handleClose}
          ref={closeButtonRef}
          className="h-11 justify-self-end rounded-full bg-white/15 px-5 text-[17px] font-semibold text-white transition-colors duration-100 hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          aria-label="Close image zoom"
        >
          Done
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 md:p-6"
        data-testid="zoom-media-viewport"
        ref={viewportRef}
        onClick={(event) => {
          if (event.target === event.currentTarget) handleClose();
        }}
      >
        <div
          className="flex min-h-full w-max min-w-full items-center justify-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) handleClose();
          }}
        >
          {zoomedImage}
        </div>
      </div>

      <div className="flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex items-center gap-1 rounded-full bg-white/15 p-1">
          <button
            type="button"
            onClick={() => adjustZoom(-zoomStep)}
            disabled={zoom <= MIN_ZOOM}
            className={zoomControlClassName}
            aria-label="Zoom out image"
          >
            <Minus size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(DEFAULT_ZOOM)}
            className="h-11 min-w-16 rounded-full px-3 text-[15px] font-semibold tabular-nums text-white transition-colors duration-100 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Reset image zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => adjustZoom(zoomStep)}
            disabled={zoom >= MAX_ZOOM}
            className={zoomControlClassName}
            aria-label="Zoom in image"
          >
            <Plus size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  const framedViewer = (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[70] bg-gray-900/80 backdrop-blur-sm p-3 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} zoomed view`}
      onClick={handleClose}
      onContextMenu={handleContextMenu}
    >
      <div
        className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={handleContextMenu}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 md:px-6">
          <div className="min-w-0">
            <div className="text-[length:var(--student-meta-font-size)] font-semibold uppercase tracking-wide text-gray-600">
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
          data-testid="zoom-media-viewport"
          ref={viewportRef}
        >
          <div className="mx-auto flex min-h-full w-full justify-center">{zoomedImage}</div>
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
    </div>
  );

  if (!currentSource) {
    return null;
  }

  return (
    <>
      {renderTrigger && loadStatus !== 'ready' ? (
        // A frame, not the zoom button: there is nothing to zoom, and the
        // retry control cannot sit inside another button.
        <div
          role="group"
          aria-label={label}
          className={`relative block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 ${className ?? ''}`}
        >
          {renderLoadNotice('light')}
        </div>
      ) : renderTrigger ? (
        <button
          type="button"
          onClick={handleOpen}
          onContextMenu={handleContextMenu}
          ref={triggerButtonRef}
          className={`group relative block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left ${className ?? ''}`}
          aria-label={label}
        >
          <div className="relative">
            <img
              key={attempt}
              src={currentSource}
              alt={alt}
              className={`h-auto w-full object-contain select-none ${imageClassName ?? ''}`}
              loading="lazy"
              decoding="async"
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
              <div className="pointer-events-none absolute inset-0">{renderOverlay(1)}</div>
            ) : null}
          </div>
        </button>
      ) : null}

      {isOpen && typeof document !== 'undefined'
        ? createPortal(isIelts ? ieltsViewer : framedViewer, document.body)
        : null}
    </>
  );
}
