import { useId } from "react";
import { Info } from "lucide-react";
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

export function SatSettingsScopeNote({ title, children, scope }: {
  title: string;
  children: string;
  scope?: "exam" | "room";
}) {
  return (
    <div data-sat-policy-scope={scope} className="flex gap-3 rounded-xl border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface-raised,#f7f7f8)] px-4 py-3">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--sat-staff-text-secondary,#515154)]" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{children}</p>
      </div>
    </div>
  );
}

function Switch({
  id,
  labelId,
  checked,
  disabled,
  describedBy,
  onChange,
}: {
  id: string;
  labelId: string;
  checked: boolean;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative -my-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sat-focus,#005fcc)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 rounded-full transition-colors duration-150 ${
          checked ? "bg-[var(--sat-accent,#003f87)]" : "bg-[var(--sat-staff-switch-off)]"
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-150 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

function SettingRow({
  id,
  label,
  help,
  badge,
  note,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  badge?: string | undefined;
  note?: string | undefined;
  checked: boolean;
  disabled?: boolean | undefined;
  onChange: (next: boolean) => void;
}) {
  const helpId = `${id}-help`;
  const labelId = `${id}-label`;
  return (
    <div className="px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            id={labelId}
            className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]"
          >
            {label}
          </span>
          {badge ? (
            <span className="rounded-full bg-[var(--sat-staff-surface-raised,#f2f2f4)] px-2 py-0.5 text-[11px] font-medium text-[var(--sat-staff-text-secondary,#515154)]">
              {badge}
            </span>
          ) : null}
        </div>
        <Switch id={id} labelId={labelId} checked={checked} disabled={disabled} describedBy={helpId} onChange={onChange} />
      </div>
      <p id={helpId} className="mt-1.5 max-w-[48ch] text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        {help}
      </p>
      {note ? (
        <p className="mt-1 text-[12px] leading-4 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{note}</p>
      ) : null}
    </div>
  );
}

function SettingsSection({
  id,
  title,
  children,
  headingLevel,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  headingLevel: "h3" | "h4";
}) {
  const Heading = headingLevel;
  return (
    <section
      className="overflow-hidden rounded-2xl border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface,#fff)]"
      aria-labelledby={id}
    >
      <Heading
        id={id}
        className="px-4 pt-3.5 text-[13px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]"
      >
        {title}
      </Heading>
      <div className="divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))]">{children}</div>
    </section>
  );
}

export function SatLearningSettings({
  value,
  onChange,
  disabled = false,
  idPrefix,
  examDefaults = false,
  heading = true,
}: {
  value: SatActivityPolicy;
  onChange: (next: SatActivityPolicy) => void;
  disabled?: boolean;
  idPrefix?: string;
  examDefaults?: boolean;
  /** The room dialog supplies its own title; the exam panel keeps this one. */
  heading?: boolean;
}) {
  const generated = useId();
  const prefix = idPrefix ?? `sat-learning-${generated}`;
  const error = satLearningSettingsError(value);
  const json = normalizeSatActivityPolicy(value);
  const policy = json.ok ? json.value : value;
  const sectionHeading = heading ? "h4" : "h3";
  const update = (patch: Partial<SatActivityPolicy>) =>
    onChange({ ...policy, study: { ...policy.study, enabled: false }, ...patch });

  return (
    <section className="grid gap-4" aria-label={heading ? "Results and retakes" : undefined}>
      {heading ? (
        <h3 className="text-[15px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
          Results and retakes
        </h3>
      ) : null}
      {examDefaults ? (
        <SatSettingsScopeNote scope="exam" title="Applies to this exam and its rooms">
          Scheduled, running, and paused rooms update now. Closed rooms keep their own settings, and new
          rooms use these defaults.
        </SatSettingsScopeNote>
      ) : null}

      <SettingsSection id={`${prefix}-results`} title="Student results" headingLevel={sectionHeading}>
        <SettingRow
          id={`${prefix}-report`}
          label="Show results"
          help="Students see their score and can download their exam PDF after submitting."
          checked={policy.reportVisible}
          disabled={disabled}
          onChange={(reportVisible) =>
            update({
              reportVisible,
              includeAnswerKeyInPdf: reportVisible ? policy.includeAnswerKeyInPdf : false,
            })
          }
        />
        <SettingRow
          id={`${prefix}-pdf-keys`}
          label="Include answer key in PDF"
          help={
            policy.reportVisible
              ? "Adds the correct answers to the student’s PDF after their first completed attempt."
              : "Turn on Show results to make the answer key available."
          }
          badge={policy.reportVisible ? undefined : "Requires Show results"}
          checked={policy.includeAnswerKeyInPdf}
          disabled={disabled || !policy.reportVisible}
          onChange={(includeAnswerKeyInPdf) => update({ includeAnswerKeyInPdf })}
        />
      </SettingsSection>

      <SettingsSection id={`${prefix}-retakes-section`} title="Retakes" headingLevel={sectionHeading}>
        <SettingRow
          id={`${prefix}-retakes`}
          label="Allow retakes"
          help="Students can start another attempt while the room is open."
          badge="Individual timers"
          note="Turning this on also turns on Show results."
          checked={policy.unlimitedRetakes === true}
          disabled={disabled}
          onChange={(unlimitedRetakes) =>
            update(unlimitedRetakes ? { unlimitedRetakes, reportVisible: true } : { unlimitedRetakes })
          }
        />
      </SettingsSection>

      <SettingsSection id={`${prefix}-timer`} title="Timer" headingLevel={sectionHeading}>
        <SettingRow
          id={`${prefix}-pause`}
          label="Allow students to pause and leave"
          help="Students can pause their clock and leave. Refreshing or losing connection keeps the clock running."
          badge="Individual timers"
          checked={policy.pauseOnLeave === true}
          disabled={disabled}
          onChange={(pauseOnLeave) => update({ pauseOnLeave })}
        />
      </SettingsSection>

      {error ? (
        <p role="alert" className="classroom-form-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
