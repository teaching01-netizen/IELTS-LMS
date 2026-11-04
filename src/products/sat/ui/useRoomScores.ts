import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StudentSession } from '../../../types';
import type { SatAttemptRow } from '../../../features/results/api/satResultsQueries';
import type { SatAttemptPage } from '../../../features/results/api/satResultsQueries';
import { resultsGateway } from '../../../features/results/infrastructure/resultsGateway';

export type RoomScoreKind = 'dash' | 'answering' | 'scoring' | 'scored' | 'not_scored';

export interface RoomScoreModule {
  moduleKey: string;
  answered: number;
  correct: number | null;
  total: number;
}

export interface RoomScore {
  kind: RoomScoreKind;
  answered: number | null;
  correct: number | null;
  total: number | null;
  pct: number | null;
  modules: RoomScoreModule[] | null;
  /** Server-estimated conversion only (row.estimatedPrimary); never computed client-side. */
  scaled: { low: number; high: number } | null;
  label: string;
  srLabel: string;
  resultId: string | null;
  hasSavedAnswers: boolean;
}

type ScoreSessionInput = Pick<
  StudentSession,
  'satStartState' | 'status' | 'scoreAnswered' | 'scoreTotal' | 'scoreCorrect' | 'scoreStatus' | 'scoreModules'
>;

type AttemptRowInput = Pick<
  SatAttemptRow,
  'resultId' | 'rawCorrect' | 'rawTotal' | 'outcomeStatus' | 'attemptStatus' | 'estimatedPrimary'
> | null
  | undefined;

function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeModules(
  modules: ScoreSessionInput['scoreModules'],
): RoomScoreModule[] | null {
  if (!Array.isArray(modules) || modules.length === 0) return null;
  const normalized: RoomScoreModule[] = [];
  for (const module of modules) {
    if (!module || typeof module.moduleKey !== 'string') continue;
    const answered = finiteCount(module.answered);
    const total = finiteCount(module.total);
    if (answered === null || total === null) continue;
    const correct = module.correct === null || module.correct === undefined ? null : finiteCount(module.correct);
    normalized.push({ moduleKey: module.moduleKey, answered, correct, total });
  }
  return normalized.length ? normalized : null;
}

function shortModuleLabel(moduleKey: string): string {
  const normalized = moduleKey.trim().toLocaleLowerCase();
  // Anchored SAT slots only: M1 exactly or M1 with higher/lower branch suffix,
  // M2 exactly or with branch suffix. No substring fallback — custom keys
  // (e.g. exam-m10, team1-x) must never misfire as M1/M2.
  if (/(^|[-_])m1([-_](higher|lower))?$/.test(normalized)) return 'M1';
  if (/(^|[-_])m2([-_](higher|lower))?$/.test(normalized)) return 'M2';
  if (/(^|[-_])m2([-_]|$)/.test(normalized)) return 'M2';
  return moduleKey;
}

/**
 * Screen-reader suffix for the conversion estimate. Scored rows always name
 * the outcome: the scaled value (or range) when the server supplied one,
 * "conversion unavailable" when it did not. Other kinds only append when an
 * estimate is present; they never claim a missing conversion.
 */
function scaledSrSuffix(scaled: { low: number; high: number } | null, kind: RoomScoreKind): string {
  if (scaled) {
    return scaled.low === scaled.high
      ? `, scaled ${scaled.low}`
      : `, scaled ${scaled.low} to ${scaled.high}`;
  }
  if (kind === 'scored') return ', conversion unavailable';
  return '';
}

/**
 * Pure view-model: one owner per score fact. Correctness comes only from the
 * backend projection (`scoreCorrect`) or the results list (`rawCorrect`).
 * This function never derives correctness from saved answers.
 */
