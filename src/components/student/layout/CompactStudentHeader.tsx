import { useCallback, useRef, useState } from "react";
import {
  Accessibility,
  Check,
  Clock,
  Eraser,
  Grid2X2,
  Highlighter,
  MoreHorizontal,
} from "lucide-react";
import {
  getStudentHighlightPaletteEntry,
  studentHighlightPalette,
  type StudentHighlightColor,
} from "../highlightPalette";
import type { StudentHighlightToolMode } from "../providers/StudentUIProvider";
import { StudentToolsSheet } from "./StudentToolsSheet";

interface CompactStudentHeaderProps {
  readonly moduleLabel: string;
  readonly testTakerId?: string | undefined;
  readonly timeRemaining?: number | undefined;
  readonly autoSaveStatus?: "saved" | "saving" | "syncing" | "offline" | "error" | null | undefined;
  readonly highlightEnabled?: boolean | undefined;
  readonly highlightToolMode?: StudentHighlightToolMode | undefined;
  readonly highlightColor?: StudentHighlightColor | undefined;
  readonly onToggleHighlightMode?: (() => void) | undefined;
  readonly onSelectHighlightColor?: ((color: StudentHighlightColor) => void) | undefined;
  readonly onSelectEraseMode?: (() => void) | undefined;
  readonly onOpenAccessibility?: (() => void) | undefined;
  readonly onOpenNavigator?: (() => void) | undefined;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

const sheetActionClassName = `student-touch-target flex items-center gap-3 rounded-sm border border-gray-200 px-3 text-left text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-[scale,background-color,border-color,box-shadow,opacity] duration-150 ease-out active:scale-[0.96]`;

export function CompactStudentHeader({
  moduleLabel,
  testTakerId,
  timeRemaining,
  autoSaveStatus,
  highlightEnabled = false,
  highlightToolMode = "off",
  highlightColor = "yellow",
  onToggleHighlightMode,
  onSelectHighlightColor,
  onSelectEraseMode,
  onOpenAccessibility,
  onOpenNavigator,
}: CompactStudentHeaderProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const closeTools = useCallback(() => {
    setToolsOpen(false);
    queueMicrotask(() => toolsTriggerRef.current?.focus());
  }, []);
  const activePaletteEntry = getStudentHighlightPaletteEntry(highlightColor);
  const hasHighlightTools = highlightEnabled && onToggleHighlightMode && onSelectEraseMode;

  return (
    <header
      className="student-compact-header flex flex-shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3"
      role="banner"
      data-testid="student-compact-header"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 border border-gray-900 px-1.5 py-0.5 text-lg font-bold tracking-tight text-gray-900">
            IELTS
          </span>
          <span className="truncate text-sm font-semibold text-gray-700">{moduleLabel}</span>
        </div>
        <span className="sr-only">Test taker ID {testTakerId ?? "—"}</span>
      </div>

      {timeRemaining !== undefined ? (
        <div
          className={`flex min-h-10 flex-shrink-0 items-center gap-1.5 rounded-sm border px-2 text-sm font-semibold transition-colors ${
            timeRemaining < 300
              ? "student-timer-urgent border-red-700 bg-red-100 text-red-900"
              : "border-gray-200 bg-gray-50 text-gray-900"
          }`}
          data-testid="student-header-timer-slot"
        >
          <Clock size={15} aria-hidden="true" />
          <span
            className="font-mono"
            role="timer"
            aria-label="Time remaining"
            data-testid="student-time-remaining"
          >
            {formatTime(timeRemaining)}
          </span>
        </div>
      ) : null}

      {autoSaveStatus ? (
        <span
          className={`flex min-h-8 max-w-28 flex-shrink-0 items-center justify-center rounded-sm px-1.5 text-[10px] font-semibold uppercase tracking-tight ${
            autoSaveStatus === "saved"
              ? "text-green-900"
              : autoSaveStatus === "offline"
                ? "text-amber-800"
                : autoSaveStatus === "error"
                  ? "text-red-700"
                  : "text-gray-700"
          }`}
          role="status"
          aria-live="polite"
          data-testid="student-auto-save-status"
        >
          {autoSaveStatus === "syncing"
            ? "Syncing"
            : autoSaveStatus === "saving"
              ? "Saving"
              : autoSaveStatus === "offline"
                ? "Offline"
                : autoSaveStatus === "error"
                  ? "Not synced"
                  : "Saved"}
        </span>
      ) : null}

      <button
        ref={toolsTriggerRef}
        type="button"
        className="student-touch-target flex flex-shrink-0 items-center justify-center rounded-sm bg-gray-50 text-gray-900 transition-[scale,background-color,border-color,box-shadow,opacity] duration-150 ease-out active:scale-[0.96] hover:bg-gray-100"
        aria-label="Open exam tools"
        aria-expanded={toolsOpen}
        onClick={() => setToolsOpen((open) => !open)}
        data-student-primary-touch-target
      >
        <MoreHorizontal size={21} aria-hidden="true" />
      </button>

      <StudentToolsSheet open={toolsOpen} onClose={closeTools}>
        {onOpenNavigator ? (
          <button
            type="button"
            className={sheetActionClassName}
            onClick={() => {
              onOpenNavigator();
              closeTools();
            }}
            data-student-primary-touch-target
          >
            <Grid2X2 size={18} aria-hidden="true" />
            <span>Question navigator</span>
          </button>
        ) : null}

        {hasHighlightTools ? (
          <>
            <button
              type="button"
              className={`${sheetActionClassName} ${highlightToolMode === "highlight" ? "border-blue-700 bg-blue-50" : ""}`}
              aria-pressed={highlightToolMode === "highlight"}
              onClick={onToggleHighlightMode}
              data-student-primary-touch-target
            >
              <Highlighter size={18} aria-hidden="true" />
              <span className="flex-1">
                {highlightToolMode === "highlight" ? "Highlighting" : "Highlight"}
              </span>
              <span
                className={`h-4 w-4 rounded-full border border-gray-700 ${activePaletteEntry.swatchClassName}`}
                aria-hidden="true"
              />
            </button>
            <div className="grid grid-cols-2 gap-2" aria-label="Highlight colors">
              {studentHighlightPalette.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="student-touch-target flex items-center gap-2 rounded-sm border border-gray-200 px-3 text-sm font-semibold text-gray-800 transition-[scale,background-color,border-color,box-shadow,opacity] duration-150 ease-out active:scale-[0.96] hover:bg-gray-50"
                  aria-label={entry.label}
                  onClick={() => onSelectHighlightColor?.(entry.id)}
                  data-student-primary-touch-target
                >
                  <span
                    className={`h-5 w-5 rounded-sm border border-gray-500 ${entry.swatchClassName}`}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-left">{entry.label}</span>
                  {highlightToolMode === "highlight" && highlightColor === entry.id ? (
                    <Check size={16} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`${sheetActionClassName} ${highlightToolMode === "erase" ? "border-blue-700 bg-blue-50" : ""}`}
              aria-pressed={highlightToolMode === "erase"}
              onClick={onSelectEraseMode}
              data-student-primary-touch-target
            >
              <Eraser size={18} aria-hidden="true" />
              <span>Erase highlights</span>
            </button>
          </>
        ) : null}

        {onOpenAccessibility ? (
          <button
            type="button"
            className={sheetActionClassName}
            onClick={() => {
              onOpenAccessibility();
              closeTools();
            }}
            data-student-primary-touch-target
          >
            <Accessibility size={18} aria-hidden="true" />
            <span>Accessibility settings</span>
          </button>
        ) : null}
      </StudentToolsSheet>
    </header>
  );
}
