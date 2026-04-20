import React, { useState } from 'react';
import { Wifi, Bell, Menu, Clock, CheckCircle, Loader2, Contrast, LayoutGrid } from 'lucide-react';

interface StudentHeaderProps {
  onExit: () => void;
  timeRemaining?: number | undefined;
  elapsedTime?: number | undefined;
  totalSectionTime?: number | undefined;
  autoSaveStatus?: 'saved' | 'saving' | 'syncing' | 'offline' | null | undefined;
  onOpenAccessibility?: (() => void) | undefined;
  onOpenNavigator?: (() => void) | undefined;
  isExamActive?: boolean | undefined;
}

export function StudentHeader({
  onExit,
  timeRemaining,
  elapsedTime = 0,
  totalSectionTime = 0,
  autoSaveStatus,
  onOpenAccessibility,
  onOpenNavigator,
  isExamActive = false,
}: StudentHeaderProps) {
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  
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

  return (
    <header className="h-14 md:h-16 border-b border-gray-200 bg-white flex items-center justify-between px-3 md:px-4 lg:px-6 flex-shrink-0 z-10 shadow-sm" role="banner">
      <div className="flex items-center gap-3 md:gap-4 lg:gap-6 min-w-0">
        <div className="bg-white border-2 border-gray-900 px-1.5 md:px-2 lg:px-3 py-0.5 rounded-sm flex-shrink-0">
          <div className="text-gray-900 font-black text-lg md:text-xl lg:text-2xl tracking-tighter" style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif' }}>IELTS</div>
        </div>
        <div className="flex flex-col min-w-0 hidden sm:flex">
          <div className="font-bold text-[10px] md:text-[11px] text-gray-600 uppercase tracking-widest">Test taker ID</div>
          <div className="text-xs md:text-sm font-bold text-gray-900 truncate">IELTS-PRO-2024-001</div>
        </div>
      </div>
      
      {timeRemaining !== undefined && (
        <div className="flex items-center gap-2 md:gap-3 lg:gap-4 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 md:gap-2 lg:gap-3 flex-shrink-0">
            <div className="text-right hidden sm:block">
              <div className="text-[9px] md:text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-0.5">Elapsed</div>
              <div className="font-mono text-xs md:text-sm font-bold text-gray-700">{formatTime(elapsedTime)}</div>
            </div>
            <div className="w-px h-5 md:h-6 lg:h-8 bg-gray-200 hidden sm:block"></div>
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
            <div className="text-right hidden md:block">
              <div className="text-[9px] md:text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-0.5">Total</div>
              <div className="font-mono text-xs md:text-sm font-bold text-gray-700">{formatTime(totalSectionTime)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 md:gap-2 lg:gap-4 text-gray-700 flex-shrink-0">
        {autoSaveStatus && (
          <div className="flex items-center gap-1 md:gap-1.5 text-[9px] md:text-[10px] lg:text-xs font-bold uppercase tracking-wider hidden sm:flex">
            {autoSaveStatus === 'saving' || autoSaveStatus === 'syncing' ? (
              <>
                <Loader2 size={10} className="animate-spin text-gray-600" />
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
        {onOpenAccessibility && (
          <button
            onClick={onOpenAccessibility}
            className="p-1 md:p-1.5 rounded-sm flex-shrink-0"
            aria-label="Open accessibility settings"
          >
            <Contrast size={16} strokeWidth={2} />
          </button>
        )}
        {onOpenNavigator && (
          <button
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
            <button className="p-1 md:p-1.5 rounded-sm relative hidden sm:block" aria-label="Connection status: Online">
              <Wifi size={16} strokeWidth={2} />
              <div className="absolute top-1 md:top-1.5 right-1 md:right-1.5 w-1.5 md:w-2 h-1.5 md:h-2 bg-green-600 rounded-full border-2 border-white"></div>
            </button>
            <button className="p-1 md:p-1.5 rounded-sm hidden sm:block" aria-label="Notifications">
              <Bell size={16} strokeWidth={2} />
            </button>
          </>
        )}
        <div className="w-px h-5 md:h-6 lg:h-8 bg-gray-200 mx-0.5 md:mx-1 lg:mx-2 hidden sm:block"></div>
        <button
          onClick={handleExit}
          className="flex items-center gap-1 md:gap-1.5 lg:gap-2 px-1.5 md:px-2 lg:px-3 py-1 md:py-1.5 bg-gray-50 text-gray-900 font-bold text-[10px] md:text-xs lg:text-sm rounded-sm flex-shrink-0"
          aria-label={isExamActive ? "Exit exam" : "Exit preview"}
        >
          <Menu size={14} strokeWidth={2.5} />
          <span className="hidden sm:inline">Exit</span>
        </button>
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
