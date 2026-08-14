import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ChevronLeft,
  ChevronRight,
  Download,
  Pause,
  Play,
  Search,
} from 'lucide-react';
import {
  useAnswerHistoryOverviewByAttempt,
  useAnswerHistoryOverviewBySubmission,
  useAnswerHistoryTargetDetail,
  useAnswerHistoryTargetDetailByAttempt,
} from '@app/data/answerHistoryQueries';
import { fetchAnswerHistoryExport } from '@services/answerHistoryService';
import { WritingChartPreview } from '@components/writing/WritingChartPreview';
import type {
  AnswerHistoryCheckpoint,
  AnswerHistoryQuestionSummary,
  AnswerHistoryTargetType,
} from '../../features/answer-history/contracts';
import type { WritingChartData } from '../../types';

type AnswerHistoryPageProps = {
  submissionId?: string | null | undefined;
  attemptId?: string | null | undefined;
  headingPrefix: string;
  backLabel: string;
  onBack: () => void;
};

type ReconciliationBadgeState = 'auto_reconciled' | 'manual_override';

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value || '(empty)';
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item || '(empty)' : JSON.stringify(item)))
      .join(' | ');
  }

  if (value == null) {
    return '(empty)';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '(unserializable)';
    }
  }

  return String(value);
}

function signalTargetsAnswer(
  evidence: Record<string, unknown> | null | undefined,
  targetId: string,
): boolean {
  if (!evidence) {
    return false;
  }

  const directTargetId = evidence['targetId'];
  if (typeof directTargetId === 'string' && directTargetId === targetId) {
    return true;
  }

  const questionId = evidence['questionId'];
  if (typeof questionId === 'string' && questionId === targetId) {
    return true;
  }

  const taskId = evidence['taskId'];
  if (typeof taskId === 'string' && taskId === targetId) {
    return true;
  }

  const affectedAnswers = evidence['affectedAnswers'];
  if (Array.isArray(affectedAnswers) && affectedAnswers.some((value) => value === targetId)) {
    return true;
  }

  const affectedWritingAnswers = evidence['affectedWritingAnswers'];
  if (
    Array.isArray(affectedWritingAnswers) &&
    affectedWritingAnswers.some((value) => value === targetId)
  ) {
    return true;
  }

  const affectedAnswerSlots = evidence['affectedAnswerSlots'];
  if (Array.isArray(affectedAnswerSlots)) {
    return affectedAnswerSlots.some((slot) => {
      if (!slot || typeof slot !== 'object') {
        return false;
      }
      const slotQuestionId = (slot as { questionId?: unknown }).questionId;
      return typeof slotQuestionId === 'string' && slotQuestionId === targetId;
    });
  }

  return false;
}

function resolveReconciliationBadge(
  signals: Array<{ signalType: string; evidence: Record<string, unknown> }>,
  targetId: string,
): ReconciliationBadgeState | null {
  let hasAutoReconciled = false;

  for (const signal of signals) {
    if (!signalTargetsAnswer(signal.evidence, targetId)) {
      continue;
    }

    const type = signal.signalType.toUpperCase();
    if (type.includes('MANUAL_OVERRIDE') || type.includes('ADMIN_OVERRIDE')) {
      return 'manual_override';
    }
    if (type.includes('RECONCILE') || type.includes('DROPPED_STALE_SECTION')) {
      hasAutoReconciled = true;
    }
  }

  return hasAutoReconciled ? 'auto_reconciled' : null;
}

function reconciliationBadgeLabel(badge: ReconciliationBadgeState): string {
  if (badge === 'manual_override') {
    return 'Manual override';
  }
  return 'Auto reconciled';
}

function saveDownloadedContent(filename: string, contentType: string, content: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to manual copy.
  }

  try {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(input);
    return copied;
  } catch {
    return false;
  }
}

function toWordCount(value: unknown): number {
  if (typeof value !== 'string') {
    return 0;
  }

  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).filter(Boolean).length;
}

function renderCheckpointState(checkpoint: AnswerHistoryCheckpoint | undefined) {
  if (!checkpoint) {
    return '(no checkpoint selected)';
  }

  return formatValue(checkpoint.stateSnapshot);
}

