import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { SatButton } from '../SatPage';

/**
 * The room's single title row: back to Rooms, the room name with its one
 * lifecycle status, what is being delivered, and the room-wide actions. Nothing
 * else on the page repeats the title or the status.
 */
export function SatRoomHeader({
  title,
  status,
  details,
  statusLine,
  actions,
  onBack,
}: {
  title: string;
  /** The room's lifecycle status pill. */
  status: ReactNode;
  /** Exam, version and scope. */
  details: string;
  /** Check-in and exam state, e.g. "Check-in open · Exam not started". */
  statusLine: string;
  actions: ReactNode;
  onBack: () => void;
}) {
  return (
    <header className="sat-room__header sticky top-0 z-40 shrink-0 border-b border-[var(--sat-staff-border-header,rgba(0,0,0,0.065))] bg-[var(--sat-staff-glass-room,#fff)]">
      <div className="flex min-h-[72px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
        <SatButton variant="quiet" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={onBack} className="-ml-1 shrink-0 px-2.5">Rooms</SatButton>
        <div className="min-w-[min(100%,16rem)] flex-[1_1_16rem]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="min-w-0 truncate text-[22px] font-semibold leading-7 tracking-[-0.02em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h1>
            {status}
          </div>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            <span className="min-w-0 break-words">{details}</span>
            <span aria-hidden="true">·</span>
            <span data-testid="sat-room-status-line" className="min-w-0 break-words">{statusLine}</span>
          </p>
        </div>
        <div className="sat-room__header-actions ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>
    </header>
  );
}
