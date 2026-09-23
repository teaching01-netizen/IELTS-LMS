import { Fragment, useMemo } from 'react';
import type { ExamPlanSection, ExamSessionRuntime, SectionRuntimeState } from '../../../types/domain';
import { SatEyebrow, SatSectionCard } from './SatPage';
import {
  buildSatRunSheet,
  formatRunSheetClock,
  formatRunSheetDuration,
  formatRunSheetRemaining,
  formatRunSheetWindow,
  SAT_RUN_SHEET_TIME_ZONE_LABEL,
  type SatRunSheet as SatRunSheetModel,
  type SatRunSheetRow,
  type SatRunSheetRowStatus,
} from './sessionRunSheet';

const STATUS_LABEL: Record<SatRunSheetRowStatus, string> = {
  done: 'Done',
  live: 'Live',
  paused: 'Paused',
  upcoming: 'Upcoming',
  projected: 'Planned',
};

const STATUS_CLASS: Record<SatRunSheetRowStatus, string> = {
  done: 'text-[var(--sat-staff-text-tertiary,#6e6e73)]',
  live: 'font-semibold text-[var(--sat-staff-success-text,#067647)]',
  paused: 'font-semibold text-[var(--sat-staff-warning-text,#92400e)]',
  upcoming: 'text-[var(--sat-staff-text-tertiary,#6e6e73)]',
  projected: 'text-[var(--sat-staff-text-tertiary,#6e6e73)]',
};

/**
 * The staff run sheet for one SAT session: every section, module and break with
 * its window in Thailand time, its own clock, and the status the runtime has
 * reached. It answers the question the per-student timers cannot — "when is the
 * cohort supposed to be where, and is the run on plan?" — which is exactly how a
 * section clock that counted Module 2 twice becomes visible: the window is
 * projected from the runtime clock the candidates are on, and a row whose clock
 * disagrees with the authored plan says so on that row.
 *
 * The Remaining column is the module-level clock the proctor could not read
 * before: the section, the module the room is inside and the break each count
 * down on the room's own clock (the same anchor the candidates' timers now use),
 * so "Module 1 has 12 minutes left" is a fact on the page rather than an
 * inference from the section clock.
 *
 * A caller that already built the projection — the session room, which renders
 * the current section and module in its header from the same rows — passes it in
 * as `sheet`, so one projection backs the header and the table and the two can
 * never disagree. Presentation only: all projection and formatting live in the
 * pure `sessionRunSheet` model.
 */
