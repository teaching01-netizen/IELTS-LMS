import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { ServerClockSnapshot } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import type { SatRoomExpectedStudent } from '../api/satRoomEntryInfo';
import { SatSearchField, SatToolbarSelect } from './SatPage';
import { SatRoomStudentRow } from './SatSessionRoomStudents';
import type { RoomScore, RoomScoreKind } from './useRoomScores';
import { SatRoomSurface } from './room/SatRoomSurface';

const FILTER_CHIP = 'inline-flex min-h-11 items-center gap-2 rounded-[var(--sat-staff-radius-control,10px)] px-3 text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]';

type AttentionFilter = 'all' | 'needs';
export type SatRosterSort = 'name' | 'attention' | 'time' | 'score_asc' | 'score_desc';

const SORT_OPTIONS: ReadonlyArray<{ value: SatRosterSort; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'time', label: 'Time remaining' },
  { value: 'score_asc', label: 'Score: low→high' },
  { value: 'score_desc', label: 'Score: high→low' },
];

/** The clock the row shows first: the student's module clock, else their section clock. */
function remainingSeconds(student: StudentSession): number {
  return student.runtimeModuleRemainingSeconds ?? student.runtimeTimeRemainingSeconds ?? student.timeRemaining;
}

function attentionWeight(student: StudentSession, reasons: ReadonlyMap<string, string>): number {
  return reasons.has(student.id) ? 1 : 0;
}

export function sortRoster(
  students: StudentSession[],
  sort: SatRosterSort,
  reasons: ReadonlyMap<string, string>,
  scores?: ReadonlyMap<string, RoomScore>,
): StudentSession[] {
  const byName = (left: StudentSession, right: StudentSession) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }) || left.id.localeCompare(right.id);
  // Scored rows carry a real correct count; everything else (dash, answering,
  // scoring, not_scored) sorts after them, stable by name, in both directions.
  // Low scores never create attention — this only orders the list.
  const scoreValue = (student: StudentSession): number | null =>
    scores?.get(student.id)?.correct ?? null;
  const compareScore = (left: StudentSession, right: StudentSession, descending: boolean): number => {
    const leftScore = scoreValue(left);
    const rightScore = scoreValue(right);
    const leftRanked = leftScore !== null;
    const rightRanked = rightScore !== null;
    if (leftRanked && rightRanked) {
      if (leftScore !== rightScore) return descending ? rightScore! - leftScore! : leftScore! - rightScore!;
      return byName(left, right);
    }
    if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
    return byName(left, right);
  };
  return [...students].sort((left, right) => {
    if (sort === 'attention') return attentionWeight(right, reasons) - attentionWeight(left, reasons) || byName(left, right);
    if (sort === 'time') return remainingSeconds(left) - remainingSeconds(right) || byName(left, right);
    if (sort === 'score_asc') return compareScore(left, right, false);
    if (sort === 'score_desc') return compareScore(left, right, true);
    return byName(left, right);
  });
}