export function resolveRoomScore(session: ScoreSessionInput, row: AttemptRowInput): RoomScore {
  const beAnswered = finiteCount(session.scoreAnswered);
  const beTotal = finiteCount(session.scoreTotal);
  const beCorrect = finiteCount(session.scoreCorrect);
  const beStatus = session.scoreStatus ?? null;
  const modules = normalizeModules(session.scoreModules);

  const rowCorrect = row ? finiteCount(row.rawCorrect) : null;
  const rowTotal = row ? finiteCount(row.rawTotal) : null;
  const outcomeStatus = row?.outcomeStatus ?? null;
  const attemptStatus = row?.attemptStatus ?? null;
  const resultId = row?.resultId ?? null;
  // Conversion passthrough only: the server's estimate flows straight to the
  // hero view-model. Never computed client-side from raw counts.
  const estimated = row?.estimatedPrimary ?? null;
  const scaled = estimated
    && typeof estimated.low === 'number'
    && typeof estimated.high === 'number'
    && Number.isFinite(estimated.low)
    && Number.isFinite(estimated.high)
    ? { low: estimated.low, high: estimated.high }
    : null;

  // Same-source pairing (F-G): correctness and its denominator always come
  // from the same scope — BE pair wins when it carries correctness,
  // otherwise the row pair. A mixed correct/total never forms a scored
  // badge; it falls through to scoring via the existing guards. When
  // neither scope carries correctness no scored badge is possible, so the
  // total falls back to BE ?? row (display-only for answering/scoring
  // counts — preserves live counts before any results row exists).
  let correct: number | null;
  let total: number | null;
  if (beCorrect !== null) {
    correct = beCorrect;
    total = beTotal !== null && beTotal > 0 ? beTotal : null;
  } else if (rowCorrect !== null) {
    correct = rowCorrect;
    total = rowTotal !== null && rowTotal > 0 ? rowTotal : null;
  } else {
    correct = null;
    const fallbackTotal = beTotal ?? rowTotal;
    total = fallbackTotal !== null && fallbackTotal > 0 ? fallbackTotal : null;
  }
  const answered = beAnswered;
  const hasSavedAnswers = resultId != null || (answered !== null && answered > 0);

  const invalidated = outcomeStatus === 'invalidated_proctor'
    || outcomeStatus === 'invalidated_timeout'
    || outcomeStatus === 'unscored';

  const isTerminalDelivery = attemptStatus === 'terminated' || attemptStatus === 'locked';

  let kind: RoomScoreKind;
  if (beStatus === 'not_scored' || invalidated) {
    kind = 'not_scored';
  } else if (
    isTerminalDelivery
    && correct === null
    && outcomeStatus !== 'scored'
    && outcomeStatus !== 'pending'
    && (attemptStatus as string | null) !== 'submitted'
  ) {
    // RULE-D: terminated/locked with no scored-path outcome and no
    // correctness reads terminal (Not scored) — never a dash, never
    // answering-forever. Any real outcome (scored / pending / submitted)
    // or any correctness wins so a later regrade still upgrades.
    kind = 'not_scored';
  } else if (correct !== null && total !== null) {
    kind = 'scored';
  } else if (
    beStatus === 'scoring'
    || outcomeStatus === 'pending'
    || attemptStatus === 'submitted'
    || beStatus === 'scored'
  ) {
    // `scored` without numbers is a grading/payload gap: stay in scoring,
    // never flash a zero stand-in.
    kind = 'scoring';
  } else if (
    beStatus === 'answering'
    || attemptStatus === 'running'
    || attemptStatus === 'paused'
    || attemptStatus === 'ended'
    || (answered !== null && total !== null)
  ) {
    // ENDED_WITHOUT_SUBMIT_KIND='answering': an ended attempt with no outcome
    // and no counts reads as still-answering, never a silent dash.
    // Product can flip this const to 'not_scored' in one line if needed.
    kind = 'answering';
  } else if (session.satStartState === 'waiting_for_code' || session.satStartState === 'never_started') {
    kind = 'dash';
  } else if (beStatus === 'unstarted') {
    kind = 'dash';
  } else {
    kind = 'dash';
  }

  if (kind === 'scored' && (correct === null || total === null)) {
    kind = 'scoring';
  }

  // Corrupt counts (answered>total) never render a negative "left" and never
  // stay as plain answering: surface as scoring for repair visibility.
  // The badge still shows raw counts; leftPart stays suppressed downstream.
  if (kind === 'answering' && answered !== null && total !== null && answered > total) {
    kind = 'scoring';
  }

  const pct = kind === 'scored' && correct !== null && total !== null && total > 0
    ? Math.round((correct / total) * 100)
    : null;

  if (kind === 'not_scored') {
    return {
      kind, answered, correct: null, total, pct: null, modules, scaled,
      label: 'Not scored', srLabel: `not scored${scaledSrSuffix(scaled, kind)}`,
      resultId, hasSavedAnswers,
    };
  }

  if (kind === 'scored' && correct !== null && total !== null && pct !== null) {
    const modulesPart = modules?.length
      ? ` · ${modules.map((module) => `${shortModuleLabel(module.moduleKey)} ${module.correct ?? module.answered}/${module.total}`).join(' ')}`
      : '';
    const left = answered !== null && answered <= total ? total - answered : null;
    const leftPart = left !== null && left > 0 ? ` · ${left} left` : '';
    return {
      kind, answered, correct, total, pct, modules, scaled,
      label: `✓ ${correct}/${total} · ${pct}%${modulesPart}${leftPart}`,
      srLabel: `score ${correct} of ${total}, ${pct} percent${scaledSrSuffix(scaled, kind)}`,
      resultId, hasSavedAnswers,
    };
  }

  if (kind === 'scoring') {
    if (answered !== null && total !== null) {
      return {
        kind, answered, correct: null, total, pct: null, modules, scaled,
        label: `Scoring… ${answered}/${total} answered`,
        srLabel: `scoring, ${answered} of ${total} answered${scaledSrSuffix(scaled, kind)}`,
        resultId, hasSavedAnswers,
      };
    }
    return {
      kind, answered, correct: null, total, pct: null, modules, scaled,
      label: 'Scoring…', srLabel: `scoring${scaledSrSuffix(scaled, kind)}`,
      resultId, hasSavedAnswers,
    };
  }

  if (kind === 'answering') {
    if (answered !== null && total !== null) {
      return {
        kind, answered, correct: null, total, pct: null, modules, scaled,
        label: `${answered}/${total} answered`,
        srLabel: `${answered} of ${total} answered${scaledSrSuffix(scaled, kind)}`,
        resultId, hasSavedAnswers,
      };
    }
    return {
      kind, answered, correct: null, total, pct: null, modules, scaled,
      label: 'Answering…', srLabel: `answering${scaledSrSuffix(scaled, kind)}`,
      resultId, hasSavedAnswers,
    };
  }

  return {
    kind: 'dash', answered, correct: null, total, pct: null, modules, scaled,
    label: '', srLabel: scaled ? `scaled ${scaled.low === scaled.high ? scaled.low : `${scaled.low} to ${scaled.high}`}` : '',
    resultId, hasSavedAnswers,
  };
}

