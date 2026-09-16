import { useId, useRef, useState, type CSSProperties } from "react";
import { Bookmark } from "lucide-react";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";
import { SAT_COPY, satSubmitConfirmSummary, satSubmitConfirmTitle, satWaitingForSavesLabel } from "../../domain/satCopy";
import {
  deriveSatSubmitReadiness,
  type SatSubmitReadinessInput,
} from "../../domain/satSubmitReadiness";
import { SatQuestionStatusGrid } from "./SatQuestionStatusGrid";
import { SatCenterModal } from "../primitives/SatCenterModal";
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
  isSubmitting: boolean;
  persistenceBlocked: boolean;
  /** Raw persistence inputs for the shared readiness derivation. */
  readinessInput?: SatSubmitReadinessInput | undefined;
  /** Current question index (0-based) for the "Back to question N" exit. */
  currentQuestionIndex?: number | undefined;
  timerVisible?: boolean | undefined;
  onToggleTimer?: (() => void) | undefined;
  onSelectQuestion: (index: number) => void;
  onBack: () => void;
  onSubmit: () => void;
  onRetrySave?: (() => void) | undefined;
}

/**
 * Module review page (Phases 1+2 applied).
 *
 * - Submit is a TWO-STEP action: the footer button opens a confirm dialog
 *   that names its scope (module), lists unanswered + flagged counts, and
 *   states irreversibility. One tap can never close a module.
 * - The button never dies silently: readiness derives from the same
 *   persistence inputs as the shell save banner. Saving shows an inline
 *   reason with aria-describedby; hard blocks show reason + recovery.
 * - Vocabulary (copy table): "Review your answers" H1, "Review answers"
 *   destination, "Flagged" state, "Back to question N" exit.
 */
export function SatReviewPage(props: SatReviewPageProps) {
  const unanswered = Math.max(0, props.items.length - props.answeredCount);
  const flagged = props.items.filter((item) => item.markedForReview).length;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const timerVisible = props.timerVisible ?? true;
  // Wave A R-04: same threshold contract as the module timer (polite 300s /
  // 60s one-shots, never per-second). Announce-only on review — no modal
  // warning here, it would interrupt the submit decision.
  const timerAnnouncement = useStudentTimerAnnouncement(props.remainingSeconds);

  const readiness = deriveSatSubmitReadiness(
    props.readinessInput ?? {
      isSubmitting: props.isSubmitting,
      failure: props.persistenceBlocked ? "Blocked" : null,
      failureKind: props.persistenceBlocked ? "retryable" : null,
      pendingCount: props.persistenceBlocked ? 1 : 0,
    },
  );
  const submitting = readiness.status === "submitting";
  const hardBlocked = readiness.status === "blocked-offline" || readiness.status === "blocked-error";
  const saving = readiness.status === "saving";
  const needsReason = hardBlocked || saving;

  const backLabel =
    props.currentQuestionIndex !== undefined
      ? "Back to question " + (props.currentQuestionIndex + 1)
      : SAT_COPY.navigation.backToQuestions;
  const reviewStyle: CSSProperties | undefined =
    props.examHeight !== null && Number.isFinite(props.examHeight)
      ? ({ ["--student-exam-height" as string]: `${props.examHeight}px` } as CSSProperties)
      : undefined;

  const openConfirm = (): void => {
    if (hardBlocked || submitting) return;
    setConfirmOpen(true);
  };

  return (
    <div
      className="sat-ui sat-review-page grid h-[100dvh] min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--sat-background)] text-[var(--sat-text)]"
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
      <main className="min-h-0 overflow-y-auto px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-[900px]">
          <h1 className="text-2xl font-semibold tracking-tight">{SAT_COPY.review.eyebrow}</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--sat-text-secondary)]">
            You can return to any question in this module before you submit. {SAT_COPY.submit.cannotReturn}
          </p>

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-y border-[var(--sat-divider-soft)] py-3 text-[14px] text-[var(--sat-text)]">
            <span>{props.answeredCount} answered</span>
            <span>{unanswered} unanswered</span>
            <span className="inline-flex items-center gap-1.5">
              <Bookmark className="h-4 w-4 fill-[var(--sat-review)] text-[var(--sat-review)]" aria-hidden="true" />{" "}
              {flagged} {flagged === 1 ? "flagged" : "flagged"}
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
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={props.onBack}
              disabled={submitting}
              className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-accent)] px-5 text-[14px] font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-accent-soft)] disabled:cursor-not-allowed disabled:border-[var(--sat-divider)] disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              {backLabel}
            </button>
            <button
              ref={submitButtonRef}
              type="button"
              onClick={openConfirm}
              disabled={hardBlocked || submitting}
              aria-disabled={saving ? true : undefined}
              aria-describedby={needsReason ? reasonId : undefined}
              className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              {submitting ? SAT_COPY.submit.submitting : SAT_COPY.submit.submitModule}
            </button>
          </div>
          {needsReason ? (
            <p id={reasonId} className="mt-2 text-right text-[13px] leading-5 text-[var(--sat-text-secondary)]" role="status">
              {saving && readiness.status === "saving" ? satWaitingForSavesLabel(readiness.pendingCount) : null}
              {readiness.status === "blocked-offline" ? SAT_COPY.submitReadiness.offlineBlocked : null}
              {readiness.status === "blocked-error" ? SAT_COPY.submitReadiness.errorBlocked : null}
              {readiness.status === "blocked-error" && props.onRetrySave ? (
                <button type="button" onClick={props.onRetrySave} className="ml-2 underline underline-offset-2">
                  {SAT_COPY.saveStatus.retryNow}
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      </footer>
      {/* Submit confirm on the shared center-modal shell (Phase 11): Radix
          focus contract + submissionVeil layer instead of a bespoke veil.
          data-testid preserved for the suite + e2e. */}
      <SatCenterModal
        open={confirmOpen}
        title={satSubmitConfirmTitle(props.moduleTitle)}
        closeLabel={SAT_COPY.review.keepChecking}
        onClose={() => setConfirmOpen(false)}
        triggerRef={submitButtonRef}
        layer="submissionVeil"
        description={`${satSubmitConfirmSummary(unanswered, flagged)}. ${SAT_COPY.submit.cannotReturn}`}
      >
        <div data-testid="sat-submit-confirm" className="px-6 py-5">
          <p className="text-[14px] leading-6 text-[var(--sat-text)]">
            {satSubmitConfirmSummary(unanswered, flagged)}. {SAT_COPY.submit.cannotReturn}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-divider)] px-5 text-[14px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              {SAT_COPY.review.keepChecking}
            </button>
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); props.onSubmit(); }}
              className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-5 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              {SAT_COPY.review.submitAnyway}
            </button>
          </div>
        </div>
      </SatCenterModal>
    </div>
  );
}
