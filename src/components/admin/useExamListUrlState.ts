import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_SORT, type ExamFilterOptions, type ExamSortOptions } from '../../utils/examStats';

/**
 * Exam library search, filters, and sort, owned by the URL so Back, refresh,
 * and returning from an exam all restore the same view. Invalid values fall
 * back to defaults per key; unrelated params are left untouched.
 */
const STATUSES = new Set(['Draft', 'Published', 'Archived']);
const SORT_FIELDS = new Set<ExamSortOptions['field']>(['title', 'modified', 'published', 'created', 'questionCount']);

function list(params: URLSearchParams, key: string, valid?: (value: string) => boolean): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw.split(',').filter((value) => value !== '' && (!valid || valid(value)));
}

function count(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parse(params: URLSearchParams): { searchQuery: string; filters: ExamFilterOptions; sort: ExamSortOptions } {
  const from = params.get('from') || undefined;
  const to = params.get('to') || undefined;
  const min = count(params, 'qmin');
  const max = count(params, 'qmax');
  const field = params.get('sort');
  const direction = params.get('dir');
  return {
    searchQuery: params.get('q') ?? '',
    filters: {
      search: '',
      status: list(params, 'status', (value) => STATUSES.has(value)),
      type: list(params, 'type'),
      creator: list(params, 'creator'),
      ...(from || to ? { dateRange: { start: from, end: to } } : {}),
      ...(min !== undefined || max !== undefined ? { questionCount: { min, max } } : {}),
    },
    sort: {
      field: field && SORT_FIELDS.has(field as ExamSortOptions['field']) ? (field as ExamSortOptions['field']) : DEFAULT_SORT.field,
      direction: direction === 'asc' || direction === 'desc' ? direction : DEFAULT_SORT.direction,
    },
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | undefined) {
  if (value) params.set(key, value);
  else params.delete(key);
}

export function useExamListUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parse(searchParams), [searchParams]);

  const update = useCallback(
    (write: (next: URLSearchParams, current: ReturnType<typeof parse>) => void) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          write(next, parse(previous));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSearchQuery = useCallback(
    (query: string) => update((next) => setOrDelete(next, 'q', query)),
    [update],
  );

  const setFilters = useCallback(
    (value: ExamFilterOptions | ((previous: ExamFilterOptions) => ExamFilterOptions)) =>
      update((next, current) => {
        const filters = typeof value === 'function' ? value(current.filters) : value;
        setOrDelete(next, 'status', filters.status.join(','));
        setOrDelete(next, 'type', filters.type.join(','));
        setOrDelete(next, 'creator', filters.creator.join(','));
        setOrDelete(next, 'from', filters.dateRange?.start);
        setOrDelete(next, 'to', filters.dateRange?.end);
        setOrDelete(next, 'qmin', filters.questionCount?.min?.toString());
        setOrDelete(next, 'qmax', filters.questionCount?.max?.toString());
      }),
    [update],
  );

  const setSort = useCallback(
    (sort: ExamSortOptions) =>
      update((next) => {
        const isDefault = sort.field === DEFAULT_SORT.field && sort.direction === DEFAULT_SORT.direction;
        setOrDelete(next, 'sort', isDefault ? undefined : sort.field);
        setOrDelete(next, 'dir', isDefault ? undefined : sort.direction);
      }),
    [update],
  );

  return { ...state, setSearchQuery, setFilters, setSort };
}
