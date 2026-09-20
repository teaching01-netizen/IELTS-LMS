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
    // Module rows carry their authored window; the Module 2 slot shows both
    // branch lengths because only one of them is sat.
    expect(screen.getAllByText('Module 1')).toHaveLength(2);
    expect(screen.getByText('Lower 32′ · Higher 32′')).toBeInTheDocument();
    expect(screen.getByText('09:00–09:32')).toBeInTheDocument();
    expect(screen.getByText('09:32–10:04')).toBeInTheDocument();
    expect(screen.getByText('Break · 10 min')).toBeInTheDocument();
    expect(screen.getByText('10:04–10:14')).toBeInTheDocument();
    expect(screen.getByText('10:14–11:24')).toBeInTheDocument();
    // A projected run says so out loud.
    expect(screen.getByText(/Projected from the scheduled start at 09:00/)).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
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

    // Section + Module 1 are live; Module 2, the break, and every Math row
    // (section, Module 1, Module 2) are still ahead.
    expect(screen.getAllByText('Live')).toHaveLength(2);
    expect(screen.getAllByText('Upcoming')).toHaveLength(5);
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
    expect(screen.getByText('09:35–10:45')).toBeInTheDocument();
    expect(screen.queryByText('09:00–10:10')).not.toBeInTheDocument();

    // No break at 10:10: it starts when Math actually ends.
    const breakRow = screen.getByText('Break · 10 min').closest('tr');
    expect(breakRow).toHaveTextContent('10:45–10:55');
    expect(breakRow).toHaveTextContent('Upcoming');
    expect(screen.queryByText('10:10–10:20')).not.toBeInTheDocument();

    // The divergence is on the row, not silent.
    const mismatchNote = screen.getByText('Clock 105 min · plan 70 min');
    expect(mismatchNote.closest('tr')).toHaveAttribute('data-runtime-mismatch', 'true');

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
    expect(screen.getByText('09:10–09:20')).toBeInTheDocument();
    expect(screen.getByText('Clock 20 min · plan 64 min')).toBeInTheDocument();
    expect(screen.getAllByText('Plan 32 min · 10 min on the clock')).toHaveLength(2);
  });
});
