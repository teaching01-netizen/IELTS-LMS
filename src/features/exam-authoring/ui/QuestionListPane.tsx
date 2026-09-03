import { useMemo, useState, type RefObject } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  AlertCircle,
  Check,
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
import { AuthoringSegmented } from "./AuthoringSegmented";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";

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
  saveStatus: QuestionSaveStatus;
  /** Renders inside the compact viewport navigation sheet. */
  embedded?: boolean;
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
    <section className={`authoring-sidebar relative isolate flex min-h-0 w-[var(--authoring-sidebar-width)] min-w-0 flex-col border-r border-au-separator ${props.embedded ? "authoring-sidebar--embedded !w-full !flex-1 !basis-auto !border-r-0" : ""}`} aria-label={`${props.module.title} questions`}>
      <div className="authoring-sidebar-header relative z-[90] overflow-visible border-b border-au-separator px-3 pb-3 pt-2.5">
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
            className="authoring-interactive flex min-h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-au-fill hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-au-accent/10 disabled:opacity-30"
            aria-label="Paste or import questions into this module"
            title="Paste questions"
          >
            <FileUp size={13} aria-hidden="true" />
            <span className="hidden 2xl:inline">Paste</span>
          </button>
          <button
            type="button"
            onClick={props.onCreateQuestion}
            disabled={props.isMutating || props.module.questions.length >= props.module.targetQuestionCount}
            className="authoring-interactive flex min-h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-au-accent px-3 text-[11px] font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-au-accent/20 disabled:opacity-35"
          >
            <Plus size={13} aria-hidden="true" /> Question
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            ref={props.searchInputRef}
            type="search"
            value={props.searchQuery}
            onChange={(event) => props.onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && props.searchQuery) {
                event.preventDefault();
                props.onSearchQueryChange("");
              }
            }}
            placeholder="Search questions"
            aria-label="Search questions"
            className="h-9 w-full rounded-[10px] bg-au-fill pl-9 pr-9 text-[12px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-au-surface focus:ring-4 focus:ring-au-accent/10"
          />
          {props.searchQuery ? (
            <button type="button" onClick={() => props.onSearchQueryChange("")} className="authoring-interactive absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-au-fill" aria-label="Clear question search"><X size={12} aria-hidden="true" /></button>
          ) : null}
        </div>
        <AuthoringSegmented
          className="mt-2 w-full"
          ariaLabel="Question readiness filters"
          layoutId="sat-question-readiness"
          value={props.filter}
          onChange={props.onFilterChange}
          options={[
            { value: "all", label: <><span className="min-w-0 truncate">All</span><span className="tabular-nums text-slate-400">{props.module.questions.length}</span></> },
            { value: "ready", label: <><span className="min-w-0 truncate">Ready</span><span className="tabular-nums text-slate-400">{readinessCounts.ready}</span></> },
            { value: "incomplete", label: <><span className="min-w-0 truncate">Needs work</span><span className="tabular-nums text-slate-400">{readinessCounts.incomplete}</span></> },
            { value: "error", label: <><span className="min-w-0 truncate">Errors</span><span className="tabular-nums text-slate-400">{readinessCounts.error}</span></> },
          ]}
        />
      </div>

      <div className="relative z-0 min-h-0 flex-1 overflow-hidden">
        {rows.length ? (
          <Virtuoso
            data={rows}
            itemContent={(index, row) => {
              const prev = index > 0 ? rows[index - 1] : undefined;
              const warm =
                prev?.kind === "question" &&
                prev.question.examQuestionId === props.selectedQuestionId;
              return row.kind === "empty" ? (
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
                flushing={
                  row.question.examQuestionId === props.selectedQuestionId &&
                  props.saveStatus === "saving"
                }
                warm={warm}
              />
            );
          }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center"><div><p className="text-[12px] font-semibold text-slate-800">No matching questions</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Change the search or readiness filter.</p></div></div>
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
  flushing,
  warm,
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
  flushing: boolean;
  warm: boolean;
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
      data-flushing={flushing || undefined}
      data-warm={warm || undefined}
      className={`authoring-question-row group relative mx-2 my-px rounded-[10px] transition-colors ${selected ? "bg-au-tint-soft-strong" : "hover:bg-au-fill"}`}
    >
      {flushing ? <span className="au-flush-bar" aria-hidden="true" /> : null}
      <div className="flex min-h-[72px] items-start gap-2 px-2.5 py-2.5">
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => onToggleSelection(question.examQuestionId, event.shiftKey)}
          className={`authoring-interactive mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition ${checked ? "border-au-tint bg-au-tint text-white" : "border-au-separator-strong bg-au-surface text-transparent group-hover:border-au-accent/30 group-hover:text-slate-300"}`}
          aria-label={`${checked ? "Deselect" : "Select"} question ${question.displayOrder + 1}`}
          aria-pressed={checked}
        >
          <Check size={11} strokeWidth={3.2} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onSelect(question.examQuestionId)} className="min-w-0 flex-1 rounded-[8px] text-left focus-visible:outline-none" disabled={disabled} aria-current={selected ? "true" : undefined}>
          <div className="flex items-baseline gap-2">
            <span className="w-6 shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">{question.displayOrder + 1}</span>
            <span className="truncate text-[15px] font-medium tracking-[-0.006em] text-slate-900">{question.promptPreview || "Empty question"}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 pl-8 text-[11px] font-medium text-slate-500">
            <ReadinessDot question={question} />
            {question.domain ? <span className="max-w-[112px] truncate">{question.domain.replaceAll("-", " ")}</span> : <span>No domain</span>}
            <span aria-hidden="true" className="text-slate-300">·</span><span className="capitalize">{question.difficulty}</span>
            {question.hasStimulus ? <><span aria-hidden="true" className="text-slate-300">·</span><span>Stimulus</span></> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {question.questionType === "single_choice" ? (
            <div role="group" aria-label={`Question ${question.displayOrder + 1} answer key`} className="flex gap-0.5">
              {(["A", "B", "C", "D"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  aria-pressed={question.answerKeyPreview === option}
                  onClick={() => onQuickAnswerKey(question.examQuestionId, option)}
                  className={`authoring-interactive h-6 w-6 rounded-[7px] text-[10px] font-bold transition ${question.answerKeyPreview === option ? "bg-au-success-text text-white" : "text-slate-400 opacity-0 hover:bg-au-fill hover:text-slate-700 group-hover:opacity-100 focus-visible:opacity-100 max-[900px]:opacity-100"}`}
                >{option}</button>
              ))}
            </div>
          ) : <span className="rounded-[7px] bg-au-fill px-1.5 py-1 text-[10px] font-semibold text-slate-500">SPR</span>}
          <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-[900px]:opacity-100">
            <button type="button" disabled={disabled || index <= 0} onClick={() => move(-1)} className="authoring-interactive flex h-6 w-6 items-center justify-center rounded-[7px] text-slate-400 hover:bg-au-fill hover:text-slate-700 disabled:opacity-20" aria-label="Move question up"><ChevronUp size={12} aria-hidden="true" /></button>
            <button type="button" disabled={disabled || index >= moduleQuestions.length - 1} onClick={() => move(1)} className="authoring-interactive flex h-6 w-6 items-center justify-center rounded-[7px] text-slate-400 hover:bg-au-fill hover:text-slate-700 disabled:opacity-20" aria-label="Move question down"><ChevronDown size={12} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadinessDot({ question }: { question: AssessmentQuestionSummary }) {
  const status = question.readiness.status;
  const label = status === "ready" ? "Ready" : status === "error" ? "Error" : "Incomplete";
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-3 w-3 shrink-0 items-center justify-center"
    >
      {status === "ready" ? (
        <CheckCircle2 size={11} className="text-au-success" aria-hidden="true" />
      ) : status === "error" ? (
        <AlertCircle size={11} className="text-au-danger" aria-hidden="true" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-au-fill" aria-hidden="true" />
      )}
    </span>
  );
}

function EmptyQuestionRow({ displayOrder, disabled, onCreate }: { displayOrder: number; disabled: boolean; onCreate: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onCreate} className="authoring-interactive mx-2 my-px flex min-h-[56px] w-[calc(100%_-_1rem)] items-center gap-3 rounded-[10px] border border-dashed border-au-separator px-3 text-left text-slate-400 hover:border-au-accent/30 hover:bg-au-accent-tint hover:text-slate-700 disabled:opacity-40">
      <span className="w-6 text-[11px] font-semibold tabular-nums">{displayOrder + 1}</span>
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-au-fill" aria-hidden="true"><Plus size={13} /></span>
      <span className="text-[12px] font-medium">Add question</span>
    </button>
  );
}

