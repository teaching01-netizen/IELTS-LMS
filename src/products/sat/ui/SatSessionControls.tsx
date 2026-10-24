import { BarChart3, MoreHorizontal, Pause, Play, Square, Timer } from 'lucide-react';
import { SatMenu, type SatMenuItem } from './Menu';

/**
 * Room-wide controls, grouped and labelled "Room controls" so they never read
 * as actions on the selected student. One primary per state: Resume exam while
 * paused, View responses once the room is finished (Start exam lives in the
 * waiting room beside the readiness it depends on). Less frequent time and
 * end controls live under More.
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
  evaOpen = false,
}: {
  runtimeStatus: string;
  pendingActions: ReadonlySet<string>;
  blocked: boolean;
  onPause: () => void;
  onResume: () => void;
  onExtend: (minutes: number) => void;
  onComplete: (trigger: HTMLElement | null) => void;
  /** Present once the room is finished or cancelled. */
  onViewResponses?: (() => void) | undefined;
  /** Eva SIM is still open: End exam stays available on a completed room. */
  evaOpen?: boolean | undefined;
}) {
  const active = runtimeStatus === 'live' || runtimeStatus === 'paused';
  const pauseBusy = pendingActions.has('pause');
  const resumeBusy = pendingActions.has('resume');
  const moreItems: SatMenuItem[] = [
    { id: 'extend-5', label: 'Add 5 minutes for the room', icon: Timer, disabled: blocked || pendingActions.has('extend-5'), onSelect: () => onExtend(5) },
    { id: 'extend-10', label: 'Add 10 minutes for the room', icon: Timer, disabled: blocked || pendingActions.has('extend-10'), onSelect: () => onExtend(10) },
    { id: 'end-exam', label: 'End exam', destructive: true, separatorBefore: true, disabled: blocked, onSelect: onComplete },
  ];

  // A completed room never regains Pause or Extend; only explicit closure.
  const endOnly = runtimeStatus === 'completed' && evaOpen;
  const endBusy = pendingActions.has('complete');

  if (!active && !onViewResponses && !endOnly) return null;

  return (
    <div role="group" aria-label="Room controls" className="sat-room__controls flex shrink-0 flex-wrap items-center gap-2">
      {onViewResponses ? (
        <button type="button" onClick={onViewResponses} className="sat-btn sat-btn--primary sat-press">
          <BarChart3 size={16} aria-hidden="true" />
          View responses
        </button>
      ) : null}
      {endOnly ? (
        <button
          type="button"
          onClick={(event) => { if (!endBusy) onComplete(event.currentTarget); }}
          disabled={blocked}
          aria-busy={endBusy || undefined}
          aria-disabled={endBusy || undefined}
          className="sat-btn sat-btn--danger-secondary sat-press"
        >
          {endBusy ? <span aria-hidden="true" className="sat-btn__spinner" /> : <Square size={16} aria-hidden="true" />}
          {endBusy ? 'Ending…' : 'End exam'}
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
        <SatMenu
          label="More"
          align="end"
          width={232}
          items={moreItems}
          triggerClassName="sat-btn sat-btn--quiet sat-press group"
          triggerContent={<><MoreHorizontal size={16} aria-hidden="true" /><span>More</span></>}
        />
      ) : null}
    </div>
  );
}
