import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatResultDetailRoute } from '../SatResultDetailRoute';
import { SatResultsRoute } from '../SatResultsRoute';

const useSatResultsQueryMock = vi.hoisted(() => vi.fn());
const useSatResultQueryMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/results/api/satResultsQueries', () => ({
  useSatResultsQuery: useSatResultsQueryMock,
  useSatResultQuery: useSatResultQueryMock,
}));

const summary = {
  id: 'result-1', submissionId: 'submission-1', scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06',
  versionNumber: 3, studentId: 'W2501', studentName: 'Ananda S.', studentEmail: null, cohortName: 'Morning',
  submittedAt: '2026-08-30T08:00:00Z', totalScore: 1370, scoreKind: 'practice', releaseStatus: 'ready_to_release', outcomeStatus: 'scored',
};

// Wave 4 drill-down fixtures (phase-04 §5 Step 1, normative names). Every row is
// SatResultSummary-shaped via { ...summary, ...overrides }; domain order is
// latestSubmittedAt desc, so submittedAt values below fix the rendered order.
const groupedFixture = [
  { ...summary, id: 'r-a1', examId: 'sat-A', examTitle: 'Practice Test 06', studentId: 'W2501', studentName: 'Ananda S.', outcomeStatus: 'scored', totalScore: 1370, submittedAt: '2026-08-30T08:00:00Z' },
  { ...summary, id: 'r-a2', examId: 'sat-A', examTitle: 'Practice Test 06', studentId: 'W2502', studentName: 'Bima R.', outcomeStatus: 'pending', totalScore: null, submittedAt: '2026-08-29T08:00:00Z' },
  { ...summary, id: 'r-b1', examId: 'sat-B', examTitle: 'Practice Test 07', studentId: 'W2503', studentName: 'Citra D.', outcomeStatus: 'invalidated_proctor', totalScore: null, submittedAt: '2026-08-28T08:00:00Z' },
];
const duplicateTitleFixture = [
  { ...summary, id: 'r-c1', examId: 'sat-C', examTitle: 'Practice Test 06', studentId: 'W2504', studentName: 'Eka P.', outcomeStatus: 'scored', totalScore: 1200, submittedAt: '2026-08-30T08:00:00Z' },
  { ...summary, id: 'r-d1', examId: 'sat-D', examTitle: 'Practice Test 06', studentId: 'W2505', studentName: 'Farah Q.', outcomeStatus: 'scored', totalScore: 1100, submittedAt: '2026-08-29T08:00:00Z' },
];
const invalidatedOnlyFixture = [
  { ...summary, id: 'r-e1', examId: 'sat-E', examTitle: 'Practice Test 08', studentId: 'W2506', studentName: 'Gilang H.', outcomeStatus: 'invalidated_proctor', totalScore: null, submittedAt: '2026-08-30T08:00:00Z' },
  { ...summary, id: 'r-e2', examId: 'sat-E', examTitle: 'Practice Test 08', studentId: 'W2507', studentName: 'Hana I.', outcomeStatus: 'invalidated_proctor', totalScore: null, submittedAt: '2026-08-29T08:00:00Z' },
];
const mixedGroupFixture = [
  { ...summary, id: 'r-g1', examId: 'sat-G', examTitle: 'Practice Test 09', studentId: 'W2501', studentName: 'Ananda S.', outcomeStatus: 'scored', totalScore: 1370, submittedAt: '2026-08-30T08:00:00Z' },
  { ...summary, id: 'r-g2', examId: 'sat-G', examTitle: 'Practice Test 09', studentId: 'W2502', studentName: 'Bima R.', outcomeStatus: 'invalidated_proctor', totalScore: null, submittedAt: '2026-08-29T08:00:00Z' },
];

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="test-location">{location.pathname + location.search}</span>;
}

