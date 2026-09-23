import { useEffect, useRef, useState } from 'react';
import type { ExamSessionRuntime } from '../../../types/domain';
import { SatEyebrow } from './SatPage';
import { SatRunSheet } from './SatRunSheet';
import {
  formatRunSheetClock,
  formatRunSheetRemaining,
  satRunSheetCurrentRows,
  type SatRunSheet as SatRunSheetModel,
} from './sessionRunSheet';
import type { SatRoomMode } from './SatSessionContextBar';

export function SatSessionRoomTimeline({
  runtime,
  scheduledStartAt,
  runSheet,
  roomMode,
  sessionLive,
  currentStage,
  remainingSeconds,
}: {
  runtime: ExamSessionRuntime;
  scheduledStartAt: string | null;
  runSheet: SatRunSheetModel;
  roomMode: SatRoomMode;
  sessionLive: boolean;
  currentStage: string;
  remainingSeconds: number;
}) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [showStickyContext, setShowStickyContext] = useState(false);
  const stageRows = satRunSheetCurrentRows(runSheet);
  const sessionFinished = runtime.status === 'completed';
  const stageSectionOrdinal = stageRows.section
    ? runSheet.rows.filter((row) => row.kind === 'section').indexOf(stageRows.section) + 1
    : 0;
  const stageSlot = [
    stageSectionOrdinal > 0 ? `Section ${stageSectionOrdinal}` : null,
    stageRows.module ? stageRows.module.label : stageRows.break ? 'Break' : null,
  ].filter(Boolean).join(' · ');
  const upcomingSection = runSheet.rows.find(
    (row) => row.kind === 'section' && (row.status === 'upcoming' || row.status === 'projected'),
  ) ?? null;
  const currentOperationalRow = stageRows.module ?? stageRows.break ?? stageRows.section;
  const currentOperationalEnd = currentOperationalRow?.plannedEndAt ? Date.parse(currentOperationalRow.plannedEndAt) : Number.NaN;
  const nextStageRow = Number.isFinite(currentOperationalEnd)
    ? runSheet.rows.find((row) => {
      const start = row.plannedStartAt ? Date.parse(row.plannedStartAt) : Number.NaN;
      return row.id !== currentOperationalRow?.id && (row.kind === 'module' || row.kind === 'break' || row.kind === 'section')
        && Number.isFinite(start) && start >= currentOperationalEnd
        && (row.status === 'upcoming' || row.status === 'projected');
    }) ?? null
    : upcomingSection;
  const nextStageLabel = nextStageRow?.detail?.startsWith('Alternative branch')
    ? 'Module 2 · Adaptive branches'
    : nextStageRow?.label ?? null;
  const clockCaption = stageRows.module ? 'Section remaining' : stageRows.break ? 'Break remaining' : 'Stage remaining';
  const currentModuleEnd = formatRunSheetClock(stageRows.module?.plannedEndAt);
  const currentSectionEnd = formatRunSheetClock(stageRows.section?.plannedEndAt);

  useEffect(() => {
    const root = workspaceRef.current;
    const target = stageRef.current;
    if (!root || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setShowStickyContext(Boolean(entry && !entry.isIntersecting));
    }, { root, threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [runtime.scheduleId]);

  return (
    <section ref={workspaceRef} className="sat-room__workspace" aria-label="Session timeline" data-sat-room-workspace data-sat-room-timeline>
      <div className={`sat-room__sticky-context${showStickyContext ? ' is-visible' : ''}`} role="group" aria-label="Current session context">
        <span>{currentStage}{stageSlot ? ` · ${stageSlot}` : ''}</span>
        {sessionLive ? <strong>{formatRunSheetRemaining(remainingSeconds)}</strong> : null}
      </div>
      <div className="min-w-0">
        <div ref={stageRef} className={`sat-room__stage sat-room__stage--${roomMode}`} data-sat-room-stage>
          <SatEyebrow>{roomMode === 'review' ? 'Session review' : roomMode === 'prestart' ? 'Ready to begin' : 'Current stage'}</SatEyebrow>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h2>{roomMode === 'review' ? (sessionFinished ? 'Session finished' : 'Session cancelled') : roomMode === 'prestart' ? upcomingSection?.label.replace(/^Section \d+ · /, '') ?? 'Session schedule' : currentStage}</h2>
              {roomMode === 'review' ? null : roomMode === 'prestart' ? (
                <p className="sat-room__stage-note">Starts when the proctor starts the session.</p>
              ) : (
                <>
                  {stageSlot ? <p className="sat-room__stage-slot" data-sat-room-stage-slot>{stageSlot}</p> : null}
                  <p className="sat-room__stage-note">
                    {stageRows.module
                      ? `Module ends ${currentModuleEnd} ICT · section ends ${currentSectionEnd} ICT`
                      : stageRows.break
                        ? `Break ends ${formatRunSheetClock(stageRows.break.plannedEndAt)} ICT`
                        : stageRows.section
                          ? `Section ends ${currentSectionEnd} ICT`
                          : sessionLive
                            ? 'Server-authoritative session clock'
                            : 'Session timing is no longer running.'}
                  </p>
                  {nextStageRow && nextStageLabel ? (
                    <p className="sat-room__next-stage">
                      <span>Next</span>{nextStageLabel}<span>Starts {formatRunSheetClock(nextStageRow.plannedStartAt)} ICT</span>
                    </p>
                  ) : null}
                </>
              )}
            </div>
            {sessionLive ? (
              <div className="shrink-0 sm:text-right">
                <p className="sat-room__clock" aria-label={clockCaption === 'Section remaining' ? 'Time remaining in this section' : 'Time remaining in this stage'}>
                  {formatRunSheetRemaining(remainingSeconds)}
                </p>
                <p className="sat-room__stage-clock-caption">{clockCaption}</p>
              </div>
            ) : null}
          </div>
        </div>
        <SatRunSheet sheet={runSheet} runtime={runtime} scheduledStartAt={scheduledStartAt} />
      </div>
    </section>
  );
}