export function SatRunSheet({
  plan,
  runtime,
  scheduledStartAt,
  now,
  sheet: providedSheet,
}: {
  plan?: ExamPlanSection[] | null | undefined;
  runtime?:
    | Pick<ExamSessionRuntime, 'sections' | 'actualStartAt' | 'actualEndAt' | 'status' | 'serverNow'>
    | null
    | undefined;
  scheduledStartAt?: string | null | undefined;
  now?: string | null | undefined;
  /** Precomputed projection (the session room builds one for its header too). */
  sheet?: SatRunSheetModel | null | undefined;
}) {
  const sheet = useMemo(
    () => providedSheet ?? buildSatRunSheet({ plan, runtime, scheduledStartAt, now }),
    [now, plan, providedSheet, runtime, scheduledStartAt],
  );

  // Nothing to run: an exam version with no sections, or a schedule whose
  // runtime rows have not been created yet. Render nothing rather than an
  // empty table.
  if (sheet.rows.length === 0) return null;

  const anchorNote =
    sheet.anchor === 'runtime'
      ? `Anchored to the proctor's start at ${formatRunSheetClock(sheet.anchorAt)} ${SAT_RUN_SHEET_TIME_ZONE_LABEL}`
      : sheet.anchor === 'scheduled'
      ? `Projected from the scheduled start at ${formatRunSheetClock(sheet.anchorAt)} — times shift if the proctor starts late`
      : 'Times appear once this session is scheduled or started';
  const extensionMinutes = (runtime?.sections ?? []).reduce((total, section) => total + Math.max(0, section.extensionMinutes), 0);
  const pausedSeconds = (runtime?.sections ?? []).reduce((total, section) => total + Math.max(0, section.accumulatedPausedSeconds), 0);
  const originalPlannedEndAt = originalRunEndAt(plan ?? [], runtime?.sections ?? [], sheet.anchorAt);
  const startedAt = runtime?.actualStartAt ?? null;
  const finishedAt = runtime?.actualEndAt ?? null;
  const finishedDuration = formatRunSheetDuration(startedAt, finishedAt) ?? '—';
  const finished = runtime?.status === 'completed';
  const timingStartLabel = startedAt ? formatRunSheetClock(startedAt) : formatRunSheetClock(sheet.anchorAt);
  const timingEndLabel = finished
    ? formatRunSheetClock(finishedAt)
    : formatRunSheetClock(sheet.plannedEndAt);
  const timingStartTitle = startedAt ? 'Started' : 'Scheduled start';
  const timingEndTitle = finished ? 'Finished' : runtime?.status === 'not_started' ? 'Planned finish' : 'Expected finish';

  return (
    <SatSectionCard className="sat-run-sheet mt-4" labelledBy="sat-run-sheet-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <SatEyebrow id="sat-run-sheet-heading">Run sheet</SatEyebrow>
          <p className="mt-1 text-[11px] font-medium text-[var(--sat-staff-text-secondary,#515154)]">
            Thailand time · {SAT_RUN_SHEET_TIME_ZONE_LABEL}
          </p>
        </div>
      </div>
      <div className="sat-run-sheet__summary" role="group" aria-label="Session timing">
        <div><span>{timingStartTitle}</span><strong>{timingStartLabel}</strong></div>
        <div><span>{timingEndTitle}</span><strong>{timingEndLabel}</strong></div>
        {finished ? <div><span>Duration</span><strong>{finishedDuration}</strong></div> : null}
        <div><span>Time zone</span><strong>{SAT_RUN_SHEET_TIME_ZONE_LABEL}</strong></div>
      </div>
      {extensionMinutes > 0 || pausedSeconds > 0 ? (
        <p className="sat-run-sheet__delta">
          Original plan {formatRunSheetClock(originalPlannedEndAt)}
          {extensionMinutes > 0 ? ` · +${extensionMinutes} min extension` : ''}
          {pausedSeconds > 0 ? ` · ${formatPausedDuration(pausedSeconds)} paused` : ''}
        </p>
      ) : <p className="mt-2 text-[11px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{anchorNote}</p>}

      {/* The inner scroll region is keyboard focusable so narrow layouts can
          review the full operational table without scrolling the page sideways. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard scrolling for the named table region */}
      <div className="sat-run-sheet__table-scroll" role="region" aria-label="Run sheet timeline" tabIndex={0}>
      <table className="mt-4 w-full border-collapse text-left">
        <caption className="sr-only">
          Planned SAT run sheet in Thailand time: every section, module and break with its window,
          its remaining clock and its status
        </caption>
        <colgroup><col className="sat-run-sheet__col-stage" /><col className="sat-run-sheet__col-window" /><col className="sat-run-sheet__col-remaining" /><col className="sat-run-sheet__col-status" /></colgroup>
        <thead>
          <tr className="border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))]">
            <th scope="col" className="pb-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              Stage
            </th>
            <th scope="col" className="pb-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              Start–end (ICT)
            </th>
            <th scope="col" className="pb-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              Remaining
            </th>
            <th scope="col" className="pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, index) => {
            const adaptiveBranch = row.kind === 'module' && row.label.startsWith('Module 2 ·') && row.detail?.startsWith('Alternative branch');
            const previous = sheet.rows[index - 1];
            const adaptiveGroupStart = adaptiveBranch && !(previous?.kind === 'module' && previous.label.startsWith('Module 2 ·') && previous.detail?.startsWith('Alternative branch'));
            return <Fragment key={row.id}>
              {adaptiveGroupStart ? <tr className="sat-run-sheet__adaptive-group"><th colSpan={4} scope="colgroup">Module 2 · Adaptive <span>One branch per student</span></th></tr> : null}
              <RunSheetRow row={row} anchorAt={sheet.anchorAt} />
            </Fragment>;
          })}
        </tbody>
      </table>
      </div>
    </SatSectionCard>
  );
}

