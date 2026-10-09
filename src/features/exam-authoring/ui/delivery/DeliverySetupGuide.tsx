import { Check, ChevronRight } from "lucide-react";

export interface DeliverySetupGuideProps {
  versionNumber: number;
  /** Sessions already prepared on this version (not revoked). */
  groupCount: number;
  runningCount?: number;
  finishedCount?: number;
  onCreate: () => void;
}

/**
 * First-time guidance as three connected steps. It is a full card until the
 * first session exists, then collapses to a disclosure that frequent users
 * can ignore and anyone can reopen.
 */
export function DeliverySetupGuide({ versionNumber, groupCount, runningCount = 0, finishedCount = 0, onCreate }: DeliverySetupGuideProps) {
  const configured = groupCount > 0 || runningCount > 0 || finishedCount > 0;
  const steps = [
    { label: "Publish", detail: `Version ${versionNumber} is published.`, done: true },
    {
      label: "Create room",
      detail: groupCount > 0
        ? `${groupCount} ${groupCount === 1 ? "room" : "rooms"} prepared on this version.`
        : configured ? "A room was prepared for this exam."
        : `Version ${versionNumber} has no room yet. Name it, choose who can join and when check-in is open.`,
      done: configured,
    },
    {
      label: "Share and run",
      detail: finishedCount > 0
        ? `${finishedCount} ${finishedCount === 1 ? "room has" : "rooms have"} finished. View results or start from an earlier session.`
        : runningCount > 0
          ? `${runningCount} ${runningCount === 1 ? "room is" : "rooms are"} running. Open a room to monitor students.`
          : "Select a room to copy its student link or show its QR code. Students wait in check-in until the proctor starts the exam. Copying does not confirm that the link was shared.",
      done: runningCount > 0 || finishedCount > 0,
    },
  ];
  const list = (
    <ol aria-label="Room settings steps" className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => {
        const current = !step.done && steps.slice(0, index).every((previous) => previous.done);
        return (
          <li
            key={step.label}
            aria-current={current ? "step" : undefined}
            className={`rounded-xl border p-3 ${current ? "border-au-accent/40 bg-au-accent/5" : "border-black/[0.06] bg-white"}`}
          >
            <p className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[14px] ${step.done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"}`}
              >
                {step.done ? <Check size={12} /> : index + 1}
              </span>
              {step.label}
              {step.done ? <span className="sr-only"> (done)</span> : null}
            </p>
            <p className="mt-1 text-[14px] leading-5 text-slate-600">{step.detail}</p>
          </li>
        );
      })}
    </ol>
  );

  if (configured) {
    return (
      <details className="group mt-4 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-white px-4 py-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
          <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)] transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          How rooms work
          <span className="ml-auto font-normal text-[var(--sat-staff-text-secondary,#515154)]">{steps.filter((step) => step.done).length} of {steps.length} steps done</span>
        </summary>
        <div className="pb-3 pt-1">{list}</div>
      </details>
    );
  }
  return (
    <section aria-label="Set up a room" className="sat-route-enter mt-4 rounded-2xl border border-black/[0.06] bg-white p-4">
      <h2 className="text-[15px] font-semibold text-slate-950">Run this exam in three steps</h2>
      <div className="mt-3">{list}</div>
      <button
        type="button"
        onClick={onCreate}
        className="sat-btn sat-btn--primary sat-press mt-4"
      >
        Create room
      </button>
    </section>
  );
}
