import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { Header } from '@components/Header';
import { useBuilderRouteController } from '@builder/hooks/useBuilderRouteController';
import type { ExamState, ModuleType } from '../../../types';
import { createLatestOnlyAsyncRunner, type LatestOnlyAsyncRunner } from '../../../utils/latestOnlyAsync';
import { AcceptedAnswersEditor } from '@components/blocks/AcceptedAnswersEditor';
import { resolveAcceptedAnswers } from '../../../utils/acceptedAnswers';
import { applyAnswerKeyEdit, buildAnswerKeyRows, type AnswerKeyRow } from '../utils/answerKeyOverview';
import { getStudentQuestionsForModule, type StudentQuestionDescriptor } from '@services/examAdapterService';

type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'error';

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ExamAnswerKeyRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const controller = useBuilderRouteController(examId);

  const [localState, setLocalState] = useState<ExamState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<'all' | Extract<ModuleType, 'reading' | 'listening'>>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  const localStateRef = useRef<ExamState | null>(null);
  const debouncedAutosaveRef = useRef<number | null>(null);
  const pendingAutosaveRef = useRef<{ state: ExamState; requestId: number } | null>(null);
  const latestSaveRequestIdRef = useRef(0);
  const handleUpdateExamContentRef = useRef(controller.handleUpdateExamContent);
  const saveRunnerRef = useRef<LatestOnlyAsyncRunner<{ state: ExamState; requestId: number }> | null>(
    null,
  );

  useEffect(() => {
    handleUpdateExamContentRef.current = controller.handleUpdateExamContent;
  }, [controller.handleUpdateExamContent]);

  useEffect(() => {
    if (controller.state) {
      setLocalState(controller.state);
      localStateRef.current = controller.state;
      setSaveStatus('saved');
    }
  }, [controller.state]);

  if (!saveRunnerRef.current) {
    saveRunnerRef.current = createLatestOnlyAsyncRunner(async ({ state: nextState, requestId }) => {
      setSaveStatus('saving');
      try {
        await handleUpdateExamContentRef.current(nextState);
        if (requestId === latestSaveRequestIdRef.current) {
          setSaveStatus('saved');
        }
      } catch {
        if (requestId === latestSaveRequestIdRef.current) {
          setSaveStatus('error');
        }
        throw new Error('Save failed');
      }
    });
  }

  const scheduleAutosave = (nextState: ExamState) => {
    const requestId = ++latestSaveRequestIdRef.current;
    pendingAutosaveRef.current = { state: nextState, requestId };
    setSaveStatus('unsaved');

    if (debouncedAutosaveRef.current) {
      window.clearTimeout(debouncedAutosaveRef.current);
    }

    debouncedAutosaveRef.current = window.setTimeout(() => {
      const pending = pendingAutosaveRef.current;
      if (!pending) {
        return;
      }
      saveRunnerRef.current?.enqueue(pending);
      pendingAutosaveRef.current = null;
      debouncedAutosaveRef.current = null;
    }, 350);
  };

  const updateLocalState = (next: ExamState | ((previous: ExamState) => ExamState)) => {
    const base = localStateRef.current;
    if (!base) return;
    const resolved = typeof next === 'function' ? next(base) : next;
    setLocalState(resolved);
    localStateRef.current = resolved;
    scheduleAutosave(resolved);
  };

  const saveNow = async () => {
    const next = localStateRef.current;
    if (!next) return false;

    const requestId = ++latestSaveRequestIdRef.current;
    if (debouncedAutosaveRef.current) {
      window.clearTimeout(debouncedAutosaveRef.current);
      debouncedAutosaveRef.current = null;
    }
    pendingAutosaveRef.current = null;

    saveRunnerRef.current?.enqueue({ state: next, requestId });
    await saveRunnerRef.current?.idle();
    return !saveRunnerRef.current?.lastError;
  };

  const handleReturnToBuilder = () => {
    void (async () => {
      const saved = await saveNow();
      if (!saved) return;
      navigate(`/builder/${examId}/builder`);
    })();
  };

  const handleNavigateToConfig = () => {
    void (async () => {
      const saved = await saveNow();
      if (!saved) return;
      navigate(`/builder/${examId}`);
    })();
  };

  const handleNavigateToReview = () => {
    void (async () => {
      const saved = await saveNow();
      if (!saved) return;
      navigate(`/builder/${examId}/review`);
    })();
  };

  const handleReturnToAdmin = () => {
    void (async () => {
      const saved = await saveNow();
      if (!saved) return;
      navigate('/admin');
    })();
  };

  const allRows = useMemo(() => (localState ? buildAnswerKeyRows(localState) : []), [localState]);

  const groups = useMemo(() => {
    const unique = new Map<string, { id: string; label: string }>();
    for (const row of allRows) {
      const key = `${row.moduleType}:${row.groupId}`;
      if (!unique.has(key)) {
        unique.set(key, {
          id: key,
          label: `${row.moduleType === 'reading' ? 'Reading' : 'Listening'}: ${row.groupLabel}`,
        });
      }
    }
    return [
      { id: 'all', label: 'All groups' },
      ...Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (moduleFilter !== 'all' && row.moduleType !== moduleFilter) return false;
      if (groupFilter !== 'all' && `${row.moduleType}:${row.groupId}` !== groupFilter) return false;
      if (!q) return true;
      return (
        row.numberLabel.toLowerCase().includes(q)
        || row.prompt.toLowerCase().includes(q)
        || row.blockType.toLowerCase().includes(q)
      );
    });
  }, [allRows, groupFilter, moduleFilter, search]);

  const rowsByGroup = useMemo(() => {
    const map = new Map<string, AnswerKeyRow[]>();
    for (const row of filteredRows) {
      const key = `${row.moduleType}:${row.groupId}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries())
      .map(([key, rows]) => {
        const first = rows[0]!;
        return {
          key,
          moduleType: first.moduleType,
          groupId: first.groupId,
          groupLabel: first.groupLabel,
          rows: [...rows].sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true })),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [filteredRows]);

  if (!examId) {
    return <ErrorSurface title="Answer key unavailable" description="Exam ID not found." />;
  }

  if (controller.isLoading) {
    return <LoadingSurface label="Loading answer key…" />;
  }

  if (controller.error) {
    return <ErrorSurface title="Answer key load failed" description={controller.error} />;
  }

  if (!localState) {
    return <ErrorSurface title="Answer key unavailable" description="Exam content not found." />;
  }

  const saveStatusLabel = (() => {
    switch (saveStatus) {
      case 'unsaved':
        return 'Unsaved changes';
      case 'saving':
        return `Saving… (${nowLabel()})`;
      case 'saved':
        return 'All changes saved';
      case 'error':
        return 'Save failed';
    }
  })();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Header
        state={localState}
        onUpdateState={updateLocalState}
        onReturnToAdmin={handleReturnToAdmin}
        onNavigateToConfig={handleNavigateToConfig}
        onNavigateToReview={handleNavigateToReview}
        onSaveDraft={() => void saveNow()}
        saveStatusLabel={saveStatusLabel}
      />

      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReturnToBuilder}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              aria-label="Back to Builder"
            >
              <ArrowLeft size={16} />
              Builder
            </button>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Answer Key Overview</h1>
              <p className="text-xs text-slate-500">Reading + Listening</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600">Module</label>
              <select
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value as typeof moduleFilter)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800"
                aria-label="Filter by module"
              >
                <option value="all">All</option>
                <option value="reading">Reading</option>
                <option value="listening">Listening</option>
              </select>

              <label className="ml-2 text-xs font-semibold text-slate-600">Group</label>
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800"
                aria-label="Filter by group"
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.label}</option>
                ))}
              </select>
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full md:w-[360px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              placeholder="Search (Q#, prompt, type)…"
              aria-label="Search answer keys"
            />
          </div>
        </div>

        <div className="space-y-6">
          {rowsByGroup.map((group) => (
            <section key={group.key} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">
                  {group.moduleType === 'reading' ? 'Reading' : 'Listening'}: {group.groupLabel}
                </h2>
                <p className="text-xs text-slate-500">{group.rows.length} slot(s)</p>
              </div>
              <div className="p-5 space-y-4">
                {group.rows.map((row) => (
                  <AnswerKeyRowEditor
                    key={row.rowId}
                    examId={examId}
                    row={row}
                    state={localState}
                    onUpdateState={updateLocalState}
                    onSaveNow={saveNow}
                    onNavigate={(path) => navigate(path)}
                  />
                ))}
              </div>
            </section>
          ))}
          {rowsByGroup.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
              No matching questions.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AnswerKeyRowEditor({
  examId,
  row,
  state,
  onUpdateState,
  onSaveNow,
  onNavigate,
}: {
  examId: string;
  row: AnswerKeyRow;
  state: ExamState;
  onUpdateState: (next: ExamState | ((previous: ExamState) => ExamState)) => void;
  onSaveNow: () => Promise<boolean>;
  onNavigate: (path: string) => void;
}) {
  const descriptors = useMemo(
    () => getStudentQuestionsForModule(state, row.moduleType),
    [row.moduleType, state],
  );
  const descriptor = useMemo(
    () => descriptors.find((candidate) => candidate.id === row.descriptorId) ?? null,
    [descriptors, row.descriptorId],
  );

  const handleOpenInBuilder = () => {
    void (async () => {
      const saved = await onSaveNow();
      if (!saved) return;
      onNavigate(`/builder/${examId}/builder?jumpField=${encodeURIComponent(row.jumpField)}`);
    })();
  };

  const updateViaEdit = (edit: Parameters<typeof applyAnswerKeyEdit>[2]) => {
    onUpdateState((prev) => applyAnswerKeyEdit(prev, row, edit));
  };

  const answerControl = descriptor
    ? (
        <AnswerControl
          descriptor={descriptor}
          onEdit={updateViaEdit}
        />
      )
    : (
        <div className="text-xs text-slate-600">Descriptor not found for this slot.</div>
      );

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            {row.numberLabel} · {row.blockType}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900 break-words">
            {row.prompt || 'Question prompt unavailable'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleOpenInBuilder}
          className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Open in Builder
        </button>
      </div>

      <div className="mt-3">
        {answerControl}
      </div>
    </div>
  );
}

function AnswerControl({
  descriptor,
  onEdit,
}: {
  descriptor: StudentQuestionDescriptor;
  onEdit: (edit: Parameters<typeof applyAnswerKeyEdit>[2]) => void;
}) {
  const { block, question, answerIndex } = descriptor;

  if (descriptor.isSubAnswerTreeLeaf) {
    const currentAccepted = getSubAnswerLeafAcceptedAnswers(block as any, descriptor.id);
    return (
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Accepted Answers</div>
        <div className="mt-2">
          <AcceptedAnswersEditor
            value={currentAccepted}
            onChange={(next) => onEdit({ kind: 'set_sub_answer_leaf_accepted_answers', leafId: descriptor.id, acceptedAnswers: next })}
            placeholder="Enter accepted answer…"
          />
        </div>
      </div>
    );
  }

  switch (block.type) {
    case 'TFNG': {
      const current = question && 'correctAnswer' in question ? String((question as any).correctAnswer ?? '') : '';
      const mode = (block as any).mode === 'YNNG' ? 'YNNG' : 'TFNG';
      const choices = mode === 'YNNG' ? ['Y', 'N', 'NG'] : ['T', 'F', 'NG'];
      return (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Correct</label>
          <select
            value={current}
            onChange={(e) => onEdit({ kind: 'set_tfng', questionId: descriptor.answerKey, value: e.target.value as any })}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-800"
          >
            <option value="">(none)</option>
            {choices.map((choice) => (
              <option key={choice} value={choice}>{choice}</option>
            ))}
          </select>
        </div>
      );
    }

    case 'CLOZE':
    case 'SHORT_ANSWER': {
      const base = question && 'correctAnswer' in question ? (question as any) : null;
      const currentAccepted = base ? resolveAcceptedAnswers(base) : [];
      return (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Accepted Answers</div>
          <div className="mt-2">
            <AcceptedAnswersEditor
              value={currentAccepted}
              onChange={(next) => onEdit({ kind: 'set_accepted_answer_fields', questionId: descriptor.answerKey, acceptedAnswers: next })}
              placeholder="Enter accepted answer…"
            />
          </div>
        </div>
      );
    }

    case 'SENTENCE_COMPLETION': {
      if (!question || !('blanks' in question) || !Array.isArray((question as any).blanks) || typeof answerIndex !== 'number') {
        return <div className="text-xs text-slate-600">Blank not found.</div>;
      }
      const blank = (question as any).blanks[answerIndex];
      const currentAccepted = blank ? resolveAcceptedAnswers(blank) : [];
      return (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Accepted Answers</div>
          <div className="mt-2">
            <AcceptedAnswersEditor
              value={currentAccepted}
              onChange={(next) => onEdit({ kind: 'set_sentence_blank_accepted_answer_fields', questionId: (question as any).id, blankIndex: answerIndex, acceptedAnswers: next })}
              placeholder="Enter accepted answer…"
            />
          </div>
        </div>
      );
    }

    case 'NOTE_COMPLETION': {
      if (!question || !('blanks' in question) || !Array.isArray((question as any).blanks) || typeof answerIndex !== 'number') {
        return <div className="text-xs text-slate-600">Blank not found.</div>;
      }
      const blank = (question as any).blanks[answerIndex];
      const currentAccepted = blank ? resolveAcceptedAnswers(blank) : [];
      return (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Accepted Answers</div>
          <div className="mt-2">
            <AcceptedAnswersEditor
              value={currentAccepted}
              onChange={(next) => onEdit({ kind: 'set_note_blank_accepted_answer_fields', questionId: (question as any).id, blankIndex: answerIndex, acceptedAnswers: next })}
              placeholder="Enter accepted answer…"
            />
          </div>
        </div>
      );
    }

    case 'TABLE_COMPLETION': {
      if (typeof answerIndex !== 'number' || !('cells' in block) || !Array.isArray((block as any).cells)) {
        return <div className="text-xs text-slate-600">Cell not found.</div>;
      }
      const cell = (block as any).cells[answerIndex];
      const currentAccepted = cell ? resolveAcceptedAnswers(cell) : [];
      return (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Accepted Answers</div>
          <div className="mt-2">
            <AcceptedAnswersEditor
              value={currentAccepted}
              onChange={(next) => onEdit({ kind: 'set_table_cell_accepted_answer_fields', cellIndex: answerIndex, acceptedAnswers: next })}
              placeholder="Enter accepted answer…"
            />
          </div>
        </div>
      );
    }

    case 'MATCHING': {
      const headings = Array.isArray((block as any).headings) ? (block as any).headings : [];
      const current = question && 'correctHeading' in question ? String((question as any).correctHeading ?? '') : '';
      return (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Correct</label>
          <select
            value={current}
            onChange={(e) => onEdit({ kind: 'set_matching_heading', questionId: descriptor.answerKey, headingId: e.target.value })}
            className="min-w-[220px] rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800"
          >
            <option value="">(none)</option>
            {headings.map((h: any) => (
              <option key={h.id} value={h.id}>
                {h.text}
              </option>
            ))}
          </select>
        </div>
      );
    }

    case 'MAP': {
      const current = question && 'correctAnswer' in question ? String((question as any).correctAnswer ?? '') : '';
      return (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Correct</label>
          <input
            type="text"
            value={current}
            onChange={(e) => onEdit({ kind: 'set_text_answer', questionId: descriptor.answerKey, value: e.target.value })}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="Enter correct answer…"
          />
        </div>
      );
    }

    case 'MULTI_MCQ': {
      const options = Array.isArray((block as any).options) ? (block as any).options : [];
      const currentCorrect = new Set<string>(
        options
          .filter((opt: any) => opt.isCorrect)
          .map((opt: any) => String(opt.id)),
      );
      return (
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Correct Options</div>
          <div className="grid gap-2 md:grid-cols-2">
            {options.map((opt: any) => (
              <label key={opt.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={currentCorrect.has(opt.id)}
                  disabled={currentCorrect.has(opt.id) && currentCorrect.size === 1}
                  onChange={(e) => {
                    const next = new Set(currentCorrect);
                    if (e.target.checked) next.add(opt.id);
                    else next.delete(opt.id);
                    onEdit({ kind: 'set_multi_mcq_correct', optionIds: Array.from(next) });
                  }}
                />
                <span className="text-slate-800">{opt.text}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }

    case 'SINGLE_MCQ': {
      const blockQuestions = Array.isArray((block as any).questions) && (block as any).questions.length > 0
        ? (block as any).questions
        : [{ id: block.id, stem: (block as any).stem ?? '', options: (block as any).options ?? [] }];
      const matched = blockQuestions.find((q: any) => q.id === descriptor.answerKey) ?? blockQuestions[0];
      const options = Array.isArray(matched?.options) ? matched.options : [];
      const selected = options.find((opt: any) => opt.isCorrect)?.id ?? '';

      return (
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Correct Option</div>
          <div className="grid gap-2 md:grid-cols-2">
            {options.map((opt: any) => (
              <label key={opt.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                <input
                  type="radio"
                  name={`single-mcq-${descriptor.answerKey}`}
                  checked={selected === opt.id}
                  onChange={() => onEdit({ kind: 'set_single_mcq_correct', questionId: matched.id, optionId: opt.id })}
                />
                <span className="text-slate-800">{opt.text}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }

    case 'DIAGRAM_LABELING': {
      if (typeof answerIndex !== 'number' || !Array.isArray((block as any).labels)) {
        return <div className="text-xs text-slate-600">Label not found.</div>;
      }
      const label = (block as any).labels[answerIndex];
      const current = label ? String(label.correctAnswer ?? '') : '';
      return (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Correct</label>
          <input
            type="text"
            value={current}
            onChange={(e) => onEdit({ kind: 'set_diagram_label_answer', labelIndex: answerIndex, value: e.target.value })}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="Enter correct answer…"
          />
        </div>
      );
    }

    case 'FLOW_CHART': {
      if (typeof answerIndex !== 'number' || !Array.isArray((block as any).steps)) {
        return <div className="text-xs text-slate-600">Step not found.</div>;
      }
      const step = (block as any).steps[answerIndex];
      const current = step ? String(step.correctAnswer ?? '') : '';
      return (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Correct</label>
          <input
            type="text"
            value={current}
            onChange={(e) => onEdit({ kind: 'set_flow_step_answer', stepIndex: answerIndex, value: e.target.value })}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="Enter correct answer…"
          />
        </div>
      );
    }

    case 'CLASSIFICATION': {
      if (typeof answerIndex !== 'number') {
        return <div className="text-xs text-slate-600">Item not found.</div>;
      }
      const categories = Array.isArray((block as any).categories) ? (block as any).categories : [];
      const item = Array.isArray((block as any).items) ? (block as any).items[answerIndex] : null;
      const current = item ? String(item.correctCategory ?? '') : '';
      return (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Correct</label>
          <select
            value={current}
            onChange={(e) => onEdit({ kind: 'set_classification_category', itemIndex: answerIndex, category: e.target.value })}
            className="min-w-[220px] rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800"
          >
            <option value="">(none)</option>
            {categories.map((cat: string) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      );
    }

    case 'MATCHING_FEATURES': {
      if (typeof answerIndex !== 'number') {
        return <div className="text-xs text-slate-600">Feature not found.</div>;
      }
      const options = Array.isArray((block as any).options) ? (block as any).options : [];
      const feature = Array.isArray((block as any).features) ? (block as any).features[answerIndex] : null;
      const current = feature ? String(feature.correctMatch ?? '') : '';
      return (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Correct</label>
          <select
            value={current}
            onChange={(e) => onEdit({ kind: 'set_matching_feature_match', featureIndex: answerIndex, match: e.target.value })}
            className="min-w-[220px] rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800"
          >
            <option value="">(none)</option>
            {current && !options.includes(current) ? (
              <option value={current}>{`Invalid saved answer: ${current}`}</option>
            ) : null}
            {options.map((opt: string) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }
  }
}

function parseTreeLeafId(leafId: string): { rootNodeId: string; nodeId: string } | null {
  const marker = '::tree::';
  const index = leafId.indexOf(marker);
  if (index < 0) return null;
  const tail = leafId.slice(index + marker.length);
  const [rootNodeId, nodeId] = tail.split('::');
  if (!rootNodeId || !nodeId) return null;
  return { rootNodeId, nodeId };
}

function findTreeNodeAcceptedAnswers(root: any, nodeId: string): string[] {
  const visit = (node: any): string[] | null => {
    if (!node || typeof node !== 'object') return null;
    if (node.id === nodeId) {
      return Array.isArray(node.acceptedAnswers) ? node.acceptedAnswers.filter((x: any) => typeof x === 'string') : [];
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };

  return visit(root) ?? [];
}

function getSubAnswerLeafAcceptedAnswers(block: any, leafId: string): string[] {
  const parsed = parseTreeLeafId(leafId);
  if (!parsed) return [];
  const roots = Array.isArray(block?.answerTree) ? block.answerTree : [];
  const root = roots.find((r: any) => r && typeof r === 'object' && r.id === parsed.rootNodeId);
  if (!root) return [];
  return findTreeNodeAcceptedAnswers(root, parsed.nodeId);
}
