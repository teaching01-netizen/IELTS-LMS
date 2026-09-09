import { useId, useRef, type Ref } from "react";
import { BookOpen, Calculator, ChevronDown, Pencil } from "lucide-react";
import type { StructuredContent } from "../../../exam-authoring/api/assessmentContracts";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { useStudentTimerAnnouncement } from "@shared/hooks/useStudentTimerAnnouncement";
import { SatDirectionsPopover } from "./SatDirectionsPopover";
import { SatReadingPopover } from "./SatReadingPopover";
import type { SatAnnotationMode } from '../annotations/SatAnnotationModeContext';

export interface SatExamTopBarProps {
  sectionLabel: string;
  directions: StructuredContent | null;
  directionsOpen: boolean;
  remainingLabel: string;
  remainingSeconds?: number | undefined;
  timerVisible: boolean;
  calculatorAvailable: boolean;
  calculatorOpen: boolean;
  referenceAvailable: boolean;
  referenceOpen: boolean;
  /** R&W-only. When false the Notes tool is hidden instead of disabled. */
  notesAvailable: boolean;
  annotationMode?: SatAnnotationMode;
  lineReaderEnabled?: boolean;
  onToggleLineReader?: () => void;
  onToggleAnnotationMode?: (mode: 'highlight' | 'underline' | 'erase') => void;
  notesOpen: boolean;
  notesButtonId: string;
  readingOpen: boolean;
  readingPreferences: SatReadingPreferences;
  blocked: boolean;
  onToggleDirections: () => void;
  onCloseDirections: () => void;
  onToggleTimer: () => void;
  onToggleCalculator: () => void;
  onToggleReference: () => void;
  onToggleNotes: () => void;
  onToggleReading: () => void;
  onCloseReading: () => void;
  onReadingPreferencesChange: (preferences: SatReadingPreferences) => void;
}

