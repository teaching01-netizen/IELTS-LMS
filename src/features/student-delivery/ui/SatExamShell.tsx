import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SAT_TIMER_AUTO_REVEAL_SECONDS, shouldAutoRevealTimer } from "../domain/satTiming";
import type { StructuredContent } from "../../exam-authoring/api/assessmentContracts";
import type { SatQuestionNavigationItem } from "../domain/satSelectors";
import type { SatReadingPreferences } from "../domain/satReadingPreferences";
import { emptySatExamToolPolicy } from "../domain/satToolPolicy";
import type { SatInteractionContext } from "../domain/satInteractionState";
import { useSatInteractionController } from "../hooks/useSatInteractionController";
import { SatSaveStatus } from "./feedback/SatSaveStatus";
import { SatExamFooter } from "./shell/SatExamFooter";
import { SatExamTopBar } from "./shell/SatExamTopBar";
import { SatQuestionNavigator } from "./shell/SatQuestionNavigator";
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
import { useSatMediaQuery } from './useSatMediaQuery';
import { useSatAnnotationSurface } from '../hooks/useSatAnnotationSurface';
import type { SatQuestionAnnotations } from '../domain/satResponses';
import { SAT_QUESTION_NOTE_EDITOR } from '../domain/satNotesUi';
import { SAT_COPY } from '../domain/satCopy';
import { SatAnnotationEditDock } from './annotations/SatAnnotationEditDock';
import { SatAnnotationViewContext } from './annotations/SatAnnotationViewContext';
import { SatNotesSurfaceHost } from './annotations/SatNotesSurfaceHost';
import { SatSelectionActionsPanel } from './annotations/SatSelectionActionsPanel';

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
  /**
   * Highlights & Notes: the shell owns annotation mutation so the contextual
   * toolbar, the dock, and the note card can all write the same response. The
   * content renderer only paints marks and reports gestures.
   */
  annotations?: SatQuestionAnnotations | undefined;
  onAnnotationsChange?: ((annotations: SatQuestionAnnotations) => void) | undefined;

  onFlushAnnotations?: (() => void) | undefined;
  /** True once this question has an answer (retires the passive hint). */
  answered?: boolean | undefined;
  /**
   * Education memory key (attempt-scoped, or preview-scoped for staff
   * previews). Absent = in-memory teaching only.
   */
  educationKey?: string | null | undefined;
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
  // the live annotation selection; the runner stays authoritative for exam
  // truth. Context is derived from props every render — never duplicated in
  // interaction state.
  // The shell only mounts in module phase (session/preview routes render
  // directions/review/break/complete separately), so phase is 'module'.
  // props.blocked folds pause/submission/lease into the gate (inert +
  // BlockingOverlay already cover input; the gate converges guards too).
  // Tool flags mirror the runner/policy props: notesAvailable IS policy.notes
  // (R&W-only), calculator/reference mirror the module tool policy.
  const notesAvailable = props.notesAvailable ?? true;
  // One identity for "which question this is": the interaction machine, the
  // annotation surface, and the Notes column keyed by it all read the same
  // string, so a draft can never be committed against the wrong question.
  const questionKey = `${props.moduleIdentity ?? ''}::${props.questionIndex}`;
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
    questionId: questionKey,
  }), [questionKey, props.blocked, props.calculatorAvailable, props.moduleIdentity, props.referenceAvailable, notesAvailable]);
  const interaction = useSatInteractionController(interactionCtx);
  const touchAnnotations = useSatMediaQuery('(pointer: coarse)');
  const activeOverlay: "directions" | "navigator" | "notes" | "reading" | "more" | null =
    interaction.state.surface.kind === 'reading-settings' ? 'reading'
    : interaction.state.surface.kind === 'question-notes' ? 'notes'
    : interaction.state.surface.kind === 'navigator' ? 'navigator'
    : interaction.state.surface.kind === 'more-menu' ? 'more'
    : interaction.state.surface.kind === 'directions' ? 'directions'
    // Both note editors live in the inline Notes column, which is part of the
    // layout rather than a top-bar popover, so nothing aliases here for them.
    : null;
  const routeModalOpen = props.helpOpen === true || props.shortcutsOpen === true;
  const floatingToolOpen = props.calculatorOpen || props.referenceOpen;
  // Bluebook 5-minute visual warning visibility (Phase 7 state; effect below).
  // Declared above the Escape partition so the warning branch can read it.
  const [timerWarningVisible, setTimerWarningVisible] = useState(false);

  /* ------------------------------------------------------------------ *
   * Highlights & Notes (selection-first)
   *
   * One owner for the whole annotation surface: marks, chrome, undo, and the
   * teaching cues all live in useSatAnnotationSurface. The shell renders what
   * it returns and reports gestures; nothing here writes an annotation twice.
   * ------------------------------------------------------------------ */
  // Declared before the annotation surface: the notes column's focus contract
  // needs the id of the control that opens it.
  const notesButtonId = useId();
  const navigatorButtonId = useId();
  const navigatorPanelId = useId();
  const surface = useSatAnnotationSurface({
    annotations: props.annotations,
    onAnnotationsChange: props.onAnnotationsChange,
    onFlushAnnotations: props.onFlushAnnotations,
    blocked: props.blocked,
    annotationsAvailable: notesAvailable,
    educationKey: props.educationKey,
    answered: props.answered === true,
    // The surface owns what these two imply (retiring the teaching line, and
    // undoing a removal); the runner still owns persistence.
    questionNote: props.questionNote,
    onSaveQuestionNote: props.onSaveNote,
    interaction,
    questionKey,
    notesTriggerId: notesButtonId,
  });
  const {
    selection,
    annotationView,
    selectionActions,
    currentColor,
    editingMark,
    closeMarkEditor,
    recolourMark,
    underlineMark,
    openNoteOnMark,
    removeMark,
    updateNote,
    undoEntry,
    undoLastRemoval,
    hintVisible,
    announcement,
    questionNotes,
  } = surface;
  const annotationsWritable = surface.writable;
  const questionHasAnnotations = props.questionNote.trim().length > 0 || surface.hasAnnotations;

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
      // Annotation chrome answers before exam surfaces: the edit dock is the
      // innermost thing the student opened.
      if (closeMarkEditor()) return;
      // The Notes column is inline now, so nothing else can hand focus back to
      // the control that opened it; Escape goes through the same close path as
      // the column's own close button.
      if (surface.notesState.kind === 'notes') {
        surface.closeNotes();
        return;
      }
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

  // Bluebook keyboard shortcuts (Phase 3): one binding converges clicks and
  // keys on the same actions. Listener lives only while the module surface
  // is mounted; blocked/paused shells ignore keys via `enabled`.
  const shortcutBinding = useMemo<SatToolActionBinding>(() => ({
    calculator: () => props.onToggleCalculator(),
    reference: () => props.onToggleReference(),
    lineReader: () => props.onReadingPreferencesChange({ ...props.readingPreferences, lineReaderEnabled: !(props.readingPreferences.lineReaderEnabled ?? false) }),
    // Highlights & Notes is a surface now, not an armed mode: with a selection
    // live the shortcut drives the contextual toolbar (the colors are already
    // one keystroke away); otherwise it opens the notes panel.
    highlights: () => {
      if (interaction.state.annotation.selection) {
        document.querySelector<HTMLButtonElement>('[data-sat-selection-toolbar="true"] button:not([disabled]), [data-sat-touch-dock="true"] button:not([disabled])')?.focus();
        return;
      }
      interaction.closeSurface();
      interaction.toggleSurface('question-notes');
    },
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
  }), [props.onToggleCalculator, props.onToggleReference, props.readingPreferences, props.onOpenHelp, props.onOpenShortcuts, props.onOpenBreakConfirm, props.onNext, props.onPrevious, props.onNextQuestion, props.onPreviousQuestion, props.onToggleEliminationMode, props.onToggleMarkForReview, props.onZoomIn, props.onZoomOut, props.onZoomReset, interaction]);
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
  /* ------------------------------------------------------------------ *
   * The Notes column
   *
   * Notes are a structural pane beside the passage, never an overlay: the
   * student does not leave the exam to write something down, and the note stays
   * next to the text it is about. SatNotesSurfaceHost owns the chrome and
   * SatNotesSurfaceContext hands it to the layout that has room for it, so the
   * shell only wires props — it no longer derives whether the column is open.
   * ------------------------------------------------------------------ */

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
        notesOpen={activeOverlay === "notes"}
        notesButtonId={notesButtonId}
        hasAnnotations={questionHasAnnotations}
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

      {/* Bluebook document: the exam body stays white inside pale-blue chrome.
          Annotation overlays are positioned against THIS box (not the zoomed
          content): the exam zoom transform must never scale a toolbar. */}
      <main
        className="relative min-h-0 min-w-0 overflow-hidden bg-[var(--sat-body-bg)]"
        id="sat-question-content"
        data-sat-question-presentation="instant"
        data-sat-annotation-bounds="true"
      >
        <SatAnnotationViewContext.Provider value={annotationView}>
          {/* The Notes column rides inside the zoom wrapper on purpose: it is
              exam content now, so screen zoom must treat it like the passage
              beside it (a fixed overlay could never do that). */}
          <SatNotesSurfaceHost
            state={surface.notesState}
            // Keyed by question: switching questions commits the draft through
            // that question's own writer before the column starts clean, so a
            // note can never be typed onto the next question.
            questionKey={questionKey}
            annotations={questionNotes}
            questionNote={props.questionNote}
            // The empty state can only say "your highlights are in the passage"
            // when marks exist: the notes list the column sees cannot answer that,
            // and a migrated freeform note is not a mark on the passage.
            hasHighlights={(props.annotations?.annotations.length ?? 0) > 0}
            // Without the surface (Math) there is no pane to hide, so there is no
            // handle left behind either: the layout is handed nothing to place.
            notesAvailable={notesAvailable}
            disabled={props.blocked || !annotationsWritable}
            hintVisible={hintVisible}
            onSelectNote={(annotationId) => {
              const target = questionNotes.find((annotation) => annotation.id === annotationId);
              if (target) openNoteOnMark(target);
            }}
            onChangeNote={updateNote}
            onSaveQuestionNote={props.onSaveNote}
            // One removal path for both card kinds: a note's words come out,
            // its ink stays, and the removal stays undoable for a few seconds.
            onRemoveNote={(annotationId) => {
              if (annotationId === SAT_QUESTION_NOTE_EDITOR) {
                surface.removeQuestionNoteText();
                return;
              }
              const target = questionNotes.find((annotation) => annotation.id === annotationId);
              if (target) surface.removeNoteText(target);
            }}
            onWriteAboutQuestion={surface.openQuestionNote}
            // The handle the hidden column leaves behind opens it again, in its
            // own place, so hiding a pane never strands a student in the toolbar.
            onOpenNotes={surface.openNotes}
            onFlush={props.onFlushAnnotations}
            onClose={surface.closeNotes}
          >
            <div
              className="h-full min-w-0"
              data-sat-content-zoom={props.readingPreferences.examZoom ?? 1}
              style={{ zoom: props.readingPreferences.examZoom ?? 1, width: '100%', height: '100%' }}>
              {props.children}
            </div>
          </SatNotesSurfaceHost>
        </SatAnnotationViewContext.Provider>
        {/* Contextual annotation tools. Exactly one is mounted at a time:
            a mark editor when a mark is being changed, otherwise the selection
            toolbar/dock while a selection is live. */}
        {editingMark ? (
          <SatAnnotationEditDock
            annotation={editingMark}
            touch={touchAnnotations}
            disabled={props.blocked || !annotationsWritable}
            noteOpen={surface.noteFieldMarkId === editingMark.id}
            onColor={(color) => recolourMark(editingMark, color)}
            onUnderline={() => underlineMark(editingMark)}
            // Writing happens in the dock the student is already using; the
            // Notes column opens only when they ask for it.
            onNote={() => surface.openNoteField(editingMark)}
            onNoteChange={(note) => surface.writeMarkNote(editingMark, note)}
            onRemoveNote={() => surface.removeNoteText(editingMark)}
            onRemove={() => removeMark(editingMark)}
            onClose={surface.closeMarkEditor}
          />
        ) : selection ? (
          <SatSelectionActionsPanel
            anchor={selection}
            currentColor={currentColor}
            actions={selectionActions}
            disabled={props.blocked || !annotationsWritable}
            variant={touchAnnotations ? 'docked' : 'floating'}
            onClose={surface.closeSelectionTools}
          />
        ) : null}
        {/* Removal is forgiving instead of confirmed: one undo, then it is
            final. Sits in the exam body (never over the footer navigation). */}
        {undoEntry ? (
          <div
            data-sat-undo-toast="true"
            data-testid="sat-undo-toast"
            role="status"
            className="sat-ui absolute bottom-3 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-[8px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-3 py-2 shadow-[var(--sat-shadow-floating)]"
          >
            <span className="sat-type-control-secondary font-medium text-[var(--sat-text)]">
              {undoEntry.kind === 'mark'
                ? undoEntry.annotation.kind === 'highlight'
                  ? SAT_COPY.annotations.removedHighlight
                  : SAT_COPY.annotations.removedUnderline
                : SAT_COPY.notes.removed}
            </span>
            <button
              type="button"
              onClick={undoLastRemoval}
              className="sat-touch-target sat-pressable rounded-[6px] px-2 sat-type-control-secondary font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              {SAT_COPY.annotations.undo}
            </button>
          </div>
        ) : null}
        {/* Polite annotation announcements: assistive tech hears the same
            cause and effect the ink shows. Visually hidden, one per action. */}
        <span className="sr-only" role="status" aria-live="polite" data-testid="sat-annotation-announcement">
          {announcement}
        </span>
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
      {/* The Notes column is not mounted here: it is rendered by the question
          workspace from SatNotesSurfaceContext, so it occupies layout space
          between the passage and the question instead of floating over them. */}
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
