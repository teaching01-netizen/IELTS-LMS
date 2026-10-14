import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { ServerClockSnapshot } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import type { SatRoomExpectedStudent } from '../api/satRoomEntryInfo';
import { SatSearchField, SatToolbarSelect } from './SatPage';
import { SatRoomStudentRow } from './SatSessionRoomStudents';
import { SatRoomSurface } from './room/SatRoomSurface';

const FILTER_CHIP = 'inline-flex min-h-11 items-center gap-2 rounded-[var(--sat-staff-radius-control,10px)] px-3 text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]';

type AttentionFilter = 'all' | 'needs';
export type SatRosterSort = 'name' | 'attention' | 'time';

const SORT_OPTIONS: ReadonlyArray<{ value: SatRosterSort; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'time', label: 'Time remaining' },
];

/** The clock the row shows first: the student's module clock, else their section clock. */
function remainingSeconds(student: StudentSession): number {
  return student.runtimeModuleRemainingSeconds ?? student.runtimeTimeRemainingSeconds ?? student.timeRemaining;
}

function attentionWeight(student: StudentSession, reasons: ReadonlyMap<string, string>): number {
  return reasons.has(student.id) ? 1 : 0;
}

export function sortRoster(students: StudentSession[], sort: SatRosterSort, reasons: ReadonlyMap<string, string>): StudentSession[] {
  const byName = (left: StudentSession, right: StudentSession) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }) || left.id.localeCompare(right.id);
  return [...students].sort((left, right) => {
    if (sort === 'attention') return attentionWeight(right, reasons) - attentionWeight(left, reasons) || byName(left, right);
    if (sort === 'time') return remainingSeconds(left) - remainingSeconds(right) || byName(left, right);
    return byName(left, right);
  });
}

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
}) {
  // While a proctor's pointer or focus is in the list, live updates never move
  // the row they are about to act on: existing rows keep their place and new
  // students join at the end. The list re-sorts once they leave it.
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const holdOrder = pointerInside || focusInside;
  const shownOrder = useRef<string[]>([]);
  const sorted = useMemo(() => sortRoster(visibleStudents, sort, attentionReasons), [attentionReasons, sort, visibleStudents]);
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
