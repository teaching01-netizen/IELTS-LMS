import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SatPageError } from '../ui/SatPage';
import { useSatAttemptsQuery, useSatResultsQuery } from '../../../features/results/api/satResultsQueries';
import { filterSatAttempts, groupSatAccessGroups, type SatExamGroup, type SatScoreFilter } from '../../../features/results/domain/satResultsGroups';
import { SatContainer, SatEmptyState, SatList, SatListSkeleton, SatPageHeader, SatPrimaryButton, SatResultCount, SatSearchField, SatStatStrip, SatStatusPill } from '../ui/SatPage';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import { SatAccessGroupRow, SatExamAttemptRow, SatExamGroupRow, aggregateLineFor, recencyLineFor, rollupFor, rollupLabelFor, rollupToneFor, versionLineFor } from './SatExamGroupSection';

const PAGE_SIZE = 50;

export function SatResultsRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const examIdParam = (searchParams.get('exam') ?? '').trim();
  const accessIdParam = (searchParams.get('access') ?? '').trim();
  const [offset, setOffset] = useState(0);
  const [examSearch, setExamSearch] = useState('');
  const [accessSearch, setAccessSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState<SatScoreFilter>('all');
  const query = useSatResultsQuery();
  const attemptsQuery = useSatAttemptsQuery(examIdParam, accessIdParam, offset, studentSearch.trim(), scoreFilter);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const allGroups = useMemo(() => groupSatAccessGroups(query.data ?? []), [query.data]);
  const summary = useMemo(() => ({
    exams: allGroups.length,
    attempts: allGroups.reduce((sum, group) => sum + group.total, 0),
    scored: allGroups.reduce((sum, group) => sum + group.scored, 0),
  }), [allGroups]);
  const examNeedle = examSearch.trim().toLocaleLowerCase();
  const listGroups = examNeedle ? allGroups.filter((group) => group.examTitle.toLocaleLowerCase().includes(examNeedle)) : allGroups;
  const selectedGroup: SatExamGroup | null = examIdParam ? allGroups.find((group) => group.examId === examIdParam) ?? null : null;
  const selectedAccess = selectedGroup?.accessGroups?.find((group) => group.scheduleId === accessIdParam) ?? null;
  const accessNeedle = accessSearch.trim().toLocaleLowerCase();
  const visibleAccessGroups = (selectedGroup?.accessGroups ?? []).filter((group) => group.accessLinkName.toLocaleLowerCase().includes(accessNeedle));
  const page = attemptsQuery.data;
  const visibleAttempts = useMemo(() => filterSatAttempts(page?.items ?? [], { needle: studentSearch, scoreFilter }), [page, studentSearch, scoreFilter]);
  const accessPath = `/sat/results?exam=${encodeURIComponent(examIdParam)}&access=${encodeURIComponent(accessIdParam)}`;

  useEffect(() => { setOffset(0); }, [examIdParam, accessIdParam, studentSearch, scoreFilter]);
  useEffect(() => {
    const focusTarget = accessIdParam ? 'sat-results-student-search' : examIdParam ? 'sat-results-access-search' : 'sat-results-search';
    if (document.activeElement === document.body) document.getElementById(focusTarget)?.focus();
  }, [examIdParam, accessIdParam]);

  if (query.error) return <SatPageError title="SAT results could not load" description={query.error instanceof Error ? query.error.message : 'Results are unavailable.'} retryLabel="Retry" onRetry={() => void query.refetch()} />;
  if (attemptsQuery.error) return <SatPageError title="Student attempts could not load" description="This Student Access group is unavailable." retryLabel="Retry" onRetry={() => void attemptsQuery.refetch()} />;

  const stats = [
    { id: 'exams', label: 'Exams', value: summary.exams },
    { id: 'attempts', label: 'Attempts', value: summary.attempts },
    { id: 'scored', label: 'Scored', value: summary.scored },
  ];
  const backButton = (label: string, target: string) => (
    <button ref={backButtonRef} type="button" onClick={() => navigate(target)} aria-label={label} className="-ml-2 flex min-h-10 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] px-2 text-[12px] font-semibold text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">
      <ArrowLeft size={15} aria-hidden="true" />{label}
    </button>
  );

  if (examIdParam) {
    if (query.isLoading) return <SatContainer>{backButton('Back to Results', '/sat/results')}<SatListSkeleton rows={5} label="Loading SAT results" /></SatContainer>;
    if (!selectedGroup) return <SatContainer>{backButton('Back to Results', '/sat/results')}<SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title="Exam not found" hint="This exam link looks invalid or the exam has no results. Go back and choose another exam." /></SatContainer>;

    if (!accessIdParam) {
      const rollup = rollupFor(selectedGroup);
      const versionLine = versionLineFor(selectedGroup.versions);
      return (
        <SatContainer>
          {backButton('Back to SAT results', '/sat/results')}
          <SatPageHeader eyebrow="Digital SAT" title={selectedGroup.examTitle} description={aggregateLineFor(selectedGroup)} />
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-[11px] tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">{versionLine ? `${versionLine} · ` : ''}{recencyLineFor(selectedGroup)}</p>
            <SatStatusPill tone={rollupToneFor(rollup)}>{rollupLabelFor(rollup)}</SatStatusPill>
          </div>
          <SatStatStrip label="Results summary" stats={stats} />
          <SatSearchField id="sat-results-access-search" label="Search Student Access" value={accessSearch} onChange={setAccessSearch} placeholder="Search Student Access" widthClassName="mt-5 w-full sm:max-w-[420px]" />
          {visibleAccessGroups.length ? <>
            <SatResultCount total={selectedGroup.accessGroups?.length ?? 0} visible={visibleAccessGroups.length} itemLabel="Student Access groups" />
            <SatList>{visibleAccessGroups.map((group, index) => <SatAccessGroupRow key={group.scheduleId} group={group} groupIndex={index} onOpen={(scheduleId) => navigate(`/sat/results?exam=${encodeURIComponent(selectedGroup.examId)}&access=${encodeURIComponent(scheduleId)}`)} />)}</SatList>
          </> : <SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title="No Student Access groups" hint="No access schedules match this exam." />}
        </SatContainer>
      );
    }

    if (!selectedAccess) return <SatContainer>{backButton(`${selectedGroup.examTitle}`, `/sat/results?exam=${encodeURIComponent(examIdParam)}`)}<SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title="Student Access not found" hint="This access schedule is unavailable for the selected exam." /></SatContainer>;
    const rollup = selectedAccess.pendingCount > 0 ? 'pending' : selectedAccess.scoredCount > 0 ? 'ready' : 'invalidated';
    const currentRows = page?.items ?? [];
    return (
      <SatContainer>
        {backButton(selectedGroup.examTitle, `/sat/results?exam=${encodeURIComponent(examIdParam)}`)}
        <SatPageHeader eyebrow="Student Access" title={selectedAccess.accessLinkName} description={`${selectedGroup.examTitle} · Version ${selectedAccess.versionNumber}`} />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2"><p className="text-[11px] tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">{selectedAccess.submittedCount} submitted · {selectedAccess.scoredCount} scored · {selectedAccess.attemptCount} students</p><SatStatusPill tone={rollup === 'ready' ? 'ready' : rollup === 'pending' ? 'pending' : 'invalidated'}>{rollup === 'ready' ? 'Scored' : rollup === 'pending' ? 'Scoring pending' : 'Not scored'}</SatStatusPill></div>
        <SatStatStrip label="Results summary" stats={stats} />
        <SatSearchField id="sat-results-student-search" label="Search students" value={studentSearch} onChange={setStudentSearch} placeholder="Search name, ID, cohort" widthClassName="mt-5 w-full sm:max-w-[420px]" />
        <SatSegmentedControl<typeof scoreFilter> label="Score availability" value={scoreFilter} options={[{ value: 'all', label: 'All' }, { value: 'available', label: 'Score available' }, { value: 'unavailable', label: 'Score unavailable' }]} onChange={setScoreFilter} className="mt-3 max-w-[420px]" />
        {attemptsQuery.isLoading ? <SatListSkeleton rows={5} label="Loading student attempts" /> : visibleAttempts.length ? <>
          <SatResultCount total={Math.min(PAGE_SIZE, Math.max(0, (page?.total ?? 0) - offset))} visible={visibleAttempts.length} itemLabel="students on this page" />
          <SatList>{visibleAttempts.map((attempt, index) => <SatExamAttemptRow key={attempt.attemptId} attempt={attempt} attemptIndex={index} onOpen={(resultId) => navigate(`/sat/results/${encodeURIComponent(resultId)}`, { state: { from: accessPath } })} />)}</SatList>
        </> : <SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title={currentRows.length ? 'No matching students on this page' : 'No student attempts'} hint={currentRows.length ? 'Try another search or score filter, or move to another page.' : 'Attempts for this Student Access will appear here.'} />}
        <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-slate-500">
          <span>{page?.total ?? 0} attempts · showing {page?.total ? offset + 1 : 0}–{Math.min(offset + currentRows.length, page?.total ?? 0)}</span>
          <div className="flex gap-2">
            <button type="button" disabled={offset === 0 || attemptsQuery.isFetching} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} className="flex min-h-9 items-center gap-1 rounded-lg border px-3 disabled:opacity-40"><ArrowLeft size={14} />Previous</button>
            <button type="button" disabled={!page?.hasMore || attemptsQuery.isFetching} onClick={() => setOffset((value) => value + PAGE_SIZE)} className="flex min-h-9 items-center gap-1 rounded-lg border px-3 disabled:opacity-40">Next<ArrowRight size={14} /></button>
          </div>
        </div>
      </SatContainer>
    );
  }

  return (
    <SatContainer>
      <SatPageHeader eyebrow="Digital SAT" title="Results" description="Practice scores and attempt outcomes." actions={<SatSearchField id="sat-results-search" label="Search exams" value={examSearch} onChange={setExamSearch} placeholder="Search exams" widthClassName="w-full sm:w-64 sm:flex-none" />} />
      <SatStatStrip label="Results summary" stats={stats} />
      {query.isLoading ? <SatListSkeleton rows={5} label="Loading SAT results" /> : listGroups.length ? <>
        <SatResultCount total={allGroups.length} visible={listGroups.length} itemLabel={listGroups.length === 1 ? 'exam' : 'exams'} />
        <SatList>{listGroups.map((group, index) => <SatExamGroupRow key={group.examId} group={group} groupIndex={index} onOpen={(examId) => navigate('/sat/results?exam=' + encodeURIComponent(examId))} />)}</SatList>
      </> : <SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title={examNeedle ? 'No matching SAT exams' : 'No SAT results yet'} hint={examNeedle ? 'Try a different exam name.' : 'SAT attempts will appear here when students use Student Access.'} action={examNeedle ? <SatPrimaryButton onClick={() => { setExamSearch(''); document.getElementById('sat-results-search')?.focus(); }}>Clear Search</SatPrimaryButton> : undefined} />}
    </SatContainer>
  );
}
