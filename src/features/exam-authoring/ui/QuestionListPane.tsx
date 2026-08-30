import { useMemo, useState, type RefObject } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileUp,
  MoveRight,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  AssessmentModuleShell,
  AssessmentQuestionSummary,
  AssessmentSectionShell,
  BulkMetadataPatch,
  BulkQuestionAction,
  Difficulty,
} from "../contracts/assessment";
import { SAT_DOMAINS, getSatSkills } from "../providers/sat/taxonomy";
import { ConfirmPopover } from "./ConfirmPopover";
import { ModuleScopePicker } from "./ModuleScopePicker";

export type QuestionListFilter = "all" | "ready" | "incomplete" | "error";

export interface QuestionListPaneProps {
  module: AssessmentModuleShell;
  sections: AssessmentSectionShell[];
  sectionKey: string;
  moveTargets: AssessmentModuleShell[];
  selectedQuestionId: string | null;
  selectedQuestionIds: ReadonlySet<string>;
  searchQuery: string;
  filter: QuestionListFilter;
  searchInputRef: RefObject<HTMLInputElement | null>;
  isMutating: boolean;
  onSearchQueryChange: (value: string) => void;
  onSelectModule: (moduleId: string) => void;
  onOpenImport: () => void;
  onFilterChange: (value: QuestionListFilter) => void;
  onSelectQuestion: (questionId: string) => void;
  onCreateQuestion: () => void;
  onToggleSelection: (questionId: string, range: boolean) => void;
  onClearSelection: () => void;
  onQuickAnswerKey: (questionId: string, optionId: string) => void;
  onReorder: (questionIds: string[], expectedQuestionIds: string[]) => Promise<void>;
  onBulkAction: (questionIds: string[], action: BulkQuestionAction, expectedRevisions?: Record<string, number>) => Promise<void>;
}

