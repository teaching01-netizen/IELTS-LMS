import React, { useEffect, useMemo, useState } from 'react';
import type { ExamState, ModuleType } from '../../types';
import { examRepository } from '../../services/examRepository';
import { gradingService } from '../../services/gradingService';
import type {
  GradingScheduleObjectiveOverrideRow,
  ObjectiveOverrideDeleteRequest,
  ObjectiveOverrideMutationResponse,
  ObjectiveOverrideUpsertRequest,
} from '../../types/grading';
import type { StudentQuestionDescriptor } from '../../services/examAdapterService';
import { getStudentQuestionsForModule } from '../../services/examAdapterService';
import { getCorrectAnswerDisplay, getQuestionPrompt } from './gradingAnswerUtils';

type ObjectiveModule = Extract<ModuleType, 'reading' | 'listening'>;

type ObjectiveQuestionItem = {
  moduleType: ObjectiveModule;
  descriptor: StudentQuestionDescriptor;
  prompt: string;
  defaultCorrectAnswer: string;
  defaultScoringRule: string;
  defaultMaxScore: number;
};

function toTextLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function getDefaultScoringRule(descriptor: StudentQuestionDescriptor): string {
  if (descriptor.isSubAnswerTreeLeaf) {
    return 'sub_answer_tree';
  }

  const { block, question } = descriptor;
  const maybeRule =
    question && typeof (question as { answerRule?: unknown }).answerRule === 'string'
      ? String((question as { answerRule?: string }).answerRule)
      : typeof (block as { answerRule?: unknown }).answerRule === 'string'
        ? String((block as { answerRule?: string }).answerRule)
        : null;

  if (maybeRule && maybeRule.trim() !== '') {
    return maybeRule;
  }

  switch (block.type) {
    case 'MULTI_MCQ':
      return 'MULTI_MCQ';
    case 'SINGLE_MCQ':
      return 'single_choice';
    case 'DIAGRAM_LABELING':
      return 'diagram_label';
    case 'FLOW_CHART':
      return 'flow_chart';
    case 'TABLE_COMPLETION':
      return 'table_completion';
    case 'CLASSIFICATION':
      return 'classification';
    case 'MATCHING_FEATURES':
      return 'matching_features';
    default:
      return 'exact_match';
  }
}

function buildQuestionItems(examState: ExamState): ObjectiveQuestionItem[] {
  const items: ObjectiveQuestionItem[] = [];
  (['reading', 'listening'] as const).forEach((moduleType) => {
    const descriptors = getStudentQuestionsForModule(examState, moduleType);
    descriptors.forEach((descriptor) => {
      items.push({
        moduleType,
        descriptor,
        prompt: getQuestionPrompt(descriptor),
        defaultCorrectAnswer: getCorrectAnswerDisplay(descriptor),
        defaultScoringRule: getDefaultScoringRule(descriptor),
        defaultMaxScore: 1,
      });
    });
  });
  return items;
}

function buildEmptyUpsertRequest(
  question: ObjectiveQuestionItem,
  existing: GradingScheduleObjectiveOverrideRow | undefined,
): ObjectiveOverrideUpsertRequest {
  const override = existing?.overrideJson;

  return {
    correctAnswer: override?.correctAnswer ?? '',
    acceptedAnswers: override?.acceptedAnswers ?? [],
    correctOptionIds: override?.correctOptionIds ?? [],
    scoringRule: override?.scoringRule ?? question.defaultScoringRule,
    maxScore: override?.maxScore ?? question.defaultMaxScore,
    reason: '',
  };
}

