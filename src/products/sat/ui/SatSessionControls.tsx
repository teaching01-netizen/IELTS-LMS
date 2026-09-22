import { MoreHorizontal, Pause, Play } from 'lucide-react';
import { SatMenu, type SatMenuItem } from './Menu';

export function SatSessionControls({
  runtimeStatus,
  pendingActions,
  blocked,
  onStart,
  onPause,
  onResume,
  onExtend,
  onComplete,
}: {
  runtimeStatus: string;
  pendingActions: ReadonlySet<string>;
  blocked: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onExtend: (minutes: number) => void;
  onComplete: () => void;
}) {
  const primary = runtimeStatus === 'not_started'
    ? { label: 'Start', icon: Play, key: 'start', action: onStart }
    : runtimeStatus === 'live'
      ? { label: 'Pause', icon: Pause, key: 'pause', action: onPause }
      : runtimeStatus === 'paused'
        ? { label: 'Resume', icon: Play, key: 'resume', action: onResume }
        : null;
  const Icon = primary?.icon;
  const primaryBusy = primary ? pendingActions.has(primary.key) : false;
  const active = runtimeStatus === 'live' || runtimeStatus === 'paused';
  const sessionItems: SatMenuItem[] = [
    { id: 'extend-5', label: 'Add 5 minutes', disabled: pendingActions.has('extend-5'), onSelect: () => onExtend(5) },
    { id: 'extend-10', label: 'Add 10 minutes', disabled: pendingActions.has('extend-10'), onSelect: () => onExtend(10) },
    { id: 'finish', label: 'Finish session…', destructive: true, separatorBefore: true, onSelect: onComplete },
  ];

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {primary && Icon ? (
        <button
          type="button"
          onClick={primary.action}
          disabled={primaryBusy || blocked}
          aria-busy={primaryBusy || undefined}
          className="flex min-h-10 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-accent,#0071e3)] px-3 text-[12px] font-semibold text-white shadow-[var(--sat-staff-accent-glow-sm,0_1px_2px_rgba(0,113,227,0.35))] transition-colors hover:bg-[var(--sat-staff-accent-hover,#0077ed)] hover:shadow-[var(--sat-staff-accent-glow-md,0_4px_14px_rgba(0,113,227,0.35))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {primaryBusy ? (
            <span aria-hidden="true" className="sat-spinner block h-3 w-3 shrink-0 rounded-full border-2 border-white/40 border-t-white" />
          ) : <Icon size={13} />}
          {primaryBusy ? 'Working…' : primary.label}
        </button>
      ) : null}
      {active ? (
        <SatMenu
          label="Session actions"
          compact
          align="end"
          width={176}
          icon={MoreHorizontal}
          items={sessionItems.map((item) => ({ ...item, disabled: blocked || Boolean(item.disabled) }))}
        />
      ) : null}
    </div>
  );
}
