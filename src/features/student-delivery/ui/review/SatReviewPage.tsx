import { useId, type CSSProperties, type ReactNode } from "react";
import { Bookmark } from "lucide-react";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";
import { SAT_COPY } from "../../domain/satCopy";
import { SatQuestionStatusGrid } from "./SatQuestionStatusGrid";
import { useStudentTimerAnnouncement } from "@shared/hooks/useStudentTimerAnnouncement";

export interface SatReviewPageProps {
  sectionLabel: string;
  moduleTitle: string;
  remainingLabel: string;
  /** Live seconds for the shared 300s/60s threshold announcer (announce-only on review). */
  remainingSeconds?: number | undefined;
  /** Stable layout viewport height in px; null keeps the 100dvh fallback. */
  examHeight?: number | null | undefined;
  /** True while the visual viewport indicates an open software keyboard. */
  keyboardOpen?: boolean | undefined;
  items: readonly SatQuestionNavigationItem[];
  answeredCount: number;
  pendingSaveCount: number;
  saveFailure: string | null;
  saveFailureKind: "offline" | "retryable" | "terminal" | "superseded" | null;
  /** Current question index (0-based) for the "Back to question N" exit. */
  currentQuestionIndex?: number | undefined;
  timerVisible?: boolean | undefined;
  onToggleTimer?: (() => void) | undefined;
  onSelectQuestion: (index: number) => void;
  onBack: () => void;
  onRetrySave?: (() => void) | undefined;
  notices?: ReactNode | undefined;
}

/** Review answers and return to a question; module completion stays server-owned. */
export function SatReviewPage(props: SatReviewPageProps) {
  const unanswered = Math.max(0, props.items.length - props.answeredCount);
  const flagged = props.items.filter((item) => item.markedForReview).length;
  const reasonId = useId();
  const timerVisible = props.timerVisible ?? true;
  const timerAnnouncement = useStudentTimerAnnouncement(props.remainingSeconds);

  const backLabel =
    props.currentQuestionIndex !== undefined
      ? "Back to question " + (props.currentQuestionIndex + 1)
      : SAT_COPY.navigation.backToQuestions;
  const reviewStyle: CSSProperties | undefined =
    props.examHeight !== null && Number.isFinite(props.examHeight)
      ? ({ ["--student-exam-height" as string]: `${props.examHeight}px` } as CSSProperties)
      : undefined;
  const saveMessage =
    props.saveFailureKind === "offline"
      ? SAT_COPY.review.saveOffline
      : props.saveFailureKind === "retryable" || props.saveFailureKind === "terminal"
        ? props.saveFailure || SAT_COPY.review.saveFailed
        : props.saveFailureKind === "superseded"
          ? SAT_COPY.review.saveSuperseded
          : props.pendingSaveCount > 0
            ? SAT_COPY.review.savingAnswers
            : null;
  const canRetry =
    props.onRetrySave !== undefined &&
    (props.saveFailureKind === "offline" ||
      props.saveFailureKind === "retryable" ||
      props.saveFailureKind === "terminal");

  return (
    <div
      className="sat-ui sat-review-page grid h-[100dvh] min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--sat-background)] text-[var(--sat-text)]"
      data-sat-keyboard-open={props.keyboardOpen ? "true" : "false"}
      style={reviewStyle}
    >
      <header className="border-b border-[var(--sat-divider)] pl-[calc(1.5rem+var(--student-safe-left))] pr-[calc(1.5rem+var(--student-safe-right))] pt-[var(--student-safe-top)]">
        <div className="mx-auto flex h-[82px] max-w-[1180px] items-center justify-between gap-4">
          <div>
            <p className="text-[16px] font-semibold">{props.sectionLabel}</p>
            <p className="mt-1 text-[14px] text-[var(--sat-text-secondary)]">
              {props.moduleTitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="sat-tabular text-[18px] font-semibold"
              role="timer"
              aria-label={timerVisible ? "Time remaining " + props.remainingLabel : "Timer hidden"}
            >
              {timerVisible ? props.remainingLabel : SAT_COPY.timer.hidden}
            </span>
            {props.onToggleTimer ? (
              <button
                type="button"
                onClick={props.onToggleTimer}
                aria-label={timerVisible ? SAT_COPY.timer.hideTimer : SAT_COPY.timer.showTimer}
                className="sat-touch-target sat-pressable mt-0.5 inline-flex items-center justify-center underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
              >
                <span className="sat-type-control-secondary font-semibold text-[var(--sat-text)]">
                  {timerVisible ? "Hide" : "Show"}
                </span>
              </button>
            ) : null}
            <span className="sr-only" aria-live="polite" data-testid="sat-review-timer-announcement">
              {timerAnnouncement}
            </span>
          </div>
        </div>
      </header>
      <div className="min-w-0 px-4 sm:px-6" data-testid="sat-review-notices">
        {props.notices}
      </div>
      <main className="min-h-0 overflow-y-auto px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-[900px]">
          <h1 className="text-2xl font-semibold tracking-tight">{SAT_COPY.review.eyebrow}</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--sat-text-secondary)]">
            {SAT_COPY.review.instructions}
          </p>

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-y border-[var(--sat-divider-soft)] py-3 text-[14px] text-[var(--sat-text)]">
            <span>{props.answeredCount} answered</span>
            <span>{unanswered} unanswered</span>
            <span className="inline-flex items-center gap-1.5">
              <Bookmark className="h-4 w-4 fill-[var(--sat-review)] text-[var(--sat-review)]" aria-hidden="true" />{" "}
              {flagged} flagged
            </span>
          </div>

          <div className="mt-7">
            <SatQuestionStatusGrid items={props.items} onSelectQuestion={props.onSelectQuestion} showLegend />
          </div>

          {unanswered > 0 ? (
            <p className="mt-6 border-l-4 border-[var(--sat-accent)] bg-[var(--sat-accent-soft)] px-4 py-3 text-[14px] leading-6 text-[var(--sat-text)]">
              {SAT_COPY.review.unansweredNotice}
            </p>
          ) : (
            <p className="mt-6 border-l-4 border-[var(--sat-accent)] bg-[var(--sat-accent-soft)] px-4 py-3 text-[14px] leading-6 text-[var(--sat-text)]">
              {SAT_COPY.review.allAnswered}
            </p>
          )}
        </div>
      </main>

      <footer className="border-t border-[var(--sat-divider)] bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pb-[calc(0.75rem+var(--student-safe-bottom))] pt-3 sm:pl-[calc(2rem+var(--student-safe-left))] sm:pr-[calc(2rem+var(--student-safe-right))]">
        <div className="mx-auto max-w-[900px]">
          {saveMessage ? (
            <p
              id={reasonId}
              className="mb-3 flex flex-wrap items-center justify-end gap-2 text-[13px] leading-5 text-[var(--sat-text-secondary)]"
              role={props.saveFailureKind ? "alert" : "status"}
              aria-live={props.saveFailureKind ? "assertive" : "polite"}
            >
              <span>{saveMessage}</span>
              {canRetry ? (
                <button type="button" onClick={props.onRetrySave} className="underline underline-offset-2">
                  {SAT_COPY.review.retrySave}
                </button>
              ) : null}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={props.onBack}
              className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-accent)] px-5 text-[14px] font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              {backLabel}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
