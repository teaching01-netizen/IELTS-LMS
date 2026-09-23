import type { ExamSessionRuntime } from '../../../types/domain';
import { formatRunSheetClock, formatRunSheetDuration, formatRunSheetRemaining } from './sessionRunSheet';
import { SatStatusPill, type SatStatusTone } from './SatPage';

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

export function SatSessionSummary({
  runtime,
  joinedCount,
  activeCount,
  attentionCount,
  openAlerts,
  isStale,
  lastUpdatedLabel,
  sessionLive,
  stageRemainingSeconds,
  onNeedsAttention,
}: {
  runtime: ExamSessionRuntime;
  joinedCount: number;
  activeCount: number;
  attentionCount: number;
  openAlerts: number;
  isStale: boolean;
  lastUpdatedLabel: string;
  sessionLive: boolean;
  stageRemainingSeconds: number;
  onNeedsAttention: () => void;
}) {
  const startedAt = runtime.actualStartAt ? formatRunSheetClock(runtime.actualStartAt) : null;
  const finishedAt = runtime.actualEndAt ? formatRunSheetClock(runtime.actualEndAt) : null;
  const finishedDuration = formatRunSheetDuration(runtime.actualStartAt, runtime.actualEndAt);

  return (
    <>
      <section className="sat-inspector__section">
        <p className="sat-inspector__label sat-room__eyebrow">Session</p>
        <dl>
          <div className="sat-inspector__row">
            <dt>Status</dt>
            <dd>
              <SatStatusPill tone={roomStatusTone(runtime.status)} pulse={runtime.status === 'live'}>
                {runtimeLabel(runtime.status)}
              </SatStatusPill>
            </dd>
          </div>
          {startedAt ? <SummaryRow label="Started" value={`${startedAt} ICT`} /> : null}
          {finishedAt ? <SummaryRow label="Finished" value={`${finishedAt} ICT`} /> : null}
          {runtime.status === 'completed' ? (
            <SummaryRow label="Duration" value={finishedDuration ?? 'Unavailable'} />
          ) : null}
        </dl>
      </section>

      <section className="sat-inspector__section">
        <p className="sat-inspector__label sat-room__eyebrow">Students</p>
        <dl>
          <SummaryRow label="Joined" value={String(joinedCount)} />
          <SummaryRow label="Active" value={String(activeCount)} />
          <div className="sat-inspector__row">
            <dt>Needs attention</dt>
            <dd>
              {attentionCount > 0 ? (
                <button
                  type="button"
                  className="sat-inspector__action"
                  aria-label={`Needs attention ${attentionCount}`}
                  onClick={onNeedsAttention}
                >
                  {attentionCount}
                </button>
              ) : 0}
            </dd>
          </div>
        </dl>
      </section>

      <section className="sat-inspector__section">
        <p className="sat-inspector__label sat-room__eyebrow">Session health</p>
        <dl>
          <SummaryRow label="Warnings" value={String(openAlerts)} />
          <div className="sat-inspector__row">
            <dt>Connection</dt>
            <dd className={isStale ? 'sat-inspector__warning' : 'sat-inspector__healthy'}>
              {isStale ? 'Reconnecting' : 'Online'}
            </dd>
          </div>
          <SummaryRow label="Clock source" value="Server" />
          {sessionLive ? (
            <SummaryRow label="Stage clock" value={formatRunSheetRemaining(stageRemainingSeconds)} />
          ) : null}
          <SummaryRow label="Last updated" value={lastUpdatedLabel} />
        </dl>
        {runtime.isOverrun ? (
          <div className="sat-inspector__overrun">
            <span className="font-semibold">Running beyond the scheduled window.</span> Review time extensions before ending the session.
          </div>
        ) : null}
      </section>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sat-inspector__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
