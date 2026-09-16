import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SAT_TIMER_AUTO_REVEAL_SECONDS, shouldAutoRevealTimer } from "../domain/satTiming";
import type { StructuredContent } from "../../exam-authoring/api/assessmentContracts";
import type { SatQuestionNavigationItem } from "../domain/satSelectors";
import type { SatReadingPreferences } from "../domain/satReadingPreferences";
import { emptySatExamToolPolicy } from "../domain/satToolPolicy";
import type { SatInteractionContext } from "../domain/satInteractionState";
import { useSatInteractionController } from "../hooks/useSatInteractionController";
import { SatSaveStatus } from "./feedback/SatSaveStatus";
import { SatNotesPanel } from "./question/SatNotesPanel";
import { SatExamFooter } from "./shell/SatExamFooter";
import { SatExamTopBar } from "./shell/SatExamTopBar";
import { SatQuestionNavigator } from "./shell/SatQuestionNavigator";
import { SatAnnotationModeContext, type SatAnnotationMode } from './annotations/SatAnnotationModeContext';
import { SatUnscheduledBreakDialog } from './break/SatUnscheduledBreakDialog';
import { SatUnscheduledBreakVeil } from './break/SatUnscheduledBreakVeil';
import { SatHelpModal } from './help/SatHelpModal';
import { SatTimerWarning } from './shell/SatTimerWarning';
import { SatShortcutsModal } from './help/SatShortcutsModal';
import { useSatShortcuts } from '../hooks/useSatShortcuts';
import type { SatToolActionBinding } from '../domain/satToolActions';
import { SatMoreMenu } from './shell/SatMoreMenu';
import { SatLineReader } from './reading/SatLineReader';
import { SatContrastContext } from './reading/SatContrastContext';

export interface SatExamShellProps {
  moduleIdentity?: string;
  sectionLabel: string;
  directions: StructuredContent | null;
  remainingLabel: string;
  remainingSeconds?: number | undefined;
  /** Stable layout viewport height in px; null keeps the 100dvh fallback. */
  examHeight?: number | null | undefined;
  /** True while the visual viewport indicates an open software keyboard. */
  keyboardOpen?: boolean | undefined;
  candidateName: string;
  questionIndex: number;
  questionCount: number;
  navigationItems: readonly SatQuestionNavigationItem[];
  calculatorAvailable: boolean;
  calculatorOpen: boolean;
  referenceAvailable: boolean;
  referenceOpen: boolean;
  /** R&W-only annotation surface (highlight/underline/notes). Hidden in Math. */
  notesAvailable?: boolean | undefined;
  blocked: boolean;
  saveState: "idle" | "saving" | "offline" | "retrying" | "failed" | "superseded";
  saveFailure?: string | null;
  questionNote: string;
  readingPreferences: SatReadingPreferences;
  children: ReactNode;
  onSelectQuestion: (index: number) => void;
  onToggleCalculator: () => void;
  onToggleReference: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReviewModule: () => void;
  onSaveNote: (note: string) => void;
  helpOpen?: boolean | undefined;
  onOpenHelp?: (() => void) | undefined;
  onCloseHelp?: (() => void) | undefined;
  breakConfirmOpen?: boolean | undefined;
  onCloseBreakConfirm?: (() => void) | undefined;
  onTakeBreak?: (() => void) | undefined;
  breakVeilOpen?: boolean | undefined;
  onReturnFromBreak?: (() => void) | undefined;
  shortcutsOpen?: boolean | undefined;
  onOpenShortcuts?: (() => void) | undefined;
  onCloseShortcuts?: (() => void) | undefined;
  onCloseModals?: (() => void) | undefined;
  onNextQuestion?: (() => void) | undefined;
  onPreviousQuestion?: (() => void) | undefined;
  onToggleMarkForReview?: (() => void) | undefined;
  onToggleEliminationMode?: (() => void) | undefined;
  onZoomIn?: (() => void) | undefined;
  onZoomOut?: (() => void) | undefined;
  onZoomReset?: (() => void) | undefined;
  onOpenBreakConfirm?: (() => void) | undefined;
  breakAvailable?: boolean | undefined;
  onReadingPreferencesChange: (preferences: SatReadingPreferences) => void;
  onRetrySave?: () => void;
  onTakeOver?: (() => void) | undefined;
  isTakingOver?: boolean | undefined;
}