/** Plain-language age for the stale-while-revalidate line; null when unknown. */
function scoresAgeLabel(updatedAt: number | undefined): string | null {
  if (!updatedAt || !Number.isFinite(updatedAt)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (seconds < 5) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds / 60)}m ago`;
}

/**
 * Footer-scoped age line for the stale paragraph. Owns its own 30s interval
 * so the listbox never re-renders on the timer — only this line ticks, and it
 * is mounted only while the stale paragraph renders.
 */
const ScoresAgeLine = memo(function ScoresAgeLine({ updatedAt, visible }: { updatedAt: number | undefined; visible: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(id);
  }, [visible]);
  if (!visible) return null;
  const age = scoresAgeLabel(updatedAt);
  if (!age) return null;
  return <>{` · ${age}`}</>;
});

export function SatSessionRoomRoster({
  students,
  expectedStudents = [],
  visibleStudents,
  selectedStudent,
  runtime,
  roomClock,
  search,
  onSearchChange,
  attentionFilter,
  onAttentionFilterChange,
  attentionCount,
  attentionReasons,
  sort,
  onSortChange,
  onSelect,
  onShareLink,
  scores,
  scoresStale = false,
  scoresLoading = false,
  scoresUpdatedAt,
  scoresTruncated = false,
}: {
  students: StudentSession[];
  expectedStudents?: readonly SatRoomExpectedStudent[];
  visibleStudents: StudentSession[];
  selectedStudent: StudentSession | null;
  runtime: ExamSessionRuntime;
  roomClock?: ServerClockSnapshot | null | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  attentionFilter: AttentionFilter;
  onAttentionFilterChange: (filter: AttentionFilter) => void;
  attentionCount: number;
  /** Plain-language reason per student id; absent means nothing needs attention. */
  attentionReasons: ReadonlyMap<string, string>;
  sort: SatRosterSort;
  onSortChange: (sort: SatRosterSort) => void;
  onSelect: (studentId: string, trigger: HTMLElement) => void;
  onShareLink?: (() => void) | undefined;
  /** Zero-click score view-model by attempt id; absent entries render as dash. */
  scores?: ReadonlyMap<string, RoomScore> | undefined;
  /** Results read failed: scores keep their last value and dim instead of flashing. */
  scoresStale?: boolean | undefined;
  /** First paint of the results join: dash rows hold a skeleton, never a zero. */
  scoresLoading?: boolean | undefined;
  /** Last successful results join, for the stale-while-revalidate age line. */
  scoresUpdatedAt?: number | undefined;
  /** Results pages capped (500-row guard): roster notes incompleteness explicitly. */
  scoresTruncated?: boolean | undefined;
}) {
  // While a proctor's pointer or focus is in the list, live updates never move
  // the row they are about to act on: existing rows keep their place and new
  // students join at the end. The list re-sorts once they leave it.
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const holdOrder = pointerInside || focusInside;
  const shownOrder = useRef<string[]>([]);
  const sorted = useMemo(() => sortRoster(visibleStudents, sort, attentionReasons, scores), [attentionReasons, scores, sort, visibleStudents]);
  const ordered = useMemo(() => {
    if (!holdOrder || shownOrder.current.length === 0) return sorted;
    const byId = new Map(sorted.map((student) => [student.id, student]));
    const held = shownOrder.current.flatMap((id) => {
      const student = byId.get(id);
      if (!student) return [];
      byId.delete(id);
      return [student];
    });
    return [...held, ...byId.values()];
  }, [holdOrder, sorted]);
  useEffect(() => {
    shownOrder.current = ordered.map((student) => student.id);
  }, [ordered]);

  // Score upgrades announce once through a single polite live region: the first
  // paint only seeds the map, and a poll that flips several attempts into
  // `scored` collapses to one summary — rapid polls never flood the reader.
  // Server-authoritative only: nothing here predicts correctness, it reports
  // the same `byAttempt` Map the row and the inspector already read.
  const previousScoreKinds = useRef<Map<string, RoomScoreKind> | null>(null);
  const [scoreAnnouncement, setScoreAnnouncement] = useState('');
  useEffect(() => {
    const previous = previousScoreKinds.current;
    const current = new Map<string, RoomScoreKind>();
    if (scores) {
      for (const [id, score] of scores) current.set(id, score.kind);
    }
    previousScoreKinds.current = current;
    if (!previous) return;
    const changed: string[] = [];
    if (scores) {
      for (const [id, score] of scores) {
        if (score.kind === 'scored' && previous.get(id) !== 'scored') {
          const name = students.find((student) => student.id === id)?.name ?? 'A student';
          changed.push(`${name} scored ${score.correct} of ${score.total}`);
        } else if (score.kind === 'not_scored' && previous.get(id) !== 'not_scored') {
          const name = students.find((student) => student.id === id)?.name ?? 'A student';
          changed.push(`${name} marked not scored`);
        }
      }
    }
    if (changed.length === 1) setScoreAnnouncement(changed[0] ?? '');
    else if (changed.length > 1) setScoreAnnouncement(`${changed.length} scores updated.`);
  }, [scores, students]);

    const activeStudent = ordered.find((student) => student.id === selectedStudent?.id) ?? null;
  const joinedAttemptIds = new Set(students.map((student) => student.id));
  const needle = search.trim().toLocaleLowerCase();
  const visibleExpectedStudents = attentionFilter === 'all'
    ? expectedStudents.filter((student) => (!student.attemptId || !joinedAttemptIds.has(student.attemptId))
      && (!needle || student.name.toLocaleLowerCase().includes(needle)))
    : [];

  const filtered = needle !== '' || attentionFilter === 'needs';

  return (
    <SatRoomSurface aria-label="Students" className="sat-room__roster overflow-hidden">
      <div className="shrink-0 border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">Students</h2>
          {filtered && students.length ? (
            <span className="text-[14px] tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]" aria-live="polite">Showing {ordered.length} of {students.length}</span>
          ) : null}
        </div>
        <div className="mt-3">
          <SatSearchField
            id="sat-room-student-search"
            label="Search students"
            value={search}
            onChange={onSearchChange}
            placeholder="Search name, ID, email"
            widthClassName="w-full"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Roster filter">
            <button
              type="button"
              aria-pressed={attentionFilter === 'all'}
              onClick={() => onAttentionFilterChange('all')}
              className={`${FILTER_CHIP} ${attentionFilter === 'all' ? 'bg-[var(--sat-staff-fill-active,rgba(0,0,0,0.065))] text-[var(--sat-staff-text-primary,#1d1d1f)]' : 'text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))]'}`}
            >
              All
            </button>
            {attentionCount > 0 ? (
              <button
                type="button"
                aria-label={`Filter roster to students needing attention, ${attentionCount}`}
                aria-pressed={attentionFilter === 'needs'}
                onClick={() => onAttentionFilterChange(attentionFilter === 'needs' ? 'all' : 'needs')}
                className={`${FILTER_CHIP} text-[var(--sat-staff-warning-text,#92400e)] ${attentionFilter === 'needs' ? 'bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))]' : 'hover:bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))]'}`}
              >
                <span>Needs attention</span>
                <span className="sat-room__attention-count tabular-nums">{attentionCount}</span>
              </button>
            ) : (
              <span className={`${FILTER_CHIP} text-[var(--sat-staff-text-tertiary,#6e6e73)]`}>
                <span>Needs attention</span>
                <span className="sat-room__attention-count tabular-nums">0</span>
              </span>
            )}
          </div>
          <SatToolbarSelect<SatRosterSort> id="sat-room-roster-sort" label="Sort" value={sort} options={SORT_OPTIONS} onChange={onSortChange} />
        </div>
        {/* Stale-while-revalidate, inline and persistent: the rows keep their
            last value dimmed, and this line says how old it is. Never a toast,
            never a zero flash. Not a live region — the age text would re-announce. */}
        {scoresStale ? (
          <p className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
            Scores may be stale<ScoresAgeLine updatedAt={scoresUpdatedAt} visible={scoresStale} /> · keeping last values.
          </p>
        ) : null}
        {scoresTruncated ? (
          <p className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            Showing first 500 scores — narrow the search to see more.
          </p>
        ) : null}
        <span className="sr-only" role="status">{scoreAnnouncement}</span>
      </div>
      <div
        role="listbox"
        aria-label="Students in this session. Use arrow keys to move between students."
        aria-activedescendant={activeStudent ? `sat-room-student-${activeStudent.id}` : undefined}
        tabIndex={ordered.length ? 0 : -1}
        onPointerEnter={() => setPointerInside(true)}
        onPointerLeave={() => setPointerInside(false)}
        onFocus={() => setFocusInside(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusInside(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const current = ordered.findIndex((student) => student.id === selectedStudent?.id);
          const nextIndex = event.key === 'ArrowDown'
            ? Math.min(current + 1, ordered.length - 1)
            : Math.max(current < 0 ? 0 : current - 1, 0);
          const next = ordered[nextIndex];
          if (!next) return;
          const nextRow = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'))
            .find((row) => row.id === `sat-room-student-${next.id}`);
          if (nextRow) {
            onSelect(next.id, nextRow);
            nextRow.focus();
          }
        }}
        className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
      >
        {ordered.length ? ordered.map((student) => (
          <SatRoomStudentRow
            key={student.id}
            student={student}
            runtime={runtime}
            roomClock={roomClock}
            selected={selectedStudent?.id === student.id}
            attentionReason={attentionReasons.get(student.id) ?? null}
            score={scores?.get(student.id) ?? null}
            scoresStale={scoresStale}
            scoresLoading={scoresLoading}
            onSelect={(trigger) => onSelect(student.id, trigger)}
          />
        )) : (
          <div className="px-6 py-12 text-center">
            <p className="text-[14px] font-semibold text-[var(--sat-staff-text-secondary,#515154)]">
              {students.length ? 'No matching students.' : 'No students have joined yet.'}
            </p>
            <p className="mx-auto mt-1 max-w-[36ch] text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              {students.length ? 'Change the search or the filter.' : 'Students appear here the moment they open their exam link.'}
            </p>
            {!students.length && onShareLink ? (
              <button type="button" onClick={onShareLink} className="sat-btn sat-btn--secondary sat-press mt-4 px-3.5">
                Share student link
              </button>
            ) : null}
          </div>
        )}
      </div>
      {visibleExpectedStudents.length ? <section aria-label="Invited students" className="shrink-0 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Expected students</h3>
          <span className="text-[14px] tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">{visibleExpectedStudents.length} not in room</span>
        </div>
        <ul className="mt-1 max-h-56 divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] overflow-y-auto">
          {visibleExpectedStudents.map((student) => <li key={student.ordinal} className="flex min-h-11 items-center justify-between gap-3 py-2 text-[14px]">
            <span className="min-w-0 break-words font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">{student.name}</span>
            <span className="shrink-0 text-right text-[var(--sat-staff-text-tertiary,#6e6e73)]">{student.state === 'not_joined' ? 'Invited · Not joined' : student.state === 'waiting' ? 'Waiting' : student.state === 'working' ? 'Working' : 'Finished'}</span>
          </li>)}
        </ul>
      </section> : null}
    </SatRoomSurface>
  );
}
