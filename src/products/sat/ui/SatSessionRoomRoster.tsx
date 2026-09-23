import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { ServerClockSnapshot } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { SatSearchField } from './SatPage';
import { SatRoomStudentRow } from './SatSessionRoomStudents';

type AttentionFilter = 'all' | 'needs';

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
  onSelect,
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
  onSelect: (studentId: string, trigger: HTMLElement) => void;
}) {
  const activeStudent = visibleStudents.find((student) => student.id === selectedStudent?.id) ?? null;

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
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Roster filter">
          <button
            type="button"
            aria-pressed={attentionFilter === 'all'}
            onClick={() => onAttentionFilterChange('all')}
            className={`min-h-8 rounded-full px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${attentionFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip-hover,rgba(0,0,0,0.07))]'}`}
          >
            All
          </button>
          {attentionCount > 0 ? (
            <button
              type="button"
              aria-label={`Filter roster to students needing attention, ${attentionCount}`}
              aria-pressed={attentionFilter === 'needs'}
              onClick={() => onAttentionFilterChange(attentionFilter === 'needs' ? 'all' : 'needs')}
              className={`sat-room__attention-filter min-h-8 rounded-full px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${attentionFilter === 'needs' ? 'is-active' : ''}`}
            >
              <span>Needs attention</span>
              <span className="sat-room__attention-count">{attentionCount}</span>
            </button>
          ) : (
            <span className="sat-room__attention-filter is-empty min-h-8 rounded-full px-3 text-[12px] font-semibold">
              <span>Needs attention</span>
              <span className="sat-room__attention-count">0</span>
            </span>
          )}
        </div>
      </div>
      <div
        role="listbox"
        aria-label="Students in this session. Use arrow keys to move between students."
        aria-activedescendant={activeStudent ? `sat-room-student-${activeStudent.id}` : undefined}
        tabIndex={visibleStudents.length ? 0 : -1}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const current = visibleStudents.findIndex((student) => student.id === selectedStudent?.id);
          const nextIndex = event.key === 'ArrowDown'
            ? Math.min(current + 1, visibleStudents.length - 1)
            : Math.max(current < 0 ? 0 : current - 1, 0);
          const next = visibleStudents[nextIndex];
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
        {visibleStudents.length ? visibleStudents.map((student) => (
          <SatRoomStudentRow
            key={student.id}
            student={student}
            runtime={runtime}
            roomClock={roomClock}
            selected={selectedStudent?.id === student.id}
            onSelect={(trigger) => onSelect(student.id, trigger)}
          />
        )) : (
          <div className="px-6 py-12 text-center">
            <p className="text-[13px] font-semibold text-[var(--sat-staff-text-secondary,#515154)]">
              {students.length ? 'No matching students.' : 'No students have joined yet.'}
            </p>
            <p className="mt-1.5 text-[12px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
              {students.length ? 'Change the search or the filter.' : 'Students appear here the moment they open their exam link.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