export function SatExamShell(props: SatExamShellProps) {
  // Strangler step 1: the interaction machine owns the exclusive surface +
  // annotation mode; the runner stays authoritative for exam truth. Context is
  // derived from props every render — never duplicated in interaction state.
  // The shell only mounts in module phase (session/preview routes render
  // directions/review/break/complete separately), so phase is 'module'.
  // props.blocked folds pause/submission/lease into the gate (inert +
  // BlockingOverlay already cover input; the gate converges guards too).
  // Tool flags mirror the runner/policy props: notesAvailable IS policy.notes
  // (R&W-only), calculator/reference mirror the module tool policy.
  const notesAvailable = props.notesAvailable ?? true;
  const interactionCtx = useMemo<SatInteractionContext>(() => ({
    phase: 'module',
    paused: props.blocked,
    terminated: false,
    isSubmitting: false,
    persistenceBlocked: false,
    toolPolicy: {
      ...emptySatExamToolPolicy(),
      highlight: notesAvailable,
      underline: notesAvailable,
      notes: notesAvailable,
      lineReader: notesAvailable,
      passageExpand: notesAvailable,
      imageZoom: true,
      contentZoom: true,
      contrast: true,
      displaySettings: true,
      calculator: props.calculatorAvailable,
      referenceSheet: props.referenceAvailable,
      markForReview: true,
      optionEliminator: true,
    },
    sectionKey: notesAvailable ? 'reading-writing' : 'math',
    moduleKey: props.moduleIdentity ?? '',
    questionId: `${props.moduleIdentity ?? ''}::${props.questionIndex}`,
  }), [props.blocked, props.calculatorAvailable, props.referenceAvailable, notesAvailable, props.moduleIdentity, props.questionIndex]);
  const interaction = useSatInteractionController(interactionCtx);
  const activeOverlay: "directions" | "navigator" | "notes" | "reading" | "more" | null =
    interaction.state.surface.kind === 'reading-settings' ? 'reading'
    : interaction.state.surface.kind === 'question-notes' ? 'notes'
    : interaction.state.surface.kind === 'navigator' ? 'navigator'
    : interaction.state.surface.kind === 'more-menu' ? 'more'
    : interaction.state.surface.kind === 'directions' ? 'directions'
    // The annotation note editor is a dialog, not a shell overlay: it must not
    // alias to a TopBar popover.
    : null;
  const annotationMode: SatAnnotationMode =
    interaction.state.annotation.mode === 'highlight' ? 'highlight'
    : interaction.state.annotation.mode === 'underline' ? 'underline'
    : interaction.state.annotation.mode === 'note' ? 'note'
    : interaction.state.annotation.mode === 'erase' ? 'erase'
    : 'none';
  const routeModalOpen = props.helpOpen === true || props.shortcutsOpen === true;
  const floatingToolOpen = props.calculatorOpen || props.referenceOpen;
  // Bluebook 5-minute visual warning visibility (Phase 7 state; effect below).
  // Declared above the Escape partition so the warning branch can read it.
  const [timerWarningVisible, setTimerWarningVisible] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Route modals (Help/Shortcuts) and floating tools (Calculator /
      // Reference) own Escape themselves; the shell must not double-handle
      // (e.g. disabling Line Reader under an open Help or a tool).
      if (routeModalOpen || floatingToolOpen) return;
      // Wave B R-16: the 5-minute warning keeps alertdialog clothing, so it
      // needs an Escape path. It takes priority over surface-close: one
      // press dismisses the warning only (the warning's own listener
      // performs the dismiss; this branch suppresses the surface-close so
      // exactly one state change happens per press).
      if (timerWarningVisible && !props.blocked) return;
      interaction.handleEscape({
        lineReaderEnabled: props.readingPreferences.lineReaderEnabled ?? false,
        onDisableLineReader: () => props.onReadingPreferencesChange({ ...props.readingPreferences, lineReaderEnabled: false }),
      });
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  });
  const [timerVisible, setTimerVisible] = useState(true);
  const [timerRevealAnnounced, setTimerRevealAnnounced] = useState(false);
  // Bluebook 5-minute visual warning (Phase 7): shown once per module when
  // the threshold is crossed, dismissible, re-arms with the reveal state.
  // Visibility state lives above the Escape partition (Wave B R-16).
  // Bluebook parity: a hidden timer automatically reveals once when the
  // module crosses the 5-minute threshold. One-shot per module timing
  // context: the student may hide it again afterwards without it reopening
  // every second, and a fresh module (remaining time jumping back above
  // five minutes) re-arms the reveal. The reveal always announces itself
  // through the timer live region (Phase 2) — never a silent override.
  const previousRemainingRef = useRef<number | null>(null);
  const timerRevealFiredRef = useRef(false);
  useEffect(() => {
    const remaining = props.remainingSeconds;
    const previous = previousRemainingRef.current;
    if (shouldAutoRevealTimer({ previousSeconds: previous, remainingSeconds: remaining, alreadyRevealed: timerRevealFiredRef.current })) {
      timerRevealFiredRef.current = true;
      setTimerVisible(true);
      setTimerRevealAnnounced(true);
      setTimerWarningVisible(true);
    } else if (remaining != null && remaining > SAT_TIMER_AUTO_REVEAL_SECONDS) {
      timerRevealFiredRef.current = false;
      setTimerRevealAnnounced(false);
      setTimerWarningVisible(false);
    }
    previousRemainingRef.current = remaining ?? null;
  }, [props.remainingSeconds]);
  const notesButtonId = useId();
  const navigatorButtonId = useId();
  const navigatorPanelId = useId();

  // Bluebook keyboard shortcuts (Phase 3): one binding converges clicks and
  // keys on the same actions. Listener lives only while the module surface
  // is mounted; blocked/paused shells ignore keys via `enabled`.
  const shortcutBinding = useMemo<SatToolActionBinding>(() => ({
    calculator: () => props.onToggleCalculator(),
    reference: () => props.onToggleReference(),
    lineReader: () => props.onReadingPreferencesChange({ ...props.readingPreferences, lineReaderEnabled: !(props.readingPreferences.lineReaderEnabled ?? false) }),
    // Highlights arming is shell-interaction state (not runner truth), so the
    // shortcut converges on the same interaction toggle as the TopBar button.
    highlights: () => { interaction.closeSurface(); interaction.toggleAnnotationMode('highlight'); },
    eliminatorMode: () => props.onToggleEliminationMode?.(),
    markForReview: () => props.onToggleMarkForReview?.(),
    questionMenu: () => toggleOverlay("navigator"),
    directions: () => toggleOverlay("directions"),
    notes: () => toggleOverlay("notes"),
    timerVisibility: () => setTimerVisible((visible) => !visible),
    help: () => props.onOpenHelp?.(),
    shortcuts: () => props.onOpenShortcuts?.(),
    breakConfirm: () => props.onOpenBreakConfirm?.(),
    nextQuestion: () => props.onNextQuestion?.() ?? props.onNext(),
    previousQuestion: () => props.onPreviousQuestion?.() ?? props.onPrevious(),
    zoomIn: () => props.onZoomIn?.(),
    zoomOut: () => props.onZoomOut?.(),
    zoomReset: () => props.onZoomReset?.(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleOverlay/closeSurface are stable-by-contract per render; prefs snapshot is intentional.
  }), [props.onToggleCalculator, props.onToggleReference, props.readingPreferences, props.onOpenHelp, props.onOpenShortcuts, props.onOpenBreakConfirm, props.onNext, props.onPrevious, props.onNextQuestion, props.onPreviousQuestion, props.onToggleEliminationMode, props.onToggleMarkForReview, props.onZoomIn, props.onZoomOut, props.onZoomReset]);
  useSatShortcuts(!props.blocked, shortcutBinding);

  // One tool truth (Phase 9): the runner's activeTools flags (calculatorOpen /
  // referenceOpen props) are the ONLY mount/open state for floating tools.
  // The interaction machine's dead `tools.*` region is intentionally unwired
  // here — shell tool buttons delegate straight to the runner commands so
  // the two truths can never diverge (no suspend/restore, no second copy).
  // Opening a tool must not destroy an exclusive surface either: floating
  // tools are independent layers (z-70, non-modal on desktop) and coexist,
  // so unlike the old window manager there is nothing to suspend or
  // restore — Directions / Display / Notes / Navigator stay open
  // underneath with an announcement.
  const toggleOverlay = (overlay: Exclude<typeof activeOverlay, null>) => {
    if (overlay === 'directions') interaction.toggleSurface('directions');
    else if (overlay === 'navigator') interaction.toggleSurface('navigator');
    else if (overlay === 'reading') interaction.toggleSurface('reading-settings');
    else if (overlay === 'more') interaction.toggleSurface('more-menu');
    else interaction.toggleSurface('question-notes');
  };
  const closeOverlay = () => interaction.closeSurface();
  // Calculator / Reference are independent floating tools, NOT exclusive
  // surfaces: opening one must not destroy an open Directions / Display /
  // Notes / Navigator surface — or the other tool. The runner owns
  // tool-open truth; the shell only delegates.
  const toggleCalculator = () => {
    props.onToggleCalculator();
  };
  const toggleReference = () => {
    props.onToggleReference();
  };
  const shellStyle: CSSProperties | undefined =
    props.examHeight !== null && Number.isFinite(props.examHeight)
      ? ({ ["--student-exam-height" as string]: `${props.examHeight}px` } as CSSProperties)
      : undefined;

  return (
    <SatContrastContext.Provider value={props.readingPreferences.contrastMode ?? 'default'}>
    <div
      className="sat-ui sat-exam-shell grid h-[100dvh] min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--sat-shell-bg)] text-[var(--sat-text)]"
      data-testid="sat-exam-shell"
      data-sat-contrast={props.readingPreferences.contrastMode ?? 'default'}
      data-sat-keyboard-open={props.keyboardOpen ? "true" : "false"}
      style={shellStyle}
    >
    {/* Blocking inert covers the whole exam grid (Phase 0.6, corrected Phase 1
        review): while a proctor pause is active NOTHING exam-interactive —
        top bar, More menu, footer, navigator, notes — may be reachable.
        Help/Shortcuts stay available through the route-level BlockingOverlay
        (outside inert), which is the only read-only surface during pause.
        Save retry / Take over live in SatSaveStatus below, also outside inert
        (WCAG 2.1.1 / 4.1.3). */}
    <div
      data-testid="sat-exam-blocked-region"
      inert={props.blocked}
      className="contents min-w-0"
    >
      <SatExamTopBar
        sectionLabel={props.sectionLabel}
        directions={props.directions}
        directionsOpen={activeOverlay === "directions"}
        remainingLabel={props.remainingLabel}
        remainingSeconds={props.remainingSeconds}
        timerVisible={timerVisible}
        timerRevealAnnouncement={timerRevealAnnounced ? "Timer shown — under 5 minutes left. You can hide it again." : null}
        calculatorAvailable={props.calculatorAvailable}
        calculatorOpen={props.calculatorOpen}
        referenceAvailable={props.referenceAvailable}
        referenceOpen={props.referenceOpen}
        notesAvailable={notesAvailable}
        annotationMode={annotationMode}
        onToggleHighlights={() => {
          interaction.closeSurface();
          interaction.toggleAnnotationMode('highlight');
        }}
        onToggleUnderline={() => {
          interaction.closeSurface();
          interaction.toggleAnnotationMode('underline');
        }}
        onToggleErase={() => {
          interaction.closeSurface();
          interaction.toggleAnnotationMode('erase');
        }}
        notesOpen={activeOverlay === "notes"}
        notesButtonId={notesButtonId}
        hasQuestionNote={props.questionNote.trim().length > 0}
        readingOpen={activeOverlay === "reading"}
        readingPreferences={props.readingPreferences}
        blocked={props.blocked}
        onToggleDirections={() => toggleOverlay("directions")}
        onCloseDirections={closeOverlay}
        onToggleTimer={() => setTimerVisible((visible) => !visible)}
        onToggleCalculator={toggleCalculator}
        onToggleReference={toggleReference}
        onToggleNotes={() => toggleOverlay("notes")}
        moreOpen={activeOverlay === "more"}
        onToggleMore={() => toggleOverlay("more")}
        onToggleReading={() => toggleOverlay("reading")}
        onCloseReading={closeOverlay}
        onReadingPreferencesChange={props.onReadingPreferencesChange}
      />
      {/* Bluebook More utility center (Phase 1): fixed-position dropdown
          pinned under the top-right More trigger (fixed right/top offsets
          mirror the trigger cell, so the panel can never drop to the shell
          bottom regardless of grid placement). Selecting Help/Shortcuts/Break
          delegates to route-level modal owners via optional props (no-op when
          unbound, e.g. preview). Toggling Line Reader here is the same action
          as the shortcut. */}
      <SatMoreMenu
        open={activeOverlay === "more"}
        blocked={props.blocked}
        lineReaderOn={props.readingPreferences.lineReaderEnabled ?? false}
        lineReaderAvailable={notesAvailable}
        breakAvailable={props.breakAvailable ?? props.onOpenBreakConfirm !== undefined}
        onSelectHelp={() => { closeOverlay(); props.onOpenHelp?.(); }}
        onSelectShortcuts={() => { closeOverlay(); props.onOpenShortcuts?.(); }}
        onToggleLineReader={() => props.onReadingPreferencesChange({ ...props.readingPreferences, lineReaderEnabled: !(props.readingPreferences.lineReaderEnabled ?? false) })}
        onSelectBreak={() => { closeOverlay(); props.onOpenBreakConfirm?.(); }}
        onClose={closeOverlay}
      />

      {/* Bluebook document: the exam body stays white inside pale-blue chrome. */}
      <main
        className="relative min-h-0 min-w-0 overflow-hidden bg-[var(--sat-body-bg)]"
        id="sat-question-content"
        data-sat-question-presentation="instant"
      >
        <SatAnnotationModeContext.Provider value={props.blocked || !notesAvailable ? 'none' : annotationMode}>
          <div
            className="h-full min-w-0"
            data-sat-content-zoom={props.readingPreferences.examZoom ?? 1}
            style={{ zoom: props.readingPreferences.examZoom ?? 1, width: '100%', height: '100%' }}>
            {props.children}
          </div>
        </SatAnnotationModeContext.Provider>
        {notesAvailable && props.readingPreferences.lineReaderEnabled && !props.blocked ? (
          <SatLineReader position={props.readingPreferences.lineReaderPosition ?? 0.5}
            onPositionChange={(lineReaderPosition) => props.onReadingPreferencesChange({ ...props.readingPreferences, lineReaderPosition })}
            onDisable={() => props.onReadingPreferencesChange({ ...props.readingPreferences, lineReaderEnabled: false })} />
        ) : null}
      </main>

      <SatExamFooter
        candidateName={props.candidateName}
        questionIndex={props.questionIndex}
        questionCount={props.questionCount}
        navigatorOpen={activeOverlay === "navigator"}
        navigatorButtonId={navigatorButtonId}
        navigatorPanelId={navigatorPanelId}
        blocked={props.blocked}
        saveState={props.saveState}
        onRetrySave={props.onRetrySave}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
        onOpenNavigator={() => toggleOverlay("navigator")}
        onReviewModule={props.onReviewModule}
      />
      <SatQuestionNavigator
        id={navigatorPanelId}
        open={activeOverlay === "navigator"}
        sectionLabel={props.sectionLabel}
        items={props.navigationItems}
        returnFocusId={navigatorButtonId}
        onSelectQuestion={props.onSelectQuestion}
        onReviewModule={props.onReviewModule}
        onClose={closeOverlay}
      />
      <SatNotesPanel
        open={activeOverlay === "notes" && notesAvailable}
        note={props.questionNote}
        disabled={props.blocked}
        readingPreferences={props.readingPreferences}
        returnFocusId={notesButtonId}
        onSave={props.onSaveNote}
        onClose={closeOverlay}
      />
      {/* Bluebook Help + Shortcuts (Phases 2-3): route-owned open state;
          the shell only presents. Timer continues and answers stay untouched
          by design — these modals never touch exam state. */}
      {props.helpOpen !== undefined && props.onCloseHelp ? (
        <SatHelpModal
          open={props.helpOpen}
          onClose={props.onCloseHelp}
          returnFocusSelector='[data-sat-focus="topbar-more"]'
        />
      ) : null}
      {props.shortcutsOpen !== undefined && props.onCloseShortcuts ? (
        <SatShortcutsModal
          open={props.shortcutsOpen}
          onClose={props.onCloseShortcuts}
          returnFocusSelector='[data-sat-focus="topbar-more"]'
        />
      ) : null}
      {/* Bluebook Unscheduled Break (Phase 8): confirm first (dangerous
          action), then a running-timer veil. Timer keeps running, answers
          intact, autosubmit still fires underneath. No backend pause call. */}
      {props.breakConfirmOpen !== undefined && props.onCloseBreakConfirm && props.onTakeBreak ? (
        <SatUnscheduledBreakDialog
          open={props.breakConfirmOpen}
          onCancel={props.onCloseBreakConfirm}
          onTakeBreak={props.onTakeBreak}
          returnFocusSelector='[data-sat-focus="topbar-more"]'
        />
      ) : null}
      {props.breakVeilOpen !== undefined && props.onReturnFromBreak ? (
        <SatUnscheduledBreakVeil
          open={props.breakVeilOpen}
          remainingLabel={props.remainingLabel}
          remainingSeconds={props.remainingSeconds}
          onReturn={props.onReturnFromBreak}
        />
      ) : null}
      {/* Bluebook 5-minute warning (Phase 7): one-shot per module, live
          remaining time. Hidden while blocked (pause veil owns attention).
          Display-only: dismissing never touches timer or answers. */}
      <SatTimerWarning
        open={timerWarningVisible && !props.blocked}
        remainingLabel={props.remainingLabel}
        onDismiss={() => setTimerWarningVisible(false)}
      />
    </div>
      <SatSaveStatus
        state={props.saveState}
        saveFailure={props.saveFailure}
        onRetrySave={props.onRetrySave}
        onTakeOver={props.onTakeOver}
        isTakingOver={props.isTakingOver}
      />
    </div>
    </SatContrastContext.Provider>
  );
}
