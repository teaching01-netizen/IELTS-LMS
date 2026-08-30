import { hasStructuredContent } from "../../../exam-authoring/api/renderingPublic";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import type { AssessmentDeliveryModule } from "../../contracts/assessmentDelivery";
import { studentModuleTitle } from "../../application/satRuntimeSelectors";

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
}

export function SatDirectionsScreen(props: SatDirectionsScreenProps) {
  const canStart =
    Boolean(props.module) &&
    props.runtimeStatus === "live" &&
    props.proctorStatus !== "paused" &&
    props.proctorStatus !== "terminated" &&
    (props.stageReady ?? true);
  const instructions =
    props.module && hasStructuredContent(props.module.instructions)
      ? props.module.instructions
      : null;

  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[calc(2rem+var(--student-safe-top))] pb-[calc(2rem+var(--student-safe-bottom))] text-[var(--sat-text)]">
      <main className="w-full max-w-[720px] border-y border-[var(--sat-divider)] py-8 sm:py-10">
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-tight">{props.sectionLabel}</h1>
        <p className="mt-1 text-[18px] text-[var(--sat-text)]">
          {props.module ? studentModuleTitle(props.module) : "Next module"}
        </p>
        <p className="mt-5 text-[15px] leading-7 text-[var(--sat-text-secondary)]">
          {props.module
            ? `${Math.round(props.module.durationSeconds / 60)} minutes · ${props.module.targetQuestionCount} questions`
            : "Preparing the next module."}
        </p>

        {instructions ? (
          <section
            className="mt-6 border-t border-[var(--sat-divider-soft)] pt-5 text-[15px] leading-7"
            aria-label="Module directions"
          >
            <StructuredContentRenderer content={instructions} />
          </section>
        ) : (
          <p className="mt-6 border-t border-[var(--sat-divider-soft)] pt-5 text-[15px] leading-7 text-[var(--sat-text-secondary)]">
            Read each question carefully. You may move among questions in this module until you
            submit it.
          </p>
        )}

        {props.runtimeStatus !== "live" ? (
          <p className="mt-5 border-l-4 border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] px-4 py-3 text-[14px] text-[var(--sat-warning)]">
            Waiting for the proctor to start the exam session.
          </p>
        ) : null}
        {props.proctorStatus === "paused" ? (
          <p className="mt-5 border-l-4 border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] px-4 py-3 text-[14px] text-[var(--sat-warning)]">
            Your attempt is paused by the proctor.
          </p>
        ) : null}
        {props.runtimeStatus === "live" && props.stageReady === false ? (
          <p className="mt-5 border-l-4 border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] px-4 py-3 text-[14px] text-[var(--sat-warning)]">
            Waiting for the proctor-controlled cohort timer to open this module.
          </p>
        ) : null}
        {props.error ? (
          <p
            className="mt-5 border-l-4 border-[var(--sat-danger)] bg-[var(--sat-danger-soft)] px-4 py-3 text-[14px] text-[var(--sat-danger)]"
            role="alert"
          >
            {props.error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={props.onStart}
            disabled={!canStart || props.isStarting}
            className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
          >
            {props.isStarting ? "Starting…" : "Start"}
          </button>
          <button
            type="button"
            onClick={() => void props.onExit()}
            className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-divider)] px-5 text-[14px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            Exit
          </button>
        </div>
      </main>
    </div>
  );
}
