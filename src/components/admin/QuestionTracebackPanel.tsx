import React, { useMemo } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, FileText, Hash } from 'lucide-react';
import type { ExamState } from '../../types';
import type { ObjectiveQuestionResult, SectionSubmission } from '../../types/grading';
import {
  buildQuestionTracebackGroups,
  type ObjectiveTracebackGroup,
} from './gradingReviewUtils';
import { extractObjectiveAnswerMap } from './gradingAnswerUtils';

interface QuestionTracebackPanelProps {
  section: 'reading' | 'listening';
  examState: ExamState | null;
  sectionSubmission: SectionSubmission | null;
  examLoading: boolean;
  examError: string | null;
  onOverride?: (questionId: string, isCorrect: boolean) => Promise<void> | void;
  pendingOverrideQuestionIds?: ReadonlySet<string>;
  overrideError?: string | null;
}

function QuestionStatusBadge({ correctness }: { correctness: boolean | null }) {
  if (correctness === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
        Not scored
      </span>
    );
  }

  return correctness ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      <CheckCircle2 size={12} />
      Correct
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
      <AlertTriangle size={12} />
      Incorrect
    </span>
  );
}

function displayPersistedAnswer(value: string): string {
  return value.trim() === '' ? '—' : value;
}

function buildFallbackTracebackGroups(
  section: QuestionTracebackPanelProps['section'],
  sectionSubmission: SectionSubmission | null,
): ObjectiveTracebackGroup[] {
  const questionResults = sectionSubmission?.autoGradingResults?.questionResults ?? [];
  if (questionResults.length === 0) {
    return [];
  }

  return [{
    groupId: `${section}:persisted-results`,
    groupLabel: `${section} persisted answer results`,
    items: questionResults.map((result: ObjectiveQuestionResult) => ({
      numberLabel: result.questionId,
      questionId: result.questionId,
      prompt: 'Question schema unavailable',
      studentAnswer: displayPersistedAnswer(result.studentAnswer),
      correctAnswer: displayPersistedAnswer(result.correctAnswer),
      correctness: result.manualOverride?.isCorrect ?? result.isCorrect,
      ...(result.manualOverride ? { manualOverride: result.manualOverride } : {}),
      awardedScore: result.manualOverride?.awardedScore ?? result.awardedScore,
      maxScore: result.maxScore,
      answerKey: result.questionId,
    })),
  }];
}

