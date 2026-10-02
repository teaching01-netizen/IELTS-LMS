import { useId, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

/* The SAT entry portal: the first screen a student sees, so it already speaks
 * the exam's language. White header closed by the spectrum rail (the same edge
 * the exam top bar wears), pale chrome canvas, one white card holding the
 * form. Structure comes from hairlines and spacing, never shadows. */

const GUTTER =
  "pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] sm:pl-[calc(2rem+var(--student-safe-left))] sm:pr-[calc(2rem+var(--student-safe-right))]";

const CARD = "rounded-2xl border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)]";

const STEPS = [
  { title: "Check in", body: "Enter your Student ID/WCODE, name, and email." },
  {
    title: "Wait for your proctor",
    body: "Stay on the next screen. It updates on its own — there is nothing to refresh.",
  },
  {
    title: "Start your exam",
    body: "Your first module opens automatically. Your answers save as you go.",
  },
] as const;

function SatEntryPage({ children }: { children: ReactNode }) {
  return (
    <div className="sat-ui flex min-h-[100dvh] flex-col bg-[var(--sat-chrome)] text-[var(--sat-text)]">
      {/* Transparent reserved border + rail overlay: same host contract as SatExamTopBar. */}
      <header className="relative border-b border-transparent bg-[var(--sat-surface)] pt-[var(--student-safe-top)]">
        <div
          className={`mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between gap-4 ${GUTTER}`}
        >
          <p className="text-[17px] font-semibold tracking-tight">Digital SAT</p>
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--sat-text-secondary)]">
            <ShieldCheck size={15} aria-hidden="true" />
            Proctored exam
          </p>
        </div>
        <span aria-hidden="true" data-sat-color-rail="true" className="sat-color-rail" />
      </header>
      {children}
    </div>
  );
}

export interface SatEntryLayoutProps {
  /** Context line above the title: the exam, or "Digital SAT" when none is known. */
  eyebrow?: string | undefined;
  title: string;
  description?: string | undefined;
  /** Small facts under the description (audience chip). */
  meta?: ReactNode;
  /** Closing line of the card. */
  helpText?: string | undefined;
  /** Notices and the form. */
  children: ReactNode;
}

export function SatEntryLayout({
  eyebrow = "Digital SAT",
  title,
  description,
  meta,
  helpText = "Need help? Ask your proctor.",
  children,
}: SatEntryLayoutProps) {
  const titleId = useId();
  const stepsId = useId();
  return (
    <SatEntryPage>
      <main
        className={`mx-auto grid w-full max-w-[1120px] flex-1 content-start gap-x-20 gap-y-10 py-8 pb-[calc(2.5rem+var(--student-safe-bottom))] sm:py-12 lg:grid-cols-[minmax(0,1fr)_27rem] lg:py-20 ${GUTTER}`}
      >
        <div className="lg:col-start-1 lg:row-start-1">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--sat-accent-strong)]">
            {eyebrow}
          </p>
          <h1
            id={titleId}
            className="mt-3 text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--sat-exam-navy)] sm:text-[2.75rem]"
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-4 max-w-[34rem] text-[1.0625rem] leading-7 text-[var(--sat-text-secondary)]">
              {description}
            </p>
          ) : null}
          {meta ? <div className="mt-5">{meta}</div> : null}
        </div>

        <SatPresenceSurface
          role="region"
          aria-labelledby={titleId}
          offsetY={8}
          className={`${CARD} p-6 sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1`}
        >
          {children}
          <p className="mt-6 border-t border-[var(--sat-divider-soft)] pt-4 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
            {helpText}
          </p>
        </SatPresenceSurface>

        <section aria-labelledby={stepsId} className="lg:col-start-1 lg:row-start-2">
          <h2
            id={stepsId}
            className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--sat-text-secondary)]"
          >
            What happens next
          </h2>
          <ol className="mt-5 space-y-5">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                aria-current={index === 0 ? "step" : undefined}
                className="flex gap-4"
              >
                <span
                  aria-hidden="true"
                  className={`sat-tabular grid size-8 shrink-0 place-items-center rounded-full border border-[var(--sat-accent)] text-[14px] font-semibold ${
                    index === 0
                      ? "bg-[var(--sat-accent)] text-[var(--sat-accent-text)]"
                      : "bg-[var(--sat-surface)] text-[var(--sat-accent-strong)]"
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[16px] font-semibold leading-6">{step.title}</p>
                  <p className="mt-0.5 max-w-[30rem] text-[15px] leading-6 text-[var(--sat-text-secondary)]">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </SatEntryPage>
  );
}

/** Terminal entry states (closed, paused, not yet open): one card, nothing to fill in. */
export function SatEntryStatus({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: ReactNode;
  eyebrow?: string | undefined;
  title: string;
  description: string;
}) {
  return (
    <SatEntryPage>
      <main
        className={`mx-auto flex w-full max-w-[34rem] flex-1 items-center py-10 pb-[calc(2.5rem+var(--student-safe-bottom))] ${GUTTER}`}
      >
        <SatPresenceSurface offsetY={8} className={`${CARD} w-full p-8 text-center sm:p-10`}>
          <span
            aria-hidden="true"
            className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--sat-chrome)] text-[var(--sat-accent-strong)]"
          >
            {icon}
          </span>
          {eyebrow ? (
            <p className="mt-5 text-[13px] font-semibold text-[var(--sat-text-secondary)]">
              {eyebrow}
            </p>
          ) : null}
          <h1
            className={`${eyebrow ? "mt-1.5" : "mt-5"} text-[1.5rem] font-semibold leading-8 tracking-[-0.02em] text-[var(--sat-exam-navy)]`}
          >
            {title}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-6 text-[var(--sat-text-secondary)]">
            {description}
          </p>
        </SatPresenceSurface>
      </main>
    </SatEntryPage>
  );
}
