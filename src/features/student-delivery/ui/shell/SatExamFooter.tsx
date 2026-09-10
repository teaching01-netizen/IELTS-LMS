import { useId } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { SAT_COPY, satLastQuestionLabel } from "../../domain/satCopy";
import type { SatSaveBannerState } from "../feedback/SatSaveStatus";
import { SatFooterSaveIndicator } from "./SatFooterSaveIndicator";

export interface SatExamFooterProps {
  candidateName: string;
  questionIndex: number;
  questionCount: number;
  navigatorOpen: boolean;
  navigatorButtonId: string;
  navigatorPanelId: string;
  blocked: boolean;
  /** Mirrors the SatSaveStatus banner object — same truth, short noun. */
  saveState?: SatSaveBannerState | undefined;
  onRetrySave?: (() => void) | undefined;
  onPrevious: () => void;
  onNext: () => void;
  onOpenNavigator: () => void;
  onReviewModule: () => void;
}

/* The primary verb is the only prominent control: one filled accent pill per bar.
 * Back recedes (quiet treatment) and the navigator pill stays neutral black so
 * style — not size — carries the hierarchy. The last-question destination is a
 * VISUALLY DISTINCT review action (list icon, no Next chevron): it never reuses
 * the Next slot shape for a different destination (Phase 2). */
const primaryStepButtonClass =
  "sat-touch-target sat-pressable inline-flex items-center justify-center gap-1 rounded-[var(--sat-button-radius)] border border-[var(--sat-control-primary-bg)] bg-[var(--sat-control-primary-bg)] px-4 sat-type-control-primary font-semibold text-[var(--sat-control-primary-fg)] transition-colors hover:bg-[var(--sat-control-primary-bg-hover)] disabled:cursor-not-allowed disabled:border-[var(--sat-divider)] disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2";

const quietStepButtonClass =
  "sat-touch-target sat-pressable inline-flex items-center justify-center gap-1 rounded-full px-3 sat-type-control-primary font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2";

export function SatExamFooter(props: SatExamFooterProps) {
  const isFirst = props.questionIndex === 0;
  const isLast = props.questionIndex === props.questionCount - 1;
  const questionPosition = (props.questionIndex + 1) + " of " + props.questionCount;
  const lastQuestionId = useId();

  // Bluebook footer: pale-blue chrome, strong top border, 70px rhythm, 1fr/auto/1fr.
  return (
    <footer className="sat-exam-footer border-t border-[var(--sat-divider-strong)] bg-[var(--sat-shell-bg)] py-2">
      <div className="mx-auto grid min-h-[70px] max-w-[1440px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 gap-y-2 px-2 sm:min-h-[70px] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3 sm:px-8">
        <div className="hidden min-w-0 items-center gap-2 sm:col-start-1 sm:row-start-1 sm:flex">
          <p className="min-w-0 truncate sat-type-control-secondary font-semibold text-[var(--sat-text)]">
            {props.candidateName}
          </p>
          {props.saveState !== undefined ? (
            <SatFooterSaveIndicator state={props.saveState} onRetrySave={props.onRetrySave} />
          ) : null}
        </div>

        <button
          id={props.navigatorButtonId}
          type="button"
          onClick={props.onOpenNavigator}
          aria-haspopup="dialog"
          aria-expanded={props.navigatorOpen}
          aria-controls={props.navigatorPanelId}
          className="sat-touch-target sat-pressable col-start-2 row-start-1 min-w-0 max-w-full justify-self-center overflow-hidden rounded-[7px] bg-[var(--sat-text)] px-2 sat-type-control-secondary font-semibold text-[var(--sat-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 sm:px-4"
          aria-label={"Open question navigator. Question " + questionPosition}
        >
          <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
            <span className="truncate">
              <span className="sm:hidden">{questionPosition}</span>
              <span className="hidden sm:inline">Question {questionPosition}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </span>
        </button>

        <div className="contents sm:col-start-3 sm:row-start-1 sm:flex sm:min-w-0 sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={props.onPrevious}
            disabled={isFirst || props.blocked}
            aria-label={SAT_COPY.navigation.previousQuestion}
            className={quietStepButtonClass + " col-start-1 row-start-1 sm:col-auto sm:row-auto"}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {SAT_COPY.navigation.previousQuestion.replace(" question", "")}
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={props.onReviewModule}
              disabled={props.blocked}
              aria-describedby={lastQuestionId}
              className={primaryStepButtonClass + " col-start-3 row-start-1 sm:col-auto sm:row-auto"}
            >
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              {SAT_COPY.navigation.reviewAnswers}
              <span id={lastQuestionId} className="sr-only">
                {satLastQuestionLabel(props.questionIndex + 1, props.questionCount)}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onNext}
              disabled={props.blocked}
              aria-label={SAT_COPY.navigation.nextQuestion}
              className={primaryStepButtonClass + " col-start-3 row-start-1 sm:col-auto sm:row-auto"}
            >
              {SAT_COPY.navigation.nextQuestion.replace(" question", "")}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
