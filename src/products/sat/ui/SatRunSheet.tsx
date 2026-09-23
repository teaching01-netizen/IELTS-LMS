import { Fragment, useMemo } from 'react';
import type { ExamPlanSection, ExamSessionRuntime } from '../../../types/domain';
import { SatEyebrow, SatSectionCard } from './SatPage';
import {
  buildSatRunSheet,
  formatRunSheetClock,
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
  const originalPlannedEndAt = originalPlannedFinishAt(sheet);

  return (
    <SatSectionCard className="sat-run-sheet mt-4" labelledBy="sat-run-sheet-heading">
      <div className="sat-run-sheet__heading">
        <SatEyebrow id="sat-run-sheet-heading">Run sheet</SatEyebrow>
        <p>Thailand time · {SAT_RUN_SHEET_TIME_ZONE_LABEL}</p>
      </div>
      <p className="sat-run-sheet__anchor">{anchorNote}</p>
      {extensionMinutes > 0 || pausedSeconds > 0 ? (
        <p className="sat-run-sheet__delta">
          Original finish {formatRunSheetClock(originalPlannedEndAt)}
          {extensionMinutes > 0 ? ` · +${extensionMinutes} min extension` : ''}
          {pausedSeconds > 0 ? ` · ${formatPausedDuration(pausedSeconds)} paused` : ''}
        </p>
      ) : null}

      <div className="sat-run-sheet__rows" role="list" aria-label="Run sheet stages">
        {sheet.rows.map((row, index) => {
          const adaptiveBranch = row.kind === 'module' && row.label.startsWith('Module 2 ·') && row.detail?.startsWith('Alternative branch');
          const previous = sheet.rows[index - 1];
          const adaptiveGroupStart = adaptiveBranch && !(previous?.kind === 'module' && previous.label.startsWith('Module 2 ·') && previous.detail?.startsWith('Alternative branch'));
          return <Fragment key={row.id}>
            {adaptiveGroupStart ? <div className="sat-run-sheet__adaptive-group" role="presentation">Module 2 · Adaptive <span>One branch per student</span></div> : null}
            <RunSheetRow row={row} anchorAt={sheet.anchorAt} />
          </Fragment>;
        })}
      </div>
    </SatSectionCard>
  );
}

/**
 * Baseline finish before extensions and pauses, using the same section and
 * break rows that render below. This is summary metadata, not another timeline
 * projection; the sessionRunSheet model remains the sole owner of row windows.
 */
function originalPlannedFinishAt(sheet: SatRunSheetModel): string | null {
  const anchorMs = sheet.anchorAt ? Date.parse(sheet.anchorAt) : Number.NaN;
  if (!Number.isFinite(anchorMs)) return null;
  const baseDurationMinutes = sheet.rows.reduce<number | null>((total, row) => {
    if (total === null || row.kind === 'module') return total;
    const rowMinutes = row.kind === 'section'
      ? row.runtimeDurationMinutes ?? row.plannedDurationMinutes
      : row.plannedDurationMinutes;
    return rowMinutes === null ? null : total + Math.max(0, rowMinutes);
  }, 0);
  if (baseDurationMinutes === null) return null;
  return new Date(anchorMs + baseDurationMinutes * 60_000).toISOString();
}

function formatPausedDuration(seconds: number): string {
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (wholeMinutes === 0) return `${remainingSeconds} sec`;
  return remainingSeconds > 0 ? `${wholeMinutes} min ${remainingSeconds} sec` : `${wholeMinutes} min`;
}

function RunSheetRow({ row, anchorAt }: { row: SatRunSheetRow; anchorAt: string | null }) {
  const planned = formatRunSheetWindow(row.plannedStartAt, row.plannedEndAt, anchorAt);
  const actual = row.actualStartAt ? formatRunSheetWindow(row.actualStartAt, row.actualEndAt, anchorAt) : null;
  const current = row.status === 'live' || row.status === 'paused';
  return (
    <div
      role="listitem"
      data-runtime-mismatch={row.runtimeMismatch ? 'true' : undefined}
      data-sat-run-sheet-row={row.kind}
      data-sat-run-sheet-status={row.status}
      aria-current={current ? 'true' : undefined}
      className={`sat-run-sheet__row sat-run-sheet__row--${row.kind}${current ? ' is-current' : ''}${row.status === 'done' ? ' is-done' : ''}`}
    >
      <div className="sat-run-sheet__row-main">
        <div className="sat-run-sheet__row-label">
          <strong>{row.label}</strong>
          {row.title ? <span>{row.title}</span> : null}
          {row.detail ? <span>{row.detail}</span> : null}
          {row.mismatchNote ? <span className="sat-run-sheet__mismatch">{row.mismatchNote}</span> : null}
        </div>
        <div className="sat-run-sheet__row-window">
          <span>{planned}</span>
          {actual && actual !== planned ? <span>Actual {actual}</span> : null}
          {row.plannedStartAt === null && (row.plannedDurationMinutes ?? row.runtimeDurationMinutes) !== null ? (
            <span>
            {row.plannedDurationMinutes ?? row.runtimeDurationMinutes} min
            </span>
          ) : null}
        </div>
      {/* The row's own clock: the room's module clock for a module row, the
          section clock for the section row, the countdown for a break. Only the
          row the cohort is inside has one running. */}
        <div className="sat-run-sheet__row-clock" data-sat-run-sheet-remaining={row.kind}>
          {row.remainingSeconds !== null ? <span className="sat-run-sheet__remaining-label">Remaining</span> : null}
          <span
            className={row.status === 'live' || row.status === 'paused' ? 'is-active' : ''}
          >
            {formatRunSheetRemaining(row.remainingSeconds)}
          </span>
        </div>
        <span className={`sat-run-sheet__status ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
      </div>
    </div>
  );
}
