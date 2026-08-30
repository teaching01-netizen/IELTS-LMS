import { useEffect, useId, useState, type ReactNode } from "react";
import type { StructuredContent } from "../../exam-authoring/api/assessmentContracts";
import type { SatQuestionNavigationItem } from "../domain/satSelectors";
import type { SatReadingPreferences } from "../domain/satReadingPreferences";
import { SatNotesPanel } from "./question/SatNotesPanel";
import { SatExamFooter } from "./shell/SatExamFooter";
import { SatExamTopBar } from "./shell/SatExamTopBar";
import { SatQuestionNavigator } from "./shell/SatQuestionNavigator";

export interface SatExamShellProps {
  sectionLabel: string;
  directions: StructuredContent | null;
  remainingLabel: string;
  candidateName: string;
  questionIndex: number;
  questionCount: number;
  navigationItems: readonly SatQuestionNavigationItem[];
  calculatorAvailable: boolean;
  calculatorOpen: boolean;
  referenceAvailable: boolean;
  referenceOpen: boolean;
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

type SatOverlay = "directions" | "navigator" | "notes" | "reading" | null;

export function SatExamShell(props: SatExamShellProps) {
  const [activeOverlay, setActiveOverlay] = useState<SatOverlay>(null);
  const [timerVisible, setTimerVisible] = useState(true);
  const notesButtonId = useId();
  const navigatorButtonId = useId();
  const navigatorPanelId = useId();

  useEffect(() => {
    if (props.blocked) setActiveOverlay(null);
  }, [props.blocked]);

  const toggleOverlay = (overlay: Exclude<SatOverlay, null>) => {
    setActiveOverlay((current) => (current === overlay ? null : overlay));
  };
  const toggleCalculator = () => {
    setActiveOverlay(null);
    props.onToggleCalculator();
  };
  const toggleReference = () => {
    setActiveOverlay(null);
    props.onToggleReference();
  };

  return (
    <div
      className="sat-ui sat-exam-shell grid h-[100dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--sat-background)] text-[var(--sat-text)]"
      data-testid="sat-exam-shell"
      inert={props.blocked}
    >
      <SatExamTopBar
        sectionLabel={props.sectionLabel}
        directions={props.directions}
        directionsOpen={activeOverlay === "directions"}
        remainingLabel={props.remainingLabel}
        timerVisible={timerVisible}
        calculatorAvailable={props.calculatorAvailable}
        calculatorOpen={props.calculatorOpen}
        referenceAvailable={props.referenceAvailable}
        referenceOpen={props.referenceOpen}
        notesOpen={activeOverlay === "notes"}
        notesButtonId={notesButtonId}
        readingOpen={activeOverlay === "reading"}
        readingPreferences={props.readingPreferences}
        blocked={props.blocked}
        onToggleDirections={() => toggleOverlay("directions")}
        onCloseDirections={() => setActiveOverlay(null)}
        onToggleTimer={() => setTimerVisible((visible) => !visible)}
        onToggleCalculator={toggleCalculator}
        onToggleReference={toggleReference}
        onToggleNotes={() => toggleOverlay("notes")}
        onToggleReading={() => toggleOverlay("reading")}
        onCloseReading={() => setActiveOverlay(null)}
        onReadingPreferencesChange={props.onReadingPreferencesChange}
      />

      <main
        className="relative min-h-0 overflow-hidden bg-[var(--sat-background)]"
        id="sat-question-content"
        data-sat-question-presentation="instant"
      >
        {props.children}
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
        onClose={() => setActiveOverlay(null)}
      />
      <SatNotesPanel
        open={activeOverlay === "notes"}
        note={props.questionNote}
        disabled={props.blocked}
        readingPreferences={props.readingPreferences}
        returnFocusId={notesButtonId}
        onSave={props.onSaveNote}
        onClose={() => setActiveOverlay(null)}
      />

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
  );
}
