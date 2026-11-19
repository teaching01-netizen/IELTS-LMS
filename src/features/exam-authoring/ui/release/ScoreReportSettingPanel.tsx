import { useState } from "react";
import type { ExamEntity } from "../../../../types/domain";
import type { SatActivityPolicy } from "../../../../shared/sat/learningPolicy";
import { SatButton } from "../../../../products/sat/ui/SatPage";
import { SatLearningSettings, defaultSatClassroomLearningPolicy, satLearningSettingsError } from "../../../../products/sat/classrooms/SatLearningSettings";
import { useSaveExamMutation } from "../../api/examQueries";
import { releaseSurfaceClass } from "./releaseUi";

export function ScoreReportSettingPanel({ exam, onSaved }: {
  exam: ExamEntity;
  onSaved: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SatActivityPolicy | null>(null);
  const saveExam = useSaveExamMutation();
  const policy = draft ?? exam.satLearningDefaults ?? defaultSatClassroomLearningPolicy(exam.satScoreReportEnabled);
  const save = async () => {
    setError(null);
    try {
      await saveExam.mutateAsync({ ...exam, satLearningDefaults: policy });
      await onSaved();
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The settings could not be saved. Try again.");
    }
  };

  return (
    <section className={`${releaseSurfaceClass} p-5 sm:p-6`}>
      <SatLearningSettings
        examDefaults
        value={policy}
        onChange={setDraft}
        disabled={saveExam.isPending || !exam.canEdit}
      />
      {draft ? (
        <SatButton className="mt-4" disabled={saveExam.isPending || !exam.canEdit || Boolean(satLearningSettingsError(draft))} onClick={() => void save()}>
          {saveExam.isPending ? "Saving…" : "Save settings"}
        </SatButton>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--sat-staff-danger,#d70015)]">{error}</p>
      ) : null}
    </section>
  );
}
