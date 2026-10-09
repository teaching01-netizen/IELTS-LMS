import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Download, SearchX } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SatAttemptInspector, type InspectedAttempt } from '../ui/SatAttemptInspector';
import { SatActiveFilters, type ActiveFilterChip } from '../ui/SatActiveFilters';
import { useSatListReturn } from '../ui/useSatListReturn';
import { downloadSatRawdataXlsx } from '../../../features/results/api/satRawdataExport';
import { useSatAttemptsQuery, useSatResultsQuery, type SatAttemptFilters } from '../../../features/results/api/satResultsQueries';
import { filterSatAttempts, groupSatAccessGroups, type SatExamGroup, type SatOutcomeCounts } from '../../../features/results/domain/satResultsGroups';
import { SatButton, SatContainer, SatEmptyState, SatInlineError, SatList, SatListSkeleton, SatListToolbar, SatPageHeader, SatResultCount, SatSearchField, SatStatStrip, SatToolbarSelect, type SatCrumb } from '../ui/SatPage';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import { AccessColumnHeader, ExamColumnHeader, SatAccessGroupRow, SatAttemptTable, SatExamGroupRow, accessOutcomeCounts, aggregateLineFor, formatDate, hasMultipleTestDates, versionLineFor } from './SatExamGroupSection';
import { localDayStartIso, viewerTimeZoneLabel } from './satTestTime';

const PAGE_SIZE = 50;
type AttemptStatus = NonNullable<SatAttemptFilters['status']>;
const STATUS_OPTIONS: Array<{ value: AttemptStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'running', label: 'Running' },
  { value: 'ended', label: 'Ended' },
  { value: 'other', label: 'Other' },
];

function parseStatus(value: string | null): AttemptStatus {
  return STATUS_OPTIONS.some((option) => option.value === value) ? (value as AttemptStatus) : 'all';
}

function countsOf(group: SatExamGroup): SatOutcomeCounts {
  return group.outcomeCounts ?? { completed: group.scored + group.pending, running: 0, ended: group.invalidated, other: 0 };
}

export interface SatResultsContentProps {
  /** Pins the exam (the exam workspace's Responses tab); the `?exam=` param is then ignored. */
  lockedExamId?: string;
  /** Path this content is mounted at; every in-page link is built from it. */
  basePath: string;
  /** Shown in place of an unknown exam when the exam is pinned. */
  emptyState?: ReactNode;
}

export function SatResultsRoute() {
  return <SatResultsContent basePath="/sat/results" />;
}