function renderGroup(
  group: ObjectiveTracebackGroup,
  index: number,
  onOverride: QuestionTracebackPanelProps['onOverride'],
  pendingOverrideQuestionIds: ReadonlySet<string> | undefined,
) {
  return (
    <section key={group.groupId} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            <BookOpen size={18} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
              Traceback Group {index + 1}
            </p>
            <h3 className="text-base font-semibold text-gray-900">{group.groupLabel}</h3>
          </div>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          {group.items.length} question{group.items.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid gap-4 px-5 py-5">
        {group.items.map((item, itemIndex) => {
          return (
          <article
            key={item.questionId}
            className={`rounded-2xl border px-4 py-4 shadow-sm ${
              item.correctness === true
                ? 'border-emerald-200 bg-emerald-50/40'
                : item.correctness === false
                  ? 'border-rose-200 bg-rose-50/30'
                  : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                  <Hash size={12} />
                  {item.numberLabel || item.questionId}
                </div>
                <h4 className="text-sm font-semibold text-gray-900">
                  {item.prompt || 'Question prompt unavailable'}
                </h4>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <QuestionStatusBadge correctness={item.correctness} />
                {item.manualOverride || item.slotManualOverrides?.some(Boolean) ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    Manual override
                  </span>
                ) : null}
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                  Score {item.awardedScore ?? '—'} / {item.maxScore ?? '—'}
                </span>
              </div>
            </div>

            {item.rootRuleLabel && itemIndex === 0 ? (
              <p className="mt-2 text-xs font-medium text-gray-500">{item.rootRuleLabel}</p>
            ) : item.requiredCorrect !== undefined && item.slotLabels && item.slotLabels.length > 0 ? (
              <p className="mt-2 text-xs font-medium text-gray-500">
                {item.slotLabels.length} answers required for {item.requiredCorrect} point
                {item.requiredCorrect === 1 ? '' : 's'}
              </p>
            ) : null}

            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                  Student answer
                </p>
                {item.studentAnswerSlots && item.studentAnswerSlots.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {item.studentAnswerSlots.map((slotValue, slotIndex) => (
                      <p
                        key={`${item.questionId}:slot:${slotIndex}`}
                        className="flex flex-wrap items-center justify-between gap-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800"
                      >
                        <span>
                          {item.slotLabels?.[slotIndex]
                            ? `${item.slotLabels[slotIndex]}: `
                            : `[${slotIndex + 1}] `}
                          {slotValue === '' ? '∅' : slotValue}
                        </span>
                        <QuestionStatusBadge correctness={item.slotCorrectness?.[slotIndex] ?? null} />
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
                    {item.studentAnswer || '—'}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                  Correct answer
                </p>
                {item.correctAnswerSlots && item.correctAnswerSlots.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {item.correctAnswerSlots.map((slotValue, slotIndex) => (
                      <p
                        key={`${item.questionId}:correct-slot:${slotIndex}`}
                        className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800"
                      >
                        {item.slotLabels?.[slotIndex]
                          ? `${item.slotLabels[slotIndex]}: `
                          : `[${slotIndex + 1}] `}
                        {slotValue === '' ? '∅' : slotValue}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
                    {item.correctAnswer || '—'}
                  </p>
                )}
              </div>
            </div>

            {onOverride ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                <span className="mr-1 text-xs font-semibold text-gray-500">Set result:</span>
                {(item.slotQuestionIds && item.slotQuestionIds.length > 0
                  ? item.slotQuestionIds
                  : [item.questionId]
                ).map((targetQuestionId, targetIndex) => {
                  const isGrouped = Boolean(item.slotQuestionIds?.length);
                  const override = isGrouped
                    ? item.slotManualOverrides?.[targetIndex]
                    : item.manualOverride;
                  const isPending = pendingOverrideQuestionIds?.has(targetQuestionId) ?? false;
                  const targetLabel = isGrouped
                    ? item.slotLabels?.[targetIndex] ?? `Answer ${targetIndex + 1}`
                    : null;
                  return (
                    <div key={targetQuestionId} className="flex flex-wrap items-center gap-2">
                      {targetLabel ? <span className="text-xs text-gray-600">{targetLabel}</span> : null}
                      <button
                        type="button"
                        onClick={() => void onOverride(targetQuestionId, true)}
                        disabled={isPending}
                        aria-pressed={override?.isCorrect === true}
                        className={`min-h-9 rounded-md border px-3 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-50 ${
                          override?.isCorrect === true
                            ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-emerald-50 hover:text-emerald-800'
                        }`}
                      >
                        Mark correct
                      </button>
                      <button
                        type="button"
                        onClick={() => void onOverride(targetQuestionId, false)}
                        disabled={isPending}
                        aria-pressed={override?.isCorrect === false}
                        className={`min-h-9 rounded-md border px-3 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-50 ${
                          override?.isCorrect === false
                            ? 'border-rose-300 bg-rose-100 text-rose-800'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-rose-50 hover:text-rose-800'
                        }`}
                      >
                        Mark incorrect
                      </button>
                    </div>
                  );
                })}
                {pendingOverrideQuestionIds && pendingOverrideQuestionIds.size > 0 ? (
                  <span className="text-xs text-gray-500" role="status" aria-live="polite">
                    Saving…
                  </span>
                ) : null}
              </div>
            ) : null}
          </article>
          );
        })}
      </div>
    </section>
  );
}

export function QuestionTracebackPanel({
  section,
  examState,
  sectionSubmission,
  examLoading,
  examError,
  onOverride,
  pendingOverrideQuestionIds,
  overrideError,
}: QuestionTracebackPanelProps) {
  const schemaGroups = useMemo(
    () => buildQuestionTracebackGroups(examState, sectionSubmission, section),
    [examState, section, sectionSubmission],
  );
  const fallbackGroups = useMemo(
    () => buildFallbackTracebackGroups(section, sectionSubmission),
    [section, sectionSubmission],
  );
  const groups = schemaGroups.length > 0 || examLoading ? schemaGroups : fallbackGroups;

  const rawAnswerPayload = sectionSubmission ? sectionSubmission.answers : null;
  const objectiveAnswerMap = useMemo(
    () => (sectionSubmission ? extractObjectiveAnswerMap(sectionSubmission.answers) : {}),
    [sectionSubmission],
  );

  const numberingGapSummary = useMemo(() => {
    const seen = new Set<number>();
    const rootNumbers: number[] = [];

    groups.forEach((group) => {
      group.items.forEach((item) => {
        const parsed = Number.parseInt(item.rootNumberLabel ?? item.numberLabel, 10);
        if (Number.isFinite(parsed) && parsed > 0 && !seen.has(parsed)) {
          seen.add(parsed);
          rootNumbers.push(parsed);
        }
      });
    });

    if (rootNumbers.length < 2) {
      return null;
    }

    const sorted = [...rootNumbers].sort((left, right) => left - right);
    const missingRanges: string[] = [];

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined) continue;
      if (current - previous <= 1) continue;
      const start = previous + 1;
      const end = current - 1;
      missingRanges.push(start === end ? String(start) : `${start}-${end}`);
    }

    if (missingRanges.length === 0) {
      return null;
    }

    return missingRanges.join(', ');
  }, [groups]);

  const unmappedAnswerKeys = useMemo(() => {
    if (groups.length === 0) return [];
    const descriptorAnswerKeys = new Set(
      groups.flatMap((group) =>
        group.items.flatMap((item) => (item.answerKeys && item.answerKeys.length > 0 ? item.answerKeys : [item.answerKey]))
          .filter(Boolean),
      ),
    );

    return Object.keys(objectiveAnswerMap).filter((key) => !descriptorAnswerKeys.has(key));
  }, [groups, objectiveAnswerMap]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-200 px-4 py-4 sm:px-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <FileText size={18} className="mt-0.5 shrink-0 text-blue-600" />
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900">Traceback View</h3>
            <p className="break-words text-xs text-gray-600 capitalize">
              {section} section answer replay · text matches ignore letter case
            </p>
          </div>
        </div>
        </div>

      {examError ? (
        <div className="px-6 py-5 border-b border-gray-200 bg-red-50 text-sm text-red-800" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 text-red-700" />
            <div>
              <p className="font-medium">Could not load exam content</p>
              <p className="mt-1">{examError}</p>
              <p className="mt-2 text-red-700">Showing raw answers from the submission bundle:</p>
            </div>
          </div>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-white p-3 text-xs text-gray-800">
            {JSON.stringify(rawAnswerPayload, null, 2)}
          </pre>
        </div>
      ) : null}

      {overrideError ? (
        <div className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800" role="alert">
          {overrideError}
        </div>
      ) : null}

      {examLoading ? (
        <div className="space-y-4 p-4 md:p-6" role="status" aria-live="polite">
          <p className="sr-only">Loading exam...</p>
          <div className="h-14 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-14 animate-pulse rounded-xl bg-gray-100/70" />
          <div className="h-14 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-14 animate-pulse rounded-xl bg-gray-100/70" />
        </div>
      ) : null}

      {!examError && !examLoading && schemaGroups.length === 0 && fallbackGroups.length === 0 ? (
        <div className="px-6 py-6 text-sm text-gray-700">
          <p className="font-medium text-gray-900">No question schema available</p>
          <p className="mt-1 text-gray-600">
            The exam version loaded, but no questions were found for this section. Showing raw answers:
          </p>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
            {JSON.stringify(rawAnswerPayload, null, 2)}
          </pre>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="space-y-4 p-4 md:p-6">
          {examError && fallbackGroups.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Showing persisted answer results because the exam schema could not be loaded.
            </div>
          ) : null}

          {numberingGapSummary ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 text-amber-700" />
                <div>
                  <p className="font-medium">Question numbering has gaps in this exam version.</p>
                  <p className="mt-1">
                    Missing number range(s): {numberingGapSummary}. This traceback preserves canonical numbering.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {unmappedAnswerKeys.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 text-amber-700" />
                <div>
                  <p className="font-medium">
                    {unmappedAnswerKeys.length} stored answer key(s) do not map to this loaded exam schema.
                  </p>
                  <p className="mt-1">
                    Example key(s): {unmappedAnswerKeys.slice(0, 3).join(', ')}
                    {unmappedAnswerKeys.length > 3 ? ', ...' : ''}.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {groups.map((group, index) =>
            renderGroup(group, index, onOverride, pendingOverrideQuestionIds),
          )}
        </div>
      ) : null}
    </div>
  );
}
