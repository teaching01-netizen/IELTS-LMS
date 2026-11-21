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
    policy.reportVisible ? "results on" : "results off",
    policy.unlimitedRetakes ? "retakes on" : "retakes off",
    policy.reportVisible && policy.includeAnswerKeyInPdf ? "PDF keys on" : "PDF keys off",
    policy.pauseOnLeave ? "pause on" : "pause off",
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
      setError(cause instanceof Error ? cause.message : "The settings could not be saved. Try again.");
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
        onChange={setDraft}
        disabled={saveExam.isPending || !exam.canEdit}
      />
      <p className="mt-3 text-sm text-[var(--sat-text-secondary)]" data-sat-policy-scope="exam">
        Saving here updates the exam defaults and the same fields in every scheduled or running room,
        including paused rooms. Closed rooms keep their own settings, and a later room save wins in that
        room until an exam save changes the same field again.
      </p>
      <p className="mt-2 text-sm text-[var(--sat-text-secondary)]">
        Currently saved: <span data-sat-policy-summary="saved">{policySummary(savedPolicy)}</span>
      </p>
      {draft ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SatButton disabled={saveExam.isPending || !exam.canEdit || Boolean(satLearningSettingsError(draft))} onClick={() => void save()}>
            {saveExam.isPending ? "Saving…" : "Save settings"}
          </SatButton>
          <SatButton variant="quiet" disabled={saveExam.isPending} onClick={() => { setDraft(null); setError(null); setConflict(false); setSaved(false); }}>
            Discard changes
          </SatButton>
        </div>
      ) : null}
      <div aria-live="polite">
        {saved ? (
          <p role="status" className="mt-2 text-sm text-[var(--sat-text-secondary)]" data-sat-policy-status="saved">
            Settings saved. Scheduled and running rooms now use the changed fields.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-[var(--sat-staff-danger,#d70015)]">{error}</p>
        ) : null}
      </div>
      {conflict ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-sat-policy-conflict="exam">
          <p className="text-sm text-[var(--sat-text-secondary)]">
            Your changes are still here. Reload the latest values, then save again.
          </p>
          <SatButton variant="quiet" onClick={() => void reload()} disabled={saveExam.isPending}>
            Reload latest
          </SatButton>
        </div>
      ) : null}
    </section>
  );
}