export function SatResultsContent({ lockedExamId, basePath, emptyState }: SatResultsContentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const embedded = lockedExamId !== undefined;
  const examIdParam = (lockedExamId ?? searchParams.get('exam') ?? '').trim();
  const requestedAccessId = (searchParams.get('access') ?? '').trim();
  // Every level keeps its list state in the URL (`q` is the search of whichever
  // level is showing), so refresh, deep links and Back restore the same view.
  const search = searchParams.get('q') ?? '';
  const status = parseStatus(searchParams.get('status'));
  const fromDay = searchParams.get('from') ?? '';
  const toDay = searchParams.get('to') ?? '';
  const parsedOffset = Number.parseInt(searchParams.get('offset') ?? '0', 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);
  const filters = useMemo<SatAttemptFilters>(() => {
    const next: SatAttemptFilters = { status };
    const from = localDayStartIso(fromDay);
    const to = localDayStartIso(toDay, 1);
    if (from) next.from = from;
    if (to) next.to = to;
    return next;
  }, [status, fromDay, toDay]);
  const hasFilters = search.trim() !== '' || status !== 'all' || fromDay !== '' || toDay !== '';
  const query = useSatResultsQuery();
  const allGroups = useMemo(() => groupSatAccessGroups(query.data ?? []), [query.data]);
  const selectedGroup: SatExamGroup | null = examIdParam ? allGroups.find((group) => group.examId === examIdParam) ?? null : null;
  const roomGroups = selectedGroup?.accessGroups ?? [];
  // An exam's Responses tab with a single room shows its students directly.
  const roomAutoSelected = !requestedAccessId && embedded && roomGroups.length === 1;
  const accessIdParam = roomAutoSelected ? roomGroups[0]!.scheduleId : requestedAccessId;
  const studentSearch = accessIdParam ? search.trim() : '';
  const attemptsQuery = useSatAttemptsQuery(examIdParam, accessIdParam, offset, studentSearch, 'all', filters);
  const needle = search.trim().toLocaleLowerCase();
  const listGroups = needle && !examIdParam ? allGroups.filter((group) => group.examTitle.toLocaleLowerCase().includes(needle)) : allGroups;
  const selectedAccess = roomGroups.find((group) => group.scheduleId === accessIdParam) ?? null;
  const visibleAccessGroups = roomGroups.filter((group) => `${group.accessLinkName} ${group.cohortName}`.toLocaleLowerCase().includes(needle));
  const page = attemptsQuery.data;
  const visibleAttempts = useMemo(() => filterSatAttempts(page?.items ?? [], { needle: studentSearch, scoreFilter: 'all' }), [page, studentSearch]);
  const returnPath = location.pathname + location.search;
  const { lastOpenedId, openRecord } = useSatListReturn(!query.isLoading);
  // A student's response opens beside the list on every entry point (URL-backed,
  // so refresh and Back restore / close it); "Open as page" stays available.
  const attemptParam = (searchParams.get('attempt') ?? '').trim();
  const inspectedIndex = attemptParam ? visibleAttempts.findIndex((item) => item.attemptId === attemptParam) : -1;
  const inspectedRow = inspectedIndex >= 0 ? visibleAttempts[inspectedIndex] ?? null : null;
  const inspected: InspectedAttempt | null = attemptParam
    ? { attemptId: attemptParam, resultId: inspectedRow?.outcomeStatus === 'scored' ? inspectedRow.resultId ?? null : null, studentName: inspectedRow?.studentName ?? null }
    : null;
  // Where this exam (or one of its sessions) lives under `basePath`.
  const examHref = (accessId?: string) => {
    if (embedded) return accessId ? `${basePath}?access=${encodeURIComponent(accessId)}` : basePath;
    const base = `${basePath}?exam=${encodeURIComponent(examIdParam)}`;
    return accessId ? `${base}&access=${encodeURIComponent(accessId)}` : base;
  };

  const updateParams = (changes: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (!keepPage) next.delete('offset');
    setSearchParams(next, { replace: true });
  };
  const setSearch = (value: string) => updateParams({ q: value || null });
  const clearFilters = () => updateParams({ q: null, status: null, from: null, to: null });
  const openAttempt = (attemptId: string) => updateParams({ attempt: attemptId }, true);

  useEffect(() => {
    const focusTarget = accessIdParam ? 'sat-results-student-search' : examIdParam ? 'sat-results-access-search' : 'sat-results-search';
    if (document.activeElement === document.body) document.getElementById(focusTarget)?.focus();
  }, [examIdParam, accessIdParam]);

  const loadError = query.error ? (query.error instanceof Error ? query.error.message : 'Responses are unavailable.') : null;

  const statsFor = (attempts: number, counts: SatOutcomeCounts, scopeLabel: string) => [
    { id: 'scope', label: scopeLabel, value: attempts },
    { id: 'completed', label: 'Completed', value: counts.completed },
    { id: 'running', label: 'Running', value: counts.running },
    { id: 'ended', label: 'Ended', value: counts.ended },
  ];
  const responsesCrumb: SatCrumb = { label: 'Responses', href: '/sat/results', onSelect: () => navigate('/sat/results') };
  const timeZoneNote = <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Times shown in {viewerTimeZoneLabel()}.</p>;
  // Back to the previous level stays one control away on narrow screens, where
  // the breadcrumb collapses to its parent crumb.
  const backLink = (label: string, target: string) => (
    <a
      href={target}
      onClick={(event) => { event.preventDefault(); navigate(target); }}
      aria-label={label}
      className="sat-btn sat-btn--quiet sat-press -ml-3 mb-2 px-3"
    >
      <ArrowLeft size={16} aria-hidden="true" />{label}
    </a>
  );

  if (examIdParam) {
    const examCrumbs: SatCrumb[] = [responsesCrumb, { label: selectedGroup?.examTitle ?? 'Exam' }];
    if (loadError) return <SatContainer>{embedded ? null : <SatPageHeader breadcrumbs={examCrumbs} title="Responses" />}<SatInlineError title="Responses could not load" description={loadError} onRetry={() => void query.refetch()} /></SatContainer>;
    if (query.isLoading) return <SatContainer>{embedded ? null : backLink('Back to Responses', '/sat/results')}<SatListSkeleton rows={5} label="Loading responses" /></SatContainer>;
    if (!selectedGroup) return embedded ? <SatContainer>{emptyState}</SatContainer> : <SatContainer>{backLink('Back to Responses', '/sat/results')}<SatEmptyState icon={<BarChart3 size={20} aria-hidden="true" />} title="Exam not found" hint="This exam link looks invalid or the exam has no responses yet. Go back and choose another exam." /></SatContainer>;

    if (!accessIdParam) {
      const versionLine = versionLineFor(selectedGroup.versions);
      return (
        <SatContainer>
          {embedded ? <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{aggregateLineFor(selectedGroup)}</p> : <SatPageHeader breadcrumbs={examCrumbs} title={selectedGroup.examTitle} description={[aggregateLineFor(selectedGroup), versionLine].filter(Boolean).join(' · ')} />}
          {embedded && versionLine ? <p className="mt-1 text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{versionLine}</p> : null}
          <SatStatStrip label="Exam summary" stats={statsFor(selectedGroup.total, countsOf(selectedGroup), 'Attempts')} />
          <SatListToolbar label="Room list controls">
            <SatSearchField id="sat-results-access-search" label="Search rooms" value={search} onChange={setSearch} placeholder="Search rooms" widthClassName="w-full sm:w-80 sm:flex-none" />
          </SatListToolbar>
          {timeZoneNote}
          {visibleAccessGroups.length ? <>
            <SatResultCount total={selectedGroup.accessGroups?.length ?? 0} visible={visibleAccessGroups.length} itemLabel={visibleAccessGroups.length === 1 ? 'room' : 'rooms'} />
            <AccessColumnHeader />
            <SatList>{visibleAccessGroups.map((group, index) => <SatAccessGroupRow key={group.scheduleId} group={group} groupIndex={index} current={group.scheduleId === lastOpenedId} onOpen={(scheduleId) => openRecord(scheduleId, examHref(scheduleId))} />)}</SatList>
          </> : <SatEmptyState icon={needle ? <SearchX size={20} aria-hidden="true" /> : <BarChart3 size={20} aria-hidden="true" />} title={needle ? 'No matching rooms' : 'No rooms'} hint={needle ? `No rooms match “${search.trim()}”.` : 'No rooms of this exam have attempts yet.'} action={needle ? <SatButton variant="secondary" onClick={() => setSearch('')}>Clear search</SatButton> : undefined} />}
        </SatContainer>
      );
    }

    if (!selectedAccess) return <SatContainer>{backLink(embedded ? 'All rooms' : `${selectedGroup.examTitle}`, examHref())}<SatEmptyState icon={<BarChart3 size={20} aria-hidden="true" />} title="Room not found" hint="This room is unavailable for the selected exam." /></SatContainer>;
    if (attemptsQuery.error) return <SatContainer>{backLink(embedded ? 'All rooms' : `${selectedGroup.examTitle}`, examHref())}<SatInlineError title="Student attempts could not load" description="This room's attempts are unavailable." onRetry={() => void attemptsQuery.refetch()} /></SatContainer>;
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
      setExportDone(false);
      try {
        await downloadSatRawdataXlsx(selectedGroup.examId, selectedAccess.scheduleId, selectedAccess.accessLinkName);
        setExportDone(true);
        window.setTimeout(() => setExportDone(false), 4000);
      } catch (error) {
        setExportError(error instanceof Error ? error.message : 'RAWDATA export failed.');
      } finally {
        setExporting(false);
      }
    };
    const activeFilterChips: ActiveFilterChip[] = [
      ...(search.trim() ? [{ id: 'q', label: `Search: ${search.trim()}`, onRemove: () => updateParams({ q: null }) }] : []),
      ...(status !== 'all' ? [{ id: 'status', label: `Status: ${STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status}`, onRemove: () => updateParams({ status: null }) }] : []),
      ...(fromDay ? [{ id: 'from', label: `From ${fromDay}`, onRemove: () => updateParams({ from: null }) }] : []),
      ...(toDay ? [{ id: 'to', label: `To ${toDay}`, onRemove: () => updateParams({ to: null }) }] : []),
    ];
    const previous = inspectedIndex > 0 ? visibleAttempts[inspectedIndex - 1] : undefined;
    const next = inspectedIndex >= 0 ? visibleAttempts[inspectedIndex + 1] : undefined;
    return (
      <SatContainer>
        {embedded ? (roomAutoSelected ? null : backLink('All rooms', examHref())) : null}
        <SatPageHeader
          breadcrumbs={embedded ? undefined : [responsesCrumb, { label: selectedGroup.examTitle, href: examHref(), onSelect: () => navigate(examHref()) }, { label: selectedAccess.accessLinkName }]}
          title={selectedAccess.accessLinkName}
          description={`${selectedGroup.examTitle} · Version ${selectedAccess.versionNumber}${selectedAccess.cohortName ? ` · ${selectedAccess.cohortName}` : ''} · ${dateRange}`}
          actions={<SatButton variant="secondary" icon={<Download size={16} aria-hidden="true" />} pending={exporting} onClick={() => void runExport()} aria-describedby="sat-results-export-scope">{exporting ? 'Exporting…' : 'Download room responses (.xlsx)'}</SatButton>}
        />
        <p id="sat-results-export-scope" className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)] sm:text-right">Exports every attempt in this room; filters do not apply.</p>
        {exportError ? <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-[14px] font-medium leading-5 text-[var(--sat-staff-danger,#b42318)] sm:justify-end">{exportError}<SatButton variant="quiet" onClick={() => void runExport()} className="px-3">Try again</SatButton></p> : null}
        <p role="status" aria-live="polite" className="min-h-5 text-[14px] font-medium leading-5 text-[var(--sat-staff-success-text,#067647)] sm:text-right">{exportDone ? 'Export downloaded.' : ''}</p>
        <SatStatStrip label="Room summary" stats={statsFor(selectedAccess.attemptCount, accessOutcomeCounts(selectedAccess), 'Attempts')} />
        <SatListToolbar
          label="Attempt list controls"
          tabs={<SatSegmentedControl<AttemptStatus> label="Attempt status" value={status} options={STATUS_OPTIONS.filter((option) => option.value !== 'other' || status === 'other' || accessOutcomeCounts(selectedAccess).other > 0)} onChange={(value) => updateParams({ status: value === 'all' ? null : value, attempt: null })} className="sm:max-w-[520px]" />}
        >
          {embedded && roomGroups.length > 1 ? <SatToolbarSelect<string> id="sat-results-room" label="Room" value={selectedAccess.scheduleId} options={roomGroups.map((group) => ({ value: group.scheduleId, label: group.cohortName ? `${group.accessLinkName} · ${group.cohortName}` : group.accessLinkName }))} onChange={(value) => updateParams({ access: value, attempt: null })} /> : null}
          <SatSearchField id="sat-results-student-search" label="Search students" value={search} onChange={setSearch} placeholder="Search students" widthClassName="w-full sm:w-64 sm:flex-none" />
        </SatListToolbar>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label htmlFor="sat-results-from" className="flex flex-col gap-1.5 text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">Test date from
            <input id="sat-results-from" type="date" className="sat-input w-auto" value={fromDay} max={toDay || undefined} onChange={(event) => updateParams({ from: event.target.value || null, attempt: null })} />
          </label>
          <label htmlFor="sat-results-to" className="flex flex-col gap-1.5 text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">Test date to
            <input id="sat-results-to" type="date" className="sat-input w-auto" value={toDay} min={fromDay || undefined} onChange={(event) => updateParams({ to: event.target.value || null, attempt: null })} />
          </label>
          <p className="pb-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Times shown in {viewerTimeZoneLabel()}.</p>
        </div>
        <SatActiveFilters chips={activeFilterChips} onClear={clearFilters} />
        {attemptsQuery.isLoading ? <SatListSkeleton rows={5} label="Loading student attempts" /> : visibleAttempts.length ? (
          <SatAttemptTable attempts={visibleAttempts} currentAttemptId={attemptParam || null} onOpen={(row) => openAttempt(row.attemptId)} />
        ) : <SatEmptyState icon={hasFilters ? <SearchX size={20} aria-hidden="true" /> : <BarChart3 size={20} aria-hidden="true" />} title={hasFilters ? 'No matching attempts' : 'No student attempts'} hint={hasFilters ? 'No attempts match the current search, status, and test date filters.' : 'Attempts for this room will appear here.'} action={hasFilters ? <SatButton variant="secondary" onClick={clearFilters}>Clear filters</SatButton> : undefined} />}
        <nav aria-label="Attempt pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          <span aria-live="polite" className="tabular-nums">{rangeStart}–{rangeEnd} of {total} {hasFilters ? 'matching attempts' : 'attempts'}</span>
          <div className="flex gap-2">
            <SatButton variant="secondary" disabled={offset === 0 || attemptsQuery.isFetching} onClick={() => updateParams({ offset: offset > PAGE_SIZE ? String(offset - PAGE_SIZE) : null, attempt: null }, true)} icon={<ArrowLeft size={16} aria-hidden="true" />}>Previous</SatButton>
            <SatButton variant="secondary" disabled={!page?.hasMore || attemptsQuery.isFetching} onClick={() => updateParams({ offset: String(offset + PAGE_SIZE), attempt: null }, true)}>Next<ArrowRight size={16} aria-hidden="true" /></SatButton>
          </div>
        </nav>
        <SatAttemptInspector
          attempt={inspected}
          returnPath={returnPath}
          onClose={() => updateParams({ attempt: null }, true)}
          position={inspectedIndex >= 0 ? { index: inspectedIndex, total: visibleAttempts.length } : null}
          onPrevious={previous ? () => openAttempt(previous.attemptId) : null}
          onNext={next ? () => openAttempt(next.attemptId) : null}
        />
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
      <SatPageHeader title="Responses" description="Review student attempts by exam and room." />
      {loadError ? <SatInlineError title="Responses could not load" description={loadError} onRetry={() => void query.refetch()} /> : <>
      <SatStatStrip label="Responses summary" stats={indexStats} />
      <SatListToolbar label="Exam list controls">
        <SatSearchField id="sat-results-search" label="Search exams" value={search} onChange={setSearch} placeholder="Search exams" widthClassName="w-full sm:w-80 sm:flex-none" />
      </SatListToolbar>
      {timeZoneNote}
      {query.isLoading ? <SatListSkeleton rows={5} label="Loading responses" /> : listGroups.length ? <>
        <SatResultCount total={allGroups.length} visible={listGroups.length} itemLabel={listGroups.length === 1 ? 'exam' : 'exams'} />
        <ExamColumnHeader />
        <SatList>{listGroups.map((group, index) => <SatExamGroupRow key={group.examId} group={group} groupIndex={index} current={group.examId === lastOpenedId} onOpen={(examId) => openRecord(examId, '/sat/results?exam=' + encodeURIComponent(examId))} />)}</SatList>
      </> : <SatEmptyState icon={needle ? <SearchX size={20} aria-hidden="true" /> : <BarChart3 size={20} aria-hidden="true" />} title={needle ? 'No matching exams' : 'No responses yet'} hint={needle ? 'Try a different exam name.' : 'Attempts appear here when students check in to a room.'} action={needle ? <SatButton variant="secondary" onClick={() => { setSearch(''); document.getElementById('sat-results-search')?.focus(); }}>Clear search</SatButton> : undefined} />}
      </>}
    </SatContainer>
  );
}
