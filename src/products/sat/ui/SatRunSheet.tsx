import { useMemo } from 'react';
import type { ExamPlanSection, ExamSessionRuntime } from '../../../types/domain';
import { SatEyebrow, SatSectionCard } from './SatPage';
import {
  buildSatRunSheet,
  formatRunSheetClock,
  formatRunSheetWindow,
  SAT_RUN_SHEET_TIME_ZONE_LABEL,
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
 * its window in Thailand time, plus the live status the runtime has reached. It
 * answers the question the per-student timers cannot — "when is the cohort
 * supposed to be where, and is the run on plan?" — which is exactly how a
 * section clock that counted Module 2 twice becomes visible: the window is
 * projected from the runtime clock the candidates are on, and a row whose clock
 * disagrees with the authored plan says so on that row.
 *
 * Presentation only: all projection and formatting live in the pure
 * `sessionRunSheet` model.
 */
export function SatRunSheet({
  plan,
  runtime,
  scheduledStartAt,
  now,
}: {
  plan?: ExamPlanSection[] | null | undefined;
  runtime?:
    | Pick<ExamSessionRuntime, 'sections' | 'actualStartAt' | 'actualEndAt' | 'status' | 'serverNow'>
    | null
    | undefined;
  scheduledStartAt?: string | null | undefined;
  now?: string | null | undefined;
}) {
  const sheet = useMemo(
    () => buildSatRunSheet({ plan, runtime, scheduledStartAt, now }),
    [now, plan, runtime, scheduledStartAt],
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

  return (
    <SatSectionCard className="mt-4" labelledBy="sat-run-sheet-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <SatEyebrow id="sat-run-sheet-heading">Run sheet</SatEyebrow>
          <p className="mt-1 text-[11px] font-medium text-[var(--sat-staff-text-secondary,#515154)]">
            Thailand time · {SAT_RUN_SHEET_TIME_ZONE_LABEL}
          </p>
        </div>
        {sheet.plannedEndAt ? (
          <p className="text-[11px] font-medium tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            Planned end {formatRunSheetClock(sheet.plannedEndAt)}
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{anchorNote}</p>

      <table className="mt-4 w-full border-collapse text-left">
        <caption className="sr-only">
          Planned SAT run sheet in Thailand time: sections, modules and breaks with their status
        </caption>
        <thead>
          <tr className="border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))]">
            <th scope="col" className="pb-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              Stage
            </th>
            <th scope="col" className="pb-2 pr-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              Start–end (ICT)
            </th>
            <th scope="col" className="pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row) => (
            <RunSheetRow key={row.id} row={row} anchorAt={sheet.anchorAt} />
          ))}
        </tbody>
      </table>
    </SatSectionCard>
  );
}

function RunSheetRow({ row, anchorAt }: { row: SatRunSheetRow; anchorAt: string | null }) {
  const isModule = row.kind === 'module';
  const isBreak = row.kind === 'break';
  const planned = formatRunSheetWindow(row.plannedStartAt, row.plannedEndAt, anchorAt);
  const actual = row.actualStartAt ? formatRunSheetWindow(row.actualStartAt, row.actualEndAt, anchorAt) : null;
  return (
    <tr
      data-runtime-mismatch={row.runtimeMismatch ? 'true' : undefined}
      className={
        'border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] last:border-b-0 ' +
        (row.status === 'live' ? 'bg-[var(--sat-staff-success-tint,rgba(5,150,105,0.06))]' : '')
      }
    >
      <td className={'py-2 pr-3 align-top text-[12px] ' + (isModule ? 'pl-4' : '')}>
        <span
          className={
            isModule || isBreak
              ? 'font-medium text-[var(--sat-staff-text-secondary,#515154)]'
              : 'font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]'
          }
        >
          {row.label}
        </span>
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
      <td className={'py-2 align-top text-[11px] ' + STATUS_CLASS[row.status]}>{STATUS_LABEL[row.status]}</td>
    </tr>
  );
}
