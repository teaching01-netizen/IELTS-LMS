import { useClassroomPlan, useSetClassroomPlan } from "../../api/assessmentQueries";
import type { SatClassroomShape } from "../../contracts/assessment";

const SHAPE_LABELS: Record<SatClassroomShape | "", string> = {
  "": "Full adaptive (Module 1, then Easy or Hard)",
  m1_easy: "Module 1 + Easy Module 2 only",
  m1_hard: "Module 1 + Hard Module 2 only",
  m2_easy: "Easy Module 2 only",
  m2_hard: "Hard Module 2 only",
};

/**
 * Classroom module plan for one section. Saves on change (the plan is one small
 * JSON document), and publish validation then requires only the modules
 * students can receive. Standard practice sessions ignore it.
 */
export function ClassroomPlanField({ examId, sectionKey, canEdit }: { examId: string; sectionKey: string; canEdit: boolean }) {
  const query = useClassroomPlan(examId);
  const save = useSetClassroomPlan(examId);
  const plan = query.data?.plan ?? {};
  const value = plan[sectionKey] ?? "";
  const change = (next: string) => {
    const { [sectionKey]: _removed, ...rest } = plan;
    save.mutate(next ? { ...rest, [sectionKey]: next as SatClassroomShape } : rest);
  };
  const selectId = `classroom-plan-${sectionKey}`;
  return (
    <div className="mt-4 rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-fill-faint)] p-4">
      <label htmlFor={selectId} className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">
        Classroom modules
      </label>
      <select
        id={selectId}
        value={value}
        disabled={!canEdit || !query.isSuccess || save.isPending}
        onChange={(event) => change(event.target.value)}
        className="mt-2 block min-h-11 w-full rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-strong)] bg-white px-3 text-[14px]"
      >
        {(Object.keys(SHAPE_LABELS) as (SatClassroomShape | "")[]).map((key) => (
          <option key={key} value={key}>{SHAPE_LABELS[key]}</option>
        ))}
      </select>
      <p className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        Only SAT Classroom sessions use this. Publishing requires just the modules students can receive.
      </p>
      {save.isError ? <p role="alert" className="mt-2 text-[14px] text-[var(--sat-staff-danger,#b42318)]">The module plan could not be saved.</p> : null}
    </div>
  );
}
