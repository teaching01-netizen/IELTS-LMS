import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SatPageError } from '../ui/SatPage';
import { useSatResultsQuery } from '../../../features/results/api/satResultsQueries';
import {
  filterSatGroups,
  groupSatResults,
  type SatExamGroup,
  type SatScoreFilter,
} from '../../../features/results/domain/satResultsGroups';
import {
  SatContainer,
  SatEmptyState,
  SatList,
  SatListSkeleton,
  SatPageHeader,
  SatPrimaryButton,
  SatResultCount,
  SatSearchField,
  SatStatStrip,
  SatStatusPill,
} from '../ui/SatPage';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import {
  SatExamAttemptRow,
  SatExamGroupRow,
  aggregateLineFor,
  recencyLineFor,
  rollupFor,
  rollupLabelFor,
  rollupToneFor,
  versionLineFor,
} from './SatExamGroupSection';

export function SatResultsRoute() {
  const navigate = useNavigate();
  const query = useSatResultsQuery();
  const [searchParams] = useSearchParams();
  const examIdParam = (searchParams.get('exam') ?? '').trim();

  const [examSearch, setExamSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState<SatScoreFilter>('all');

  // Wave 3 hardening (addendum §5): drill-down navigation unmounts the activated
  // control, so focus would fall to <body>. Keep focus visible by moving it to the
  // next view's stable entry control — Back on the inside page, exam search on the
  // list — on view transitions only, never on first mount (deep links keep focus).
  // Targets are natively focusable (no primitive edits needed for tabIndex).
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const insideView = examIdParam.length > 0;
  const prevInsideViewRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevInsideViewRef.current;
    prevInsideViewRef.current = insideView;
    if (prev === null || prev === insideView) return;
    if (insideView) backButtonRef.current?.focus();
    else document.getElementById('sat-results-search')?.focus();
  }, [insideView]);

  const allGroups = useMemo(
    () => groupSatResults(query.data ?? []),
    [query.data],
  );
  const summary = useMemo(() => {
    const rows = query.data ?? [];
    const scored = rows.filter((result) => result.outcomeStatus === 'scored' && result.totalScore != null).length;
    return { exams: allGroups.length, attempts: rows.length, scored };
  }, [query.data, allGroups.length]);

  const examNeedle = examSearch.trim().toLocaleLowerCase();
  const listGroups = useMemo(
    () => (examNeedle ? allGroups.filter((group) => group.examTitle.toLocaleLowerCase().includes(examNeedle)) : allGroups),
    [allGroups, examNeedle],
  );

  const selectedGroup: SatExamGroup | null = examIdParam
    ? (allGroups.find((group) => group.examId === examIdParam) ?? null)
    : null;

  const inside = useMemo(() => {
    if (!selectedGroup) return null;
    const filtered = filterSatGroups([selectedGroup], { needle: studentSearch, scoreFilter });
    return { group: selectedGroup, visibleAttempts: filtered[0]?.visibleAttempts ?? [] };
  }, [selectedGroup, studentSearch, scoreFilter]);

  if (query.error) return <SatPageError title="SAT results could not load" description={query.error instanceof Error ? query.error.message : 'Results are unavailable.'} retryLabel="Retry" onRetry={() => void query.refetch()} />;

  const stats = [
    { id: 'exams', label: 'Exams', value: summary.exams },
    { id: 'attempts', label: 'Attempts', value: summary.attempts },
    { id: 'scored', label: 'Scored', value: summary.scored },
  ];

  const backToList = (
    <button
      type="button"
      ref={backButtonRef}
      onClick={() => navigate('/sat/results')}
      aria-label="Back to SAT results"
      className="-ml-2 flex min-h-10 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] px-2 text-[12px] font-semibold text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] hover:text-[var(--sat-staff-text-primary,#1d1d1f)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
    >
      <ArrowLeft size={15} aria-hidden="true" />Back to Results
    </button>
  );

  if (examIdParam) {
    if (query.isLoading) {
      return (
        <SatContainer>
          {backToList}
          <SatListSkeleton rows={5} label="Loading SAT results" />
        </SatContainer>
      );
    }
    if (!inside) {
      return (
        <SatContainer>
          {backToList}
          <SatEmptyState
            icon={<BarChart3 size={18} aria-hidden="true" />}
            title="Exam not found"
            hint="This exam link looks invalid or the exam has no results. Go back and choose another exam."
          />
        </SatContainer>
      );
    }
    const { group, visibleAttempts } = inside;
    const versionLine = versionLineFor(group.versions);
    const rollup = rollupFor(group);
    const fromPath = '/sat/results?exam=' + encodeURIComponent(group.examId);
    return (
      <SatContainer>
        {backToList}
        <SatPageHeader
          eyebrow="Digital SAT"
          title={group.examTitle}
          description={aggregateLineFor(group)}
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[11px] tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">{versionLine ? versionLine + ' · ' : ''}{recencyLineFor(group)}</p>
          <SatStatusPill tone={rollupToneFor(rollup)}>{rollupLabelFor(rollup)}</SatStatusPill>
        </div>
        <SatStatStrip label="Results summary" stats={stats} />
        <SatSearchField
          id="sat-results-student-search"
          label="Search students"
          value={studentSearch}
          onChange={setStudentSearch}
          placeholder="Search name, ID, cohort"
          widthClassName="mt-5 w-full sm:max-w-[420px]"
        />
        <SatSegmentedControl<typeof scoreFilter>
          label="Score availability"
          value={scoreFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'available', label: 'Score available' },
            { value: 'unavailable', label: 'Score unavailable' },
          ]}
          onChange={setScoreFilter}
          className="mt-3 max-w-[420px]"
        />
        {visibleAttempts.length ? (
          <>
          <div className="flex items-center gap-2">
            <SatResultCount total={group.attempts.length} visible={visibleAttempts.length} itemLabel="students" />
            {query.isFetching && !query.isLoading ? <span className="text-[11px] text-slate-400">Updating…</span> : null}
          </div>
          <SatList>
            {visibleAttempts.map((attempt, attemptIndex) => (
              <SatExamAttemptRow key={attempt.id} attempt={attempt} attemptIndex={attemptIndex} onOpen={(attemptId) => navigate('/sat/results/' + attemptId, { state: { from: fromPath } })} />
            ))}
          </SatList>
          </>
        ) : (
          <>
            <SatResultCount total={group.attempts.length} visible={0} itemLabel="students" />
            <SatEmptyState
              icon={<BarChart3 size={18} aria-hidden="true" />}
              title="No matching students"
              hint="Try another search or score-availability filter."
              action={<SatPrimaryButton onClick={() => { setStudentSearch(''); setScoreFilter('all'); document.getElementById('sat-results-student-search')?.focus(); }}>Clear Search</SatPrimaryButton>}
            />
          </>
        )}
      </SatContainer>
    );
  }

  return (
    <SatContainer>
      <SatPageHeader
        eyebrow="Digital SAT"
        title="Results"
        description="Practice scores and attempt outcomes."
        actions={
          <SatSearchField
            id="sat-results-search"
            label="Search exams"
            value={examSearch}
            onChange={setExamSearch}
            placeholder="Search exams"
            widthClassName="w-full sm:w-64 sm:flex-none"
          />
        }
      />
      <SatStatStrip label="Results summary" stats={stats} />
      {query.isLoading ? (
        <SatListSkeleton rows={5} label="Loading SAT results" />
      ) : listGroups.length ? (
        <>
        <div className="flex items-center gap-2">
          <SatResultCount total={allGroups.length} visible={listGroups.length} itemLabel={listGroups.length === 1 ? 'exam' : 'exams'} />
          {query.isFetching && !query.isLoading ? <span className="text-[11px] text-slate-400">Updating…</span> : null}
        </div>
        <SatList>
          {listGroups.map((group, groupIndex) => (
            <SatExamGroupRow key={group.examId} group={group} groupIndex={groupIndex} onOpen={(examId) => navigate('/sat/results?exam=' + encodeURIComponent(examId))} />
          ))}
        </SatList>
        </>
      ) : (
        <>
          <SatResultCount total={allGroups.length} visible={0} itemLabel="exams" />
          <SatEmptyState
            icon={<BarChart3 size={18} aria-hidden="true" />}
            title={examNeedle ? 'No matching SAT exams' : 'No SAT results yet'}
            hint={examNeedle ? 'Try a different exam name.' : 'Completed SAT attempts will appear here when scoring is available.'}
            action={examNeedle ? <SatPrimaryButton onClick={() => { setExamSearch(''); document.getElementById('sat-results-search')?.focus(); }}>Clear Search</SatPrimaryButton> : undefined}
          />
        </>
      )}
    </SatContainer>
  );
}
