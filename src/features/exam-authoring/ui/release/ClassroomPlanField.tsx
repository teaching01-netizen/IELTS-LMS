import { useClassroomPlan, useSetClassroomPlan } from "../../api/assessmentQueries";
import type { SatClassroomPlan, SatClassroomShape } from "../../contracts/assessment";
import { ModuleSetPicker } from "../create-exam/ModuleSetPicker";

/** Classroom plan for one section. Publishing then checks only modules students can receive. */
export function ClassroomPlanField({
  examId,
  sectionKey,
  sectionLabel,
  plan,
  loading,
  canEdit,
}: {
  examId: string;
  sectionKey: string;
  sectionLabel?: string;
  plan?: SatClassroomPlan | null;
  loading?: boolean;
  canEdit: boolean;
}) {
  const planQuery = useClassroomPlan(examId);
  const save = useSetClassroomPlan(examId);
  const currentPlan = plan !== undefined ? plan : planQuery.data?.plan ?? null;
  const value = currentPlan?.[sectionKey] ?? "full";
  const change = (shape: SatClassroomShape | "full") => {
    const next = { ...(currentPlan ?? {}) };
    if (shape === "full") delete next[sectionKey];
    else next[sectionKey] = shape;
    save.mutate(next);
  };

  return (
    <div className="rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-fill-faint)] p-4">
      <ModuleSetPicker
        sectionLabel={sectionLabel ?? sectionKey}
        value={value}
        disabled={!canEdit || (loading ?? !planQuery.isSuccess) || save.isPending}
        idPrefix={`classroom-plan-${sectionKey}`}
        onChange={change}
      />
      <p className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        Custom module sets use Classroom rooms only. Publishing requires the questions students can receive.
      </p>
      {save.isError ? <p role="alert" className="mt-2 text-[14px] text-[var(--sat-staff-danger,#b42318)]">The module plan could not be saved.</p> : null}
    </div>
  );
}
