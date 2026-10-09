import { ChevronDown } from "lucide-react";
import { releaseSurfaceClass } from "./releaseUi";

export function RuntimePolicyPanel() {
  return (
    <details className={`${releaseSurfaceClass} group p-5 sm:p-6`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-[var(--sat-staff-radius-control,10px)]">
        <div>
          <p className="text-[14px] font-semibold uppercase leading-5 tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            Delivery policy
          </p>
          <p className="mt-1 text-[18px] font-semibold leading-6 tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
            Exam-day behavior
          </p>
          <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Read-only. Set by the runtime for every room.</p>
        </div>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)] transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <p className="mt-3 max-w-2xl text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        These policies are runtime-authoritative and intentionally read-only here until every
        setting has a typed update contract and exam-day regression coverage.
      </p>
      <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-[var(--sat-staff-border-hairline)] pt-5 sm:grid-cols-2">
        <PolicyRow label="Start" value="Proctor controlled" />
        <PolicyRow label="Module transition" value="Automatic with proctor control" />
        <PolicyRow label="Time extension" value="+5 / +10 minutes" />
        <PolicyRow label="Auto submit" value="Enabled" />
        <PolicyRow label="Pause" value="Allowed by runtime policy" />
        <PolicyRow label="Offline protection" value="Buffered + device continuity" />
      </dl>
    </details>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">{value}</dd>
    </div>
  );
}
