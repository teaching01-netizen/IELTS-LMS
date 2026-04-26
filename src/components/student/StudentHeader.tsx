import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  ChevronDown,
  CheckCircle,
  Clock,
  Contrast,
  Highlighter,
  LayoutGrid,
  Menu,
  Minus,
  Plus,
  RefreshCw,
  Wifi,
} from 'lucide-react';
import { LoadingMark, SrLoadingText } from '../ui/LoadingMark';
import {
  defaultStudentHighlightColor,
  studentHighlightPalette,
  type StudentHighlightColor,
} from './highlightPalette';

interface StudentHeaderProps {
  onExit: () => void;
  testTakerId?: string | undefined;
  timeRemaining?: number | undefined;
  autoSaveStatus?: 'saved' | 'saving' | 'syncing' | 'offline' | null | undefined;
  onOpenAccessibility?: (() => void) | undefined;
  onOpenNavigator?: (() => void) | undefined;
  zoom?: number | undefined;
  onZoomIn?: (() => void) | undefined;
  onZoomOut?: (() => void) | undefined;
  onZoomReset?: (() => void) | undefined;
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  onHighlightModeToggle?: (() => void) | undefined;
  onHighlightColorChange?: ((color: StudentHighlightColor) => void) | undefined;
  isExamActive?: boolean | undefined;
  showExitButton?: boolean | undefined;
}