export function AnswerHistoryPage({
  submissionId,
  attemptId,
  headingPrefix,
  backLabel,
  onBack,
}: AnswerHistoryPageProps) {
  const overviewBySubmission = useAnswerHistoryOverviewBySubmission(submissionId ?? null);
  const overviewByAttempt = useAnswerHistoryOverviewByAttempt(attemptId ?? null);

  const overviewQuery = submissionId ? overviewBySubmission : overviewByAttempt;
  const overview = overviewQuery.data;

  const [search, setSearch] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedTargetType, setSelectedTargetType] = useState<AnswerHistoryTargetType>('objective');
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copiedMutationId, setCopiedMutationId] = useState<string | null>(null);

  const filteredTargets = useMemo(() => {
    const summaries = overview?.questionSummaries ?? [];
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return summaries;
    }

    return summaries.filter((summary) => {
      return (
        summary.label.toLowerCase().includes(normalizedSearch) ||
        summary.targetId.toLowerCase().includes(normalizedSearch) ||
        summary.module.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [overview?.questionSummaries, search]);

  useEffect(() => {
    if (!overview) {
      return;
    }

    if (!selectedTargetId || !overview.questionSummaries.some((summary) => summary.targetId === selectedTargetId)) {
      const first = overview.questionSummaries[0];
      if (first) {
        setSelectedTargetId(first.targetId);
        setSelectedTargetType(first.targetType);
      }
    }
  }, [overview, selectedTargetId]);

  const selectedTargetSummary = useMemo<AnswerHistoryQuestionSummary | null>(() => {
    if (!selectedTargetId || !overview) {
      return null;
    }

    return (
      overview.questionSummaries.find(
        (summary) =>
          summary.targetId === selectedTargetId && summary.targetType === selectedTargetType,
      ) ?? null
    );
  }, [overview, selectedTargetId, selectedTargetType]);

  const detailBySubmissionQuery = useAnswerHistoryTargetDetail({
    submissionId: overview?.submissionId ?? null,
    targetId: selectedTargetId,
    targetType: selectedTargetType,
  });
  const detailByAttemptQuery = useAnswerHistoryTargetDetailByAttempt({
    attemptId: overview?.submissionId ? null : (overview?.attemptId ?? attemptId ?? null),
    targetId: selectedTargetId,
    targetType: selectedTargetType,
  });
  const detailQuery = overview?.submissionId ? detailBySubmissionQuery : detailByAttemptQuery;

  const checkpoints = detailQuery.data?.checkpoints ?? [];
  const technicalLogs = detailQuery.data?.technicalLogs ?? [];
  const currentCheckpoint = checkpoints[Math.min(replayIndex, Math.max(0, checkpoints.length - 1))];
  const previousCheckpoint =
    checkpoints[Math.max(0, Math.min(replayIndex, Math.max(0, checkpoints.length - 1)) - 1)];

  useEffect(() => {
    setReplayIndex(Math.max(0, checkpoints.length - 1));
    setIsPlaying(false);
  }, [selectedTargetId, selectedTargetType, checkpoints.length]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    if (checkpoints.length === 0) {
      setIsPlaying(false);
      return;
    }

    const intervalMs = Math.max(250, Math.floor(1000 / Math.max(0.25, playbackSpeed)));
    const timer = window.setInterval(() => {
      setReplayIndex((current) => {
        if (current >= checkpoints.length - 1) {
          window.clearInterval(timer);
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [isPlaying, checkpoints.length, playbackSpeed]);

  const groupedTargets = useMemo(() => {
    const groups = new Map<string, AnswerHistoryQuestionSummary[]>();
    for (const item of filteredTargets) {
      const list = groups.get(item.module) ?? [];
      list.push(item);
      groups.set(item.module, list);
    }
    return [...groups.entries()];
  }, [filteredTargets]);

  const writingGrowthChart = useMemo<WritingChartData | undefined>(() => {
    if (selectedTargetType !== 'writing' || checkpoints.length === 0) {
      return undefined;
    }

    return {
      id: `writing-growth-${selectedTargetId ?? 'unknown'}`,
      type: 'line',
      title: 'Essay growth over checkpoints',
      labels: checkpoints.map((checkpoint) => `v${checkpoint.index}`),
      values: checkpoints.map((checkpoint) => toWordCount(checkpoint.stateSnapshot)),
    };
  }, [checkpoints, selectedTargetId, selectedTargetType]);

  const reconciliationBadgesByTarget = useMemo(() => {
    const map = new Map<string, ReconciliationBadgeState>();
    const signals = (overview?.signals ?? []).filter(
      (signal) =>
        Boolean(signal?.signalType) && Boolean(signal?.evidence && typeof signal.evidence === 'object'),
    );
    for (const summary of overview?.questionSummaries ?? []) {
      const badge = resolveReconciliationBadge(signals, summary.targetId);
      if (badge) {
        map.set(summary.targetId, badge);
      }
    }
    return map;
  }, [overview?.questionSummaries, overview?.signals]);

  const selectedTargetReconciliationBadge = useMemo(() => {
    if (!selectedTargetSummary) {
      return null;
    }

    const signals = [
      ...(overview?.signals ?? []),
      ...(detailQuery.data?.signals ?? []),
    ].filter(
      (signal) =>
        Boolean(signal?.signalType) && Boolean(signal?.evidence && typeof signal.evidence === 'object'),
    );

    return resolveReconciliationBadge(signals, selectedTargetSummary.targetId);
  }, [detailQuery.data?.signals, overview?.signals, selectedTargetSummary]);

  const handleDownload = async (format: 'json' | 'csv') => {
    if (!overview?.submissionId || !selectedTargetSummary) {
      return;
    }

    setDownloadError(null);
    try {
      const exported = await fetchAnswerHistoryExport({
        submissionId: overview.submissionId,
        targetId: selectedTargetSummary.targetId,
        targetType: selectedTargetSummary.targetType,
        format,
      });
      saveDownloadedContent(exported.filename, exported.contentType, exported.content);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Failed to export answer history.');
    }
  };

  const isLoading = overviewQuery.isLoading || detailQuery.isLoading;
  const isError = overviewQuery.isError || detailQuery.isError;
  const hasNoAttemptHistoryYet =
    Boolean(attemptId) && !submissionId && !isLoading && !isError && !overview;

  const handleCopyPayload = async (mutationId: string, payload: Record<string, unknown>) => {
    const copied = await copyTextToClipboard(JSON.stringify(payload, null, 2));
    if (!copied) {
      return;
    }

    setCopiedMutationId(mutationId);
    window.setTimeout(() => {
      setCopiedMutationId((current) => (current === mutationId ? null : current));
    }, 1200);
  };

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ChevronLeft size={16} />
          {backLabel}
        </button>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{headingPrefix}</p>
          <h1 className="text-2xl font-bold text-gray-900">Answer History</h1>
        </div>
      </div>

      {isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load answer history data.
        </div>
      ) : null}

      {hasNoAttemptHistoryYet ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No answer history is available yet for this in-progress attempt.
        </div>
      ) : null}

      {overview ? (
        <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Candidate</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{overview.candidateName}</p>
            <p className="text-sm text-gray-500">{overview.candidateId}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Attempt</p>
            <p className="mt-1 text-sm font-medium text-gray-900">{overview.attemptId}</p>
            <p className="text-sm text-gray-500">{overview.examTitle}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Revisions</p>
            <p className="mt-1 text-2xl font-bold text-blue-700">{overview.totalRevisions}</p>
            <p className="text-sm text-gray-500">{overview.totalTargetsEdited} edited targets</p>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 text-gray-400" size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search targets..."
              className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="max-h-[65vh] space-y-4 overflow-auto pr-1">
            {groupedTargets.map(([module, items]) => (
              <div key={module}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">{module}</h3>
                <div className="space-y-2">
                  {items.map((item) => {
                    const selected =
                      item.targetId === selectedTargetId && item.targetType === selectedTargetType;
                    const unanswered = !item.answered;
                    const reconciliationBadge = reconciliationBadgesByTarget.get(item.targetId) ?? null;
                    return (
                      <button
                        key={`${item.targetType}-${item.targetId}`}
                        type="button"
                        onClick={() => {
                          setSelectedTargetId(item.targetId);
                          setSelectedTargetType(item.targetType);
                        }}
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                          selected
                            ? 'border-blue-500 bg-blue-50 text-blue-800'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium">{item.label}</p>
                          <div className="flex items-center gap-1.5">
                            {reconciliationBadge ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                {reconciliationBadgeLabel(reconciliationBadge)}
                              </span>
                            ) : null}
                            {unanswered ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                Unanswered
                              </span>
                            ) : null}
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                              {item.revisionCount}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {groupedTargets.length === 0 ? (
              <p className="text-sm text-gray-500">No targets matched your search.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          {selectedTargetSummary ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {selectedTargetSummary.label}
                    </h2>
                    {selectedTargetReconciliationBadge ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                        {reconciliationBadgeLabel(selectedTargetReconciliationBadge)}
                      </span>
                    ) : null}
                    {!selectedTargetSummary.answered ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        Unanswered
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-500">
                    {selectedTargetSummary.targetType} • {selectedTargetSummary.module}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDownload('csv')}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    <Download size={13} /> CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload('json')}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    <Download size={13} /> JSON
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Final State</p>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-gray-800">
                    {formatValue(detailQuery.data?.finalState ?? selectedTargetSummary.finalValue)}
                  </pre>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Compare</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div className="rounded-md bg-gray-50 p-2">
                      <p className="text-[11px] font-semibold uppercase text-gray-500">Previous</p>
                      <p className="mt-1 text-sm text-gray-800">{renderCheckpointState(previousCheckpoint)}</p>
                    </div>
                    <div className="rounded-md bg-blue-50 p-2">
                      <p className="text-[11px] font-semibold uppercase text-blue-500">Current</p>
                      <p className="mt-1 text-sm text-blue-900">{renderCheckpointState(currentCheckpoint)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Replay</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReplayIndex((value) => Math.max(0, value - 1))}
                      className="rounded-md border border-gray-200 p-1.5 hover:bg-gray-50"
                      aria-label="Previous checkpoint"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPlaying((value) => !value)}
                      className="rounded-md border border-gray-200 p-1.5 hover:bg-gray-50"
                      aria-label="Toggle playback"
                    >
                      {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setReplayIndex((value) => Math.min(Math.max(0, checkpoints.length - 1), value + 1))
                      }
                      className="rounded-md border border-gray-200 p-1.5 hover:bg-gray-50"
                      aria-label="Next checkpoint"
                    >
                      <ChevronRight size={14} />
                    </button>
                    <select
                      value={playbackSpeed}
                      onChange={(event) => setPlaybackSpeed(Number(event.target.value))}
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs"
                      aria-label="Replay speed"
                    >
                      <option value={0.5}>0.5x</option>
                      <option value={1}>1x</option>
                      <option value={2}>2x</option>
                    </select>
                  </div>
                </div>
                <input
                  className="mt-3 w-full"
                  type="range"
                  min={0}
                  max={Math.max(0, checkpoints.length - 1)}
                  step={1}
                  value={Math.min(replayIndex, Math.max(0, checkpoints.length - 1))}
                  onChange={(event) => setReplayIndex(Number(event.target.value))}
                />
                <p className="mt-2 text-xs text-gray-500">
                  Checkpoint {checkpoints.length === 0 ? 0 : Math.min(replayIndex + 1, checkpoints.length)} of {checkpoints.length}
                </p>
              </div>

              {writingGrowthChart ? (
                <div className="mt-4 rounded-lg border border-gray-200 p-3">
                  <WritingChartPreview chart={writingGrowthChart} variant="student" />
                </div>
              ) : null}

              <div className="mt-4 rounded-lg border border-gray-200">
                <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                  Checkpoints
                </div>
                <div className="max-h-[30vh] overflow-auto">
                  {checkpoints.map((checkpoint, index) => (
                    <button
                      key={checkpoint.id}
                      type="button"
                      onClick={() => setReplayIndex(index)}
                      className={`grid w-full grid-cols-[60px_1fr_80px] items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                        index === replayIndex ? 'bg-blue-50' : ''
                      }`}
                    >
                      <span className="text-xs font-semibold text-gray-500">v{checkpoint.index}</span>
                      <div>
                        <p className="font-medium text-gray-800">{checkpoint.summary}</p>
                        <p className="text-xs text-gray-500">{new Date(checkpoint.serverReceivedAt).toLocaleTimeString()}</p>
                      </div>
                      <span
                        className={`text-right text-xs font-semibold ${
                          checkpoint.deltaChars > 0
                            ? 'text-emerald-600'
                            : checkpoint.deltaChars < 0
                              ? 'text-rose-600'
                              : 'text-gray-500'
                        }`}
                      >
                        {checkpoint.deltaChars > 0 ? `+${checkpoint.deltaChars}` : checkpoint.deltaChars}
                      </span>
                    </button>
                  ))}
                  {checkpoints.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-gray-500">No checkpoints were recorded for this target.</p>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">Select a target to inspect its answer history.</p>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-400">Signals</h3>
          <div className="mt-3 space-y-2">
            {(detailQuery.data?.signals ?? overview?.signals ?? []).map((signal, index) => (
              <div key={`${signal.signalType}-${index}`} className="rounded-md border border-gray-200 bg-gray-50 p-2.5">
                <p className="text-sm font-semibold text-gray-800">{signal.signalType}</p>
                <p className="mt-1 text-xs text-gray-600">{signal.message}</p>
              </div>
            ))}
            {(detailQuery.data?.signals ?? overview?.signals ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No signals detected for this scope.</p>
            ) : null}
          </div>

          <h3 className="mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-gray-400">Technical Log</h3>
          <div className="mt-2 max-h-[42vh] overflow-auto rounded-md border border-gray-200 bg-gray-50">
            {technicalLogs.map((row) => (
              <div key={row.mutationId} className="border-b border-gray-200 p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-700">{row.mutationType}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">seq {row.mutationSeq}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyPayload(row.mutationId, row.payload)}
                      className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                      aria-label={`Copy payload ${row.mutationId}`}
                    >
                      {copiedMutationId === row.mutationId ? <Check size={12} /> : <Copy size={12} />}
                      {copiedMutationId === row.mutationId ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-gray-700">
                  {JSON.stringify(row.payload, null, 2)}
                </pre>
              </div>
            ))}
            {technicalLogs.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">No technical logs available for this target.</p>
            ) : null}
          </div>

          {downloadError ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              <AlertCircle size={14} className="mt-0.5" />
              <span>{downloadError}</span>
            </div>
          ) : null}
        </section>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading answer history...</div>
      ) : null}
    </div>
  );
}
