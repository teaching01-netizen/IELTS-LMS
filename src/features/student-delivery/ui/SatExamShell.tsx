import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { SAT_TIMER_AUTO_REVEAL_SECONDS, shouldAutoRevealTimer } from "../domain/satTiming";
import type { StructuredContent } from "../../exam-authoring/api/assessmentContracts";
import type { SatQuestionNavigationItem } from "../domain/satSelectors";
import type { SatReadingPreferences } from "../domain/satReadingPreferences";
import { emptySatExamToolPolicy } from "../domain/satToolPolicy";
import type { SatInteractionContext } from "../domain/satInteractionState";
import { useSatInteractionController } from "../hooks/useSatInteractionController";
import { SatNotesPanel } from "./question/SatNotesPanel";
import { SatExamFooter } from "./shell/SatExamFooter";
import { SatExamTopBar } from "./shell/SatExamTopBar";
import { SatQuestionNavigator } from "./shell/SatQuestionNavigator";
import { SatAnnotationModeContext, type SatAnnotationMode } from './annotations/SatAnnotationModeContext';
import { SatLineReader } from './reading/SatLineReader';
import { SatContrastContext } from './reading/SatContrastContext';

export interface SatExamShellProps {
  moduleIdentity?: string;
  sectionLabel: string;
  directions: StructuredContent | null;
  remainingLabel: string;
  remainingSeconds?: number | undefined;
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
  onReadingPreferencesChange: (preferences: SatReadingPreferences) => void;
  onRetrySave?: () => void;
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
  const activeOverlay: "directions" | "navigator" | "notes" | "reading" | null =
    interaction.state.surface.kind === 'reading-settings' ? 'reading'
    : interaction.state.surface.kind === 'question-notes' ? 'notes'
    : interaction.state.surface.kind === 'navigator' ? 'navigator'
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
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      interaction.handleEscape({
        lineReaderEnabled: props.readingPreferences.lineReaderEnabled ?? false,
        onDisableLineReader: () => props.onReadingPreferencesChange({ ...props.readingPreferences, lineReaderEnabled: false }),
      });
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  });
  const [timerVisible, setTimerVisible] = useState(true);
  // Bluebook parity: a hidden timer automatically reveals once when the
  // module crosses the 5-minute threshold. One-shot per module timing
  // context: the student may hide it again afterwards without it reopening
  // every second, and a fresh module (remaining time jumping back above
  // five minutes) re-arms the reveal.
  const previousRemainingRef = useRef<number | null>(null);
  const timerRevealFiredRef = useRef(false);
  useEffect(() => {
    const remaining = props.remainingSeconds;
    const previous = previousRemainingRef.current;
    if (shouldAutoRevealTimer({ previousSeconds: previous, remainingSeconds: remaining, alreadyRevealed: timerRevealFiredRef.current })) {
      timerRevealFiredRef.current = true;
      setTimerVisible(true);
    } else if (remaining != null && remaining > SAT_TIMER_AUTO_REVEAL_SECONDS) {
      timerRevealFiredRef.current = false;
    }
    previousRemainingRef.current = remaining ?? null;
  }, [props.remainingSeconds]);
  const notesButtonId = useId();
  const navigatorButtonId = useId();
  const navigatorPanelId = useId();

  const toggleOverlay = (overlay: Exclude<typeof activeOverlay, null>) => {
    if (overlay === 'directions') interaction.toggleSurface('directions');
    else if (overlay === 'navigator') interaction.toggleSurface('navigator');
    else if (overlay === 'reading') interaction.toggleSurface('reading-settings');
    else interaction.toggleSurface('question-notes');
  };
  const closeOverlay = () => interaction.closeSurface();
  const toggleCalculator = () => {
    interaction.closeSurface();
    props.onToggleCalculator();
  };
  const toggleReference = () => {
    interaction.closeSurface();
    props.onToggleReference();
  };

  return (
    <SatContrastContext.Provider value={props.readingPreferences.contrastMode ?? 'default'}>
    <div
      className="sat-ui sat-exam-shell grid h-[100dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--sat-background)] text-[var(--sat-text)]"
      data-testid="sat-exam-shell"
      data-sat-contrast={props.readingPreferences.contrastMode ?? 'default'}
      inert={props.blocked}
    >
      <SatExamTopBar
        sectionLabel={props.sectionLabel}
        directions={props.directions}
        directionsOpen={activeOverlay === "directions"}
        remainingLabel={props.remainingLabel}
        remainingSeconds={props.remainingSeconds}
        timerVisible={timerVisible}
        calculatorAvailable={props.calculatorAvailable}
        calculatorOpen={props.calculatorOpen}
        referenceAvailable={props.referenceAvailable}
        referenceOpen={props.referenceOpen}
        notesAvailable={notesAvailable}
        annotationMode={annotationMode}
        lineReaderEnabled={props.readingPreferences.lineReaderEnabled ?? false}
        onToggleLineReader={() => props.onReadingPreferencesChange({ ...props.readingPreferences, lineReaderEnabled: !props.readingPreferences.lineReaderEnabled })}
        onToggleAnnotationMode={(mode) => {
          interaction.closeSurface();
          interaction.toggleAnnotationMode(mode);
        }}
        notesOpen={annotationMode === 'note'}
        notesButtonId={notesButtonId}
        readingOpen={activeOverlay === "reading"}
        readingPreferences={props.readingPreferences}
        blocked={props.blocked}
        onToggleDirections={() => toggleOverlay("directions")}
        onCloseDirections={closeOverlay}
        onToggleTimer={() => setTimerVisible((visible) => !visible)}
        onToggleCalculator={toggleCalculator}
        onToggleReference={toggleReference}
        onToggleNotes={() => {
          interaction.closeSurface();
          interaction.toggleAnnotationMode('note');
        }}
        onToggleReading={() => toggleOverlay("reading")}
        onCloseReading={closeOverlay}
        onReadingPreferencesChange={props.onReadingPreferencesChange}
      />

      <main
        className="relative min-h-0 overflow-hidden bg-[var(--sat-background)]"
        id="sat-question-content"
        data-sat-question-presentation="instant"
      >
        <SatAnnotationModeContext.Provider value={props.blocked || !notesAvailable ? 'none' : annotationMode}>
          <div data-sat-content-zoom={props.readingPreferences.examZoom ?? 1}
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
      {notesAvailable && props.questionNote ? (
        <button type="button" className="sat-touch-target fixed bottom-20 right-4 z-[65] rounded border bg-[var(--sat-surface)] px-3 text-sm"
          onClick={() => toggleOverlay('notes')}>General note</button>
      ) : null}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {props.saveState === "offline"
          ? "Offline. Response kept on this device."
          : props.saveState === "retrying"
            ? "Retrying response save"
            : props.saveState === "failed" || props.saveState === "superseded"
              ? "Response save failed"
              : ""}
      </div>
      {props.saveState === "failed" || props.saveState === "superseded" ? (
        <div
          className="sat-surface-enter fixed bottom-[calc(78px+var(--student-safe-bottom))] left-1/2 z-[75] flex w-[min(680px,calc(100vw-32px))] -translate-x-1/2 items-center justify-between gap-4 border border-[var(--sat-danger)] bg-[var(--sat-surface)] px-4 py-3 text-[14px] shadow-lg"
          role="alert"
        >
          <span className="min-w-0 text-[var(--sat-danger)]">
            {props.saveFailure || "Your latest response has not been saved yet."}
          </span>
          {props.saveState !== "superseded" && props.onRetrySave ? (
            <button
              type="button"
              onClick={props.onRetrySave}
              className="sat-touch-target sat-pressable shrink-0 rounded-full border border-[var(--sat-danger)] px-4 font-semibold text-[var(--sat-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {props.saveState === "offline" || props.saveState === "retrying" ? (
        <div
          className="sat-surface-enter fixed bottom-[calc(78px+var(--student-safe-bottom))] left-1/2 z-[65] flex w-[min(680px,calc(100vw-32px))] -translate-x-1/2 items-center justify-between gap-4 border border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] px-4 py-3 text-[14px] shadow-sm"
          role="status"
        >
          <span className="min-w-0 text-[var(--sat-warning)]">
            {props.saveFailure ||
              (props.saveState === "offline"
                ? "Offline — changes are kept on this device."
                : "Saving is retrying.")}
          </span>
          {props.saveState === "retrying" && props.onRetrySave ? (
            <button
              type="button"
              onClick={props.onRetrySave}
              className="sat-touch-target sat-pressable shrink-0 rounded-full border border-[var(--sat-warning)] px-4 font-semibold text-[var(--sat-warning)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              Retry now
            </button>
          ) : null}
        </div>
      ) : null}
      {props.saveState === "saving" ? (
        <div className="pointer-events-none fixed bottom-[calc(82px+var(--student-safe-bottom))] left-[calc(1rem+var(--student-safe-left))] z-[55] text-[13px] font-medium text-[var(--sat-text-secondary)]">
          Saving…
        </div>
      ) : null}
    </div>
    </SatContrastContext.Provider>
  );
}
