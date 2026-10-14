import { AlertTriangle } from 'lucide-react';
import type { ExamSessionRuntime } from '../../../types/domain';
import { formatRunSheetClock, formatRunSheetDuration } from './sessionRunSheet';
import type { SatStatusTone } from './SatPage';

export type SatRoomMode = 'prestart' | 'live' | 'review';

export function getSatRoomMode(status: ExamSessionRuntime['status']): SatRoomMode {
  if (status === 'not_started') return 'prestart';
  if (status === 'completed' || status === 'cancelled') return 'review';
  return 'live';
}

export function runtimeLabel(status: string): string {
  if (status === 'not_started') return 'Not started';
  if (status === 'live') return 'Running';
  if (status === 'paused') return 'Paused';
  if (status === 'completed') return 'Finished';
  return 'Cancelled';
}

export function roomStatusTone(status: string): SatStatusTone {
  if (status === 'live') return 'live';
  if (status === 'paused') return 'paused';
  if (status === 'not_started') return 'info';
  if (status === 'completed') return 'finished';
  return 'cancelled';
}

/**
 * The room summary under the header: when the room runs, the student counts a
 * proctor scans for (inline figures, not metric cards), and whether the data
 * is live. Action-oriented counts turn amber and filter the roster.
 */
export function SatSessionContextBar({
  runtime,
  scheduledStartAt,
  joinedCount,
  activeCount,
  readyCount,
  attentionCount,
  openAlerts,
  isStale,
  lastUpdatedLabel,
  onNeedsAttention,
}: {
  runtime: ExamSessionRuntime;
  scheduledStartAt: string | null;
  joinedCount: number;
  activeCount: number;
  /** Before the start: students ready to begin, or null when the server did not report it. */
  readyCount?: number | null | undefined;
  attentionCount: number;
  openAlerts: number;
  isStale: boolean;
  lastUpdatedLabel: string;
  onNeedsAttention: () => void;
}) {
  const mode = getSatRoomMode(runtime.status);
  const startedAt = runtime.actualStartAt ? formatRunSheetClock(runtime.actualStartAt) : null;
  const finishedAt = runtime.actualEndAt ? formatRunSheetClock(runtime.actualEndAt) : null;
  const duration = formatRunSheetDuration(runtime.actualStartAt, runtime.actualEndAt);
  const timing = mode === 'prestart'
    ? `Scheduled ${formatRunSheetClock(scheduledStartAt)} ICT`
    : mode === 'review' && startedAt && finishedAt
      ? `${startedAt}–${finishedAt} ICT · ${duration ?? 'Duration unavailable'}`
      : mode === 'review'
        ? [startedAt ? `Started ${startedAt} ICT` : null, finishedAt ? `Finished ${finishedAt} ICT` : null, duration].filter(Boolean).join(' · ') || 'Room timing unavailable'
        : startedAt ? `Started ${startedAt} ICT` : 'Room started';
  const showReady = mode === 'prestart' && readyCount != null;

  return (
    <section
      className="sat-room__context flex min-h-12 shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] px-4 py-2 text-[14px] sm:px-5"
      aria-label="Room context"
      data-sat-room-context
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <p data-testid="sat-room-session-timing" className="font-semibold tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{timing}</p>
        {runtime.isOverrun ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--sat-staff-warning-text,#92400e)]">
            <AlertTriangle size={14} aria-hidden="true" />
            Overrun · review extensions before ending
          </span>
        ) : null}
      </div>
      <div role="group" aria-label="Student counts" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <SummaryStat value={joinedCount} label="Joined" />
        {showReady ? <SummaryStat value={readyCount} label="Ready" /> : <SummaryStat value={activeCount} label="Active" />}
        {attentionCount > 0 ? (
          <button
            type="button"
            aria-label={`Needs attention ${attentionCount}`}
            onClick={onNeedsAttention}
            className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] px-2 text-[var(--sat-staff-warning-text,#92400e)] transition-colors duration-150 hover:bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
          >
            <AlertTriangle size={14} aria-hidden="true" />
            <strong className="font-semibold tabular-nums">{attentionCount}</strong> Needs attention
          </button>
        ) : <SummaryStat value={0} label="Needs attention" />}
        <SummaryStat value={openAlerts} label={openAlerts === 1 ? 'Open alert' : 'Open alerts'} warning={openAlerts > 0} />
      </div>
      <div role="group" aria-label="Room health" className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
        <span className={`inline-flex items-center gap-1.5 font-medium ${isStale ? 'text-[var(--sat-staff-warning-text,#92400e)]' : 'text-[var(--sat-staff-success-text,#067647)]'}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isStale ? 'bg-[var(--sat-staff-warning-dot,#d97706)]' : 'bg-[var(--sat-staff-success-dot,#059669)]'}`} />
          {isStale ? 'Reconnecting' : 'Live data'}
        </span>
        <span className="tabular-nums">Updated {lastUpdatedLabel}</span>
      </div>
    </section>
  );
}

function SummaryStat({ value, label, warning = false }: { value: number; label: string; warning?: boolean }) {
  const tone = warning
    ? 'text-[var(--sat-staff-warning-text,#92400e)]'
    : 'text-[var(--sat-staff-text-secondary,#515154)]';
  const figure = warning
    ? 'text-[var(--sat-staff-warning-text,#92400e)]'
    : value === 0 ? 'text-[var(--sat-staff-text-tertiary,#6e6e73)]' : 'text-[var(--sat-staff-text-primary,#1d1d1f)]';
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${tone}`}>
      <strong className={`font-semibold tabular-nums ${figure}`}>{value}</strong> {label}
    </span>
  );
}
