import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Download } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SatPageError } from '../ui/SatPage';
import { downloadSatRawdataXlsx } from '../../../features/results/api/satRawdataExport';
import { useSatAttemptsQuery, useSatResultsQuery, type SatAttemptFilters } from '../../../features/results/api/satResultsQueries';
import { filterSatAttempts, groupSatAccessGroups, type SatExamGroup, type SatOutcomeCounts } from '../../../features/results/domain/satResultsGroups';
import { SatContainer, SatEmptyState, SatList, SatListSkeleton, SatPageHeader, SatPrimaryButton, SatResultCount, SatSearchField, SatStatStrip } from '../ui/SatPage';
import { AccessColumnHeader, AttemptColumnHeader, ExamColumnHeader, SatAccessGroupRow, SatExamAttemptRow, SatExamGroupRow, accessOutcomeCounts, aggregateLineFor, formatDate, hasMultipleTestDates, versionLineFor } from './SatExamGroupSection';
import { localDayStartIso, viewerTimeZoneLabel } from './satTestTime';

const PAGE_SIZE = 50;
const STATUS_OPTIONS: Array<{ value: NonNullable<SatAttemptFilters['status']>; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'running', label: 'In progress' },
  { value: 'ended', label: 'Ended' },
  { value: 'other', label: 'Other / unknown' },
];
const FIELD_CLASS = 'min-h-11 rounded-[var(--sat-staff-radius-control,10px)] border border-slate-200 bg-white px-3 text-[14px] text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]';

function parseStatus(value: string | null): NonNullable<SatAttemptFilters['status']> {
  return STATUS_OPTIONS.some((option) => option.value === value) ? (value as NonNullable<SatAttemptFilters['status']>) : 'all';
}

function countsOf(group: SatExamGroup): SatOutcomeCounts {
  return group.outcomeCounts ?? { completed: group.scored + group.pending, running: 0, ended: group.invalidated, other: 0 };
}

