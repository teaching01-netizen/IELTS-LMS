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
import type { ExamType } from "../../../types";
import { useStudentTimerAnnouncement } from "@shared/hooks/useStudentTimerAnnouncement";
import { StudentToolsSheet } from "./StudentToolsSheet";
import {
  getStudentSaveStatusPresentation,
  type StudentAutoSaveStatus,
} from "../saveStatusPresentation";

interface CompactStudentHeaderProps {
  readonly examType?: ExamType | undefined;
  readonly moduleLabel: string;
  readonly testTakerId?: string | undefined;
  readonly timeRemaining?: number | undefined;
  readonly autoSaveStatus?: StudentAutoSaveStatus | null | undefined;
  readonly highlightEnabled?: boolean | undefined;
  readonly highlightToolMode?: StudentHighlightToolMode | undefined;
  readonly highlightColor?: StudentHighlightColor | undefined;
  readonly onToggleHighlightMode?: (() => void) | undefined;
  readonly onSelectHighlightColor?: ((color: StudentHighlightColor) => void) | undefined;
  readonly onSelectEraseMode?: (() => void) | undefined;
  readonly choiceEliminationAvailable?: boolean | undefined;
  readonly choiceEliminationEnabled?: boolean | undefined;
  readonly onToggleChoiceElimination?: (() => void) | undefined;
  readonly onOpenAccessibility?: (() => void) | undefined;
  readonly onOpenNavigator?: (() => void) | undefined;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// Inset-grouped cells: a filled row with no resting outline; the active
// state adds an edge so it never relies on the tint alone.
const sheetActionClassName = `student-touch-target flex items-center gap-3 rounded-xl border px-3 text-left text-[length:var(--student-control-font-size)] font-semibold text-gray-900 transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out`;
const sheetActionRestClassName = "border-transparent bg-gray-100 hover:bg-gray-200 active:bg-gray-200";
const sheetActionActiveClassName = "border-blue-700 bg-blue-50";

export function CompactStudentHeader({
  examType = "Academic",
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
  choiceEliminationAvailable = false,
  choiceEliminationEnabled = false,
  onToggleChoiceElimination,
  onOpenAccessibility,
  onOpenNavigator,
}: CompactStudentHeaderProps) {
  const saveStatus = autoSaveStatus ? getStudentSaveStatusPresentation(autoSaveStatus) : null;
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const closeTools = useCallback(() => {
    setToolsOpen(false);
    queueMicrotask(() => toolsTriggerRef.current?.focus());
  }, []);
  // T2.5: shared threshold announcer (5-min / 1-min, never per-second),
  // mirroring StudentHeader. Per-tick timer keeps no live region so only
  // threshold crossings announce.
  const timerAnnouncement = useStudentTimerAnnouncement(timeRemaining);
  const activePaletteEntry = getStudentHighlightPaletteEntry(highlightColor);
  const hasHighlightTools = highlightEnabled && onToggleHighlightMode && onSelectEraseMode;
  const shouldShowChoiceEliminationTool = Boolean(
    examType === "ACT" && choiceEliminationAvailable && onToggleChoiceElimination,
  );

  return (
    <header
      className="student-compact-header flex flex-shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3"
      role="banner"
      data-testid="student-compact-header"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 border border-gray-900 px-1.5 py-0.5 text-lg font-bold tracking-tight text-gray-900">
            {examType === "ACT" ? "ACT" : "IELTS"}
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
          {/* T2.5: polite threshold announcements only (5-min / 1-min). */}
          <span className="sr-only" aria-live="polite" data-testid="student-timer-announcement">
            {timerAnnouncement}
          </span>
        </div>
      ) : null}

      {saveStatus ? (
        <span
          className={`flex min-h-8 max-w-32 flex-shrink-0 items-center justify-center rounded-sm px-1.5 text-[length:var(--student-meta-font-size)] font-semibold whitespace-nowrap ${
            {
              success: "text-green-900",
              neutral: "text-gray-700",
              warning: "text-amber-800",
              danger: "text-red-700",
            }[saveStatus.tone]
          }`}
          role="status"
          aria-live="polite"
          data-testid="student-auto-save-status"
        >
          {saveStatus.shortLabel}
          <span className="sr-only">{saveStatus.label.slice(saveStatus.shortLabel.length)}</span>
        </span>
      ) : null}

      <button
        ref={toolsTriggerRef}
        type="button"
        className="student-touch-target flex flex-shrink-0 items-center justify-center rounded-sm bg-gray-50 text-gray-900 transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out hover:bg-gray-100"
        aria-label="Open exam tools"
        aria-expanded={toolsOpen}
        onClick={() => setToolsOpen((open) => !open)}
        data-student-primary-touch-target
      >
        <MoreHorizontal size={21} aria-hidden="true" />
      </button>

      <StudentToolsSheet open={toolsOpen} onClose={closeTools}>
        {shouldShowChoiceEliminationTool ? (
          <button
            type="button"
            className={`${sheetActionClassName} ${choiceEliminationEnabled ? sheetActionActiveClassName : sheetActionRestClassName}`}
            aria-pressed={choiceEliminationEnabled}
            onClick={() => {
              onToggleChoiceElimination?.();
              closeTools();
            }}
            data-student-primary-touch-target
          >
            <span aria-hidden="true">×</span>
            <span>Eliminate choices</span>
          </button>
        ) : null}
        {onOpenNavigator ? (
          <button
            type="button"
            className={`${sheetActionClassName} ${sheetActionRestClassName}`}
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
              className={`${sheetActionClassName} ${highlightToolMode === "highlight" ? sheetActionActiveClassName : sheetActionRestClassName}`}
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
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Highlight colors">
              {studentHighlightPalette.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`student-touch-target flex items-center gap-2 rounded-xl border px-3 text-[length:var(--student-control-font-size)] font-semibold text-gray-900 transition-[background-color,border-color,box-shadow,opacity] duration-100 ease-out ${
                    highlightColor === entry.id ? sheetActionActiveClassName : sheetActionRestClassName
                  }`}
                  aria-label={entry.label}
                  aria-pressed={highlightColor === entry.id}
                  onClick={() => onSelectHighlightColor?.(entry.id)}
                  data-student-primary-touch-target
                >
                  <span
                    className={`h-5 w-5 rounded-sm border border-gray-500 ${entry.swatchClassName}`}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-left">{entry.label}</span>
                  {highlightColor === entry.id ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`${sheetActionClassName} ${highlightToolMode === "erase" ? sheetActionActiveClassName : sheetActionRestClassName}`}
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
            className={`${sheetActionClassName} ${sheetActionRestClassName}`}
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
