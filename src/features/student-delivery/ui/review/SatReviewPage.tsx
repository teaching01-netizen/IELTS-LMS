import { Bookmark } from "lucide-react";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";
import { SatQuestionStatusGrid } from "./SatQuestionStatusGrid";

export interface SatReviewPageProps {
  sectionLabel: string;
  moduleTitle: string;
  remainingLabel: string;
  items: readonly SatQuestionNavigationItem[];
  answeredCount: number;
  isSubmitting: boolean;
  persistenceBlocked: boolean;
  onSelectQuestion: (index: number) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export function SatReviewPage(props: SatReviewPageProps) {
  const unanswered = Math.max(0, props.items.length - props.answeredCount);
  const flagged = props.items.filter((item) => item.markedForReview).length;

  return (
    <div className="sat-ui grid h-[100dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--sat-background)] text-[var(--sat-text)]">
      <header className="border-b border-[var(--sat-divider)] pl-[calc(1.5rem+var(--student-safe-left))] pr-[calc(1.5rem+var(--student-safe-right))] pt-[var(--student-safe-top)]">
        <div className="mx-auto flex h-[82px] max-w-[1180px] items-center justify-between gap-4">
          <div>
            <p className="text-[16px] font-semibold">{props.sectionLabel}</p>
            <p className="mt-1 text-[14px] text-[var(--sat-text-secondary)]">
              {props.moduleTitle} Review
            </p>
          </div>
          <span
            className="sat-tabular text-[18px] font-semibold"
            aria-label={`Time remaining ${props.remainingLabel}`}
          >
            {props.remainingLabel}
          </span>
        </div>
      </header>
      <main className="min-h-0 overflow-y-auto px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-[900px]">
          <h1 className="text-2xl font-semibold tracking-tight">Check Your Work</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--sat-text-secondary)]">
            You can return to any question in this module before you submit. Once submitted, you
            cannot return to this module.
          </p>

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-y border-[var(--sat-divider-soft)] py-3 text-[14px] text-[var(--sat-text)]">
            <span>{props.answeredCount} answered</span>
            <span>{unanswered} unanswered</span>
            <span className="inline-flex items-center gap-1.5">
              <Bookmark
                className="h-4 w-4 fill-[var(--sat-review)] text-[var(--sat-review)]"
                aria-hidden="true"
              />{" "}
              {flagged} for review
            </span>
          </div>

          <div className="mt-7">
            <SatQuestionStatusGrid items={props.items} onSelectQuestion={props.onSelectQuestion} />
          </div>

          {unanswered > 0 ? (
            <p className="mt-6 border-l-4 border-[var(--sat-accent)] bg-[var(--sat-accent-soft)] px-4 py-3 text-[14px] leading-6 text-[var(--sat-text)]">
              {unanswered} question{unanswered === 1 ? "" : "s"} remain unanswered. You may still
              submit the module.
            </p>
          ) : null}
        </div>
      </main>

      <footer className="border-t border-[var(--sat-divider)] bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pb-[calc(0.75rem+var(--student-safe-bottom))] pt-3 sm:pl-[calc(2rem+var(--student-safe-left))] sm:pr-[calc(2rem+var(--student-safe-right))]">
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={props.onBack}
            disabled={props.isSubmitting}
            className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-accent)] px-5 text-[14px] font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-accent-soft)] disabled:cursor-not-allowed disabled:border-[var(--sat-divider)] disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            Back to Questions
          </button>
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={props.isSubmitting || props.persistenceBlocked}
            className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {props.isSubmitting ? "Submitting…" : "Submit Module"}
          </button>
        </div>
      </footer>
    </div>
  );
}
