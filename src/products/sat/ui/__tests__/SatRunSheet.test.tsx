import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExamPlanSection, ExamSessionRuntime } from '../../../../types/domain';
import { SatRunSheet } from '../SatRunSheet';

const START = '2026-09-20T02:00:00.000Z'; // 09:00 in Bangkok

const plan: ExamPlanSection[] = [
  {
    sectionKey: 'reading-writing',
    label: 'Reading & Writing',
    order: 0,
    durationMinutes: 64,
    gapAfterMinutes: 10,
    modules: [
      { moduleKey: 'rw-m1', title: 'Module 1', adaptiveRole: 'base', durationMinutes: 32 },
      { moduleKey: 'rw-m2-lower', title: 'Module 2 — Lower', adaptiveRole: 'lower_branch', durationMinutes: 32 },
      { moduleKey: 'rw-m2-higher', title: 'Module 2 — Higher', adaptiveRole: 'higher_branch', durationMinutes: 32 },
    ],
  },
  {
    sectionKey: 'math',
    label: 'Math',
    order: 1,
    durationMinutes: 70,
    gapAfterMinutes: 0,
    modules: [
      { moduleKey: 'math-m1', title: 'Module 1', adaptiveRole: 'base', durationMinutes: 35 },
      { moduleKey: 'math-m2-lower', title: 'Module 2 — Lower', adaptiveRole: 'lower_branch', durationMinutes: 35 },
      { moduleKey: 'math-m2-higher', title: 'Module 2 — Higher', adaptiveRole: 'higher_branch', durationMinutes: 35 },
    ],
  },
];

type RuntimePick = Pick<ExamSessionRuntime, 'sections' | 'actualStartAt' | 'status' | 'serverNow'>;

function runtimeWith(sections: ExamSessionRuntime['sections']): RuntimePick {
  return { sections, actualStartAt: START, status: 'live', serverNow: START };
}

// Before the proctor starts there is no runtime row at all: the sheet falls
// back to the scheduled start and says the windows are projections.
const preStartRuntime: RuntimePick = {
  sections: [],
  actualStartAt: null,
  status: 'not_started',
  serverNow: START,
};

