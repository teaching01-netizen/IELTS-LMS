import {
  SAT_CONFIG_SECTION_KEYS,
  SAT_CONFIG_SECTION_LABELS,
  type SatConfigFieldErrors,
  type SatConfigLimits,
  type SatConfigSectionKey,
  type SatExamConfig,
  type SatSectionConfig,
} from "../../contracts/satExamConfig";

interface FieldDef {
  key: keyof SatSectionConfig;
  label: string;
  suffix: string;
  group: "timing" | "routing";
}

const FIELDS: readonly FieldDef[] = [
  { key: "module1Minutes", label: "Module 1", suffix: "min", group: "timing" },
  { key: "module2LowerMinutes", label: "Module 2 · lower", suffix: "min", group: "timing" },
  { key: "module2HigherMinutes", label: "Module 2 · higher", suffix: "min", group: "timing" },
  { key: "breakAfterMinutes", label: "Break after section", suffix: "min", group: "timing" },
  { key: "minimumCorrectForHigher", label: "Correct answers for the higher Module 2", suffix: "correct", group: "routing" },
];

/**
 * Exam-level configuration fields (timing, break, adaptive threshold, results).
 * Controlled and persistence-free: Create exam submits the whole object once.
 */
export function SatExamConfigFields({
  value,
  limits,
  errors,
  disabled,
  idPrefix,
  onChange,
}: {
  value: SatExamConfig;
  limits: SatConfigLimits;
  errors: SatConfigFieldErrors;
  disabled?: boolean;
  idPrefix: string;
  onChange: (next: SatExamConfig) => void;
}) {
  const setField = (section: SatConfigSectionKey, key: keyof SatSectionConfig, raw: string) => {
    // An empty box is NaN so validation reports "required" instead of coercing it to 0.
    const parsed = raw.trim() === "" ? Number.NaN : Number(raw);
    onChange({ ...value, sections: { ...value.sections, [section]: { ...value.sections[section], [key]: parsed } } });
  };

  return (
    <div className="space-y-5">
      {SAT_CONFIG_SECTION_KEYS.map((section) => (
        <fieldset key={section} className="space-y-3" disabled={disabled}>
          <legend className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{SAT_CONFIG_SECTION_LABELS[section]}</legend>
          {(["timing", "routing"] as const).map((group) => (
            <div key={group} className="grid grid-cols-2 gap-3">
              {FIELDS.filter((field) => field.group === group).map((field) => {
                const id = `${idPrefix}-${section}-${field.key}`;
                const error = errors[`${section}.${field.key}`];
                const current = value.sections[section][field.key];
                const hint =
                  field.key === "minimumCorrectForHigher" ? `1 to ${limits.operationalQuestions[section]}` : undefined;
                return (
                  <div key={field.key} className={group === "routing" ? "col-span-2" : undefined}>
                    <label htmlFor={id} className="block text-[14px] font-medium leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                      {field.label}
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        id={id}
                        type="number"
                        inputMode="numeric"
                        min={0}
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
          ))}
        </fieldset>
      ))}
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">
        <input
          type="checkbox"
          checked={value.showClassroomScoreReport}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, showClassroomScoreReport: event.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]"
        />
        <span>
          <span className="block font-semibold">Show the score report when a Classroom sitting ends</span>
          <span className="block text-[var(--sat-staff-text-secondary,#515154)]">Standard practice never shows a report. You can change this later in Settings.</span>
        </span>
      </label>
    </div>
  );
}
