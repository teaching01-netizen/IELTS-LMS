import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import type { AssessmentResult, SATRecoveryResolutionReceipt } from "../../contracts/assessmentDelivery";
import { classroomReport, SatScoreReport, type AnsweredExamSource } from "./SatScoreReport";

export interface SATCompletionRecoveryException {
  moduleTitle: string;
  receipt: SATRecoveryResolutionReceipt;
}

/** Confirms that the SAT exam is complete; shows the score report only when the exam's report setting released one. */
export function SatCompleteScreen({
  result,
  onExit,
  answered = null,
  recoveryExceptions = [],
  eva = null,
}: {
  result: AssessmentResult | null;
  onExit: () => void | Promise<void>;
  answered?: AnsweredExamSource | null;
  recoveryExceptions?: readonly SATCompletionRecoveryException[];
  /** The shared Eva SIM status group, identical in both branches. */
  eva?: ReactNode;
}) {
  const report = classroomReport(result);
  if (!report) return <SatCompletionOnly onExit={onExit} recoveryExceptions={recoveryExceptions} eva={eva} />;
  return <SatScoreReport report={report} answered={answered} onExit={onExit} recoveryExceptions={recoveryExceptions} eva={eva} />;
}

function SatCompletionOnly({ onExit, recoveryExceptions, eva }: {
  onExit: () => void | Promise<void>;
  recoveryExceptions: readonly SATCompletionRecoveryException[];
  eva: ReactNode;
}) {
  const hasRecoveryException = recoveryExceptions.length > 0;
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[calc(1.5rem+var(--student-safe-top))] pb-[calc(1.5rem+var(--student-safe-bottom))] text-[var(--sat-text)]">
      <main className="w-full max-w-lg rounded-2xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-6 py-8 shadow-[var(--sat-shadow-floating)] sm:px-10 sm:py-10">
        <header className="flex flex-col items-center text-center">
          <span
            className={`grid size-14 place-items-center rounded-full ${hasRecoveryException ? "bg-[var(--sat-warning-soft)] text-[var(--sat-warning)]" : "bg-[var(--sat-accent-soft)] text-[var(--sat-accent-strong)]"}`}
            aria-hidden="true"
          >
            {hasRecoveryException ? <AlertTriangle size={28} strokeWidth={2.25} /> : <CheckCircle2 size={28} strokeWidth={2.25} />}
          </span>
          <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--sat-text-secondary)]">Digital SAT</p>
          <h1
            data-sat-stage-heading="true"
            tabIndex={-1}
            className="mt-1.5 text-[32px] font-semibold leading-tight tracking-tight [text-wrap:balance] focus-visible:outline-none"
          >
            {hasRecoveryException ? SAT_COPY.transitions.completeRecoveryTitle : SAT_COPY.transitions.completeTitle}
          </h1>
          <p className="mt-2 max-w-sm text-[15px] leading-6 text-[var(--sat-text-secondary)] [text-wrap:pretty]">
            {hasRecoveryException ? SAT_COPY.transitions.completeRecoverySubtitle : SAT_COPY.transitions.completeSubtitle}
          </p>
        </header>
        {hasRecoveryException ? (
          <ul className="mt-6 space-y-2 text-left text-[14px] leading-5 text-[var(--sat-text-secondary)]" aria-label="Recovery decisions recorded">
            {recoveryExceptions.map(({ moduleTitle, receipt }) => (
              <li key={receipt.receiptId} className="rounded-xl border border-[var(--sat-divider)] bg-[var(--sat-surface-subtle)] px-4 py-3">
                <span className="font-semibold text-[var(--sat-text)]">{moduleTitle}</span>
                <span className="sat-tabular mt-0.5 block">Recovery record {receipt.receiptId}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {eva}
        <div className="mt-8 border-t border-[var(--sat-divider)] pt-6">
          <button
            type="button"
            onClick={() => void onExit()}
            className="sat-touch-target sat-pressable w-full rounded-full bg-[var(--sat-accent)] px-6 text-[15px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sat-surface)]"
          >
            Back to dashboard
          </button>
        </div>
      </main>
    </div>
  );
}

/** Classroom staff_selects: Module 1 is in; the student holds until staff assign Module 2. */
export function SatAwaitingRouteScreen({ onExit }: { onExit: () => void | Promise<void> }) {
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]">
      <main role="status" className="w-full max-w-lg border-y border-[var(--sat-divider)] py-10">
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
        <h1
          data-sat-stage-heading="true"
          tabIndex={-1}
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          Awaiting teacher assignment
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]">
          Your answers are saved. Your teacher will choose your next module. This page updates automatically.
        </p>
        <button
          type="button"
          onClick={() => void onExit()}
          className="sat-touch-target sat-pressable mt-8 rounded-full border border-[var(--sat-divider)] px-6 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          Back to dashboard
        </button>
      </main>
    </div>
  );
}

export function SatTerminatedScreen({
  note,
  onExit,
}: {
  note: string | null;
  onExit: () => void | Promise<void>;
}) {
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] pt-[var(--student-safe-top)] pb-[var(--student-safe-bottom)] text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg border-y border-[var(--sat-divider)] py-10">
        <p className="text-[14px] font-semibold text-[var(--sat-danger)]">Session ended</p>
        <h1
          data-sat-stage-heading="true"
          tabIndex={-1}
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          Your SAT attempt has ended
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--sat-text-secondary)]">
          {note || "Please contact the proctor if you need assistance."}
        </p>
        <button
          type="button"
          onClick={() => void onExit()}
          className="sat-touch-target sat-pressable mt-8 rounded-full bg-[var(--sat-text)] px-6 text-[14px] font-semibold text-[var(--sat-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          Return
        </button>
      </main>
    </div>
  );
}
