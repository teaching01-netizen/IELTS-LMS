import type { Ref } from "react";

export function SatRoomSetupProgress({ current, total, label, description, headingRef }: { current: number; total: number; label: string; description: string; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <div className="border-b border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-fill-faint)] px-6 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-[15px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">{label}</h2>
        <span className="shrink-0 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Step {current} of {total}</span>
      </div>
      <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
      <div role="progressbar" aria-label="Room setup progress" aria-valuetext={`${label}, step ${current} of ${total}`} aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} className="mt-2.5 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {Array.from({ length: total }, (_, index) => <span key={index} aria-hidden="true" className={`h-1 rounded-full ${index < current ? "bg-[var(--sat-staff-accent,#0071e3)]" : "bg-[var(--sat-staff-border-strong,rgba(0,0,0,0.12))]"}`} />)}
      </div>
    </div>
  );
}
