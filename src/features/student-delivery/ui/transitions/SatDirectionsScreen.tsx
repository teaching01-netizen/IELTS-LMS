import { useRef, useState } from "react";
import { hasStructuredContent } from "../../../exam-authoring/api/renderingPublic";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import type { AssessmentDeliveryModule } from "../../contracts/assessmentDelivery";
import { studentModuleTitle } from "../../application/satRuntimeSelectors";
import { SAT_COPY } from "../../domain/satCopy";
import { SatCenterModal } from "../primitives/SatCenterModal";

export interface SatDirectionsScreenProps {
  module: AssessmentDeliveryModule | null;
  sectionLabel: string;
  runtimeStatus: string;
  proctorStatus: string;
  isStarting: boolean;
  stageReady?: boolean;
  error: string | null;
  onStart: () => void;
  onExit: () => void | Promise<void>;
  // Exam-day re-audit defect 2: terminal recovery failed while every module
  // is final — offer the same finalize retry available in `submitting`.
  secondaryActionLabel?: string | undefined;
  onSecondaryAction?: (() => void) | undefined;
  secondaryActionPending?: boolean | undefined;
}

export function SatDirectionsScreen(props: SatDirectionsScreenProps) {
  const canStart =
    Boolean(props.module) &&
    props.runtimeStatus === "live" &&
    props.proctorStatus !== "paused" &&
    props.proctorStatus !== "terminated" &&
    (props.stageReady ?? true);
  // Tertiary "Leave exam" path (Phase 6b): leaving mid-directions is a
  // destructive-adjacent exit, so it confirms with saved-state language.
  // Focus moves into the dialog and back on every close path.
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const leaveButtonRef = useRef<HTMLButtonElement>(null);
  const openLeaveConfirm = (): void => {
    setLeaveConfirmOpen(true);
  };
  const closeLeaveConfirm = (): void => {
    setLeaveConfirmOpen(false);
  };
  const instructions =
    props.module && hasStructuredContent(props.module.instructions)
      ? props.module.instructions
      : null;

  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[calc(2rem+var(--student-safe-top))] pb-[calc(2rem+var(--student-safe-bottom))] text-[var(--sat-text)]">
      <main className="w-full max-w-[720px] border-y border-[var(--sat-divider)] py-8 sm:py-10">
        <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
        {/* scale-exception: text-[30px] directions H1 has no type token (scale tops out at 20px timer); literal kept intentionally. */}
        <h1 className="mt-2 text-[30px] font-semibold tracking-tight">{props.sectionLabel}</h1>
        <p className="mt-1 sat-type-input text-[var(--sat-text)]">
          {props.module ? studentModuleTitle(props.module) : "Next module"}
        </p>
        <p className="mt-5 sat-type-control-primary leading-7 text-[var(--sat-text-secondary)]">
          {props.module
            ? `${Math.round(props.module.durationSeconds / 60)} minutes · ${props.module.targetQuestionCount} questions`
            : "Preparing the next module."}
        </p>

        {instructions ? (
          <section
            className="mt-6 border-t border-[var(--sat-divider-soft)] pt-5 sat-type-control-primary leading-7"
            aria-label="Module directions"
          >
            <StructuredContentRenderer content={instructions} />
          </section>
        ) : (
          <p className="mt-6 border-t border-[var(--sat-divider-soft)] pt-5 sat-type-control-primary leading-7 text-[var(--sat-text-secondary)]">
            Read each question carefully. You may move among questions in this module until you
            submit it.
          </p>
        )}

        {props.runtimeStatus !== "live" ? (
          <p className="mt-5 border-l-4 border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] px-4 py-3 sat-type-control-secondary text-[var(--sat-warning)]">
            Waiting for the proctor to start the exam session.
          </p>
        ) : null}
        {props.proctorStatus === "paused" ? (
          <p className="mt-5 border-l-4 border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] px-4 py-3 sat-type-control-secondary text-[var(--sat-warning)]">
            Your attempt is paused by the proctor.
          </p>
        ) : null}
        {props.runtimeStatus === "live" && props.stageReady === false ? (
          <p className="mt-5 border-l-4 border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] px-4 py-3 sat-type-control-secondary text-[var(--sat-warning)]">
            Waiting for the proctor-controlled cohort timer to open this module.
          </p>
        ) : null}
        {props.error ? (
          <p
            className="mt-5 border-l-4 border-[var(--sat-danger)] bg-[var(--sat-danger-soft)] px-4 py-3 sat-type-control-secondary text-[var(--sat-danger)]"
            role="alert"
          >
            {props.error}
          </p>
        ) : null}

        <p className="mt-5 sat-type-metadata leading-5 text-[var(--sat-text-secondary)]">
          {SAT_COPY.directions.calculatorCleared} {SAT_COPY.directions.timerBegins}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={props.onStart}
            disabled={!canStart || props.isStarting}
            aria-describedby={canStart ? undefined : "sat-directions-start-blocked"}
            className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-6 sat-type-control-secondary font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
          >
            {props.isStarting
              ? SAT_COPY.directions.starting
              : SAT_COPY.directions.beginModule +
                (props.module ? " \u2014 " + studentModuleTitle(props.module) : "")}
          </button>
          {props.secondaryActionLabel && props.onSecondaryAction ? (
            <button
              type="button"
              onClick={props.onSecondaryAction}
              disabled={props.secondaryActionPending}
              className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-5 sat-type-control-secondary font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {props.secondaryActionPending ? "Retrying…" : props.secondaryActionLabel}
            </button>
          ) : null}
          <button
            ref={leaveButtonRef}
            type="button"
            onClick={openLeaveConfirm}
            className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-divider)] px-5 sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)] hover:bg-[var(--sat-surface-hover)] hover:text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.directions.leaveExam}
          </button>
        </div>
        {!canStart && !props.isStarting ? (
          <p id="sat-directions-start-blocked" className="mt-3 sat-type-metadata text-[var(--sat-text-secondary)]">
            {props.proctorStatus === "paused"
              ? SAT_COPY.blocking.pausedBody
              : "The start button enables when the proctor opens this module."}
          </p>
        ) : null}
        {/* Leave confirm on the shared center-modal shell (Phase 11): Radix
            focus contract + routeAlert layer instead of a bespoke veil. */}
        <SatCenterModal
          open={leaveConfirmOpen}
          title={SAT_COPY.directions.leaveConfirmTitle}
          closeLabel={SAT_COPY.directions.stayAndContinue}
          onClose={closeLeaveConfirm}
          triggerRef={leaveButtonRef}
          layer="routeAlert"
          description={SAT_COPY.directions.leaveConfirmBody}
        >
          <div className="px-5 py-5">
            <p className="sat-type-control-secondary leading-6 text-[var(--sat-text-secondary)]">
              {SAT_COPY.directions.leaveConfirmBody}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeLeaveConfirm}
                className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-divider)] px-4 sat-type-control-secondary font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
              >
                {SAT_COPY.directions.stayAndContinue}
              </button>
              <button
                type="button"
                onClick={() => void props.onExit()}
                className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-danger)] px-4 sat-type-control-secondary font-semibold text-[var(--sat-accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
              >
                {SAT_COPY.directions.leaveForSure}
              </button>
            </div>
          </div>
        </SatCenterModal>
      </main>
    </div>
  );
}