export function StudentHeader({
  onExit,
  testTakerId,
  timeRemaining,
  autoSaveStatus,
  onOpenAccessibility,
  onOpenNavigator,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  highlightEnabled = false,
  highlightColor = defaultStudentHighlightColor,
  onHighlightModeToggle,
  onHighlightColorChange,
  isExamActive = false,
  showExitButton = true,
}: StudentHeaderProps) {
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showHighlightPalette, setShowHighlightPalette] = useState(false);
  const [highlightPaletteStyle, setHighlightPaletteStyle] = useState<React.CSSProperties>({
    top: 0,
    left: 0,
    width: 288,
  });
  const highlightButtonRef = useRef<HTMLButtonElement | null>(null);
  const highlightPaletteRef = useRef<HTMLDivElement | null>(null);
  const showZoomControls = zoom !== undefined && onZoomIn && onZoomOut && onZoomReset;
  const zoomPercent = zoom !== undefined ? Math.round(zoom * 100) : null;
  const showHighlightControls = Boolean(onHighlightModeToggle && onHighlightColorChange);
  const selectedHighlight =
    studentHighlightPalette.find((entry) => entry.id === highlightColor) ?? studentHighlightPalette[0]!;
  
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleExit = () => {
    if (isExamActive) {
      setShowExitConfirm(true);
    } else {
      onExit();
    }
  };

  const confirmExit = () => {
    setShowExitConfirm(false);
    onExit();
  };

  const updateHighlightPalettePosition = useCallback(() => {
    const button = highlightButtonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const width = 288;
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));

    setHighlightPaletteStyle({
      top: Math.round(rect.bottom + 10),
      left: Math.round(left),
      width,
    });
  }, []);

  useEffect(() => {
    if (!showHighlightPalette) {
      return;
    }

    updateHighlightPalettePosition();

    const handleResize = () => {
      updateHighlightPalettePosition();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowHighlightPalette(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [showHighlightPalette, updateHighlightPalettePosition]);

  useEffect(() => {
    if (!showHighlightPalette) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (highlightButtonRef.current?.contains(target) || highlightPaletteRef.current?.contains(target))
      ) {
        return;
      }

      setShowHighlightPalette(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [showHighlightPalette]);

  const handleHighlightButtonClick = useCallback(() => {
    setShowHighlightPalette((open) => !open);
  }, []);

  const handleHighlightColorChange = (color: StudentHighlightColor) => {
    onHighlightColorChange?.(color);
    if (!highlightEnabled) {
      onHighlightModeToggle?.();
    }
    setShowHighlightPalette(false);
  };

  return (
    <header className="h-14 md:h-16 border-b border-gray-200 bg-white flex items-center justify-between px-3 md:px-4 lg:px-6 flex-shrink-0 z-10 shadow-sm" role="banner">
      <div className="flex items-center gap-3 md:gap-4 lg:gap-6 min-w-0">
        <div className="bg-white border-2 border-gray-900 px-1.5 md:px-2 lg:px-3 py-0.5 rounded-sm flex-shrink-0">
          <div className="text-gray-900 font-black text-lg md:text-xl lg:text-2xl tracking-tighter" style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif' }}>IELTS</div>
        </div>
        <div className="flex flex-col min-w-0 hidden sm:flex">
          <div className="font-bold text-[10px] md:text-[11px] text-gray-600 uppercase tracking-widest">Test taker ID</div>
          <div className="text-xs md:text-sm font-bold text-gray-900 truncate">
            {testTakerId ?? '—'}
          </div>
        </div>
      </div>
      
      {timeRemaining !== undefined && (
        <div className="flex items-center gap-2 md:gap-3 lg:gap-4 overflow-x-auto no-scrollbar">
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
        </div>
      )}

      <div className="flex items-center gap-1.5 md:gap-2 lg:gap-4 text-gray-700 flex-shrink-0 overflow-x-auto no-scrollbar max-w-full">
        {autoSaveStatus && (
          <div className="flex items-center gap-1 md:gap-1.5 text-[9px] md:text-[10px] lg:text-xs font-bold uppercase tracking-wider hidden sm:flex">
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
        {showZoomControls ? (
          <div
            data-testid="zoom-controls"
            className="flex w-[11.5rem] shrink-0 items-center gap-1 rounded-sm border border-gray-200 bg-gray-50 p-1"
          >
            <button
              type="button"
              onClick={onZoomOut}
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus size={14} />
            </button>
            <div
              data-testid="zoom-percent"
              className="w-12 shrink-0 px-1 text-center text-[10px] md:text-xs font-bold text-gray-700 tabular-nums"
              aria-live="polite"
              aria-label={zoomPercent !== null ? `Zoom level ${zoomPercent}%` : undefined}
            >
              {zoomPercent !== null ? `${zoomPercent}%` : null}
            </div>
            <button
              type="button"
              onClick={onZoomIn}
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              onClick={onZoomReset}
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              aria-label="Reset zoom"
              title="Reset zoom"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        ) : null}
        {showHighlightControls ? (
          <div className="relative">
            <button
              ref={highlightButtonRef}
              type="button"
              onClick={handleHighlightButtonClick}
              className={`flex items-center gap-1 rounded-sm border px-2 py-1 text-[10px] md:text-xs font-bold transition-colors ${
                highlightEnabled
                  ? 'border-amber-500 bg-amber-50 text-amber-800'
                  : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100'
              }`}
              aria-expanded={showHighlightPalette}
              aria-controls="student-highlight-palette"
              aria-label="Open highlight options"
              title="Open highlight options"
            >
              <Highlighter size={14} strokeWidth={2.2} />
              <span className="hidden sm:inline">Highlight</span>
              <span className={`h-2.5 w-2.5 rounded-full border border-white shadow-sm ${selectedHighlight.swatchClassName}`} />
              <ChevronDown size={12} className="hidden sm:inline" />
            </button>
            {showHighlightPalette ? (
              <div
                ref={highlightPaletteRef}
                id="student-highlight-palette"
                role="dialog"
                aria-label="Highlight options"
                className="fixed z-50 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl"
                style={highlightPaletteStyle}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-500">
                      Highlight
                    </div>
                    <div className="text-xs text-gray-600">
                      Pick a color and turn highlight mode on or off.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onHighlightModeToggle?.();
                    }}
                    className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                      highlightEnabled
                        ? 'border-amber-500 bg-amber-50 text-amber-800'
                        : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {highlightEnabled ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {studentHighlightPalette.map((color) => {
                    const isActive = highlightColor === color.id;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => handleHighlightColorChange(color.id)}
                        className={`rounded-lg border-2 p-2 text-left transition-all ${
                          isActive
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                        aria-pressed={isActive}
                        aria-label={`Select ${color.label} highlight color`}
                      >
                        <div className={`h-6 rounded-md ${color.swatchClassName}`} />
                        <div className="mt-1 text-xs font-semibold text-gray-900">{color.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {onOpenAccessibility && (
          <button
            type="button"
            onClick={onOpenAccessibility}
            className="p-1 md:p-1.5 rounded-sm flex-shrink-0"
            aria-label="Open accessibility settings"
          >
            <Contrast size={16} strokeWidth={2} />
          </button>
        )}
        {onOpenNavigator && (
          <button
            type="button"
            onClick={onOpenNavigator}
            className="flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 py-1 md:py-1.5 rounded-sm bg-gray-50 text-gray-900 font-bold text-[10px] md:text-xs"
            aria-label="Open question navigator"
          >
            <LayoutGrid size={16} strokeWidth={2} />
            <span className="hidden sm:inline">Questions</span>
          </button>
        )}
        {!isExamActive && (
          <>
            <button type="button" className="p-1 md:p-1.5 rounded-sm relative hidden sm:block" aria-label="Connection status: Online">
              <Wifi size={16} strokeWidth={2} />
              <div className="absolute top-1 md:top-1.5 right-1 md:right-1.5 w-1.5 md:w-2 h-1.5 md:h-2 bg-green-600 rounded-full border-2 border-white"></div>
            </button>
            <button type="button" className="p-1 md:p-1.5 rounded-sm hidden sm:block" aria-label="Notifications">
              <Bell size={16} strokeWidth={2} />
            </button>
          </>
        )}
        {showExitButton && (
          <>
            <div className="w-px h-5 md:h-6 lg:h-8 bg-gray-200 mx-0.5 md:mx-1 lg:mx-2 hidden sm:block"></div>
            <button
              type="button"
              onClick={handleExit}
              className="flex items-center gap-1 md:gap-1.5 lg:gap-2 px-1.5 md:px-2 lg:px-3 py-1 md:py-1.5 bg-gray-50 text-gray-900 font-bold text-[10px] md:text-xs lg:text-sm rounded-sm flex-shrink-0"
              aria-label={isExamActive ? "Exit exam" : "Exit preview"}
            >
              <Menu size={14} strokeWidth={2.5} />
              <span className="hidden sm:inline">Exit</span>
            </button>
          </>
        )}
      </div>
      
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title">
          <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8">
            <h2 id="exit-confirm-title" className="text-xl font-black text-gray-900 mb-3">Exit Exam?</h2>
            <p className="text-sm text-gray-700 leading-6 mb-6">
              Are you sure you want to exit the exam? Your progress will be saved, but you will not be able to return to this session.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="px-4 py-2 bg-gray-50 text-gray-900 font-bold text-sm rounded-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmExit}
                className="px-4 py-2 bg-red-800 text-white font-bold text-sm rounded-sm"
              >
                Exit Exam
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
