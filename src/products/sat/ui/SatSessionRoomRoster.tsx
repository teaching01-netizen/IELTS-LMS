import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { ServerClockSnapshot } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { SatSearchField, SatToolbarSelect } from './SatPage';
import { SatRoomStudentRow } from './SatSessionRoomStudents';

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
  return (reasons.has(student.id) ? 1 : 0) + student.warnings + student.violations.length;
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

  return (
    <section className="sat-room__roster" aria-label="Students">
      <div className="sat-room__roster-head">
        <p className="sat-room__eyebrow">Students</p>
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
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Roster filter">
            <button
              type="button"
              aria-pressed={attentionFilter === 'all'}
              onClick={() => onAttentionFilterChange('all')}
              className={`min-h-11 rounded-full px-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${attentionFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip-hover,rgba(0,0,0,0.07))]'}`}
            >
              All
            </button>
            {attentionCount > 0 ? (
              <button
                type="button"
                aria-label={`Filter roster to students needing attention, ${attentionCount}`}
                aria-pressed={attentionFilter === 'needs'}
                onClick={() => onAttentionFilterChange(attentionFilter === 'needs' ? 'all' : 'needs')}
                className={`sat-room__attention-filter min-h-11 rounded-full px-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${attentionFilter === 'needs' ? 'is-active' : ''}`}
              >
                <span>Needs attention</span>
                <span className="sat-room__attention-count">{attentionCount}</span>
              </button>
            ) : (
              <span className="sat-room__attention-filter is-empty min-h-11 rounded-full px-3 text-[14px] font-semibold">
                <span>Needs attention</span>
                <span className="sat-room__attention-count">0</span>
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
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
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
            <p className="mt-1.5 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              {students.length ? 'Change the search or the filter.' : 'Students appear here the moment they open their exam link.'}
            </p>
            {!students.length && onShareLink ? (
              <button
                type="button"
                onClick={onShareLink}
                className="mt-4 min-h-11 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-accent,#0071e3)] px-3.5 text-[14px] font-semibold text-white hover:bg-[var(--sat-staff-accent-hover,#0077ed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
              >
                Share student link
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
