import {
  SAT_CONFIG_SECTION_KEYS,
  SAT_CONFIG_SECTION_LABELS,
  SHAPE_MODULE_ROLES,
  satSectionPath,
  type SatConfigFieldErrors,
  type SatConfigLimits,
  type SatConfigSectionKey,
  type SatExamConfig,
  type SatSectionConfig,
} from "../../contracts/satExamConfig";
import type { SatClassroomShape } from "../../contracts/assessment";
import { ModuleSetPicker } from "./ModuleSetPicker";

interface FieldDef {
  key: keyof SatSectionConfig;
  label: string;
  suffix: string;
  role: "module1" | "lower" | "higher" | "break" | "routing";
}

const FIELDS: readonly FieldDef[] = [
  { key: "module1Minutes", label: "Module 1", suffix: "min", role: "module1" },
  { key: "module2LowerMinutes", label: "Easy Module 2", suffix: "min", role: "lower" },
  { key: "module2HigherMinutes", label: "Hard Module 2", suffix: "min", role: "higher" },
  { key: "breakAfterMinutes", label: "Break after section", suffix: "min", role: "break" },
  { key: "minimumCorrectForHigher", label: "Harder Module 2 at", suffix: "correct", role: "routing" },
];

/** Controlled timing fields for create; hidden values are reset when a shape changes. */
export function SatExamConfigFields({
  value,
  defaults,
  limits,
  errors,
  disabled,
  idPrefix,
  customModules,
  onChange,
}: {
  value: SatExamConfig;
  defaults: SatExamConfig;
  limits: SatConfigLimits;
  errors: SatConfigFieldErrors;
  disabled?: boolean;
  idPrefix: string;
  customModules: boolean;
  onChange: (next: SatExamConfig) => void;
}) {
  const setField = (section: SatConfigSectionKey, key: keyof SatSectionConfig, raw: string) => {
    // An empty box is NaN so validation reports "required" instead of coercing it to 0.
    const parsed = raw.trim() === "" ? Number.NaN : Number(raw);
    onChange({ ...value, sections: { ...value.sections, [section]: { ...value.sections[section], [key]: parsed } } });
  };

  const setShape = (section: SatConfigSectionKey, shape: SatClassroomShape | "full") => {
    const classroomPlan = { ...(value.classroomPlan ?? {}) };
    if (shape === "full") delete classroomPlan[section];
    else classroomPlan[section] = shape;

    const timing = { ...value.sections[section] };
    const roles = SHAPE_MODULE_ROLES[shape];
    if (!roles.includes("module1")) timing.module1Minutes = defaults.sections[section].module1Minutes;
    if (!roles.includes("lower")) timing.module2LowerMinutes = defaults.sections[section].module2LowerMinutes;
    if (!roles.includes("higher")) timing.module2HigherMinutes = defaults.sections[section].module2HigherMinutes;
    if (shape !== "full") timing.minimumCorrectForHigher = defaults.sections[section].minimumCorrectForHigher;

    // Drop the previous plan so an all-full selection doesn't keep the stale one.
    const { classroomPlan: _previousPlan, ...rest } = value;
    onChange({
      ...rest,
      sections: { ...value.sections, [section]: timing },
      ...(Object.keys(classroomPlan).length ? { classroomPlan } : {}),
    });
  };

  return (
    <div className="space-y-6">
      {SAT_CONFIG_SECTION_KEYS.map((section) => {
        const shape = customModules ? value.classroomPlan?.[section] ?? "full" : "full";
        const roles = SHAPE_MODULE_ROLES[shape];
        const visibleFields = FIELDS.filter((field) => {
          if (field.role === "break") return true;
          if (field.role === "routing") return shape === "full";
          return roles.includes(field.role);
        });
        const routingHint = limits.operationalQuestions[section];
        return (
          <fieldset key={section} className="space-y-4" disabled={disabled}>
            <legend className="text-[15px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
              {SAT_CONFIG_SECTION_LABELS[section]}
            </legend>
            {customModules ? (
              <ModuleSetPicker
                sectionLabel={SAT_CONFIG_SECTION_LABELS[section]}
                value={shape}
                disabled={disabled ?? false}
                idPrefix={`${idPrefix}-${section}`}
                onChange={(next) => setShape(section, next)}
              />
            ) : null}
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              {visibleFields.map((field) => {
                const id = `${idPrefix}-${section}-${field.key}`;
                const error = errors[`${section}.${field.key}`];
                const current = value.sections[section][field.key];
                const hint = field.role === "routing" ? `1 to ${routingHint}` : undefined;
                return (
                  <div key={field.key} className={field.role === "routing" ? "col-span-2" : undefined}>
                    <span id={`${id}-label`} className="block text-[14px] font-medium leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                      {field.label}
                    </span>
                    {field.role === "routing" ? (
                      <p className="mt-0.5 text-[13px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                        Students with at least this many correct in Module 1 get the harder Module 2.
                      </p>
                    ) : null}
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        id={id}
                        type="number"
                        inputMode="numeric"
                        aria-labelledby={`${id}-label`}
                        min={field.role === "break" ? 0 : 1}
                        value={Number.isNaN(current) ? "" : current}
                        onChange={(event) => setField(section, field.key, event.target.value)}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${id}-error` : undefined}
                        className="sat-input w-24"
                      />
                      <span className="text-[14px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{field.suffix}{hint ? ` · ${hint}` : ""}</span>
                    </div>
                    {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{error}</p> : null}
                  </div>
                );
              })}
            </div>
            <p className="rounded-xl bg-[var(--sat-staff-fill-faint)] px-3 py-2.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              <span className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Students sit:</span> {satSectionPath(shape, value.sections[section])}
            </p>
          </fieldset>
        );
      })}
    </div>
  );
}
