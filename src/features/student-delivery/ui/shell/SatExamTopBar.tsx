import { useId, useRef, type Ref } from "react";
import { BookOpen, Calculator, ChevronDown, EllipsisVertical, Highlighter, Pencil } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
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
  /** Announced once when a hidden timer auto-reveals at the 5-minute mark. */
  timerRevealAnnouncement?: string | null | undefined;
  calculatorAvailable: boolean;
  calculatorOpen: boolean;
  referenceAvailable: boolean;
  referenceOpen: boolean;
  /** R&W-only. When false the Notes tool is hidden instead of disabled. */
  notesAvailable: boolean;
  /** True when the current question already has a question note (has-note dot). */
  hasQuestionNote?: boolean | undefined;
  annotationMode?: SatAnnotationMode;
  onToggleHighlights?: (() => void) | undefined;
  notesOpen: boolean;
  notesButtonId: string;
  moreOpen: boolean;
  readingOpen: boolean;
  readingPreferences: SatReadingPreferences;
  blocked: boolean;
  onToggleDirections: () => void;
  onCloseDirections: () => void;
  onToggleTimer: () => void;
  onToggleCalculator: () => void;
  onToggleReference: () => void;
  onToggleNotes: () => void;
  onToggleMore: () => void;
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
      className="sat-exam-topbar relative z-[60] border-b border-[var(--sat-divider-strong)] bg-[var(--sat-shell-bg)]"
      role="banner"
    >
      {/* Bluebook 3-anchor header: context | independently-centered timer | tools. Mobile keeps 2-row stacking. */}
      <div className="mx-auto grid min-h-[96px] max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 py-1 sm:h-[96px] sm:min-h-0 sm:grid-cols-[minmax(280px,1fr)_180px_minmax(280px,1fr)] sm:grid-rows-1 sm:gap-3 sm:py-0">
        <div className="sat-popover-anchor relative col-start-1 row-start-1 flex min-w-0 items-center gap-2 self-stretch sm:col-auto sm:row-auto sm:block sm:py-3">
          <p className="sat-type-body truncate font-semibold leading-6 text-[var(--sat-text)]">
            {props.sectionLabel}
          </p>
          <button
            ref={directionsButtonRef}
            type="button"
            data-sat-focus="topbar-directions"
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
            role="timer"
            aria-label={
              props.timerVisible
                ? `Time remaining ${props.remainingLabel}`
                : "Timer hidden. Reappears at 5:00."
            }
          >
            {props.timerVisible ? props.remainingLabel : "Hidden"}
          </span>
          {/* T2.5: polite threshold announcements only (5-min / 1-min), plus
              the one-shot auto-reveal notice when a hidden timer reappears. */}
          <span className="sr-only" aria-live="polite" data-testid="sat-timer-announcement">
            {timerAnnouncement}
          </span>
          {props.timerRevealAnnouncement ? (
            <span className="sr-only" aria-live="polite" data-testid="sat-timer-reveal-announcement">
              {props.timerRevealAnnouncement}
            </span>
          ) : null}
          <button
            type="button"
            onClick={props.onToggleTimer}
            aria-label={props.timerVisible ? "Hide timer" : "Show timer"}
            className="sat-touch-target sat-pressable mt-0.5 inline-flex items-center justify-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            <span className="sat-type-control-secondary font-semibold text-[var(--sat-text)]">
              {props.timerVisible ? "Hide" : "Show"}
            </span>
          </button>
        </div>

        <div className="relative col-span-2 row-start-2 flex min-w-0 items-center justify-end gap-1 self-stretch sm:col-span-1 sm:col-start-auto sm:row-start-auto" role="group" aria-label="Test tools">
          {/* Highlight (passage selection marks) and Question note (freeform
              per-question panel) are SEPARATE top-bar entries: the note is
              always reachable when available, never gated on highlight mode. */}
          {props.notesAvailable ? (
            <TopToolButton
              label="Highlight"
              pressed={props.annotationMode === 'highlight'}
              disabled={props.blocked}
              onClick={() => props.onToggleHighlights?.()}
              icon={<Highlighter className="h-5 w-5" aria-hidden="true" />}
            />
          ) : null}
          {props.notesAvailable ? (
            <TopToolButton
              id={props.notesButtonId}
              dataSatFocus="topbar-notes"
              label="Question note"
              pressed={props.notesOpen}
              disabled={props.blocked}
              onClick={props.onToggleNotes}
              hasIndicator={props.hasQuestionNote}
              icon={<Pencil className="h-5 w-5" aria-hidden="true" />}
            />
          ) : null}
          <div className="sat-popover-anchor relative shrink-0">
            <TopToolButton
              buttonRef={readingButtonRef}
              dataSatFocus="topbar-reading"
              label="Display"
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
          {props.calculatorAvailable ? (
            <TopToolButton
              label="Calculator"
              dataSatToolTrigger="calculator"
              pressed={props.calculatorOpen}
              disabled={props.blocked}
              onClick={props.onToggleCalculator}
              icon={<Calculator className="h-5 w-5" aria-hidden="true" />}
            />
          ) : null}
          {props.referenceAvailable ? (
            <TopToolButton
              label="Reference"
              dataSatToolTrigger="reference"
              pressed={props.referenceOpen}
              disabled={props.blocked}
              onClick={props.onToggleReference}
              icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
            />
          ) : null}
          {/* Bluebook More utility center (Phase 1): tiny subordinate trigger at
              the extreme top-right. Never disabled — Help/Shortcuts stay
              reachable read-only while blocked. */}
          <div className="sat-popover-anchor relative shrink-0">
            <button
              type="button"
              onClick={props.onToggleMore}
              aria-expanded={props.moreOpen}
              aria-haspopup="menu"
              aria-label={SAT_COPY.more.triggerLabel}
              data-sat-focus="topbar-more"
              className="sat-touch-target sat-pressable flex min-w-11 flex-col items-center justify-center gap-1 px-2 sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] sm:h-[66px] sm:min-w-[68px]"
            >
              <EllipsisVertical className="h-5 w-5" aria-hidden="true" />
              <span className="hidden max-w-[80px] truncate min-[420px]:inline">{SAT_COPY.more.trigger}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function TopToolButton({
  id,
  buttonRef,
  dataSatFocus,
  dataSatToolTrigger,
  label,
  icon,
  pressed,
  disabled,
  hasIndicator,
  onClick,
}: {
  id?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  dataSatFocus?: string | undefined;
  dataSatToolTrigger?: "calculator" | "reference" | undefined;
  label: string;
  icon: React.ReactNode;
  pressed: boolean;
  disabled: boolean;
  hasIndicator?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      id={id}
      data-sat-focus={dataSatFocus}
      data-sat-tool-trigger={dataSatToolTrigger}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={hasIndicator === true ? label + ", has note" : label}
      className="sat-touch-target sat-pressable relative flex min-w-11 items-center justify-center gap-1.5 px-2 min-[420px]:min-w-[72px] sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] sm:h-[66px] sm:min-w-[68px] sm:flex-col sm:gap-1"
    >
      {icon}
      <span className="hidden max-w-[80px] truncate text-[13px] min-[420px]:inline">{label}</span>
      {pressed ? (
        <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--sat-text)]" aria-hidden="true" />
      ) : null}
      {hasIndicator === true ? (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--sat-accent-strong)]" aria-hidden="true" />
      ) : null}
    </button>
  );
}
