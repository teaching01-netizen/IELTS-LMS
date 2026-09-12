import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Tiny query-param store for the Digital SAT staff list pages.
 * Parses a fixed key set with validation + fallback to defaults; unknown
 * or invalid values fall back per-key (never throw, never persist junk).
 * setParams merges a partial patch over the current params.
 */
export type SatListBucket = 'upcoming' | 'live' | 'finished';
export type SatScoreFilter = 'all' | 'available' | 'unavailable';
export type SatArchiveTab = 'active' | 'archived';

export type SatListParams = {
  bucket?: SatListBucket;
  q?: string;
  score?: SatScoreFilter;
  student?: string;
  tab?: SatArchiveTab;
};

const BUCKETS: ReadonlySet<string> = new Set(['upcoming', 'live', 'finished']);
const SCORES: ReadonlySet<string> = new Set(['all', 'available', 'unavailable']);
const TABS: ReadonlySet<string> = new Set(['active', 'archived']);

function parseParams(searchParams: URLSearchParams): SatListParams {
  const params: SatListParams = {};
  const bucket = searchParams.get('bucket');
  if (bucket && BUCKETS.has(bucket)) params.bucket = bucket as SatListBucket;
  const q = searchParams.get('q');
  if (q) params.q = q;
  const score = searchParams.get('score');
  if (score && SCORES.has(score)) params.score = score as SatScoreFilter;
  const student = searchParams.get('student');
  if (student) params.student = student;
  const tab = searchParams.get('tab');
  if (tab && TABS.has(tab)) params.tab = tab as SatArchiveTab;
  return params;
}

export function useSatListParams(): { params: SatListParams; setParams: (patch: SatListParams) => void } {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parseParams(searchParams), [searchParams]);
  const setParams = useCallback(
    (patch: SatListParams) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const apply = (key: string, value: string | undefined, valid: (v: string) => boolean) => {
            if (value === undefined) return;
            if (value === '' || !valid(value)) next.delete(key);
            else next.set(key, value);
          };
          apply('bucket', patch.bucket, (v) => BUCKETS.has(v));
          apply('q', patch.q, () => true);
          apply('score', patch.score, (v) => SCORES.has(v));
          apply('student', patch.student, () => true);
          apply('tab', patch.tab, (v) => TABS.has(v));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  return { params, setParams };
}
