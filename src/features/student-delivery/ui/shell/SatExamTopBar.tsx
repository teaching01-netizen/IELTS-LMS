import { useId, useRef, type Ref } from "react";
import { BookOpen, Calculator, ChevronDown, EllipsisVertical, Highlighter } from "lucide-react";
import { SAT_COPY, satNotesToolLabel } from "../../domain/satCopy";
import type { StructuredContent } from "../../../exam-authoring/api/assessmentContracts";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { useStudentTimerAnnouncement } from "@shared/hooks/useStudentTimerAnnouncement";
import { SatDirectionsPopover } from "./SatDirectionsPopover";
import { SatReadingPopover } from "./SatReadingPopover";

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
  /** R&W-only. When false both Highlights & Notes controls are hidden, not disabled. */
  notesAvailable: boolean;
  /**
   * The armed annotation mode: selecting text may raise annotation controls.
   *
   * Held by the shell's interaction machine, never derived here from a
   * selection or from the Notes column being open.
   */
  annotationModeEnabled: boolean;
  /** True when the current question already carries marks or a note (dot). */
  hasAnnotations?: boolean | undefined;
  /** Notes this question holds, written beside the disclosure. */
  notesCount: number;
  /** True while the Notes column is part of the layout (not "a popover is up"). */
  notesOpen: boolean;
  notesButtonId: string;
  onToggleAnnotationMode: () => void;
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
  /**
   * Measures the panes again and lands on a zoom where the question fits.
   * Optional only so this bar can render with no exam behind it (harnesses,
   * tests): wherever a shell renders it, the shell supplies the measurement —
   * staff preview included, since preview lays out the same panes.
   */
  onFitToScreen?: (() => void) | undefined;
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
      className="sat-exam-topbar relative z-[60] min-w-0 border-b border-[var(--sat-divider-strong)] bg-[var(--sat-shell-bg)]"
      role="banner"
    >
      {/* Bluebook 3-anchor header: context | independently-centered timer | tools. Mobile keeps 2-row stacking. */}
      <div className="mx-auto grid min-h-0 min-w-0 max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 py-1 lg:h-[96px] lg:min-h-0 lg:grid-cols-[minmax(280px,1fr)_180px_minmax(280px,1fr)] lg:grid-rows-1 lg:gap-3 lg:py-0">
        <div className="sat-popover-anchor relative col-start-1 row-start-1 flex min-w-0 items-center gap-2 self-stretch lg:col-auto lg:row-auto lg:block lg:py-3">
          <p className="sat-type-body min-w-0 truncate font-semibold leading-6 text-[var(--sat-text)]">
            {props.sectionLabel}
          </p>
          <button
            ref={directionsButtonRef}
            type="button"
            data-sat-focus="topbar-directions"
            onClick={props.onToggleDirections}
            aria-expanded={props.directionsOpen}
            // Closed triggers expose no target at all: the panel unmounts, so
            // an unconditional aria-controls would dangle (Task 6).
            aria-controls={props.directionsOpen ? directionsId : undefined}
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

        <div className="col-start-2 row-start-1 flex min-w-[84px] flex-col items-center justify-center self-stretch text-center lg:col-auto lg:row-auto lg:min-w-[96px]">
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

        <div className="relative col-span-2 row-start-2 flex min-w-0 flex-wrap items-center justify-end gap-1 self-stretch lg:col-span-1 lg:col-start-auto lg:row-start-auto lg:flex-nowrap" role="group" aria-label="Test tools">
          {/* Two controls, two meanings — never one control with two:

              - the labeled entry ARMS annotation. Its pressed state is the
                mode and its click does nothing else: no panel opens, no draft
                is created, and the exam layout does not move. Arming is the
                student saying "I am about to mark something up".
              - the disclosure beside it opens the Notes column, which stays a
                separate state: reviewing notes with annotation disarmed is a
                normal thing to be, and so is arming annotation with nothing
                open. Coupling them is what makes a toggle mean two things.

              The label is never shortened to an icon-only state: a bare
              highlighter glyph would have to be decoded, and the whole point of
              this pass is that a first-time student never has to decode. */}
          {props.notesAvailable ? (
            <div className="flex items-stretch" role="none" data-sat-annotation-group="true">
              <TopToolButton
                dataSatFocus="topbar-annotations"
                label={SAT_COPY.annotations.toolLabel}
                pressed={props.annotationModeEnabled}
                disabled={props.blocked}
                onClick={props.onToggleAnnotationMode}
                icon={<Highlighter className="h-5 w-5" aria-hidden="true" />}
              />
              <button
                id={props.notesButtonId}
                type="button"
                data-sat-focus="topbar-notes"
                data-sat-notes-disclosure="true"
                onClick={props.onToggleNotes}
                disabled={props.blocked}
                aria-expanded={props.notesOpen}
                aria-label={satNotesToolLabel({
                  count: props.notesCount,
                  hasHighlights: props.hasAnnotations === true,
                })}
                className="sat-touch-target sat-pressable relative flex min-w-11 items-center justify-center gap-1 px-1.5 sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] lg:min-w-[44px] lg:flex-col lg:gap-1"
              >
                <span className="flex items-center gap-1">
                  <ChevronDown
                    className={props.notesOpen ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"}
                    aria-hidden="true"
                  />
                  {props.notesCount > 0 ? (
                    <span
                      data-sat-notes-count="true"
                      className="sat-tabular rounded-full bg-[var(--sat-surface-hover)] px-1.5 text-[11px] font-semibold text-[var(--sat-text)]"
                    >
                      {props.notesCount}
                    </span>
                  ) : null}
                </span>
                <span className="hidden max-w-[80px] truncate text-[13px] min-[420px]:inline">
                  {SAT_COPY.annotations.notesTool}
                </span>
                {props.hasAnnotations === true ? (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--sat-accent-strong)]" aria-hidden="true" />
                ) : null}
              </button>
            </div>
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
              onFitToScreen={props.onFitToScreen}
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
              className="sat-touch-target sat-pressable flex min-w-11 flex-col items-center justify-center gap-1 px-2 sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] lg:h-[66px] lg:min-w-[68px]"
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
  buttonRef,
  dataSatFocus,
  dataSatToolTrigger,
  label,
  icon,
  pressed,
  disabled,
  onClick,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  dataSatFocus?: string | undefined;
  dataSatToolTrigger?: "calculator" | "reference" | undefined;
  label: string;
  icon: React.ReactNode;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      data-sat-focus={dataSatFocus}
      data-sat-tool-trigger={dataSatToolTrigger}
      type="button"
      onClick={onClick}
      disabled={disabled}
      // A real toggle, announced as one: pressed is the armed mode, and the
      // 2px underline below says the same thing to a student at a glance. The
      // active state is never colour alone.
      aria-pressed={pressed}
      aria-label={label}
      className="sat-touch-target sat-pressable relative flex min-w-11 items-center justify-center gap-1.5 px-2 min-[420px]:min-w-[72px] sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] lg:h-[66px] lg:min-w-[68px] lg:flex-col lg:gap-1"
    >
      {icon}
      <span className="hidden max-w-[80px] truncate text-[13px] min-[420px]:inline">{label}</span>
      {pressed ? (
        <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--sat-text)]" aria-hidden="true" />
      ) : null}
    </button>
  );
}