export function SatExamTopBar(props: SatExamTopBarProps) {
  const directionsId = useId();
  const directionsButtonRef = useRef<HTMLButtonElement>(null);
  const readingButtonRef = useRef<HTMLButtonElement>(null);
  // T2.5: shared threshold announcer (5-min / 1-min, never per-second),
  // mirroring the IELTS headers. Per-tick label keeps no live region.
  const timerAnnouncement = useStudentTimerAnnouncement(props.remainingSeconds);

  return (
    <header
      className="sat-exam-topbar relative z-[60] border-b border-[var(--sat-divider)] bg-[var(--sat-background)]"
      role="banner"
    >
      <div className="mx-auto grid min-h-[96px] max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 py-1 sm:h-[90px] sm:min-h-0 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:grid-rows-1 sm:gap-3 sm:py-0">
        <div className="relative col-start-1 row-start-1 flex min-w-0 items-center gap-2 self-stretch sm:col-auto sm:row-auto sm:block sm:py-3">
          <p className="sat-type-body truncate font-semibold leading-6 text-[var(--sat-text)]">
            {props.sectionLabel}
          </p>
          <button
            ref={directionsButtonRef}
            type="button"
            onClick={props.onToggleDirections}
            aria-expanded={props.directionsOpen}
            aria-controls={directionsId}
            aria-haspopup="dialog"
            className="sat-touch-target sat-pressable inline-flex shrink-0 items-center gap-1 sat-type-control-secondary font-medium text-[var(--sat-text)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            Directions <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <SatDirectionsPopover
            id={directionsId}
            open={props.directionsOpen}
            title={props.sectionLabel}
            instructions={props.directions}
            triggerRef={directionsButtonRef}
            onClose={props.onCloseDirections}
          />
        </div>

        <div className="col-start-2 row-start-1 flex min-w-[84px] flex-col items-center justify-center self-stretch text-center sm:col-auto sm:row-auto sm:min-w-[96px]">
          <span
            className="sat-tabular sat-type-timer font-semibold text-[var(--sat-text)]"
            aria-label={
              props.timerVisible
                ? `Time remaining ${props.remainingLabel}`
                : "Time remaining hidden"
            }
          >
            {props.timerVisible ? props.remainingLabel : "—:—"}
          </span>
          {/* T2.5: polite threshold announcements only (5-min / 1-min). */}
          <span className="sr-only" aria-live="polite" data-testid="sat-timer-announcement">
            {timerAnnouncement}
          </span>
          <button
            type="button"
            onClick={props.onToggleTimer}
            aria-label={props.timerVisible ? "Hide time remaining" : "Show time remaining"}
            className="sat-touch-target sat-pressable mt-0.5 inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            <span className="rounded-full border border-[var(--sat-text)] px-3 py-1 sat-type-metadata font-semibold text-[var(--sat-text)]">
              {props.timerVisible ? "Hide" : "Show"}
            </span>
          </button>
        </div>

        <div className="relative col-span-2 row-start-2 flex min-w-0 items-center justify-end gap-1 self-stretch sm:col-span-1 sm:col-start-auto sm:row-start-auto">
          {props.notesAvailable ? (['highlight', 'underline', 'erase'] as const).map((mode) => (
            <button key={mode} type="button" aria-label={mode === 'highlight' ? 'Highlight' : mode === 'underline' ? 'Underline' : 'Eraser'}
              aria-pressed={props.annotationMode === mode} disabled={props.blocked}
              onClick={() => props.onToggleAnnotationMode?.(mode)}
              className="sat-touch-target min-w-0 rounded px-2 text-sm font-medium aria-pressed:bg-[var(--sat-accent-soft)] aria-pressed:text-[var(--sat-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]"
            >{mode === 'highlight' ? 'Highlight' : mode === 'underline' ? 'Underline' : 'Eraser'}</button>
          )) : null}
          {props.notesAvailable ? (
            <button type="button" aria-label="Line Reader" aria-pressed={props.lineReaderEnabled ?? false} disabled={props.blocked}
              onClick={props.onToggleLineReader}
              className="sat-touch-target rounded px-2 text-sm font-medium aria-pressed:bg-[var(--sat-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]">Line Reader</button>
          ) : null}
          <div className="relative shrink-0">
            <TopToolButton
              buttonRef={readingButtonRef}
              label="Reading"
              pressed={props.readingOpen}
              disabled={props.blocked}
              onClick={props.onToggleReading}
              icon={
                <span className="text-[15px] font-semibold tracking-[-0.04em]" aria-hidden="true">
                  Aa
                </span>
              }
            />
            <SatReadingPopover
              open={props.readingOpen}
              disabled={props.blocked}
              preferences={props.readingPreferences}
              triggerRef={readingButtonRef}
              onChange={props.onReadingPreferencesChange}
              onClose={props.onCloseReading}
            />
          </div>
          {props.notesAvailable ? (
            <TopToolButton
              id={props.notesButtonId}
              label="Notes"
              pressed={props.notesOpen}
              disabled={props.blocked}
              onClick={props.onToggleNotes}
              icon={<Pencil className="h-[18px] w-[18px]" aria-hidden="true" />}
            />
          ) : null}
          {props.calculatorAvailable ? (
            <TopToolButton
              label="Calculator"
              pressed={props.calculatorOpen}
              disabled={props.blocked}
              onClick={props.onToggleCalculator}
              icon={<Calculator className="h-[18px] w-[18px]" aria-hidden="true" />}
            />
          ) : null}
          {props.referenceAvailable ? (
            <TopToolButton
              label="Reference"
              pressed={props.referenceOpen}
              disabled={props.blocked}
              onClick={props.onToggleReference}
              icon={<BookOpen className="h-[18px] w-[18px]" aria-hidden="true" />}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}

function TopToolButton({
  id,
  buttonRef,
  label,
  icon,
  pressed,
  disabled,
  onClick,
}: {
  id?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  label: string;
  icon: React.ReactNode;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      className="sat-touch-target sat-pressable flex min-w-11 items-center justify-center gap-1.5 px-2 min-[420px]:min-w-[72px] sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] sm:h-[66px] sm:min-w-[68px] sm:flex-col sm:gap-1"
    >
      {icon}
      <span className="hidden max-w-[80px] truncate min-[420px]:inline">{label}</span>
    </button>
  );
}
