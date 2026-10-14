import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExamSessionRuntime } from '../../../types/domain';
import { SatRunSheet } from './SatRunSheet';
import {
  formatRunSheetClock,
  formatRunSheetRemaining,
  satRunSheetCurrentRows,
  type SatRunSheet as SatRunSheetModel,
} from './sessionRunSheet';
import type { SatRoomMode } from './SatSessionContextBar';
import { SatRoomSurface } from './room/SatRoomSurface';

/**
 * The room's context column: the current stage first (before the exam, how it
 * starts; while running, the stage and its authoritative clock; afterwards,
 * the outcome), then whatever the room needs now (`children`: joining and
 * attention), then the full run sheet behind a disclosure. When the stage card
 * scrolls away, a sticky line keeps the stage and clock in view.
 */
export function SatSessionRoomTimeline({
  runtime,
  scheduledStartAt,
  runSheet,
  roomMode,
  sessionLive,
  currentStage,
  remainingSeconds,
  startMode,
  studentEntry,
  children,
}: {
  runtime: ExamSessionRuntime;
  scheduledStartAt: string | null;
  runSheet: SatRunSheetModel;
  roomMode: SatRoomMode;
  sessionLive: boolean;
  currentStage: string;
  remainingSeconds: number;
  /** How students begin: the proctor's room start, or each student's start code. */
  startMode: 'proctor' | 'access_code';
  /** Pre-start only: what will run and how it starts. */
  studentEntry?: ReactNode;
  /** Room panels shown between the stage and the run sheet. */
  children?: ReactNode;
}) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [showStickyContext, setShowStickyContext] = useState(false);
  // The full schedule is the record once the room is over; while it runs, the
  // stage card carries what a proctor acts on and the schedule is one click away.
  const [scheduleOpen, setScheduleOpen] = useState(roomMode === 'review');
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
  const paused = runtime.status === 'paused';

  useEffect(() => {
    if (roomMode === 'review') setScheduleOpen(true);
  }, [roomMode]);

  useEffect(() => {
    const root = workspaceRef.current;
    const target = root?.querySelector('[data-sat-room-stage]');
    if (!root || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setShowStickyContext(Boolean(entry && !entry.isIntersecting));
    }, { root, threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [runtime.scheduleId]);

  const eyebrow = roomMode === 'review' ? 'Room review' : roomMode === 'prestart' ? 'Ready to begin' : paused ? 'Paused' : 'Current stage';
  const title = roomMode === 'review'
    ? (sessionFinished ? 'Room finished' : 'Room cancelled')
    : roomMode === 'prestart'
      ? upcomingSection?.label.replace(/^Section \d+ · /, '') ?? 'Room schedule'
      : currentStage;

  /* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The scrollable context column must be keyboard reachable. */
  return (
    <section
      ref={workspaceRef}
      className="sat-room__workspace focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
      aria-label="Room information"
      tabIndex={0}
      data-sat-room-workspace
      data-sat-room-timeline
    >
      <div className={`sat-room__sticky-context${showStickyContext ? ' is-visible' : ''}`} role="group" aria-label="Current room context">
        <span className="min-w-0 truncate">{currentStage}{stageSlot ? ` · ${stageSlot}` : ''}</span>
        {sessionLive ? <strong className="tabular-nums">{formatRunSheetRemaining(remainingSeconds)}</strong> : null}
      </div>
      <SatRoomSurface as="div" className={`sat-room__stage sat-room__stage--${roomMode} p-4`} data-sat-room-stage>
        <p className={`text-[14px] font-medium ${paused ? 'text-[var(--sat-staff-warning-text,#92400e)]' : 'text-[var(--sat-staff-text-tertiary,#6e6e73)]'}`}>{eyebrow}</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-40">
            <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
            {roomMode === 'live' && stageSlot ? (
              <p className="mt-0.5 text-[14px] font-medium tabular-nums text-[var(--sat-staff-text-secondary,#515154)]" data-sat-room-stage-slot>{stageSlot}</p>
            ) : null}
          </div>
          {sessionLive ? (
            <div className="shrink-0 text-right">
              <p className="sat-room__clock" aria-label={clockCaption === 'Section remaining' ? 'Time remaining in this section' : 'Time remaining in this stage'}>
                {formatRunSheetRemaining(remainingSeconds)}
              </p>
              <p className="sat-room__stage-clock-caption mt-1 text-[14px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">{clockCaption}</p>
            </div>
          ) : null}
        </div>
        {roomMode === 'prestart' ? (
          <>
            <p className="sat-room__stage-note mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              {startMode === 'access_code' ? 'Each student starts when they enter the exam start code.' : 'Starts when the proctor starts the session.'}
            </p>
            {studentEntry}
          </>
        ) : roomMode === 'live' ? (
          <div className="mt-3 space-y-1.5 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-3 text-[14px] leading-5">
            <p className="sat-room__stage-note text-[var(--sat-staff-text-secondary,#515154)]">
              {stageRows.module
                ? `Module ends ${currentModuleEnd} ICT · section ends ${currentSectionEnd} ICT`
                : stageRows.break
                  ? `Break ends ${formatRunSheetClock(stageRows.break.plannedEndAt)} ICT`
                  : stageRows.section
                    ? `Section ends ${currentSectionEnd} ICT`
                    : sessionLive
                      ? 'Server-authoritative room clock'
                      : 'Room timing is no longer running.'}
            </p>
            {nextStageRow && nextStageLabel ? (
              <p className="flex flex-wrap items-baseline gap-x-2 text-[var(--sat-staff-text-secondary,#515154)]">
                <span className="text-[var(--sat-staff-text-tertiary,#6e6e73)]">Next</span>
                <span className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{nextStageLabel}</span>
                <span className="tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">Starts {formatRunSheetClock(nextStageRow.plannedStartAt)} ICT</span>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="sat-room__stage-note mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            {sessionFinished ? 'Every student’s attempt is closed. The run sheet below is the record of this room.' : 'This room was cancelled. The run sheet below shows the timeline recorded so far.'}
          </p>
        )}
      </SatRoomSurface>
      {children}
      <SatRunSheet sheet={runSheet} runtime={runtime} scheduledStartAt={scheduledStartAt} open={scheduleOpen} onOpenChange={setScheduleOpen} />
    </section>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-tabindex */
}