export function SatResultsRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const examIdParam = (searchParams.get('exam') ?? '').trim();
  const accessIdParam = (searchParams.get('access') ?? '').trim();
  // Attempt list state lives in the URL so refresh, deep links and Back restore it.
  const studentSearch = searchParams.get('q') ?? '';
  const status = parseStatus(searchParams.get('status'));
  const fromDay = searchParams.get('from') ?? '';
  const toDay = searchParams.get('to') ?? '';
  const parsedOffset = Number.parseInt(searchParams.get('offset') ?? '0', 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;
  const [examSearch, setExamSearch] = useState('');
  const [accessSearch, setAccessSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const filters = useMemo<SatAttemptFilters>(() => {
    const next: SatAttemptFilters = { status };
    const from = localDayStartIso(fromDay);
    const to = localDayStartIso(toDay, 1);
    if (from) next.from = from;
    if (to) next.to = to;
    return next;
  }, [status, fromDay, toDay]);
  const hasFilters = studentSearch.trim() !== '' || status !== 'all' || fromDay !== '' || toDay !== '';
  const query = useSatResultsQuery();
  const attemptsQuery = useSatAttemptsQuery(examIdParam, accessIdParam, offset, studentSearch.trim(), 'all', filters);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const allGroups = useMemo(() => groupSatAccessGroups(query.data ?? []), [query.data]);
  const examNeedle = examSearch.trim().toLocaleLowerCase();
  const listGroups = examNeedle ? allGroups.filter((group) => group.examTitle.toLocaleLowerCase().includes(examNeedle)) : allGroups;
  const selectedGroup: SatExamGroup | null = examIdParam ? allGroups.find((group) => group.examId === examIdParam) ?? null : null;
  const selectedAccess = selectedGroup?.accessGroups?.find((group) => group.scheduleId === accessIdParam) ?? null;
  const accessNeedle = accessSearch.trim().toLocaleLowerCase();
  const visibleAccessGroups = (selectedGroup?.accessGroups ?? []).filter((group) => `${group.accessLinkName} ${group.cohortName}`.toLocaleLowerCase().includes(accessNeedle));
  const page = attemptsQuery.data;
  const visibleAttempts = useMemo(() => filterSatAttempts(page?.items ?? [], { needle: studentSearch, scoreFilter: 'all' }), [page, studentSearch]);
  const returnPath = location.pathname + location.search;

  const updateParams = (changes: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (!keepPage) next.delete('offset');
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => updateParams({ q: null, status: null, from: null, to: null });

  useEffect(() => {
    const focusTarget = accessIdParam ? 'sat-results-student-search' : examIdParam ? 'sat-results-access-search' : 'sat-results-search';
    if (document.activeElement === document.body) document.getElementById(focusTarget)?.focus();
  }, [examIdParam, accessIdParam]);

  if (query.error) return <SatPageError title="SAT results could not load" description={query.error instanceof Error ? query.error.message : 'Results are unavailable.'} retryLabel="Retry" onRetry={() => void query.refetch()} />;
  if (attemptsQuery.error) return <SatPageError title="Student attempts could not load" description="This Student Access group is unavailable." retryLabel="Retry" onRetry={() => void attemptsQuery.refetch()} />;

  const statsFor = (attempts: number, counts: SatOutcomeCounts, scopeLabel: string) => [
    { id: 'scope', label: scopeLabel, value: attempts },
    { id: 'completed', label: 'Completed', value: counts.completed },
    { id: 'running', label: 'In progress', value: counts.running },
    { id: 'ended', label: 'Ended', value: counts.ended },
  ];
  const backButton = (label: string, target: string) => (
    <button ref={backButtonRef} type="button" onClick={() => navigate(target)} aria-label={label} className="-ml-2 flex min-h-10 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] px-2 text-[12px] font-semibold text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">
      <ArrowLeft size={15} aria-hidden="true" />{label}
    </button>
  );
  const timeZoneNote = <p className="mt-2 text-[12px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">Times shown in {viewerTimeZoneLabel()}.</p>;

  if (examIdParam) {
    if (query.isLoading) return <SatContainer>{backButton('Back to Results', '/sat/results')}<SatListSkeleton rows={5} label="Loading SAT results" /></SatContainer>;
    if (!selectedGroup) return <SatContainer>{backButton('Back to Results', '/sat/results')}<SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title="Exam not found" hint="This exam link looks invalid or the exam has no results. Go back and choose another exam." /></SatContainer>;

    if (!accessIdParam) {
      const versionLine = versionLineFor(selectedGroup.versions);
      return (
        <SatContainer>
          {backButton('Back to SAT results', '/sat/results')}
          <SatPageHeader eyebrow="Digital SAT" title={selectedGroup.examTitle} description={aggregateLineFor(selectedGroup)} />
          {versionLine ? <p className="mt-3 text-[12px] tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">{versionLine}</p> : null}
          <SatStatStrip label="Exam summary" stats={statsFor(selectedGroup.total, countsOf(selectedGroup), 'Attempts')} />
          <SatSearchField id="sat-results-access-search" label="Search Student Access" value={accessSearch} onChange={setAccessSearch} placeholder="Search Student Access or cohort" widthClassName="mt-5 w-full sm:max-w-[420px]" />
          {timeZoneNote}
          {visibleAccessGroups.length ? <>
            <SatResultCount total={selectedGroup.accessGroups?.length ?? 0} visible={visibleAccessGroups.length} itemLabel="Student Access groups" />
            <AccessColumnHeader />
            <SatList>{visibleAccessGroups.map((group, index) => <SatAccessGroupRow key={group.scheduleId} group={group} groupIndex={index} onOpen={(scheduleId) => navigate(`/sat/results?exam=${encodeURIComponent(selectedGroup.examId)}&access=${encodeURIComponent(scheduleId)}`)} />)}</SatList>
          </> : <SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title="No Student Access groups" hint="No access schedules match this exam." />}
        </SatContainer>
      );
    }

    if (!selectedAccess) return <SatContainer>{backButton(`${selectedGroup.examTitle}`, `/sat/results?exam=${encodeURIComponent(examIdParam)}`)}<SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title="Student Access not found" hint="This access schedule is unavailable for the selected exam." /></SatContainer>;
    const currentRows = page?.items ?? [];
    const total = page?.total ?? 0;
    const rangeStart = total ? offset + 1 : 0;
    const rangeEnd = Math.min(offset + currentRows.length, total);
    const dateRange = selectedAccess.latestTestStartedAt
      ? hasMultipleTestDates(selectedAccess) ? `Test dates: ${formatDate(selectedAccess.earliestTestStartedAt)} – ${formatDate(selectedAccess.latestTestStartedAt)}` : `Test date: ${formatDate(selectedAccess.latestTestStartedAt)}`
      : 'Test dates unavailable';
    const runExport = async () => {
      if (exporting) return;
      setExporting(true);
      setExportError(null);
      try {
        await downloadSatRawdataXlsx(selectedGroup.examId, selectedAccess.scheduleId, selectedAccess.accessLinkName);
      } catch (error) {
        setExportError(error instanceof Error ? error.message : 'RAWDATA export failed.');
      } finally {
        setExporting(false);
      }
    };
    return (
      <SatContainer>
        {backButton(selectedGroup.examTitle, `/sat/results?exam=${encodeURIComponent(examIdParam)}`)}
        <SatPageHeader
          eyebrow="Student Access"
          title={selectedAccess.accessLinkName}
          description={`${selectedGroup.examTitle} · Version ${selectedAccess.versionNumber}${selectedAccess.cohortName ? ` · ${selectedAccess.cohortName}` : ''}`}
          actions={<SatPrimaryButton icon={<Download size={15} aria-hidden="true" />} pending={exporting} onClick={() => void runExport()}>{exporting ? 'Exporting...' : 'Export all group answers (.xlsx)'}</SatPrimaryButton>}
        />
        <p className="mt-2 text-[12px] text-[var(--sat-staff-text-tertiary,#6e6e73)] sm:text-right">Includes all attempts in this Student Access group; filters do not affect export.</p>
        {exportError ? <p role="alert" className="mt-3 text-[12px] font-medium text-[var(--sat-staff-danger,#b42318)]">{exportError}</p> : null}
        <p className="mt-3 text-[13px] tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{dateRange}</p>
        <SatStatStrip label="Student Access summary" stats={statsFor(selectedAccess.attemptCount, accessOutcomeCounts(selectedAccess), 'Attempts')} />
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <SatSearchField id="sat-results-student-search" label="Search students" value={studentSearch} onChange={(value) => updateParams({ q: value || null })} placeholder="Search name, ID, cohort" widthClassName="w-full sm:w-[320px] sm:flex-none" />
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">Status
            <select className={FIELD_CLASS} value={status} onChange={(event) => updateParams({ status: event.target.value === 'all' ? null : event.target.value })}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">Test date from
            <input type="date" className={FIELD_CLASS} value={fromDay} max={toDay || undefined} onChange={(event) => updateParams({ from: event.target.value || null })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">Test date to
            <input type="date" className={FIELD_CLASS} value={toDay} min={fromDay || undefined} onChange={(event) => updateParams({ to: event.target.value || null })} />
          </label>
        </div>
        {timeZoneNote}
        {attemptsQuery.isLoading ? <SatListSkeleton rows={5} label="Loading student attempts" /> : visibleAttempts.length ? <>
          <AttemptColumnHeader />
          <SatList>{visibleAttempts.map((attempt, index) => <SatExamAttemptRow key={attempt.attemptId} attempt={attempt} attemptIndex={index} onOpen={(row) => navigate(row.outcomeStatus === 'scored' && row.resultId ? `/sat/results/${encodeURIComponent(row.resultId)}` : `/sat/results/attempts/${encodeURIComponent(row.attemptId)}`, { state: { from: returnPath } })} />)}</SatList>
        </> : <SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title={hasFilters ? 'No matching attempts' : 'No student attempts'} hint={hasFilters ? 'No attempts match the current search, status, and test date filters.' : 'Attempts for this Student Access will appear here.'} action={hasFilters ? <SatPrimaryButton onClick={clearFilters}>Clear filters</SatPrimaryButton> : undefined} />}
        <div className="mt-4 flex items-center justify-between gap-3 text-[12px] text-slate-500">
          <span aria-live="polite">{rangeStart}–{rangeEnd} of {total} {hasFilters ? 'matching attempts' : 'attempts'}</span>
          <div className="flex gap-2">
            <button type="button" disabled={offset === 0 || attemptsQuery.isFetching} onClick={() => updateParams({ offset: offset > PAGE_SIZE ? String(offset - PAGE_SIZE) : null }, true)} className="flex min-h-11 items-center gap-1 rounded-lg border px-3 disabled:opacity-40"><ArrowLeft size={14} />Previous</button>
            <button type="button" disabled={!page?.hasMore || attemptsQuery.isFetching} onClick={() => updateParams({ offset: String(offset + PAGE_SIZE) }, true)} className="flex min-h-11 items-center gap-1 rounded-lg border px-3 disabled:opacity-40">Next<ArrowRight size={14} /></button>
          </div>
        </div>
      </SatContainer>
    );
  }

  const totals = allGroups.reduce((sum, group) => {
    const counts = countsOf(group);
    return { attempts: sum.attempts + group.total, completed: sum.completed + counts.completed, running: sum.running + counts.running, ended: sum.ended + counts.ended };
  }, { attempts: 0, completed: 0, running: 0, ended: 0 });
  const indexStats = [
    { id: 'exams', label: 'Exams', value: allGroups.length },
    { id: 'attempts', label: 'Attempts', value: totals.attempts },
    { id: 'completed', label: 'Completed', value: totals.completed },
    { id: 'running', label: 'In progress', value: totals.running },
    { id: 'ended', label: 'Ended', value: totals.ended },
  ];

  return (
    <SatContainer>
      <SatPageHeader eyebrow="Digital SAT" title="SAT results" description="Find a test and review student attempts." actions={<SatSearchField id="sat-results-search" label="Search exams" value={examSearch} onChange={setExamSearch} placeholder="Search exams" widthClassName="w-full sm:w-64 sm:flex-none" />} />
      <SatStatStrip label="Results summary" stats={indexStats} />
      {timeZoneNote}
      {query.isLoading ? <SatListSkeleton rows={5} label="Loading SAT results" /> : listGroups.length ? <>
        <SatResultCount total={allGroups.length} visible={listGroups.length} itemLabel={listGroups.length === 1 ? 'exam' : 'exams'} />
        <ExamColumnHeader />
        <SatList>{listGroups.map((group, index) => <SatExamGroupRow key={group.examId} group={group} groupIndex={index} onOpen={(examId) => navigate('/sat/results?exam=' + encodeURIComponent(examId))} />)}</SatList>
      </> : <SatEmptyState icon={<BarChart3 size={18} aria-hidden="true" />} title={examNeedle ? 'No matching SAT exams' : 'No SAT results yet'} hint={examNeedle ? 'Try a different exam name.' : 'SAT attempts will appear here when students use Student Access.'} action={examNeedle ? <SatPrimaryButton onClick={() => { setExamSearch(''); document.getElementById('sat-results-search')?.focus(); }}>Clear Search</SatPrimaryButton> : undefined} />}
    </SatContainer>
  );
}
