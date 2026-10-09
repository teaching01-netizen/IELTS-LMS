import { Play } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Pre-start summary of one session: what will run, who is here, and the one
 * consequential action. Opening check-in and starting the exam are different
 * events; this panel is where the second one happens, next to the facts a
 * proctor needs to decide it (version, sections, joined and ready counts).
 */
export function SatWaitingRoomPanel({
  versionLabel,
  sectionsLabel,
  joinedCount,
  readyCount,
  startPending,
  startBlocked,
  onStart,
  children,
}: {
  /** Null when the viewer cannot read the session's version pin. */
  versionLabel: string | null;
  sectionsLabel: string;
  joinedCount: number;
  /** Null when the server did not report readiness. */
  readyCount: number | null;
  startPending: boolean;
  startBlocked: boolean;
  onStart: () => void;
  /** Student link + QR. */
  children?: ReactNode;
}) {
  return (
    <section aria-label="Waiting room" className="mt-5 rounded-[18px] bg-[var(--sat-staff-surface,#fff)] p-4 ring-1 ring-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))]" data-sat-room-waiting>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">Waiting room</h2>
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={startPending || startBlocked}
          aria-busy={startPending || undefined}
          className="flex min-h-11 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-accent,#0071e3)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--sat-staff-accent-hover,#0077ed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] disabled:opacity-50"
        >
          {startPending ? (
            <span aria-hidden="true" className="sat-spinner block h-3 w-3 shrink-0 rounded-full border-2 border-white/40 border-t-white" />
          ) : <Play size={14} aria-hidden="true" />}
          {startPending ? 'Starting…' : 'Review and start exam'}
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[14px] sm:grid-cols-4">
        <Fact label="Version" value={versionLabel ?? 'Not shown'} />
        <Fact label="Sections" value={sectionsLabel} />
        <Fact label="Joined" value={String(joinedCount)} />
        <Fact label="Ready" value={readyCount === null ? 'Not reported' : String(readyCount)} />
      </dl>
      <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
        Students who have joined are waiting. The exam begins only when you start it.
      </p>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--sat-staff-text-tertiary,#6e6e73)]">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{value}</dd>
    </div>
  );
}
