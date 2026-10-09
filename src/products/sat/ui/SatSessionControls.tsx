import { Pause, Play, Timer } from 'lucide-react';
import { SatMenu, type SatMenuItem } from './Menu';

export function SatSessionControls({
  runtimeStatus,
  pendingActions,
  blocked,
  onPause,
  onResume,
  onExtend,
  onComplete,
}: {
  runtimeStatus: string;
  pendingActions: ReadonlySet<string>;
  blocked: boolean;
  onPause: () => void;
  onResume: () => void;
  onExtend: (minutes: number) => void;
  onComplete: () => void;
}) {
  // Starting the exam is not a header control: it lives in the waiting room next
  // to the readiness facts it depends on. Once started, the header runs the session.
  const primary = runtimeStatus === 'live'
    ? { label: 'Pause exam', icon: Pause, key: 'pause', action: onPause }
    : runtimeStatus === 'paused'
      ? { label: 'Resume exam', icon: Play, key: 'resume', action: onResume }
      : null;
  const Icon = primary?.icon;
  const primaryBusy = primary ? pendingActions.has(primary.key) : false;
  const active = runtimeStatus === 'live' || runtimeStatus === 'paused';
  const extendItems: SatMenuItem[] = [
    { id: 'extend-5', label: 'Add 5 minutes', disabled: blocked || pendingActions.has('extend-5'), onSelect: () => onExtend(5) },
    { id: 'extend-10', label: 'Add 10 minutes', disabled: blocked || pendingActions.has('extend-10'), onSelect: () => onExtend(10) },
  ];

  return (
    <div role="group" aria-label="Cohort controls" className="flex shrink-0 items-center gap-1.5">
      {primary && Icon ? (
        <button
          type="button"
          onClick={primary.action}
          disabled={primaryBusy || blocked}
          aria-busy={primaryBusy || undefined}
          className="flex min-h-11 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-accent,#0071e3)] px-3 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--sat-staff-accent-hover,#0077ed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent,#0071e3)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {primaryBusy ? (
            <span aria-hidden="true" className="sat-spinner block h-3 w-3 shrink-0 rounded-full border-2 border-white/40 border-t-white" />
          ) : <Icon size={13} />}
          {primaryBusy ? 'Working…' : primary.label}
        </button>
      ) : null}
      {active ? (
        <>
          <SatMenu label="Add time" align="end" width={176} icon={Timer} items={extendItems} />
          <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-[var(--sat-staff-separator-strong,#c7c7cc)]" />
          <button
            type="button"
            onClick={onComplete}
            disabled={blocked}
            className="flex min-h-11 items-center rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-danger,#b42318)]/30 px-3 text-[14px] font-semibold text-[var(--sat-staff-danger,#b42318)] transition-colors hover:bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-danger,#b42318)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            End room
          </button>
        </>
      ) : null}
    </div>
  );
}