describe('SatRunSheet', () => {
  it('renders every stage with its planned window in Thailand time', () => {
    render(<SatRunSheet plan={plan} runtime={preStartRuntime} scheduledStartAt={START} now={START} />);

    expect(screen.getByText('Run sheet')).toBeInTheDocument();
    expect(screen.getByText(/Thailand time · ICT \(UTC\+7\)/)).toBeInTheDocument();
    expect(screen.getByText('Section 1 · Reading & Writing')).toBeInTheDocument();
    expect(screen.getByText('Section 2 · Math')).toBeInTheDocument();
    // Module rows carry their authored window; both Module 2 alternatives are
    // visible with the same start because each student sits only one branch.
    expect(screen.getAllByText('Module 1')).toHaveLength(2);
    expect(screen.getAllByText('Module 2 · Lower')).toHaveLength(2);
    expect(screen.getAllByText('Module 2 · Higher')).toHaveLength(2);
    expect(screen.getAllByText('Alternative branch · 32′')).toHaveLength(2);
    expect(screen.getByText('09:00–09:32')).toBeInTheDocument();
    expect(screen.getAllByText('09:32–10:04')).toHaveLength(2);
    expect(screen.getByText('Break · 10 min')).toBeInTheDocument();
    expect(screen.getByText('10:04–10:14')).toBeInTheDocument();
    expect(screen.getByText('10:14–11:24')).toBeInTheDocument();
    // A projected run says so out loud.
    expect(screen.getByText(/Projected from the scheduled start at 09:00/)).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.getAllByText('Module 2 · Adaptive')).toHaveLength(2);
    expect(screen.getAllByText('One branch per student')).toHaveLength(2);
    expect(screen.queryByText('Scheduled start')).not.toBeInTheDocument();
    expect(screen.queryByText('Planned finish')).not.toBeInTheDocument();
  });

  it('labels the timing plan the rows describe', () => {
    const { unmount } = render(
      <SatRunSheet
        plan={plan}
        runtime={{ ...preStartRuntime, timingModel: 'sat_personal_v1' }}
        scheduledStartAt={START}
        now={START}
      />
    );

    // A proctor must be able to tell that these rows are a per-candidate plan
    // (full entry time) and not the room's own section clock.
    const pinned = document.querySelector('[data-sat-run-sheet-plan="sat_personal_v1"]');
    expect(pinned).not.toBeNull();
    expect(pinned).toHaveTextContent('Personal timing · full entry time');
    unmount();

    // A cohort runtime says so instead, and a runtime that does not state a plan
    // at all renders no plan line rather than defaulting to one.
    const cohort = render(
      <SatRunSheet
        plan={plan}
        runtime={{ ...preStartRuntime, timingModel: 'cohort_section_v3' }}
        scheduledStartAt={START}
        now={START}
      />
    );
    expect(
      document.querySelector('[data-sat-run-sheet-plan="cohort_section_v3"]')
    ).toHaveTextContent('Cohort timing · section clock');
    cohort.unmount();

    render(
      <SatRunSheet plan={plan} runtime={preStartRuntime} scheduledStartAt={START} now={START} />
    );
    expect(document.querySelector('[data-sat-run-sheet-plan]')).toBeNull();
  });

  it('keeps extension context while the run sheet presents stage rows', () => {
    render(
      <SatRunSheet
        plan={[plan[0]]}
        runtime={runtimeWith([{
          sectionKey: 'reading-writing' as ExamSessionRuntime['sections'][number]['sectionKey'],
          label: 'Reading & Writing',
          order: 0,
          plannedDurationMinutes: 64,
          gapAfterMinutes: 10,
          status: 'live',
          availableAt: null,
          actualStartAt: START,
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 5,
        }])}
        scheduledStartAt={START}
        now="2026-09-20T02:20:00.000Z"
      />
    );

    expect(document.querySelector('.sat-run-sheet__anchor')).toHaveTextContent('Anchored to the proctor');
    expect(screen.getByText(/Original finish 10:14 · \+5 min extension/)).toBeInTheDocument();
  });

  it('derives the original finish from the same runtime rows and separates extension and pause time', () => {
    render(
      <SatRunSheet
        plan={[plan[0]]}
        runtime={runtimeWith([{
          sectionKey: 'reading-writing' as ExamSessionRuntime['sections'][number]['sectionKey'],
          label: 'Reading & Writing',
          order: 0,
          plannedDurationMinutes: 70,
          gapAfterMinutes: 10,
          status: 'paused',
          availableAt: null,
          actualStartAt: START,
          actualEndAt: null,
          pausedAt: '2026-09-20T02:20:00.000Z',
          accumulatedPausedSeconds: 90,
          extensionMinutes: 5,
        }])}
        scheduledStartAt={START}
        now="2026-09-20T02:20:00.000Z"
      />
    );

    expect(screen.getByText(/Original finish 10:20 · \+5 min extension · 1 min 30 sec paused/)).toBeInTheDocument();
    expect(document.querySelector('[data-sat-run-sheet-row="section"]')).toHaveAttribute('data-runtime-mismatch', 'true');
  });

  it('uses runtime rows for the original finish when the authored plan is unavailable', () => {
    render(
      <SatRunSheet
        plan={null}
        runtime={runtimeWith([{
          sectionKey: 'reading-writing' as ExamSessionRuntime['sections'][number]['sectionKey'],
          label: 'Reading & Writing',
          order: 0,
          plannedDurationMinutes: 64,
          gapAfterMinutes: 10,
          status: 'live',
          availableAt: null,
          actualStartAt: START,
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 5,
        }])}
        scheduledStartAt={START}
        now="2026-09-20T02:20:00.000Z"
      />
    );

    expect(screen.getByText(/Original finish 10:14 · \+5 min extension/)).toBeInTheDocument();
  });

  it('marks the live stage and the module the cohort is inside', () => {
    render(
      <SatRunSheet
        plan={plan}
        runtime={runtimeWith([
          {
            sectionKey: 'reading-writing' as ExamSessionRuntime['sections'][number]['sectionKey'],
            label: 'Reading & Writing',
            order: 0,
            plannedDurationMinutes: 64,
            gapAfterMinutes: 10,
            status: 'live',
            availableAt: null,
            actualStartAt: START,
            actualEndAt: null,
            pausedAt: null,
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
          {
            sectionKey: 'math' as ExamSessionRuntime['sections'][number]['sectionKey'],
            label: 'Math',
            order: 1,
            plannedDurationMinutes: 70,
            gapAfterMinutes: 0,
            status: 'locked',
            availableAt: null,
            actualStartAt: null,
            actualEndAt: null,
            pausedAt: null,
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
        ])}
        scheduledStartAt={START}
        now="2026-09-20T02:20:00.000Z" // 09:20 ICT, inside Module 1
      />
    );

    // Section + Module 1 are live; both Module 2 alternatives, the break, and
    // every Math row (section, Module 1, both Module 2 alternatives) are ahead.
    expect(screen.getAllByText('Live')).toHaveLength(2);
    expect(screen.getAllByText('Upcoming')).toHaveLength(7);
    expect(screen.queryByText('Planned')).not.toBeInTheDocument();
    expect(screen.getByText(/Anchored to the proctor's start at 09:00/)).toBeInTheDocument();
  });

  it('renders nothing when there is no plan and no runtime section', () => {
    const { container } = render(<SatRunSheet plan={null} runtime={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  // The panel-level regression for the reported bug: the session's snapshot
  // still holds 105 minutes of Math while the plan says 70, read at 10:15 ICT.
  // Staff must see the clock the candidates are actually on — Math to 10:45,
  // the break still ahead — plus the divergence, not a 10:10 break that cannot
  // open and a Module 2 that "ended" twenty minutes ago.
  it('renders the runtime clock, not the plan, when the two disagree', () => {
    const mathOnly: ExamPlanSection[] = [{ ...plan[1], gapAfterMinutes: 10 }];
    render(
      <SatRunSheet
        plan={mathOnly}
        runtime={runtimeWith([
          {
            sectionKey: 'math' as ExamSessionRuntime['sections'][number]['sectionKey'],
            label: 'Math',
            order: 0,
            plannedDurationMinutes: 105,
            gapAfterMinutes: 10,
            status: 'live',
            availableAt: null,
            actualStartAt: START,
            actualEndAt: null,
            pausedAt: null,
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
        ])}
        scheduledStartAt={START}
        now="2026-09-20T03:15:00.000Z" // 10:15 ICT
      />
    );

    // The real remaining Math time: the section and the module the cohort is
    // inside both end at 10:45.
    expect(screen.getByText('09:00–10:45')).toBeInTheDocument();
    expect(screen.getAllByText('09:35–10:45')).toHaveLength(2);
    expect(screen.queryByText('09:00–10:10')).not.toBeInTheDocument();

    // No break at 10:10: it starts when Math actually ends.
    const breakRow = screen.getByText('Break · 10 min').closest('[data-sat-run-sheet-row]');
    expect(breakRow).toHaveTextContent('10:45–10:55');
    expect(breakRow).toHaveTextContent('Upcoming');
    expect(screen.queryByText('10:10–10:20')).not.toBeInTheDocument();

    // The divergence is on the row, not silent.
    const mismatchNote = screen.getByText('Clock 105 min · plan 70 min');
    expect(mismatchNote.closest('[data-sat-run-sheet-row]')).toHaveAttribute('data-runtime-mismatch', 'true');

    // …and a session whose runtime clock agrees with the plan carries no note.
    cleanup();
    render(
      <SatRunSheet
        plan={mathOnly}
        runtime={runtimeWith([
          {
            sectionKey: 'math' as ExamSessionRuntime['sections'][number]['sectionKey'],
            label: 'Math',
            order: 0,
            plannedDurationMinutes: 70,
            gapAfterMinutes: 10,
            status: 'live',
            availableAt: null,
            actualStartAt: START,
            actualEndAt: null,
            pausedAt: null,
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
        ])}
        scheduledStartAt={START}
        now="2026-09-20T03:15:00.000Z"
      />
    );
    expect(screen.queryByText(/Clock \d+ min/)).not.toBeInTheDocument();
    expect(screen.getByText('09:00–10:10')).toBeInTheDocument();
  });

  // When the clock is shorter than the plan's modules, the panel compresses
  // them onto the section window instead of claiming time the section does not
  // have — the audit's probe shape, rendered.
  it('compresses module rows onto a shorter clock and says so', () => {
    render(
      <SatRunSheet
        plan={[plan[0]]}
        runtime={runtimeWith([
          {
            sectionKey: 'reading-writing' as ExamSessionRuntime['sections'][number]['sectionKey'],
            label: 'Reading & Writing',
            order: 0,
            plannedDurationMinutes: 20,
            gapAfterMinutes: 10,
            status: 'live',
            availableAt: null,
            actualStartAt: START,
            actualEndAt: null,
            pausedAt: null,
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
        ])}
        scheduledStartAt={START}
        now={START}
      />
    );

    expect(screen.getByText('09:00–09:20')).toBeInTheDocument();
    expect(screen.getByText('09:00–09:10')).toBeInTheDocument();
    expect(screen.getAllByText('09:10–09:20')).toHaveLength(2);
    expect(screen.getByText('Clock 20 min · plan 64 min')).toBeInTheDocument();
    expect(screen.getAllByText('Plan 32 min · 10 min on the clock')).toHaveLength(3);
  });

  // The column the reported bug was about: the sheet named every stage but only
  // the section row ever counted anything down, so "how long does Module 1 have?"
  // was arithmetic across rows. Every live row now carries its own window's
  // remainder, read off the same server clock the candidates' timers use.
  it('counts down the section and the module the room is inside, and nothing else', () => {
    render(
      <SatRunSheet
        plan={plan}
        runtime={runtimeWith([
          {
            sectionKey: 'reading-writing' as ExamSessionRuntime['sections'][number]['sectionKey'],
            label: 'Reading & Writing',
            order: 0,
            plannedDurationMinutes: 64,
            gapAfterMinutes: 10,
            status: 'live',
            availableAt: null,
            actualStartAt: START,
            actualEndAt: null,
            pausedAt: null,
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
          {
            sectionKey: 'math' as ExamSessionRuntime['sections'][number]['sectionKey'],
            label: 'Math',
            order: 1,
            plannedDurationMinutes: 70,
            gapAfterMinutes: 0,
            status: 'locked',
            availableAt: null,
            actualStartAt: null,
            actualEndAt: null,
            pausedAt: null,
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
        ])}
        scheduledStartAt={START}
        now="2026-09-20T02:20:00.000Z" // 09:20 ICT, inside Module 1
      />
    );

    expect(screen.getAllByText('Remaining')).toHaveLength(2);
    // Section 09:00–10:04 has 44 minutes left at 09:20; Module 1 09:00–09:32 has 12.
    expect(screen.getByText('44:00')).toBeInTheDocument();
    expect(screen.getByText('12:00')).toBeInTheDocument();

    // Nine rows for this plan (section + Module 1 + two Module 2 alternatives
    // + break for Reading & Writing, then section + three modules for Math), and only
    // the two the room is inside have a running window: everything else reads as
    // no window at all rather than a 0:00 that would look live.
    const cells = Array.from(document.querySelectorAll('[data-sat-run-sheet-remaining]'));
    expect(cells).toHaveLength(9);
    expect(cells.filter((cell) => cell.textContent === '—')).toHaveLength(7);
  });

  // A paused room keeps the window the pause landed on: the candidates' own
  // clocks are frozen, so the clock staff read must freeze with them.
  it('freezes every running clock while the room is paused', () => {
    render(
      <SatRunSheet
        plan={[plan[0]]}
        runtime={runtimeWith([
          {
            sectionKey: 'reading-writing' as ExamSessionRuntime['sections'][number]['sectionKey'],
            label: 'Reading & Writing',
            order: 0,
            plannedDurationMinutes: 64,
            gapAfterMinutes: 10,
            status: 'paused',
            availableAt: null,
            actualStartAt: START,
            actualEndAt: null,
            pausedAt: '2026-09-20T02:20:00.000Z', // 09:20 ICT
            accumulatedPausedSeconds: 0,
            extensionMinutes: 0,
          },
        ])}
        scheduledStartAt={START}
        now="2026-09-20T03:00:00.000Z" // 10:00 ICT, 40 minutes after the pause
      />
    );

    // The windows the pause landed on, not what the wall clock would say now —
    // and the pause landed during Module 1 (44 minutes left of the section, 12
    // of the module), not in the Module 2 the room had not reached yet.
    expect(screen.getByText('44:00')).toBeInTheDocument();
    expect(screen.getByText('12:00')).toBeInTheDocument();
    expect(screen.getAllByText('Paused')).toHaveLength(2);
    const moduleRow = document.querySelector('[data-sat-run-sheet-row="module"]');
    expect(moduleRow).toHaveAttribute('data-sat-run-sheet-status', 'paused');
    expect(moduleRow).toHaveTextContent('Module 1');
  });
});