function renderResultsRoute(initialEntry = '/sat/results') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/sat/results" element={<SatResultsRoute />} />
        <Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SAT Results product', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists one group row per exam with no student names before drill-down', () => {
    // Drill-down addendum §6(1): the list shows N group rows per examId, never
    // flat student rows. Absorbs the legacy no-IELTS-band guard at list level.
    useSatResultsQueryMock.mockReturnValue({ data: groupedFixture, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    const { container } = renderResultsRoute();
    expect(screen.getByText('Practice Test 06')).toBeInTheDocument();
    expect(screen.getByText('Practice Test 07')).toBeInTheDocument();
    expect(container.querySelectorAll('.sat-list-row')).toHaveLength(2);
    expect(screen.queryByText('Ananda S.')).not.toBeInTheDocument();
    expect(screen.queryByText('Bima R.')).not.toBeInTheDocument();
    expect(screen.queryByText('Citra D.')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 exams');
    expect(screen.queryByText(/overall band/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/6\.5/)).not.toBeInTheDocument();
  });

  it('renders header plus skeleton while loading, without blanking the page', () => {
    useSatResultsQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Results')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading SAT results' })).toBeInTheDocument();
  });

  it('opens the inside page on group click with ?exam=, header, students and count', () => {
    // Drill-down addendum §6(2) + Step-8 hierarchy sweep on the revealed rows.
    useSatResultsQueryMock.mockReturnValue({ data: groupedFixture, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    const { container } = renderResultsRoute();
    fireEvent.click(screen.getByRole('button', { name: /Practice Test 06/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-A');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Practice Test 06');
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    expect(screen.getByText('Bima R.')).toBeInTheDocument();
    expect(screen.queryByText('Citra D.')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 students');
    // Focus moves to the inside entry control (Wave 3 addendum §5: the drill
    // unmounts the clicked row, so focus would otherwise fall to <body>).
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Back to SAT results');
    // 04A hierarchy guard, now on an inside attempt row: 13px name, 10px
    // tabular-nums metas, 17px tabular-nums score, no gradient/blur surfaces.
    const row = screen.getByText('Ananda S.').closest('.sat-list-row');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('W2501');
    expect(row).toHaveTextContent('Morning');
    expect(row).toHaveTextContent('Practice Test 06');
    const score = screen.getByText('1370');
    expect(score.className).toMatch(/tabular-nums/);
    expect(score.className).toMatch(/17px/);
    expect(score.closest('.sat-list-row')).not.toBeNull();
    const tabularMetas = row?.querySelectorAll('.tabular-nums') ?? [];
    expect(tabularMetas.length).toBeGreaterThanOrEqual(2);
    expect(container.innerHTML).not.toMatch(/bg-gradient|backdrop-blur/);
  });

  it('returns to the exam list from the inside Back button', () => {
    // Drill-down addendum §6(3): Back restores the list view.
    useSatResultsQueryMock.mockReturnValue({ data: groupedFixture, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    renderResultsRoute();
    fireEvent.click(screen.getByRole('button', { name: /Practice Test 06/ }));
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results');
    expect(screen.getByText('Practice Test 06')).toBeInTheDocument();
    expect(screen.getByText('Practice Test 07')).toBeInTheDocument();
    expect(screen.queryByText('Ananda S.')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 exams');
    // Focus returns to the list entry control (Wave 3 addendum §5).
    expect(document.activeElement?.id).toBe('sat-results-search');
  });

  it('keeps duplicate exam titles with distinct examIds as separate groups', () => {
    // Drill-down addendum §6(4): the grouping key is examId, never examTitle.
    useSatResultsQueryMock.mockReturnValue({ data: duplicateTitleFixture, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    renderResultsRoute();
    expect(screen.getAllByText('Practice Test 06')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('2 exams');
    const groupButtons = screen.getAllByRole('button', { name: /Practice Test 06/ });
    expect(groupButtons).toHaveLength(2);
    fireEvent.click(groupButtons[0] as HTMLElement);
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-C');
    expect(screen.getByText('Eka P.')).toBeInTheDocument();
    expect(screen.queryByText('Farah Q.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Practice Test 06/ })[1] as HTMLElement);
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-D');
    expect(screen.getByText('Farah Q.')).toBeInTheDocument();
    expect(screen.queryByText('Eka P.')).not.toBeInTheDocument();
  });

  it('drills into an invalidated-only group with dash scores and never 0', () => {
    // Drill-down addendum §6(5): an invalidated-only group drills fine; null
    // scores render as dashes, never 0. Absorbs the legacy
    // termination-vs-missing-score guard (no Practice caption leaks here).
    useSatResultsQueryMock.mockReturnValue({ data: invalidatedOnlyFixture, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    const { container } = renderResultsRoute();
    expect(container.querySelectorAll('.sat-list-row')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('1 exam');
    fireEvent.click(screen.getByRole('button', { name: /Practice Test 08/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-E');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Practice Test 08');
    expect(screen.getAllByText('Exam terminated by proctor')).toHaveLength(2);
    expect(screen.queryByText('Practice')).not.toBeInTheDocument();
    for (const name of ['Gilang H.', 'Hana I.']) {
      const row = screen.getByText(name).closest('.sat-list-row');
      expect(row).not.toBeNull();
      // First child of the right column is the score block: dash, never 0.
      expect(row?.querySelector('span.text-right > span')?.textContent).toBe('—');
    }
  });

  it('narrows exams on the list and students inside, with Clear restoring focus', () => {
    // Drill-down addendum §6(6): list search is exam-title-only; student/cohort
    // matching plus the availability radios live inside. Absorbs the legacy
    // score-filter/empty-match and filter-zero announcer guards.
    useSatResultsQueryMock.mockReturnValue({ data: groupedFixture, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    renderResultsRoute();
    // No availability radios on the list: per-attempt filtering has no meaning
    // on exam rows.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    // A student name matches no exam title, so the list goes empty (EXAMS only).
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exams' }), { target: { value: 'Ananda' } });
    expect(screen.getByText('No matching SAT exams')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 of 2 exams');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
    expect(screen.getByText('Practice Test 06')).toBeInTheDocument();
    expect(screen.getByText('Practice Test 07')).toBeInTheDocument();
    expect(document.activeElement?.id).toBe('sat-results-search');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exams' }), { target: { value: 'Test 07' } });
    expect(screen.queryByText('Practice Test 06')).not.toBeInTheDocument();
    expect(screen.getByText('Practice Test 07')).toBeInTheDocument();
    // Singular itemLabel when one group is visible (route passes 'exam').
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 exam');
    // Non-empty list has no empty-state Clear action: reset via the field.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exams' }), { target: { value: '' } });
    // Inside: the student search narrows STUDENTS with an X-of-Y count.
    fireEvent.click(screen.getByRole('button', { name: /Practice Test 06/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search students' }), { target: { value: 'bima' } });
    expect(screen.queryByText('Ananda S.')).not.toBeInTheDocument();
    expect(screen.getByText('Bima R.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 students');
    // Escape clears the student search.
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search students' }), { key: 'Escape' });
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    expect(screen.getByText('Bima R.')).toBeInTheDocument();
    // Inside radios drop non-matching students.
    fireEvent.click(screen.getByRole('radio', { name: 'Score unavailable' }));
    expect(screen.queryByText('Ananda S.')).not.toBeInTheDocument();
    expect(screen.getByText('Bima R.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Score available' }));
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    expect(screen.queryByText('Bima R.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    // Filter-zero keeps the announcer mounted next to the empty state.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search students' }), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No matching students')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 of 2 students');
    // Clear restores the full roster and refocuses the search field.
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    expect(screen.getByText('Bima R.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 students');
    expect(document.activeElement?.id).toBe('sat-results-student-search');
  });

  it('never masks scored totals with an invalidated pill in a mixed group', () => {
    // Drill-down addendum §6(7) + Step-8 single-pill sweep on inside rows:
    // the scored row keeps its score + Practice pill, the invalidated row
    // keeps its pill, and the header roll-up is ready (never invalidated).
    useSatResultsQueryMock.mockReturnValue({ data: mixedGroupFixture, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    const { container } = renderResultsRoute();
    expect(screen.getByText('Practice')).toBeInTheDocument();
    expect(screen.queryByText('Not scored')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Practice Test 09/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-G');
    const scoredRow = screen.getByText('Ananda S.').closest('.sat-list-row');
    expect(scoredRow).toHaveTextContent('1370');
    expect(scoredRow).toHaveTextContent('Practice');
    const invalidatedRow = screen.getByText('Bima R.').closest('.sat-list-row');
    expect(invalidatedRow).toHaveTextContent('Exam terminated by proctor');
    expect(invalidatedRow?.querySelector('span.text-right > span')?.textContent).toBe('—');
    // Exactly one status signal per row: one pill frame + its dot per row, and
    // no duplicate 'outcome · Practice · releaseStatus' caption anywhere.
    for (const row of Array.from(container.querySelectorAll('.sat-list-row'))) {
      expect(row.querySelectorAll('span.rounded-full')).toHaveLength(2);
    }
    expect(screen.queryByText(/· Practice ·/)).not.toBeInTheDocument();
    expect(screen.queryByText('Not scored')).not.toBeInTheDocument();
  });

  it('exposes a single status signal per row without a duplicate release-status caption', () => {
    useSatResultsQueryMock.mockReturnValue({ data: [summary], isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Practice')).toBeInTheDocument();
    expect(screen.queryByText('Practice · Practice · ready_to_release')).not.toBeInTheDocument();
    expect(screen.queryByText(/· Practice ·/)).not.toBeInTheDocument();
  });

  it('shows a subtle updating cue while refetching loaded results', () => {
    useSatResultsQueryMock.mockReturnValue({ data: [summary], isLoading: false, error: null, isFetching: true, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Updating…')).toBeInTheDocument();
  });

  it('labels the back control with its destination', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Back to SAT results' })).toBeInTheDocument();
  });

  it('shows a retryable detail error instead of treating a failed response query as empty', () => {
    const refetch = vi.fn();
    useSatResultQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('load SAT question responses: database unavailable'),
      isFetching: false,
      refetch,
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('Could not load response details. Retry to try again.')).toBeInTheDocument();
    expect(screen.queryByText('No question-level responses recorded for this result.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('shows the hero basis caption with release status on the detail page', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('Scaled practice score · Practice · ready_to_release')).toBeInTheDocument();
    // Policy footnote stays pinned below the question sections.
    expect(screen.getByText(/generated by this practice assessment system/i)).toBeInTheDocument();
  });

  it('renders the static detail outcome without a redundant live region', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary: { ...summary, outcomeStatus: 'pending', totalScore: null }, scorePayload: {}, sections: [], questions: [],
      },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    const outcome = screen.getByText(/No score was produced for this attempt\./);
    expect(outcome).toBeInTheDocument();
    expect(outcome).not.toHaveAttribute('role');
  });

  it('falls back to truthful raw score when no scaled total exists', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary: { ...summary, totalScore: null }, scorePayload: {},
        sections: [
          { sectionKey: 'reading-writing', route: 'higher', rawCorrect: 30, operationalQuestionCount: 34, scaledScore: null, details: {}, modules: [] },
          { sectionKey: 'math', route: null, rawCorrect: 12, operationalQuestionCount: 20, scaledScore: null, details: {}, modules: [] },
        ],
        questions: [],
      }, isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('42/54')).toBeInTheDocument();
    expect(screen.getByText('Raw correct 42/54 — scaled score unavailable · Practice · ready_to_release')).toBeInTheDocument();
    expect(screen.getByText('Reading & Writing')).toBeInTheDocument();
    expect(screen.getByText('Math')).toBeInTheDocument();
    expect(screen.getByText('Adaptive route · Higher')).toBeInTheDocument();
  });

  it('shows module raw scores and question-level responses without fabricating verdicts', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary, scorePayload: {},
        sections: [
          {
            sectionKey: 'reading-writing', route: 'higher', rawCorrect: 20, operationalQuestionCount: 34,
            scaledScore: 680, details: {},
            modules: [
              { moduleKey: 'rw-base', adaptiveRole: 'base', rawCorrect: 12, operationalQuestionCount: 20, state: 'submitted', isAdministered: true, displayOrder: 1 },
              { moduleKey: 'rw-higher', adaptiveRole: 'higher_branch', rawCorrect: 8, operationalQuestionCount: 14, state: 'submitted', isAdministered: true, displayOrder: 2 },
            ],
          },
        ],
        questions: [
          { questionId: 'q-ok', displayOrder: 1, moduleKey: 'rw-base', sectionKey: 'reading-writing', response: 'B', correctAnswer: 'B', isCorrect: true, isPretest: false, markedForReview: false },
          { questionId: 'q-wrong', displayOrder: 2, moduleKey: 'rw-base', sectionKey: 'reading-writing', response: 'A', correctAnswer: 'B', isCorrect: false, isPretest: false, markedForReview: true },
          { questionId: 'q-pre', displayOrder: 3, moduleKey: 'rw-base', sectionKey: 'reading-writing', response: 'B', correctAnswer: 'B', isCorrect: null, isPretest: true, markedForReview: false },
          { questionId: 'q-blank', displayOrder: 4, moduleKey: 'rw-base', sectionKey: 'reading-writing', response: null, correctAnswer: 'B', isCorrect: null, isPretest: false, markedForReview: false },
        ],
      }, isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    // Module raw scores and question-level responses render by default (no toggles).
    expect(screen.getByText('rw-base')).toBeInTheDocument();
    expect(screen.getByText('12 / 20')).toBeInTheDocument();
    expect(screen.getByText('q-ok · rw-base')).toBeInTheDocument();
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByText('Incorrect')).toBeInTheDocument();
    expect(screen.getByText('Pretest · excluded')).toBeInTheDocument();
    // A null verdict never renders as incorrect: one Correct + one Incorrect only.
    expect(screen.getAllByText('Not scored')).toHaveLength(2);
  });

  it('keeps the hero score on tabular-nums', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('1370')).toHaveClass('tabular-nums');
  });

  it('caps the performance stagger index at 5', () => {
    const sections = Array.from({ length: 7 }, (_, i) => ({
      sectionKey: `section-${i}`, route: null, rawCorrect: 1, operationalQuestionCount: 2, scaledScore: 100, details: {}, modules: [],
    }));
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections, questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    const cards = document.querySelectorAll('.sat-row-enter');
    expect(cards).toHaveLength(7);
    // Row-index custom property caps at 5: the 7th card still carries index 5.
    cards.forEach((card, cardIndex) => {
      expect((card as HTMLElement).style.getPropertyValue('--sat-row-index')).toBe(String(Math.min(cardIndex, 5)));
    });
  });

  it('names the module dl and omits the jargon identifier note', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary, scorePayload: {},
        sections: [
          {
            sectionKey: 'reading-writing', route: null, rawCorrect: 20, operationalQuestionCount: 34,
            scaledScore: 680, details: {},
            modules: [
              { moduleKey: 'rw-base', adaptiveRole: 'base', rawCorrect: 12, operationalQuestionCount: 20, state: 'submitted', isAdministered: true, displayOrder: 1 },
            ],
          },
          {
            sectionKey: 'math', route: null, rawCorrect: 10, operationalQuestionCount: 20,
            scaledScore: 650, details: {},
            modules: [
              { moduleKey: 'm-base', adaptiveRole: 'base', rawCorrect: 10, operationalQuestionCount: 20, state: 'submitted', isAdministered: true, displayOrder: 1 },
            ],
          },
        ],
        questions: [],
      }, isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    // Module dl carries an accessible name ending in 'module raw scores'.
    // Phase 02 deleted the jargon footnote 'Module identifiers as delivered.'.
    expect(screen.getByLabelText('Reading & Writing module raw scores')).toBeInTheDocument();
    expect(screen.queryByText('Module identifiers as delivered.')).not.toBeInTheDocument();
  });

  it('shows the empty questions state and hides the section on unscored results', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections: [{ sectionKey: 'reading-writing', route: null, rawCorrect: 0, operationalQuestionCount: 0, scaledScore: null, details: {}, modules: [] }], questions: [] },
      isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('No question-level responses recorded for this result.')).toBeInTheDocument();
  });

  it('renders no Question-level responses section on unscored results', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary: { ...summary, outcomeStatus: 'pending', totalScore: null }, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-2']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.queryByText(/Question-level responses/)).not.toBeInTheDocument();
  });

  it('lands Back on the inside page for a results from-state and falls back on hostile states', () => {
    // Addendum §4: detail Back honors location.state.from only when it starts
    // with '/sat/results'; hostile values fall back to '/sat/results'.
    const detailData = { summary, scorePayload: {}, sections: [], questions: [] };
    const resultsTree = (
      <>
        <LocationProbe />
        <Routes>
          <Route path="/sat/results" element={<SatResultsRoute />} />
          <Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} />
        </Routes>
      </>
    );
    useSatResultQueryMock.mockReturnValue({ data: detailData, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    useSatResultsQueryMock.mockReturnValue({ data: groupedFixture, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    const trusted = render(
      <MemoryRouter initialEntries={[{ pathname: '/sat/results/result-1', state: { from: '/sat/results?exam=sat-A' } }]}>
        {resultsTree}
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-A');
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    trusted.unmount();
    const hostileAbsolute = render(
      <MemoryRouter initialEntries={[{ pathname: '/sat/results/result-1', state: { from: 'https://evil.example/phish' } }]}>
        {resultsTree}
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results');
    expect(screen.getByText('Practice Test 06')).toBeInTheDocument();
    hostileAbsolute.unmount();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/sat/results/result-1', state: { from: '/admin/users' } }]}>
        {resultsTree}
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results');
  });
});