function BulkToolbar(props: QuestionListPaneProps & { selectedIds: string[] }) {
  const [domain, setDomain] = useState("");
  const [skill, setSkill] = useState("");
  const [tags, setTags] = useState("");
  const [moveTarget, setMoveTarget] = useState(props.moveTargets[0]?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const domains = props.sectionKey === "math" ? SAT_DOMAINS.math : SAT_DOMAINS["reading-writing"];
  const skills = getSatSkills(domain || null);
  const expectedRevisions = Object.fromEntries(
    props.module.questions.filter((q) => props.selectedQuestionIds.has(q.examQuestionId)).map((q) => [q.examQuestionId, q.revision])
  );
  const patch = async (metadata: BulkMetadataPatch) => {
    try {
      await props.onBulkAction(
        props.selectedIds,
        { type: "patch_metadata", patch: metadata },
        expectedRevisions,
      );
    } catch {
      // The parent owns the visible navigation error; avoid an unhandled
      // rejection from a select/input event handler.
    }
  };
  const run = (action: BulkQuestionAction) => {
    void props.onBulkAction(props.selectedIds, action).catch(() => undefined);
  };
  return (
    <div className="au-elevation-card border-t border-au-separator bg-au-surface p-3 authoring-glass">
      <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-800">{props.selectedIds.length} selected</span><button type="button" onClick={props.onClearSelection} className="authoring-interactive flex h-7 w-7 items-center justify-center rounded-[7px] text-slate-400 hover:bg-au-fill" aria-label="Clear selection"><X size={12} aria-hidden="true" /></button></div>
      <div className="grid grid-cols-2 gap-1.5">
        <select value={domain} onChange={(event) => { setDomain(event.target.value); setSkill(""); if (event.target.value) void patch({ domain: event.target.value }); }} className="h-8 rounded-[9px] bg-au-fill px-2 text-[11px] font-medium text-slate-700 outline-none hover:bg-au-fill-strong focus-visible:ring-2 focus-visible:ring-au-accent/30" aria-label="Bulk domain"><option value="">Set domain…</option>{domains.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
        <select value={skill} disabled={!domain} onChange={(event) => { setSkill(event.target.value); if (event.target.value) void patch({ skill: event.target.value }); }} className="h-8 rounded-[9px] bg-au-fill px-2 text-[11px] font-medium text-slate-700 outline-none hover:bg-au-fill-strong focus-visible:ring-2 focus-visible:ring-au-accent/30 disabled:opacity-40" aria-label="Bulk skill"><option value="">Set skill…</option>{skills.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1">{(["easy", "medium", "hard"] as Difficulty[]).map((value) => <button key={value} type="button" onClick={() => void patch({ difficulty: value })} className="authoring-interactive h-8 rounded-[9px] bg-au-fill text-[11px] font-semibold capitalize text-slate-600 hover:bg-au-fill-strong">{value}</button>)}</div>
      <div className="mt-1.5 flex gap-1.5"><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Replace tags…" aria-label="Bulk tags" className="h-8 min-w-0 flex-1 rounded-[9px] bg-au-fill px-2 text-[11px] text-slate-700 outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-au-accent/30" /><button type="button" disabled={!tags.trim()} onClick={() => void patch({ tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) })} className="authoring-interactive rounded-[9px] px-2.5 text-[11px] font-semibold text-au-accent hover:bg-au-accent-tint disabled:opacity-30">Apply</button></div>
      {props.moveTargets.length ? <div className="mt-1.5 flex gap-1.5"><select value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} className="h-8 min-w-0 flex-1 rounded-[9px] bg-au-fill px-2 text-[11px] text-slate-700 outline-none hover:bg-au-fill-strong focus-visible:ring-2 focus-visible:ring-au-accent/30" aria-label="Move selected to module">{props.moveTargets.map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}</select><button type="button" disabled={!moveTarget} onClick={() => run({ type: "move", destinationModuleId: moveTarget })} className="authoring-interactive flex h-8 items-center gap-1 rounded-[9px] px-2.5 text-[11px] font-semibold text-au-accent hover:bg-au-accent-tint"><MoveRight size={11} aria-hidden="true" />Move</button></div> : null}
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <button type="button" onClick={() => run({ type: "duplicate", destinationModuleId: props.module.id })} className="authoring-interactive flex h-9 items-center justify-center gap-1 rounded-[9px] text-[11px] font-semibold text-slate-500 hover:bg-au-fill"><Copy size={11} aria-hidden="true" />Duplicate</button>
        <button type="button" onClick={() => run({ type: "set_pretest", value: true })} className="authoring-interactive flex h-9 items-center justify-center gap-1 rounded-[9px] text-[11px] font-semibold text-slate-500 hover:bg-au-fill"><RotateCcw size={11} aria-hidden="true" />Pretest</button>
        <div className="relative"><button type="button" onClick={() => setDeleteOpen(true)} className="authoring-interactive flex h-9 w-full items-center justify-center gap-1 rounded-[9px] text-[11px] font-semibold text-au-danger hover:bg-au-danger-tint"><Trash2 size={11} aria-hidden="true" />Delete</button><ConfirmPopover open={deleteOpen} title={`Delete ${props.selectedIds.length} questions?`} description="This removes the selected questions from the module." confirmLabel="Delete selected" busy={deleteBusy} onCancel={() => setDeleteOpen(false)} onConfirm={async () => { if (deleteBusy) return; setDeleteBusy(true); try { await props.onBulkAction(props.selectedIds, { type: "delete" }); setDeleteOpen(false); } catch { /* Parent surfaces the failure; keep the confirmation available for retry. */ } finally { setDeleteBusy(false); } }} /></div>
      </div>
    </div>
  );
}
