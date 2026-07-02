import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  CheckCircle,
  Clock,
  Contrast,
  LayoutGrid,
  Minus,
  Plus,
  RefreshCw,
  Wifi,
} from 'lucide-react';
import { LoadingMark, SrLoadingText } from '../ui/LoadingMark';

interface StudentHeaderProps {
  testTakerId?: string | undefined;
  timeRemaining?: number | undefined;
  autoSaveStatus?: 'saved' | 'saving' | 'syncing' | 'offline' | null | undefined;
  highlightEnabled?: boolean | undefined;
  onOpenAccessibility?: (() => void) | undefined;
  onOpenNavigator?: (() => void) | undefined;
  onClearHighlights?: (() => void) | undefined;
  tabletMode?: boolean | undefined;
  zoom?: number | undefined;
  onZoomIn?: (() => void) | undefined;
  onZoomOut?: (() => void) | undefined;
  onZoomReset?: (() => void) | undefined;
  isExamActive?: boolean | undefined;
}

export function StudentHeader({
  testTakerId,
  timeRemaining,
  autoSaveStatus,
  highlightEnabled = false,
  onOpenAccessibility,
  onOpenNavigator,
  onClearHighlights,
  tabletMode = false,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  isExamActive = false,
}: StudentHeaderProps) {
  void onClearHighlights;
  const [showTabletZoomControls, setShowTabletZoomControls] = useState(false);
  const [tabletZoomControlsStyle, setTabletZoomControlsStyle] = useState<React.CSSProperties>({
    top: 0,
    left: 0,
    width: 280,
  });
  const tabletZoomButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabletZoomPanelRef = useRef<HTMLDivElement | null>(null);
  const showZoomControls = zoom !== undefined && onZoomIn && onZoomOut && onZoomReset;
  const zoomPercent = zoom !== undefined ? Math.round(zoom * 100) : null;
  const shouldShowHighlightHint = Boolean(highlightEnabled && onOpenNavigator);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const updateTabletZoomControlsPosition = useCallback(() => {
    const button = tabletZoomButtonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const width = Math.min(300, Math.max(248, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));

    setTabletZoomControlsStyle({
      top: Math.round(rect.bottom + 10),
      left: Math.round(left),
      width,
    });
  }, []);

  useEffect(() => {
    if (!tabletMode || !showTabletZoomControls) {
      return;
    }

    updateTabletZoomControlsPosition();

    const handleResize = () => {
      updateTabletZoomControlsPosition();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowTabletZoomControls(false);
      }
    };

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (tabletZoomButtonRef.current?.contains(target) || tabletZoomPanelRef.current?.contains(target))
      ) {
        return;
      }

      setShowTabletZoomControls(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [showTabletZoomControls, tabletMode, updateTabletZoomControlsPosition]);

  const renderOverlayPanel = useCallback((panel: React.ReactNode) => {
    if (typeof document === 'undefined') {
      return null;
    }

    return createPortal(panel, document.body);
  }, []);

  const tabletZoomPanel = showTabletZoomControls
    ? renderOverlayPanel(
        <div
          ref={tabletZoomPanelRef}
          role="dialog"
          aria-label="Zoom controls"
          className="fixed z-[90] max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-2xl"
          style={tabletZoomControlsStyle}
        >
          <div className="mb-2 text-[length:var(--student-meta-font-size)] font-black uppercase tracking-[0.18em] text-gray-500">
            Zoom
          </div>
          <div
            data-testid="zoom-controls"
            className="flex w-full items-center gap-1 rounded-sm border border-gray-200 bg-gray-50 p-1"
          >
            <button
              type="button"
              onClick={onZoomOut}
              className="flex h-10 w-10 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus size={16} />
            </button>
            <div
              data-testid="zoom-percent"
              className="flex-1 px-1 text-center text-sm font-bold text-gray-700 tabular-nums"
              aria-live="polite"
              aria-label={zoomPercent !== null ? `Zoom level ${zoomPercent}%` : undefined}
            >
              {zoomPercent !== null ? `${zoomPercent}%` : null}
            </div>
            <button
              type="button"
              onClick={onZoomIn}
              className="flex h-10 w-10 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              onClick={onZoomReset}
              className="flex h-10 w-10 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              aria-label="Reset zoom"
              title="Reset zoom"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>,
      )
    : null;

  return (
    <header
      className="h-14 md:h-16 border-b border-gray-200 bg-white grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 md:gap-3 px-3 md:px-4 lg:px-6 flex-shrink-0 z-10 shadow-sm"
      role="banner"
    >
      <div className="flex items-center gap-3 md:gap-4 lg:gap-6 min-w-0 justify-self-start">
        <div className="bg-white border-2 border-gray-900 px-1.5 md:px-2 lg:px-3 py-0.5 rounded-sm flex-shrink-0">
          <div className="text-gray-900 font-black text-lg md:text-xl lg:text-2xl tracking-tighter" style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif' }}>IELTS</div>
        </div>
        <div className="flex flex-col min-w-0 hidden sm:flex">
          <div className="font-bold text-[length:var(--student-meta-font-size)] text-gray-600 uppercase tracking-widest">
            Test taker ID
          </div>
          <div className="text-[length:var(--student-control-font-size)] font-bold text-gray-900 truncate">
            {testTakerId ?? '—'}
          </div>
        </div>
      </div>

      <div
        className="flex min-w-[8rem] items-center justify-center justify-self-center"
        data-testid="student-header-timer-slot"
      >
        {timeRemaining !== undefined ? (
          <div className="flex items-center gap-1.5 md:gap-2 lg:gap-3 flex-shrink-0">
            <div className={`flex items-center gap-1.5 md:gap-2 lg:gap-3 font-bold text-base md:text-lg lg:text-xl px-2 md:px-3 lg:px-4 py-1 md:py-1.5 border-2 rounded-sm transition-colors flex-shrink-0 ${timeRemaining < 300 ? 'bg-red-100 border-red-700 text-red-900' : 'bg-gray-50 border-gray-100 text-gray-900'}`}>
              <Clock size={14} className={timeRemaining < 300 ? 'text-red-900' : 'text-gray-700'} />
              <span
                className="font-mono"
                role="timer"
                aria-label="Time remaining"
                data-testid="student-time-remaining"
              >
                {formatTime(timeRemaining)}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="flex min-w-0 max-w-full items-center justify-end gap-1.5 md:gap-2 lg:gap-4 text-gray-700 flex-shrink-0 overflow-x-auto no-scrollbar justify-self-end"
        data-testid="student-header-controls-slot"
      >
        {shouldShowHighlightHint ? (
          <div className="hidden sm:flex items-center rounded-sm border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-700">
            Tip: Select text to highlight
          </div>
        ) : null}
        {autoSaveStatus && (
          <div className="flex items-center gap-1 md:gap-1.5 text-[length:var(--student-meta-font-size)] font-bold uppercase tracking-wider hidden sm:flex">
            {autoSaveStatus === 'saving' || autoSaveStatus === 'syncing' ? (
              <>
                <LoadingMark size="xs" className="bg-gray-300" />
                <SrLoadingText>{autoSaveStatus === 'syncing' ? 'Syncing…' : 'Saving…'}</SrLoadingText>
                <span className="text-gray-600">
                  {autoSaveStatus === 'syncing' ? 'Syncing' : 'Saving'}
                </span>
              </>
            ) : autoSaveStatus === 'offline' ? (
              <>
                <Wifi size={10} className="text-amber-600" />
                <span className="text-amber-700">Offline</span>
              </>
            ) : (
              <>
                <CheckCircle size={10} className="text-green-600" />
                <span className="text-green-900">Saved</span>
              </>
            )}
          </div>
        )}
        {tabletMode ? (
          <>
            {showZoomControls ? (
              <div className="relative">
                <button
                  ref={tabletZoomButtonRef}
                  type="button"
                  onClick={() => {
                    setShowTabletZoomControls((open) => !open);
                  }}
                  className="flex min-w-[5.75rem] items-center justify-center gap-1 rounded-sm border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[length:var(--student-control-font-size)] font-bold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100"
                  aria-expanded={showTabletZoomControls}
                  aria-label="Open zoom controls"
                  title="Open zoom controls"
                >
                  <Plus size={14} strokeWidth={2.2} />
                  <span>Zoom</span>
                  {zoomPercent !== null ? (
                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[length:var(--student-meta-font-size)] font-black tabular-nums text-gray-700">
                      {zoomPercent}%
                    </span>
                  ) : null}
                </button>
                {tabletZoomPanel}
              </div>
            ) : null}
          </>
        ) : (
          <>
            {showZoomControls ? (
              <div
                data-testid="zoom-controls"
                className="flex w-[11.5rem] shrink-0 items-center gap-1 rounded-sm border border-gray-200 bg-gray-50 p-1"
              >
                <button
                  type="button"
                  onClick={onZoomOut}
                  className="flex h-9 w-9 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  <Minus size={16} />
                </button>
                <div
                  data-testid="zoom-percent"
                  className="w-12 shrink-0 px-1 text-center text-[length:var(--student-meta-font-size)] font-bold text-gray-700 tabular-nums"
                  aria-live="polite"
                  aria-label={zoomPercent !== null ? `Zoom level ${zoomPercent}%` : undefined}
                >
                  {zoomPercent !== null ? `${zoomPercent}%` : null}
                </div>
                <button
                  type="button"
                  onClick={onZoomIn}
                  className="flex h-9 w-9 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  onClick={onZoomReset}
                  className="flex h-9 w-9 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  aria-label="Reset zoom"
                  title="Reset zoom"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            ) : null}
          </>
        )}
        {onOpenAccessibility && (
          <button
            type="button"
            onClick={onOpenAccessibility}
            className="p-2 md:p-2.5 rounded-sm flex-shrink-0"
            aria-label="Open accessibility settings"
          >
            <Contrast size={16} strokeWidth={2} />
          </button>
        )}
        {onOpenNavigator && (
          <button
            type="button"
            onClick={onOpenNavigator}
            className="flex items-center gap-1 md:gap-1.5 px-2.5 md:px-3 py-1.5 md:py-2 rounded-sm bg-gray-50 text-gray-900 font-bold text-[length:var(--student-control-font-size)]"
            aria-label="Open question navigator"
          >
            <LayoutGrid size={16} strokeWidth={2} />
            <span className="hidden sm:inline">Questions</span>
          </button>
        )}
        {!isExamActive && (
          <>
            <button type="button" className="p-2 md:p-2.5 rounded-sm relative hidden sm:block" aria-label="Connection status: Online">
              <Wifi size={16} strokeWidth={2} />
              <div className="absolute top-1 md:top-1.5 right-1 md:right-1.5 w-1.5 md:w-2 h-1.5 md:h-2 bg-green-600 rounded-full border-2 border-white"></div>
            </button>
            <button type="button" className="p-2 md:p-2.5 rounded-sm hidden sm:block" aria-label="Notifications">
              <Bell size={16} strokeWidth={2} />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
