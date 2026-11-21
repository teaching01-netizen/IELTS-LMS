import { useState } from "react";
import { hasBackendStatusCode } from "../../../../services/backendBridge";
import type { ExamEntity } from "../../../../types/domain";
import type { SatActivityPolicy } from "../../../../shared/sat/learningPolicy";
import { SatButton } from "../../../../products/sat/ui/SatPage";
import { SatLearningSettings, defaultSatClassroomLearningPolicy, satLearningSettingsError } from "../../../../products/sat/classrooms/SatLearningSettings";
import { useSaveExamMutation } from "../../api/examQueries";
import { releaseSurfaceClass } from "./releaseUi";

function policySummary(policy: SatActivityPolicy): string {
  return [
    policy.reportVisible ? "Results on" : "Results off",
    policy.unlimitedRetakes ? "Retakes on" : "Retakes off",
    policy.reportVisible && policy.includeAnswerKeyInPdf ? "PDF keys on" : "PDF keys off",
    policy.pauseOnLeave ? "Pause on" : "Pause off",
  ].join(" · ");
}

export function ScoreReportSettingPanel({ exam, onSaved }: {
  exam: ExamEntity;
  onSaved: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SatActivityPolicy | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveExam = useSaveExamMutation();
  const savedPolicy = exam.satLearningDefaults ?? defaultSatClassroomLearningPolicy(exam.satScoreReportEnabled);
  const policy = draft ?? savedPolicy;
  const change = (next: SatActivityPolicy) => {
    setDraft(next);
    setSaved(false);
  };
  const save = async () => {
    setError(null);
    setConflict(false);
    setSaved(false);
    try {
      await saveExam.mutateAsync({ ...exam, satLearningDefaults: policy });
      await onSaved();
      setDraft(null);
      setSaved(true);
    } catch (cause) {
      // A stale revision keeps the draft: the teacher can reload the latest
      // values and apply the same choice again without retyping it.
      setConflict(hasBackendStatusCode(cause, 409));
      setError(cause instanceof Error ? cause.message : "Couldn’t save these settings. Check your connection and try again.");
    }
  };
  const reload = async () => {
    setError(null);
    setConflict(false);
    await onSaved();
  };

  return (
    <section className={`${releaseSurfaceClass} p-5 sm:p-6`}>
      <SatLearningSettings
        examDefaults
        value={policy}
        onChange={change}
        disabled={saveExam.isPending || !exam.canEdit}
      />
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-[var(--sat-text-secondary)]">
        <span className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Saved now</span>
        <span data-sat-policy-summary="saved">{policySummary(savedPolicy)}</span>
      </div>
      {draft ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SatButton variant="primary" disabled={saveExam.isPending || !exam.canEdit || Boolean(satLearningSettingsError(draft))} onClick={() => void save()}>
            {saveExam.isPending ? "Saving…" : "Save changes"}
          </SatButton>
          <SatButton variant="quiet" disabled={saveExam.isPending} onClick={() => { setDraft(null); setError(null); setConflict(false); setSaved(false); }}>
            Discard changes
          </SatButton>
        </div>
      ) : null}
      <div aria-live="polite">
        {saved ? (
          <p role="status" className="mt-3 text-sm text-[var(--sat-text-secondary)]" data-sat-policy-status="saved">
            Saved. The exam and its scheduled, running, and paused rooms now use these settings.
          </p>
        ) : null}
        {error && !conflict ? (
          <p role="alert" className="mt-3 text-sm text-[var(--sat-staff-danger,#d70015)]">{error}</p>
        ) : null}
      </div>
      {conflict ? (
        <div
          className="mt-3 grid gap-2 rounded-xl border border-[var(--sat-staff-danger-border)] bg-[var(--sat-staff-danger-tint)] px-4 py-3"
          data-sat-policy-conflict="exam"
        >
          <p className="text-[13px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
            This exam changed while you were editing.
          </p>
          <p className="text-[12.5px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            Your changes are still here. Reload the latest values, then save again.
          </p>
          <div className="mt-1">
            <SatButton variant="quiet" onClick={() => void reload()} disabled={saveExam.isPending}>
              Reload latest values
            </SatButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