/**
 * Field-wise equality for the score view-model. The roster renders one badge
 * per row from a shared `byAttempt` Map (cart badge vs cart line): when a poll
 * returns the same facts, the previous object is reused so only the row whose
 * score actually changed re-renders its badge — no whole-grid churn.
 */
export function isSameRoomScore(a: RoomScore, b: RoomScore): boolean {
  if (
    a.kind !== b.kind
    || a.answered !== b.answered
    || a.correct !== b.correct
    || a.total !== b.total
    || a.pct !== b.pct
    || a.label !== b.label
    || a.srLabel !== b.srLabel
    || a.resultId !== b.resultId
    || a.hasSavedAnswers !== b.hasSavedAnswers
    || a.scaled?.low !== b.scaled?.low
    || a.scaled?.high !== b.scaled?.high
  ) {
    return false;
  }
  const aModules = a.modules;
  const bModules = b.modules;
  if (aModules === bModules) return true;
  if (!aModules || !bModules || aModules.length !== bModules.length) return false;
  return aModules.every((module, index) => {
    const other = bModules[index];
    return !!other
      && module.moduleKey === other.moduleKey
      && module.answered === other.answered
      && module.correct === other.correct
      && module.total === other.total;
  });
}

/**
 * Joins the live room roster with the results attempts list by `attemptId`.
 * The backend projection wins when it carries correctness; otherwise the
 * results row decides. Never computes a score from answers client-side.
 *
 * Pagination: rooms can exceed the results API 50-row page. We loop
 * offset 0,50,... until !hasMore (cap 10 pages = 500 attempts; real rooms are
 * tens). Partial failure keeps accumulated pages + stale dim, never zeros.
 */
const ROOM_SCORES_PAGE_LIMIT = 50;
const ROOM_SCORES_MAX_PAGES = 10;

function attemptOutcomeRank(outcome: string | null | undefined): number {
  switch (outcome) {
    case 'invalidated_proctor':
    case 'invalidated_timeout':
    case 'unscored':
      return 3;
    case 'scored':
      return 2;
    case 'pending':
      return 1;
    default:
      return 0;
  }
}

