import type { SatClassroomShape } from "../../contracts/assessment";
import { SHAPE_LABELS } from "../../contracts/satExamConfig";

const SHAPES: readonly (SatClassroomShape | "full")[] = [
  "full",
  "m1_easy",
  "m1_hard",
  "m2_easy",
  "m2_hard",
];

export function ModuleSetPicker({
  sectionLabel,
  value,
  disabled = false,
  idPrefix,
  onChange,
}: {
  sectionLabel: string;
  value: SatClassroomShape | "full";
  disabled?: boolean;
  idPrefix: string;
  onChange: (shape: SatClassroomShape | "full") => void;
}) {
  const groupId = `${idPrefix}-module-set`;
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
        Module set
      </legend>
      <div id={groupId} role="radiogroup" aria-label={`${sectionLabel} module set`} className="grid gap-2 sm:grid-cols-2">
        {SHAPES.map((shape) => {
          const id = `${groupId}-${shape}`;
          const checked = value === shape;
          return (
            <label
              key={shape}
              htmlFor={id}
              className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[14px] leading-5 transition-colors ${
                checked
                  ? "border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))]"
                  : "border-[var(--sat-staff-border-strong)] bg-white hover:bg-[var(--sat-staff-fill-faint)]"
              } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
            >
              <input
                id={id}
                type="radio"
                name={groupId}
                value={shape}
                aria-label={`${sectionLabel}: ${SHAPE_LABELS[shape]}`}
                checked={checked}
                onChange={() => onChange(shape)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--sat-staff-accent,#0071e3)]"
              />
              <span className="font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">{SHAPE_LABELS[shape]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
