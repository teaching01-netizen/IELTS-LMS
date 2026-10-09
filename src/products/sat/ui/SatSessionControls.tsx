import { BarChart3, Pause, Play, Timer } from 'lucide-react';
import { SatMenu, type SatMenuItem } from './Menu';

/**
 * Room-wide controls, grouped and labelled "Room controls" so they never read
 * as actions on the selected student. One primary per state: Resume exam while
 * paused, View responses once the room is finished (Start exam lives in the
 * waiting room beside the readiness it depends on). While running, Pause and
 * Add time stay secondary; End exam is a destructive entry point whose
 * confirmation states the room-wide consequence.
 */
export function SatSessionControls({
  runtimeStatus,
  pendingActions,
  blocked,
  onPause,
  onResume,
  onExtend,
  onComplete,
  onViewResponses,
}: {
  runtimeStatus: string;
  pendingActions: ReadonlySet<string>;
  blocked: boolean;
  onPause: () => void;
  onResume: () => void;
  onExtend: (minutes: number) => void;
  onComplete: () => void;
  /** Present once the room is finished or cancelled. */
  onViewResponses?: (() => void) | undefined;
}) {
  const active = runtimeStatus === 'live' || runtimeStatus === 'paused';
  const pauseBusy = pendingActions.has('pause');
  const resumeBusy = pendingActions.has('resume');
  const extendItems: SatMenuItem[] = [
    { id: 'extend-5', label: 'Add 5 minutes for the room', disabled: blocked || pendingActions.has('extend-5'), onSelect: () => onExtend(5) },
    { id: 'extend-10', label: 'Add 10 minutes for the room', disabled: blocked || pendingActions.has('extend-10'), onSelect: () => onExtend(10) },
  ];

  if (!active && !onViewResponses) return null;

  return (
    <div role="group" aria-label="Room controls" className="sat-room__controls flex shrink-0 flex-wrap items-center gap-2">
      {onViewResponses ? (
        <button type="button" onClick={onViewResponses} className="sat-btn sat-btn--primary sat-press">
          <BarChart3 size={16} aria-hidden="true" />
          View responses
        </button>
      ) : null}
      {runtimeStatus === 'paused' ? (
        <button
          type="button"
          onClick={() => { if (!resumeBusy) onResume(); }}
          disabled={blocked}
          aria-busy={resumeBusy || undefined}
          aria-disabled={resumeBusy || undefined}
          className="sat-btn sat-btn--primary sat-press"
        >
          {resumeBusy ? <span aria-hidden="true" className="sat-btn__spinner" /> : <Play size={16} aria-hidden="true" />}
          {resumeBusy ? 'Resuming…' : 'Resume exam'}
        </button>
      ) : null}
      {runtimeStatus === 'live' ? (
        <button
          type="button"
          onClick={() => { if (!pauseBusy) onPause(); }}
          disabled={blocked}
          aria-busy={pauseBusy || undefined}
          aria-disabled={pauseBusy || undefined}
          className="sat-btn sat-btn--secondary sat-press"
        >
          {pauseBusy ? <span aria-hidden="true" className="sat-btn__spinner" /> : <Pause size={16} aria-hidden="true" />}
          {pauseBusy ? 'Pausing…' : 'Pause exam'}
        </button>
      ) : null}
      {active ? (
        <>
          <SatMenu
            label="Add time"
            align="end"
            width={232}
            items={extendItems}
            triggerClassName="sat-btn sat-btn--secondary sat-press group"
            triggerContent={<><Timer size={16} aria-hidden="true" /><span>Add time</span></>}
          />
          <button type="button" onClick={onComplete} disabled={blocked} className="sat-btn sat-btn--danger-secondary sat-press">
            End exam
          </button>
        </>
      ) : null}
    </div>
  );
}