type ListRow =
  | { kind: "question"; question: AssessmentQuestionSummary }
  | { kind: "empty"; displayOrder: number };

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchesSearch(question: AssessmentQuestionSummary, query: string): boolean {
  if (!query) return true;
  return [
    question.promptPreview,
    question.answerKeyPreview ?? "",
    question.domain ?? "",
    question.skill ?? "",
    question.difficulty,
    ...question.tags,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

export function QuestionListPane(props: QuestionListPaneProps) {
  const query = normalizeSearch(props.searchQuery);
  const rows = useMemo<ListRow[]>(() => {
    const questions = props.module.questions.filter((question) => {
      if (!matchesSearch(question, query)) return false;
      return props.filter === "all" || question.readiness.status === props.filter;
    });
    const result: ListRow[] = questions.map((question) => ({ kind: "question", question }));
    if (!query && props.filter === "all") {
      for (let index = props.module.questions.length; index < props.module.targetQuestionCount; index += 1) {
        result.push({ kind: "empty", displayOrder: index });
      }
    }
    return result;
  }, [props.filter, props.module.questions, props.module.targetQuestionCount, query]);

  const readinessCounts = useMemo(() => {
    const counts = { ready: 0, incomplete: 0, error: 0 };
    for (const question of props.module.questions) counts[question.readiness.status] += 1;
    return counts;
  }, [props.module.questions]);

  return (
    <section className="flex min-h-0 w-[430px] min-w-[360px] flex-col border-r border-black/[0.06] bg-white" aria-label={`${props.module.title} questions`}>
      <div className="border-b border-black/[0.055] px-3 pb-3 pt-2.5">
        <div className="mb-2 flex items-center gap-1">
          <ModuleScopePicker
            sections={props.sections}
            selectedModuleId={props.module.id}
            disabled={props.isMutating}
            onSelectModule={props.onSelectModule}
          />
          <button
            type="button"
            onClick={props.onOpenImport}
            disabled={props.isMutating || props.module.questions.length >= props.module.targetQuestionCount}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-semibold text-slate-500 transition hover:bg-black/[0.04] hover:text-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/10 disabled:opacity-30"
            aria-label="Paste or import questions into this module"
            title="Paste questions"
          >
            <FileUp size={13} />
            <span className="hidden 2xl:inline">Paste</span>
          </button>
          <button
            type="button"
            onClick={props.onCreateQuestion}
            disabled={props.isMutating || props.module.questions.length >= props.module.targetQuestionCount}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#0071e3] px-3 text-[10px] font-semibold text-white transition hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/20 disabled:opacity-35"
          >
            <Plus size={13} /> Question
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={props.searchInputRef}
            type="search"
            value={props.searchQuery}
            onChange={(event) => props.onSearchQueryChange(event.target.value)}
            placeholder="Search questions"
            aria-label="Search questions"
            className="h-10 w-full rounded-xl bg-black/[0.035] pl-9 pr-9 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-[#0071e3]/10"
          />
          {props.searchQuery ? (
            <button type="button" onClick={() => props.onSearchQueryChange("")} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-black/[0.05]" aria-label="Clear question search"><X size={12} /></button>
          ) : null}
        </div>
        <div className="authoring-segmented mt-2 grid grid-cols-4 rounded-xl p-1" aria-label="Question readiness filters">
          {([
            ["all", "All", props.module.questions.length],
            ["ready", "Ready", readinessCounts.ready],
            ["incomplete", "Needs work", readinessCounts.incomplete],
            ["error", "Errors", readinessCounts.error],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={props.filter === value}
              onClick={() => props.onFilterChange(value)}
              className={`min-w-0 rounded-lg px-1.5 py-1.5 text-[9px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/20 ${props.filter === value ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-slate-500 hover:text-slate-800"}`}
            >
              <span className="truncate">{label}</span> <span className="tabular-nums text-slate-400">{count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {rows.length ? (
          <Virtuoso
            data={rows}
            itemContent={(_, row) => row.kind === "empty" ? (
              <EmptyQuestionRow displayOrder={row.displayOrder} disabled={props.isMutating} onCreate={props.onCreateQuestion} />
            ) : (
              <QuestionRow
                question={row.question}
                selected={row.question.examQuestionId === props.selectedQuestionId}
                checked={props.selectedQuestionIds.has(row.question.examQuestionId)}
                disabled={props.isMutating}
                moduleQuestions={props.module.questions}
                onSelect={props.onSelectQuestion}
                onToggleSelection={props.onToggleSelection}
                onQuickAnswerKey={props.onQuickAnswerKey}
                onReorder={props.onReorder}
              />
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center"><div><p className="text-xs font-semibold text-slate-600">No matching questions</p><p className="mt-1 text-[11px] leading-5 text-slate-400">Change the search or readiness filter.</p></div></div>
        )}
      </div>

      {props.selectedQuestionIds.size ? (
        <BulkToolbar {...props} selectedIds={[...props.selectedQuestionIds]} />
      ) : null}
    </section>
  );
}

function QuestionRow({
  question,
  selected,
  checked,
  disabled,
  moduleQuestions,
  onSelect,
  onToggleSelection,
  onQuickAnswerKey,
  onReorder,
}: {
  question: AssessmentQuestionSummary;
  selected: boolean;
  checked: boolean;
  disabled: boolean;
  moduleQuestions: AssessmentQuestionSummary[];
  onSelect: (questionId: string) => void;
  onToggleSelection: (questionId: string, range: boolean) => void;
  onQuickAnswerKey: (questionId: string, optionId: string) => void;
  onReorder: (questionIds: string[], expectedQuestionIds: string[]) => Promise<void>;
}) {
  const index = moduleQuestions.findIndex((item) => item.examQuestionId === question.examQuestionId);
  const expectedIds = moduleQuestions.map((item) => item.examQuestionId);
  const move = (direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= expectedIds.length) return;
    const next = [...expectedIds];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void onReorder(next, expectedIds);
  };
  return (
    <div
      data-question-list-row={question.examQuestionId}
      className={`group mx-2 my-1 rounded-xl border transition ${selected ? "border-[#0071e3]/35 bg-[#0071e3]/[0.055]" : "border-transparent hover:bg-black/[0.025]"}`}
    >
      <div className="flex min-h-[76px] items-start gap-2 px-2.5 py-2.5">
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => onToggleSelection(question.examQuestionId, event.shiftKey)}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] transition ${checked ? "border-[#0071e3] bg-[#0071e3] text-white" : "border-slate-200 bg-white text-transparent group-hover:text-slate-300"}`}
          aria-label={`${checked ? "Deselect" : "Select"} question ${question.displayOrder + 1}`}
          aria-pressed={checked}
        >✓</button>
        <button type="button" onClick={() => onSelect(question.examQuestionId)} className="min-w-0 flex-1 text-left" disabled={disabled}>
          <div className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">{question.displayOrder + 1}</span>
            <span className="truncate text-[12px] font-medium text-slate-900">{question.promptPreview || "Empty question"}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 pl-8 text-[9px] font-medium text-slate-400">
            <ReadinessDot question={question} />
            {question.domain ? <span className="max-w-[112px] truncate">{question.domain.replaceAll("-", " ")}</span> : <span>No domain</span>}
            <span>·</span><span className="capitalize">{question.difficulty}</span>
            {question.hasStimulus ? <><span>·</span><span>Stimulus</span></> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {question.questionType === "single_choice" ? (
            <div className="flex gap-0.5" aria-label={`Question ${question.displayOrder + 1} answer key`}>
              {(["A", "B", "C", "D"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  aria-pressed={question.answerKeyPreview === option}
                  onClick={() => onQuickAnswerKey(question.examQuestionId, option)}
                  className={`h-6 w-6 rounded-md text-[9px] font-bold transition ${question.answerKeyPreview === option ? "bg-emerald-600 text-white" : "text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus-visible:opacity-100"}`}
                >{option}</button>
              ))}
            </div>
          ) : <span className="rounded-md bg-slate-100 px-1.5 py-1 text-[9px] font-semibold text-slate-500">SPR</span>}
          <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button type="button" disabled={disabled || index <= 0} onClick={() => move(-1)} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20" aria-label="Move question up"><ChevronUp size={12} /></button>
            <button type="button" disabled={disabled || index >= moduleQuestions.length - 1} onClick={() => move(1)} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20" aria-label="Move question down"><ChevronDown size={12} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadinessDot({ question }: { question: AssessmentQuestionSummary }) {
  if (question.readiness.status === "ready") return <CheckCircle2 size={11} className="text-emerald-500" aria-label="Ready" />;
  if (question.readiness.status === "error") return <AlertCircle size={11} className="text-red-500" aria-label="Error" />;
  return <span className="h-2 w-2 rounded-full bg-slate-300" aria-label="Incomplete" />;
}

function EmptyQuestionRow({ displayOrder, disabled, onCreate }: { displayOrder: number; disabled: boolean; onCreate: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onCreate} className="mx-2 my-1 flex min-h-[58px] w-[calc(100%_-_1rem)] items-center gap-3 rounded-xl border border-dashed border-black/[0.09] px-3 text-left text-slate-400 transition hover:border-[#0071e3]/25 hover:bg-[#0071e3]/[0.025] hover:text-slate-700 disabled:opacity-40">
      <span className="w-6 text-[11px] font-semibold tabular-nums">{displayOrder + 1}</span><Plus size={13} /><span className="text-[11px] font-medium">Empty slot · create question</span>
    </button>
  );
}

function BulkToolbar(props: QuestionListPaneProps & { selectedIds: string[] }) {
  const [domain, setDomain] = useState("");
  const [skill, setSkill] = useState("");
  const [tags, setTags] = useState("");
  const [moveTarget, setMoveTarget] = useState(props.moveTargets[0]?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const domains = props.sectionKey === "math" ? SAT_DOMAINS.math : SAT_DOMAINS["reading-writing"];
  const skills = getSatSkills(domain || null);
  const expectedRevisions = Object.fromEntries(
    props.module.questions.filter((q) => props.selectedQuestionIds.has(q.examQuestionId)).map((q) => [q.examQuestionId, q.revision])
  );
  const patch = (metadata: BulkMetadataPatch) => props.onBulkAction(props.selectedIds, { type: "patch_metadata", patch: metadata }, expectedRevisions);
  return (
    <div className="border-t border-black/[0.07] bg-white p-3 shadow-[0_-12px_30px_rgba(15,23,42,0.05)]">
      <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-800">{props.selectedIds.length} selected</span><button type="button" onClick={props.onClearSelection} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" aria-label="Clear selection"><X size={12} /></button></div>
      <div className="grid grid-cols-2 gap-1.5">
        <select value={domain} onChange={(event) => { setDomain(event.target.value); setSkill(""); if (event.target.value) void patch({ domain: event.target.value }); }} className="h-8 rounded-lg bg-slate-50 px-2 text-[10px] font-medium text-slate-600 outline-none" aria-label="Bulk domain"><option value="">Set domain…</option>{domains.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
        <select value={skill} disabled={!domain} onChange={(event) => { setSkill(event.target.value); if (event.target.value) void patch({ skill: event.target.value }); }} className="h-8 rounded-lg bg-slate-50 px-2 text-[10px] font-medium text-slate-600 outline-none disabled:opacity-40" aria-label="Bulk skill"><option value="">Set skill…</option>{skills.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1">{(["easy", "medium", "hard"] as Difficulty[]).map((value) => <button key={value} type="button" onClick={() => void patch({ difficulty: value })} className="h-8 rounded-lg bg-slate-50 text-[10px] font-semibold capitalize text-slate-600 hover:bg-slate-100">{value}</button>)}</div>
      <div className="mt-1.5 flex gap-1.5"><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Replace tags…" aria-label="Bulk tags" className="h-8 min-w-0 flex-1 rounded-lg bg-slate-50 px-2 text-[10px] outline-none" /><button type="button" disabled={!tags.trim()} onClick={() => void patch({ tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) })} className="rounded-lg px-2 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30">Apply</button></div>
      {props.moveTargets.length ? <div className="mt-1.5 flex gap-1.5"><select value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg bg-slate-50 px-2 text-[10px] outline-none" aria-label="Move selected to module">{props.moveTargets.map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}</select><button type="button" disabled={!moveTarget} onClick={() => void props.onBulkAction(props.selectedIds, { type: "move", destinationModuleId: moveTarget })} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"><MoveRight size={11}/>Move</button></div> : null}
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <button type="button" onClick={() => void props.onBulkAction(props.selectedIds, { type: "duplicate", destinationModuleId: props.module.id })} className="flex h-9 items-center justify-center gap-1 rounded-lg text-[9px] font-semibold text-slate-500 hover:bg-slate-100"><Copy size={11}/>Duplicate</button>
        <button type="button" onClick={() => void props.onBulkAction(props.selectedIds, { type: "set_pretest", value: true })} className="flex h-9 items-center justify-center gap-1 rounded-lg text-[9px] font-semibold text-slate-500 hover:bg-slate-100"><RotateCcw size={11}/>Pretest</button>
        <div className="relative"><button type="button" onClick={() => setDeleteOpen(true)} className="flex h-9 w-full items-center justify-center gap-1 rounded-lg text-[9px] font-semibold text-red-500 hover:bg-red-50"><Trash2 size={11}/>Delete</button><ConfirmPopover open={deleteOpen} title={`Delete ${props.selectedIds.length} questions?`} description="This removes the selected questions from the module." confirmLabel="Delete selected" onCancel={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); void props.onBulkAction(props.selectedIds, { type: "delete" }); }} /></div>
      </div>
    </div>
  );
}
