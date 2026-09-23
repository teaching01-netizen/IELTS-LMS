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
  if (status === 'not_started') return 'Ready';
  if (status === 'live') return 'Live';
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

export function SatSessionContextBar({
  runtime,
  scheduledStartAt,
  joinedCount,
  activeCount,
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
        ? [startedAt ? `Started ${startedAt} ICT` : null, finishedAt ? `Finished ${finishedAt} ICT` : null, duration].filter(Boolean).join(' · ') || 'Session timing unavailable'
        : startedAt ? `Started ${startedAt} ICT` : 'Session started';

  return (
    <section className="sat-room__context" aria-label="Session context" data-sat-room-context>
      <div className="sat-room__context-timing">
        <p data-testid="sat-room-session-timing">{timing}</p>
        {runtime.isOverrun ? <span className="sat-room__context-overrun">Overrun · review extensions before ending</span> : null}
      </div>
      <div className="sat-room__context-counts" aria-label="Student counts">
        <span>{joinedCount} joined</span>
        <span>{activeCount} active</span>
        {attentionCount > 0 ? (
          <button type="button" aria-label={`Needs attention ${attentionCount}`} onClick={onNeedsAttention}>
            {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
          </button>
        ) : <span>0 need attention</span>}
        <span>{openAlerts} open alert{openAlerts === 1 ? '' : 's'}</span>
      </div>
      <div className="sat-room__context-health" aria-label="Session health">
        <span className={isStale ? 'is-stale' : ''}>{isStale ? 'Reconnecting' : 'Online'}</span>
        <span>Server clock</span>
        <span>Updated {lastUpdatedLabel}</span>
      </div>
    </section>
  );
}
