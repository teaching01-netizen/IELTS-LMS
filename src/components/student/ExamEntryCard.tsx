import React, { useId } from "react";
import type { ExamConfig, ExamType } from "../../types";
import { PreExamPage } from "./preExam/PreExamPage";

export function formatExamDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (remainder || !hours) parts.push(`${remainder} ${remainder === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

interface ExamEntryCardProps {
  config?: ExamConfig | undefined;
  examTitle: string;
  /** Provider drives the badge in the shell header. IELTS unless an ACT exam. */
  examType?: ExamType | undefined;
  candidateName?: string | null | undefined;
  candidateId?: string | null | undefined;
  footer?: React.ReactNode;
  status?: "connecting" | "waiting" | undefined;
  statusDetail?: string | undefined;
}

/* The waiting room: status, then the exam's own facts.
 *
 * The section list is the reason this screen exists. Everything else is one
 * line of status and the two facts a candidate needs to trust the timer. */
export function ExamEntryCard({
  config,
  examTitle,
  examType = "Academic",
  candidateName,
  candidateId,
  footer,
  status = "waiting",
  statusDetail,
}: ExamEntryCardProps) {
  const titleId = useId();
  const sections = Object.values(config?.sections ?? {})
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order);
  const totalDuration = sections.reduce((total, section) => total + section.duration, 0);

  const statusLabel =
    status === "connecting"
      ? "Preparing your connection…"
      : "Waiting for the proctor to start the exam";
  const examBadge = examType === "ACT" ? "ACT" : "IELTS";

  return (
    <PreExamPage examBadge={examBadge}>
      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pb-[calc(2rem+var(--student-safe-bottom))] pt-10 sm:px-6 sm:pt-16">
        <section
          aria-labelledby={titleId}
          className="rounded-xl border border-[var(--exam-hairline)] bg-[var(--exam-surface)] shadow-[0_1px_2px_rgba(24,24,27,0.04)]"
        >
          <div className="p-5 sm:p-6">
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-[13px] font-medium leading-5 text-[var(--exam-ink-secondary)]"
            >
              <span
                aria-hidden="true"
                className={`exam-entry-status-dot ${
                  status === "connecting" ? "motion-safe:animate-pulse" : ""
                }`}
              />
              <span>{statusLabel}</span>
            </div>

            <h2
              id={titleId}
              className="mt-3 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-[var(--exam-ink)]"
            >
              Waiting for the exam to start
            </h2>
            <p className="mt-2 text-[14px] leading-6 text-[var(--exam-ink-secondary)]">
              You're checked in and waiting for the exam to start. Please keep this page open.
            </p>
            {statusDetail ? (
              <p className="mt-2 text-[13px] leading-5 text-[var(--exam-attention)]">
                {statusDetail}
              </p>
            ) : null}

            <div className="mt-5 border-t border-[var(--exam-hairline)] pt-4">
              <p className="exam-entry-meta-label text-[12px] leading-4">Exam</p>
              <h3 className="mt-1 text-[16px] font-semibold leading-6 text-[var(--exam-ink)]">
                {examTitle}
              </h3>

              {candidateName || candidateId ? (
                <dl className="mt-3 space-y-2.5">
                  {candidateName ? (
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="exam-entry-meta-label text-[13px] leading-5">Candidate</dt>
                      <dd className="min-w-0 truncate text-right text-[14px] font-medium leading-5 text-[var(--exam-ink)]">
                        {candidateName}
                      </dd>
                    </div>
                  ) : null}
                  {candidateId ? (
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="exam-entry-meta-label text-[13px] leading-5">Candidate ID</dt>
                      <dd className="min-w-0 truncate text-right font-mono text-[13px] leading-5 tracking-[0.04em] text-[var(--exam-ink)]">
                        {candidateId}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </div>

            <div className="mt-5 border-t border-[var(--exam-hairline)] pt-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[13px] font-medium leading-5 text-[var(--exam-ink)]">
                  Total duration
                </span>
                <span className="text-[13px] font-semibold leading-5 tabular-nums text-[var(--exam-ink)]">
                  {formatExamDuration(totalDuration)}
                </span>
              </div>
              <ul className="mt-1 divide-y divide-[var(--exam-hairline)]">
                {sections.map((section) => (
                  <li
                    data-testid="exam-section"
                    key={section.label}
                    className="flex items-baseline justify-between gap-4 py-2"
                  >
                    <span className="min-w-0 truncate text-[14px] leading-5 text-[var(--exam-ink)]">
                      {section.label}
                    </span>
                    <span className="shrink-0 text-[13px] leading-5 tabular-nums text-[var(--exam-ink-secondary)]">
                      {formatExamDuration(section.duration)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {footer ? (
              <div className="mt-4 border-t border-[var(--exam-hairline)] pt-4">{footer}</div>
            ) : null}

            <div className="mt-5 space-y-1.5 border-t border-[var(--exam-hairline)] pt-4 text-[12px] leading-5 text-[var(--exam-ink-muted)]">
              <p>
                Your exam timer will not begin while you are waiting. The timer starts when the
                proctor begins the exam.
              </p>
              <p>
                Your answers save automatically. If your connection drops, return on the same device
                and browser. Once the exam begins, refreshing or leaving this page will not pause
                the timer.
              </p>
            </div>
          </div>
        </section>
      </main>
    </PreExamPage>
  );
}