export function useRoomScores(
  scheduleId: string,
  examId: string | null,
  sessions: readonly StudentSession[],
): { byAttempt: Map<string, RoomScore>; isStale: boolean; isLoading: boolean; updatedAt: number; truncated: boolean; partial: boolean } {
  const attemptsQuery = useQuery({
    queryKey: ['sat-results', 'attempts-all', examId ?? '', scheduleId ?? ''],
    queryFn: async ({ signal }): Promise<{ items: SatAttemptRow[]; truncated: boolean; partial?: boolean }> => {
      const all: SatAttemptRow[] = [];
      let offset = 0;
      let truncated = false;
      let total: number | null = null;
      for (let page = 0; page < ROOM_SCORES_MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          examId: examId ?? '',
          scheduleId: scheduleId ?? '',
          limit: String(ROOM_SCORES_PAGE_LIMIT),
          offset: String(offset),
          q: '',
          scoreFilter: 'all',
        });
        let pageData: SatAttemptPage;
        try {
          pageData = await resultsGateway.get<SatAttemptPage>(
            `/v1/results/sat/attempts?${params.toString()}`,
            { signal },
          );
        } catch (error) {
          // Page-0 failure rejects the whole query (existing path: roster
          // falls back to the backend projection + stale dim). A later-page
          // failure keeps the pages already fetched instead of zeroing.
          if (all.length === 0) throw error;
          return { items: all, truncated, partial: true };
        }
        all.push(...(pageData.items ?? []));
        if (typeof pageData.total === 'number' && Number.isFinite(pageData.total)) total = pageData.total;
        if (!pageData.hasMore || (pageData.items ?? []).length < ROOM_SCORES_PAGE_LIMIT) break;
        offset += ROOM_SCORES_PAGE_LIMIT;
        if (all.length >= (pageData.total ?? 0)) break;
        if (page === ROOM_SCORES_MAX_PAGES - 1) truncated = true;
      }
      // Offset-shift limitation: a submit interleaving between page reads can
      // shift later pages, so `all.length < total` is a gap signal, not an
      // exact count. Flag partial (same channel as page failure; existing
      // stale line, no new UI) — the next 15s poll heals it. No cursor API
      // per constraints.
      if (total !== null && all.length < total) return { items: all, truncated, partial: true };
      return { items: all, truncated };
    },
    enabled: Boolean(examId && scheduleId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: 15_000,
  });

  const rowsByAttempt = useMemo(() => {
    const map = new Map<string, SatAttemptRow>();
    const rank = new Map<string, number>();
    for (const item of attemptsQuery.data?.items ?? []) {
      const r = attemptOutcomeRank(item.outcomeStatus);
      // Severity-wins on duplicate attemptIds (mirrors BE): invalidation
      // stays authoritative over a stale scored/pending duplicate.
      if (!map.has(item.attemptId) || r >= (rank.get(item.attemptId) ?? -1)) {
        map.set(item.attemptId, item);
        rank.set(item.attemptId, r);
      }
    }
    return map;
  }, [attemptsQuery.data?.items]);

  // Per-row subscription: polls rebuild the Map, but attempts whose facts did
  // not change keep their previous object identity, so a memoized badge only
  // re-renders for the row that actually changed.
  const previousByAttempt = useRef(new Map<string, RoomScore>());

  const byAttempt = useMemo(() => {    const map = new Map<string, RoomScore>();    const cache = previousByAttempt.current;
    for (const session of sessions) {
      const next = resolveRoomScore(session, rowsByAttempt.get(session.id) ?? null);
      const previous = cache.get(session.id);
      map.set(session.id, previous && isSameRoomScore(previous, next) ? previous : next);
    }
    previousByAttempt.current = map;
    return map;
  }, [rowsByAttempt, sessions]);

  // A failed results read keeps the last successful join (or the backend
  // projection / dash fallback): the roster dims instead of flashing zeros.
  // Partial (page failure or traversal gap) dims through the same channel.
  const partial = attemptsQuery.data?.partial ?? false;
  const isStale = attemptsQuery.isError || partial;

  return {
    byAttempt,
    isStale,
    // First paint of the results join: the roster renders a shape-preserving
    // skeleton in the score slot (never a zero). Refetches keep last values.
    isLoading: attemptsQuery.isLoading,
    updatedAt: attemptsQuery.dataUpdatedAt ?? 0,
    truncated: attemptsQuery.data?.truncated ?? false,
    partial,
  };
}