export function ObjectiveOverridesPanel(props: { scheduleId: string; publishedVersionId?: string | undefined }) {
  const { scheduleId, publishedVersionId } = props;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ObjectiveQuestionItem[]>([]);
  const [overrides, setOverrides] = useState<GradingScheduleObjectiveOverrideRow[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [form, setForm] = useState<ObjectiveOverrideUpsertRequest | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationResult, setMutationResult] = useState<ObjectiveOverrideMutationResponse | null>(null);
  const [mutating, setMutating] = useState(false);

  const overridesByQuestionId = useMemo(() => {
    const map = new Map<string, GradingScheduleObjectiveOverrideRow>();
    overrides.forEach((row) => map.set(row.questionId, row));
    return map;
  }, [overrides]);

  const selected = useMemo(() => {
    if (!selectedQuestionId) return null;
    return questions.find((q) => q.descriptor.id === selectedQuestionId) ?? null;
  }, [questions, selectedQuestionId]);

  useEffect(() => {
    if (!open) return;
    if (!publishedVersionId) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const run = async () => {
      try {
        const [version, overrideResult] = await Promise.all([
          examRepository.getVersionById(publishedVersionId),
          gradingService.getObjectiveOverrides(scheduleId),
        ]);
        if (cancelled) return;
        if (!version?.contentSnapshot) {
          throw new Error('Could not load published exam snapshot for this schedule.');
        }
        const examState = version.contentSnapshot as ExamState;
        setQuestions(buildQuestionItems(examState));
        if (overrideResult.success && overrideResult.data) {
          setOverrides(overrideResult.data);
        } else {
          setOverrides([]);
        }
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, publishedVersionId, scheduleId]);

  useEffect(() => {
    if (!selected) return;
    const existing = overridesByQuestionId.get(selected.descriptor.id);
    setForm(buildEmptyUpsertRequest(selected, existing));
    setMutationError(null);
    setMutationResult(null);
  }, [overridesByQuestionId, selected]);

  const refreshOverrides = async () => {
    const overrideResult = await gradingService.getObjectiveOverrides(scheduleId);
    if (overrideResult.success && overrideResult.data) {
      setOverrides(overrideResult.data);
    }
  };

  const handleSave = async () => {
    if (!selected || !form) return;
    setMutationError(null);
    setMutationResult(null);

    if (!form.reason.trim()) {
      setMutationError('Reason is required.');
      return;
    }

    setMutating(true);
    try {
      const payload: ObjectiveOverrideUpsertRequest = {
        correctAnswer: form.correctAnswer?.trim() ? form.correctAnswer : undefined,
        acceptedAnswers: Array.isArray(form.acceptedAnswers) ? form.acceptedAnswers : [],
        correctOptionIds: Array.isArray(form.correctOptionIds) ? form.correctOptionIds : [],
        scoringRule: form.scoringRule,
        maxScore: Number.isFinite(form.maxScore) ? form.maxScore : 0,
        reason: form.reason,
      };

      const result = await gradingService.upsertObjectiveOverride(scheduleId, selected.descriptor.id, payload);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Failed to save override');
      }
      setMutationResult(result.data);
      await refreshOverrides();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setMutating(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || !form) return;
    setMutationError(null);
    setMutationResult(null);

    if (!form.reason.trim()) {
      setMutationError('Reason is required.');
      return;
    }

    setMutating(true);
    try {
      const payload: ObjectiveOverrideDeleteRequest = { reason: form.reason };
      const result = await gradingService.deleteObjectiveOverride(scheduleId, selected.descriptor.id, payload);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Failed to delete override');
      }
      setMutationResult(result.data);
      await refreshOverrides();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setMutating(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <div className="text-sm font-semibold text-gray-900">Session Settings</div>
          <div className="text-xs text-gray-500">Objective overrides (answer key + scoring)</div>
        </div>
        <div className="text-sm font-medium text-gray-600">{open ? 'Hide' : 'Show'}</div>
      </button>

      {open ? (
        <div className="border-t border-gray-200 px-4 py-4">
          {loading ? (
            <div className="text-sm text-gray-600">Loading objective questions…</div>
          ) : loadError ? (
            <div className="text-sm text-red-700">{loadError}</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Questions ({questions.length})
                </div>
                <div className="max-h-[420px] overflow-auto rounded-md border border-gray-200">
                  {questions.map((q) => {
                    const active = overridesByQuestionId.has(q.descriptor.id);
                    const isSelected = q.descriptor.id === selectedQuestionId;
                    return (
                      <button
                        key={q.descriptor.id}
                        type="button"
                        onClick={() => setSelectedQuestionId(q.descriptor.id)}
                        className={[
                          'flex w-full flex-col gap-1 border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50',
                          isSelected ? 'bg-blue-50' : '',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-gray-900">
                            {q.moduleType.toUpperCase()} • {q.descriptor.id}
                          </div>
                          {active ? (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                              Override
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-gray-600 line-clamp-2">{q.prompt}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Edit</div>
                {selected && form ? (
                  <div className="space-y-3 rounded-md border border-gray-200 p-3">
                    <div>
                      <div className="text-xs font-semibold text-gray-700">Question</div>
                      <div className="text-xs text-gray-600">{selected.descriptor.id}</div>
                      <div className="mt-1 text-xs text-gray-600">{selected.prompt}</div>
                      <div className="mt-2 text-xs font-semibold text-gray-700">Current key</div>
                      <div className="text-xs text-gray-600">{selected.defaultCorrectAnswer}</div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <div className="text-xs font-semibold text-gray-700">Scoring rule</div>
                        <input
                          value={form.scoringRule}
                          onChange={(e) => setForm({ ...form, scoringRule: e.target.value })}
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          placeholder="exact_match / ONE_WORD / TWO_WORDS / THREE_WORDS / MULTI_MCQ"
                        />
                      </label>
                      <label className="block">
                        <div className="text-xs font-semibold text-gray-700">Max score</div>
                        <input
                          type="number"
                          value={form.maxScore}
                          onChange={(e) => setForm({ ...form, maxScore: Number(e.target.value) })}
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          min={0}
                          step={1}
                        />
                      </label>
                    </div>

                    <label className="block">
                      <div className="text-xs font-semibold text-gray-700">Correct answer (text)</div>
                      <input
                        value={form.correctAnswer ?? ''}
                        onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })}
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                        placeholder='e.g. Top (case/whitespace sensitive)'
                      />
                    </label>

                    <label className="block">
                      <div className="text-xs font-semibold text-gray-700">Accepted answers (one per line)</div>
                      <textarea
                        value={(form.acceptedAnswers ?? []).join('\n')}
                        onChange={(e) => setForm({ ...form, acceptedAnswers: toTextLines(e.target.value) })}
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                        rows={3}
                        placeholder={'Alternative answers.\nUse | inside a line for variants.'}
                      />
                    </label>

                    <label className="block">
                      <div className="text-xs font-semibold text-gray-700">Correct option ids (MCQ, one per line)</div>
                      <textarea
                        value={(form.correctOptionIds ?? []).join('\n')}
                        onChange={(e) => setForm({ ...form, correctOptionIds: toTextLines(e.target.value) })}
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                        rows={2}
                        placeholder={'e.g.\nA\nC'}
                      />
                    </label>

                    <label className="block">
                      <div className="text-xs font-semibold text-gray-700">Reason (required)</div>
                      <input
                        value={form.reason}
                        onChange={(e) => setForm({ ...form, reason: e.target.value })}
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                        placeholder="Why is this override needed?"
                      />
                    </label>

                    {mutationError ? <div className="text-sm text-red-700">{mutationError}</div> : null}
                    {mutationResult ? (
                      <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        Regraded: {mutationResult.regradeReport.sectionsUpdated} sections updated.
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={mutating}
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {mutating ? 'Saving…' : 'Save override + regrade'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete()}
                        disabled={mutating || !overridesByQuestionId.has(selected.descriptor.id)}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
                      >
                        Remove override
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-gray-200 p-3 text-sm text-gray-600">
                    Select a question to edit.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

