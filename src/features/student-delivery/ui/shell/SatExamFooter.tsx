import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

export interface SatExamFooterProps {
  candidateName: string;
  questionIndex: number;
  questionCount: number;
  navigatorOpen: boolean;
  navigatorButtonId: string;
  navigatorPanelId: string;
  blocked: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onOpenNavigator: () => void;
  onReviewModule: () => void;
}

/* The primary verb is the only prominent control: one filled accent pill per bar.
 * Back recedes (quiet treatment) and the navigator pill stays neutral black so
 * style — not size — carries the hierarchy. */
const primaryStepButtonClass =
  "sat-touch-target sat-pressable inline-flex items-center justify-center gap-1 rounded-full border border-[var(--sat-accent-strong)] bg-[var(--sat-accent-strong)] px-4 sat-type-control-primary font-semibold text-[var(--sat-accent-text)] transition-colors hover:bg-[var(--sat-accent)] disabled:cursor-not-allowed disabled:border-[var(--sat-divider)] disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2";

const quietStepButtonClass =
  "sat-touch-target sat-pressable inline-flex items-center justify-center gap-1 rounded-full px-3 sat-type-control-primary font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2";

export function SatExamFooter(props: SatExamFooterProps) {
  const isFirst = props.questionIndex === 0;
  const isLast = props.questionIndex === props.questionCount - 1;
  const questionPosition = `${props.questionIndex + 1} of ${props.questionCount}`;

  return (
    <footer className="sat-exam-footer border-t border-[var(--sat-divider)] bg-[var(--sat-background)] py-2">
      <div className="mx-auto grid min-h-[60px] max-w-[1600px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:min-h-[58px] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
        <p className="hidden min-w-0 truncate sat-type-control-secondary font-semibold text-[var(--sat-text)] sm:col-start-1 sm:row-start-1 sm:block">
          {props.candidateName}
        </p>

        <button
          id={props.navigatorButtonId}
          type="button"
          onClick={props.onOpenNavigator}
          aria-haspopup="dialog"
          aria-expanded={props.navigatorOpen}
          aria-controls={props.navigatorPanelId}
          className="sat-touch-target sat-pressable col-start-2 row-start-1 min-w-0 justify-self-center rounded-[7px] bg-[var(--sat-text)] px-3 sat-type-control-secondary font-semibold text-[var(--sat-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 sm:px-4"
          aria-label={`Open question navigator. Question ${props.questionIndex + 1} of ${props.questionCount}`}
        >
          <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
            <span className="truncate">
              <span className="sm:hidden">{questionPosition}</span>
              <span className="hidden sm:inline">Question {questionPosition}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </span>
        </button>

        <div className="contents sm:col-start-3 sm:row-start-1 sm:flex sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={props.onPrevious}
            disabled={isFirst || props.blocked}
            className={`${quietStepButtonClass} col-start-1 row-start-1 sm:col-auto sm:row-auto`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
          {/* On the last question the verb and destination change together:
              the label says Review because it goes to Review. */}
          {isLast ? (
            <button
              type="button"
              onClick={props.onReviewModule}
              disabled={props.blocked}
              className={`${primaryStepButtonClass} col-start-3 row-start-1 sm:col-auto sm:row-auto`}
            >
              Review
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onNext}
              disabled={props.blocked}
              className={`${primaryStepButtonClass} col-start-3 row-start-1 sm:col-auto sm:row-auto`}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