function originalRunEndAt(
  plan: ExamPlanSection[],
  runtime: SectionRuntimeState[],
  anchorAt: string | null,
): string | null {
  const anchorMs = anchorAt ? Date.parse(anchorAt) : Number.NaN;
  if (!Number.isFinite(anchorMs)) return null;
  const runtimeByKey = new Map<string, SectionRuntimeState>(runtime.map((section) => [section.sectionKey, section]));
  const sections = plan.length ? plan : runtime.map((section) => ({
    sectionKey: section.sectionKey,
    durationMinutes: section.plannedDurationMinutes,
    gapAfterMinutes: section.gapAfterMinutes,
  }));
  const durationMinutes = sections.reduce((total, section) => {
    const live = runtimeByKey.get(section.sectionKey);
    return total + Math.max(0, live?.plannedDurationMinutes ?? section.durationMinutes)
      + Math.max(0, live?.gapAfterMinutes ?? section.gapAfterMinutes);
  }, 0);
  return new Date(anchorMs + durationMinutes * 60_000).toISOString();
}

function formatPausedDuration(seconds: number): string {
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (wholeMinutes === 0) return `${remainingSeconds} sec`;
  return remainingSeconds > 0 ? `${wholeMinutes} min ${remainingSeconds} sec` : `${wholeMinutes} min`;
}

function RunSheetRow({ row, anchorAt }: { row: SatRunSheetRow; anchorAt: string | null }) {
  const isModule = row.kind === 'module';
  const isBreak = row.kind === 'break';
  const planned = formatRunSheetWindow(row.plannedStartAt, row.plannedEndAt, anchorAt);
  const actual = row.actualStartAt ? formatRunSheetWindow(row.actualStartAt, row.actualEndAt, anchorAt) : null;
  const current = row.status === 'live' || row.status === 'paused';
  return (
    <tr
      data-runtime-mismatch={row.runtimeMismatch ? 'true' : undefined}
      data-sat-run-sheet-row={row.kind}
      data-sat-run-sheet-status={row.status}
      aria-current={current ? 'true' : undefined}
      className={`sat-run-sheet__row sat-run-sheet__row--${row.kind}${current ? ' is-current' : ''}${row.status === 'done' ? ' is-done' : ''}`}
    >
      <td className={'py-2 pr-3 align-top text-[12px] ' + (isModule ? 'pl-5' : '')}>
        <span
          className={
            isModule || isBreak
              ? 'font-medium text-[var(--sat-staff-text-secondary,#515154)]'
              : 'font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]'
          }
        >
          {row.label}
        </span>
        {row.title ? (
          <span className="mt-0.5 block text-[10px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{row.title}</span>
        ) : null}
        {row.detail ? (
          <span className="mt-0.5 block text-[10px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{row.detail}</span>
        ) : null}
        {row.mismatchNote ? (
          <span className="mt-0.5 block text-[10px] font-semibold text-[var(--sat-staff-warning-text,#92400e)]">
            {row.mismatchNote}
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3 align-top text-[12px] tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">
        <span className="block">{planned}</span>
        {actual && actual !== planned ? (
          <span className="mt-0.5 block text-[10px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">Actual {actual}</span>
        ) : null}
        {row.plannedStartAt === null &&
        (row.plannedDurationMinutes ?? row.runtimeDurationMinutes) !== null ? (
          <span className="mt-0.5 block text-[10px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            {row.plannedDurationMinutes ?? row.runtimeDurationMinutes} min
          </span>
        ) : null}
      </td>
      {/* The row's own clock: the room's module clock for a module row, the
          section clock for the section row, the countdown for a break. Only the
          row the cohort is inside has one running. */}
      <td
        data-sat-run-sheet-remaining={row.kind}
        className={
          'py-2 pr-3 align-top text-[12px] tabular-nums ' +
          (row.status === 'live' || row.status === 'paused'
            ? 'font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]'
            : 'text-[var(--sat-staff-text-tertiary,#6e6e73)]')
        }
      >
        {formatRunSheetRemaining(row.remainingSeconds)}
      </td>
      <td className={'py-2 align-top text-[11px] ' + STATUS_CLASS[row.status]}>{STATUS_LABEL[row.status]}</td>
    </tr>
  );
}
