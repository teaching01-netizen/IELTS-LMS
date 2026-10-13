import { useState } from "react";
import { examRepository } from "@services/examRepository";
import type { ExamEntity } from "../../../../types/domain";
import { SectionHeading } from "./releaseChrome";
import { releaseSurfaceClass } from "./releaseUi";

/**
 * Per-exam SAT completion behavior for Classroom sessions. On: students see
 * their score report and can download their answered exam. Off: students only
 * see "SAT complete". Standard Practice never shows a report. The server reads
 * this live, so a change applies to past attempts too.
 */
export function ScoreReportSettingPanel({
  exam,
  onSaved,
}: {
  exam: ExamEntity;
  onSaved: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = exam.satScoreReportEnabled === true;

  const toggle = async () => {
    setPending(true);
    setError(null);
    try {
      await examRepository.saveExam({ ...exam, satScoreReportEnabled: !enabled });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The setting could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={`${releaseSurfaceClass} p-5 sm:p-6`}>
      <SectionHeading
        eyebrow="Results"
        title="Score report after the exam"
        description="When on, students in Classroom sessions see their score report and can download their answered exam when they finish. When off, they only see that the SAT is complete. Standard Practice sessions never show a score report."
      />
      <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={pending || !exam.canEdit}
          onChange={() => void toggle()}
          className="h-5 w-5 accent-[var(--sat-staff-accent,#0071e3)]"
        />
        Show score report and answered exam
        {pending ? <span className="font-normal text-[var(--sat-staff-text-secondary,#515154)]">Saving…</span> : null}
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-danger,#d70015)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
