import { QrCode } from 'lucide-react';
import { SatButton } from '../SatPage';
import { SatStudentLinkCard } from '../SatStudentLink';
import { SatRoomSectionHeader } from './SatRoomSectionHeader';
import { SatRoomSurface } from './SatRoomSurface';

/**
 * How students get into this room, in one quiet card: the room link and QR,
 * what students enter at check-in, and how their exam starts. A code-start
 * room's shared start code is its own card (SatStartCodePanel).
 */
export function SatRoomEntryPanel({
  entryUrl,
  cohortName,
  status,
  identificationInstructions,
  startInstructions,
  onRetry,
  onOpenShare,
  onPresent,
}: {
  /** Null until the room's own link is confirmed. */
  entryUrl: string | null;
  cohortName: string;
  status: 'ready' | 'loading' | 'error' | 'unavailable';
  identificationInstructions: string;
  startInstructions: string;
  onRetry: () => void;
  onOpenShare: () => void;
  onPresent: () => void;
}) {
  return (
    <SatRoomSurface aria-label="Student joining" className="p-4" data-sat-room-entry>
      <SatRoomSectionHeader
        title="Join room"
        description="Students scan the QR or open the link, then check in."
        action={entryUrl ? <SatButton variant="quiet" icon={<QrCode size={16} aria-hidden="true" />} onClick={onOpenShare} className="-mr-1 px-2.5">Share with students</SatButton> : null}
      />
      {entryUrl ? (
        <>
          <SatStudentLinkCard url={entryUrl} cohortName={cohortName} onOpenShare={onOpenShare} onPresent={onPresent} />
          <dl className="mt-4 space-y-3 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-4 text-[14px] leading-5">
            <div>
              <dt className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Check-in</dt>
              <dd className="mt-0.5 text-[var(--sat-staff-text-secondary,#515154)]">{identificationInstructions}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Starting the exam</dt>
              <dd className="mt-0.5 text-[var(--sat-staff-text-secondary,#515154)]">{startInstructions}</dd>
            </div>
          </dl>
        </>
      ) : status === 'loading' ? (
        <p role="status" className="mt-3 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">Loading student joining details…</p>
      ) : status === 'error' ? (
        <div role="alert" className="mt-3 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] p-3 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
          <p>Student joining details could not load. Sharing is paused until the room's correct link is confirmed.</p>
          <SatButton variant="secondary" onClick={onRetry} className="mt-2 px-3">Retry</SatButton>
        </div>
      ) : (
        <p role="status" className="mt-3 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">Student joining details are unavailable for this account.</p>
      )}
    </SatRoomSurface>
  );
}
