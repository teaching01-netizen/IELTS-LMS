import { Play } from 'lucide-react';
import { SatButton } from './SatPage';

/**
 * Pre-start summary of one session: what will run, and how it starts. Opening
 * check-in and starting the exam are different events. A teacher-start room
 * starts here, beside the facts a proctor needs to decide it; a code-start room
 * has no room-wide start, so this says how each student's clock begins instead.
 * Joined and ready counts live in the room summary, not here.
 */
export function SatWaitingRoomPanel({
  versionLabel,
  sectionsLabel,
  startPending,
  startBlocked,
  onStart,
}: {
  /** Null when the viewer cannot read the session's version pin. */
  versionLabel: string | null;
  sectionsLabel: string;
  startPending: boolean;
  startBlocked: boolean;
  /** Teacher-start rooms only; code-start rooms have no room-wide start. */
  onStart?: (() => void) | undefined;
}) {
  return (
    <section aria-label="Waiting room" className="mt-4 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-4" data-sat-room-waiting>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-4 gap-y-3 text-[14px] leading-5">
        <Fact label="Version" value={versionLabel ?? 'Not shown'} />
        <Fact label="Sections" value={sectionsLabel} />
      </dl>
      {onStart ? (
        <>
          <SatButton
            variant="primary"
            block
            icon={<Play size={16} aria-hidden="true" />}
            pending={startPending}
            disabled={startBlocked}
            onClick={onStart}
            className="mt-4"
          >
            {startPending ? 'Starting…' : 'Review and start exam'}
          </SatButton>
          <p className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            Students who have joined are waiting. The exam begins only when you start it.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
          There is no room-wide start. Each student’s clock begins when they enter the exam start code.
        </p>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--sat-staff-text-tertiary,#6e6e73)]">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{value}</dd>
    </div>
  );
}
