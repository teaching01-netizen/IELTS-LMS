import { useId } from "react";
import {
  SAT_ACTIVITY_POLICY_DEFAULTS,
  normalizeSatActivityPolicy,
  type SatActivityPolicy,
} from "../../../shared/sat/learningPolicy";

export function defaultSatClassroomLearningPolicy(reportVisible = false): SatActivityPolicy {
  return { ...SAT_ACTIVITY_POLICY_DEFAULTS, reportVisible, unlimitedRetakes: true };
}

/**
 * Returns the first blocking problem in a teacher policy. The server repeats
 * this validation; the local copy only keeps an obviously invalid form from
 * being submitted.
 */
export function satLearningSettingsError(policy: SatActivityPolicy): string | null {
  const normalized = normalizeSatActivityPolicy(policy);
  if (!normalized.ok) return normalized.message;
  return null;
}

function Toggle({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="classroom-exam-setting flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--sat-staff-border-hairline,#ddd)] p-3">
      <label htmlFor={id} className="flex w-full cursor-pointer items-center justify-between gap-2">
        <span id={`${id}-label`} className="classroom-exam-setting__title text-sm font-semibold">{label}</span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-labelledby={`${id}-label`}
          aria-describedby={help ? `${id}-help` : undefined}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="h-5 w-5 shrink-0 accent-current"
        />
      </label>
      {help ? (
        <p id={`${id}-help`} className="classroom-exam-setting__help basis-full text-sm">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function SatLearningSettings({
  value,
  onChange,
  disabled = false,
  idPrefix,
  examDefaults = false,
}: {
  value: SatActivityPolicy;
  onChange: (next: SatActivityPolicy) => void;
  disabled?: boolean;
  idPrefix?: string;
  examDefaults?: boolean;
}) {
  const generated = useId();
  const prefix = idPrefix ?? `sat-learning-${generated}`;
  const error = satLearningSettingsError(value);
  const json = normalizeSatActivityPolicy(value);
  const policy = json.ok ? json.value : value;
  const update = (patch: Partial<SatActivityPolicy>) =>
    onChange({ ...policy, study: { ...policy.study, enabled: false }, ...patch });

  return (
    <section className="classroom-exam-learning grid gap-3" aria-labelledby={`${prefix}-title`}>
      <h3 id={`${prefix}-title`} className="classroom-exam-setting__title">
        Results and retakes
      </h3>
      {examDefaults ? (
        <p className="classroom-exam-setting__help">New rooms and assignments use these settings. You can change them for each room or assignment.</p>
      ) : null}
      <Toggle
        id={`${prefix}-retakes`}
        label="Allow retakes"
        help="Students can take the exam again as many times as they want while it’s open. This requires individual timers. Turning this on also turns on Show results, which you can switch off separately."
        checked={policy.unlimitedRetakes === true}
        disabled={disabled}
        onChange={(unlimitedRetakes) =>
          update(unlimitedRetakes ? { unlimitedRetakes, reportVisible: true } : { unlimitedRetakes })
        }
      />
      <Toggle
        id={`${prefix}-report`}
        label="Show results"
        help="Students can see their score and download their exam PDF after submitting. Use Allow retakes to let them start again."
        checked={policy.reportVisible}
        disabled={disabled}
        onChange={(reportVisible) =>
          update({
            reportVisible,
            includeAnswerKeyInPdf: reportVisible ? policy.includeAnswerKeyInPdf : false,
          })
        }
      />
      <Toggle
        id={`${prefix}-pdf-keys`}
        label="Include answer key in PDF"
        help={
          policy.reportVisible
            ? "The PDF includes correct answers starting with the first completed exam."
            : "Turn on Show results to let students download the answer key."
        }
        checked={policy.includeAnswerKeyInPdf}
        disabled={disabled || !policy.reportVisible}
        onChange={(includeAnswerKeyInPdf) => update({ includeAnswerKeyInPdf })}
      />
      <fieldset className="mt-2 grid gap-3">
        <legend className="classroom-exam-setting__title mb-2">Timer</legend>
        <Toggle
          id={`${prefix}-pause`}
          label="Allow students to pause and leave"
          help="In rooms with individual timers, Pause and leave freezes the student’s timer. Closing the tab, refreshing, or losing connection keeps time running."
          checked={policy.pauseOnLeave === true}
          disabled={disabled}
          onChange={(pauseOnLeave) => update({ pauseOnLeave })}
        />
      </fieldset>
      {error ? (
        <p role="alert" className="classroom-form-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
