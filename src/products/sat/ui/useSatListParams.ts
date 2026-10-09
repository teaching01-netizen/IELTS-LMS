import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Tiny query-param store for the Digital SAT staff list pages.
 * Parses a fixed key set with validation + fallback to defaults; unknown
 * or invalid values fall back per-key (never throw, never persist junk).
 * setParams merges a partial patch over the current params; an empty string
 * removes the key. List state lives in the URL so refresh, deep links and the
 * browser Back button all return staff to the same view.
 */
export type SatListBucket = 'upcoming' | 'live' | 'finished';
export type SatScoreFilter = 'all' | 'available' | 'unavailable';
export type SatLibraryTab = 'active' | 'drafts' | 'published' | 'archived';
export type SatListSort = 'updated' | 'title' | 'soonest' | 'latest';

export type SatListParams = {
  bucket?: SatListBucket;
  q?: string;
  score?: SatScoreFilter;
  student?: string;
  tab?: SatLibraryTab;
  sort?: SatListSort;
};

type SatListParamsPatch = { [K in keyof SatListParams]?: SatListParams[K] | '' };

const BUCKETS: Record<string, true> = { upcoming: true, live: true, finished: true };
const SCORES: Record<string, true> = { all: true, available: true, unavailable: true };
const TABS: Record<string, true> = { active: true, drafts: true, published: true, archived: true };
const SORTS: Record<string, true> = { updated: true, title: true, soonest: true, latest: true };
const has = (table: Record<string, true>, value: string): boolean => Object.hasOwn(table, value);

function parseParams(searchParams: URLSearchParams): SatListParams {
  const params: SatListParams = {};
  const bucket = searchParams.get('bucket');
  if (bucket && has(BUCKETS, bucket)) params.bucket = bucket as SatListBucket;
  const q = searchParams.get('q');
  if (q) params.q = q;
  const score = searchParams.get('score');
  if (score && has(SCORES, score)) params.score = score as SatScoreFilter;
  const student = searchParams.get('student');
  if (student) params.student = student;
  const tab = searchParams.get('tab');
  if (tab && has(TABS, tab)) params.tab = tab as SatLibraryTab;
  const sort = searchParams.get('sort');
  if (sort && has(SORTS, sort)) params.sort = sort as SatListSort;
  return params;
}

export function useSatListParams(): { params: SatListParams; setParams: (patch: SatListParamsPatch) => void } {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parseParams(searchParams), [searchParams]);
  const setParams = useCallback(
    (patch: SatListParamsPatch) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const apply = (key: string, value: string | undefined, valid: (v: string) => boolean) => {
            if (value === undefined) return;
            if (value === '' || !valid(value)) next.delete(key);
            else next.set(key, value);
          };
          apply('bucket', patch.bucket, (v) => has(BUCKETS, v));
          apply('q', patch.q, () => true);
          apply('score', patch.score, (v) => has(SCORES, v));
          apply('student', patch.student, () => true);
          apply('tab', patch.tab, (v) => has(TABS, v));
          apply('sort', patch.sort, (v) => has(SORTS, v));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  return { params, setParams };
}
