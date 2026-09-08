import { useMemo, type RefObject } from "react";
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
} from "../../contracts/assessment";
import { SAT_DOMAINS, getSatSkills } from "../../providers/sat/taxonomy";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import { ModuleScopePicker } from "../ModuleScopePicker";
import { AuthoringSegmented } from "../AuthoringSegmented";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";
import {
  buildQueueRows,
  countQueueReadiness,
  type SpineQueueFilter,
  type SpineQueueRow,
} from "./queueModel";
import { useState } from "react";

export type { SpineQueueFilter };

export interface QuestionQueueRailProps {
  module: AssessmentModuleShell;
  sections: AssessmentSectionShell[];
  sectionKey: string;
  moveTargets: AssessmentModuleShell[];
  selectedQuestionId: string | null;
  selectedQuestionIds: ReadonlySet<string>;
  searchQuery: string;
  filter: SpineQueueFilter;
  searchInputRef: RefObject<HTMLInputElement | null>;
  isMutating: boolean;
  onSearchQueryChange: (value: string) => void;
  onSelectModule: (moduleId: string) => void;
  onOpenImport: () => void;
  onFilterChange: (value: SpineQueueFilter) => void;
  onSelectQuestion: (questionId: string) => void;
  onCreateQuestion: () => void;
  onToggleSelection: (questionId: string, range: boolean) => void;
  onClearSelection: () => void;
  onQuickAnswerKey: (questionId: string, optionId: string) => void;
  onReorder: (questionIds: string[], expectedQuestionIds: string[]) => Promise<void>;
  onBulkAction: (
    questionIds: string[],
    action: BulkQuestionAction,
    expectedRevisions?: Record<string, number>,
  ) => Promise<void>;
  saveStatus: QuestionSaveStatus;
  /** Renders inside the compact viewport navigation sheet. */
  embedded?: boolean;
}

/**
 * Spine question queue rail (plan Phase 3). Same prop contract and queue
 * derivation as the legacy QuestionListPane (via queueModel — readiness
 * semantics shared, never forked). Narrower rail with a text + aria
 * selection cue beyond color; legacy pane stays the default branch.
 */
export function QuestionQueueRail(props: QuestionQueueRailProps) {
  const rows = useMemo<SpineQueueRow[]>(
    () => buildQueueRows(props.module, props.searchQuery, props.filter),
    [props.filter, props.module, props.searchQuery],
  );
  const readinessCounts = useMemo(
    () => countQueueReadiness(props.module),
    [props.module],
  );

  return (
    <section
      aria-label={`${props.module.title} questions`}
      className={"flex min-h-0 min-w-0 flex-col bg-card" + (props.embedded ? " h-full w-full flex-1" : " h-full w-full")}
    >
      <div className="relative z-10 border-b border-border px-3 pb-3 pt-2.5">
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
            aria-label="Paste or import questions into this module"
            title="Paste questions"
            className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
          >
            <FileUp size={13} aria-hidden="true" />
            <span className="hidden 2xl:inline">Paste</span>
          </button>
          <button
            type="button"
            onClick={props.onCreateQuestion}
            disabled={props.isMutating || props.module.questions.length >= props.module.targetQuestionCount}
            className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
          >
            <Plus size={13} aria-hidden="true" /> Question
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
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
            className="h-9 w-full rounded-md bg-muted pl-9 pr-9 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-card focus:ring-2 focus:ring-ring"
          />
          {props.searchQuery ? (
            <button type="button" onClick={() => props.onSearchQueryChange("")} aria-label="Clear question search" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X size={12} aria-hidden="true" /></button>
          ) : null}
        </div>
        <AuthoringSegmented
          className="mt-2 w-full"
          ariaLabel="Question readiness filters"
          layoutId="sat-queue-readiness"
          value={props.filter}
          onChange={props.onFilterChange}
          options={[
            { value: "all", label: <><span className="min-w-0 truncate">All</span><span className="tabular-nums text-muted-foreground">{props.module.questions.length}</span></> },
            { value: "ready", label: <><span className="min-w-0 truncate">Ready</span><span className="tabular-nums text-muted-foreground">{readinessCounts.ready}</span></> },
            { value: "incomplete", label: <><span className="min-w-0 truncate">Needs work</span><span className="tabular-nums text-muted-foreground">{readinessCounts.incomplete}</span></> },
            { value: "error", label: <><span className="min-w-0 truncate">Errors</span><span className="tabular-nums text-muted-foreground">{readinessCounts.error}</span></> },
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
                <QueueEmptyRow displayOrder={row.displayOrder} disabled={props.isMutating} onCreate={props.onCreateQuestion} />
              ) : (
                <QueueRow
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
          <div className="flex h-full items-center justify-center px-8 text-center"><div><p className="text-xs font-semibold text-foreground">No matching questions</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Change the search or readiness filter.</p></div></div>
        )}
      </div>

      {props.selectedQuestionIds.size ? (
        <QueueBulkToolbar {...props} selectedIds={[...props.selectedQuestionIds]} />
      ) : null}
    </section>
  );
}

function QueueRow({
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
    const current = next[index];
    const other = next[target];
    if (current === undefined || other === undefined) return;
    next[index] = other;
    next[target] = current;
    void onReorder(next, expectedIds);
  };
  return (
    <div
      data-question-list-row={question.examQuestionId}
      data-flushing={flushing || undefined}
      data-warm={warm || undefined}
      className={`group relative mx-2 my-px rounded-md transition-colors ${selected ? "bg-muted" : "hover:bg-muted/60"}`}
    >
      <div className="flex min-h-[72px] items-start gap-2 px-2.5 py-2.5">
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => onToggleSelection(question.examQuestionId, event.shiftKey)}
          aria-label={`${checked ? "Deselect" : "Select"} question ${question.displayOrder + 1}`}
          aria-pressed={checked}
          className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-transparent group-hover:border-ring/40 group-hover:text-muted-foreground/40"}`}
        >
          <Check size={11} strokeWidth={3.2} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onSelect(question.examQuestionId)} disabled={disabled} aria-current={selected ? "true" : undefined} aria-label={`Question ${question.displayOrder + 1}: ${question.promptPreview || "Empty question"}${selected ? ", current" : ""}`} className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-baseline gap-2">
            <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{question.displayOrder + 1}</span>
            <span className="truncate text-[15px] font-medium tracking-tight text-foreground">{question.promptPreview || "Empty question"}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 pl-8 text-xs font-medium text-muted-foreground">
            <QueueReadinessDot question={question} />
            {question.domain ? <span className="max-w-[112px] truncate">{question.domain.replaceAll("-", " ")}</span> : <span>No domain</span>}
            <span aria-hidden="true">·</span><span className="capitalize">{question.difficulty}</span>
            {question.hasStimulus ? <><span aria-hidden="true">·</span><span>Stimulus</span></> : null}
            {selected ? <><span aria-hidden="true">·</span><span className="font-semibold text-foreground">Current</span></> : null}
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
                  aria-label={`Set question ${question.displayOrder + 1} key to ${option}`}
                  onClick={() => onQuickAnswerKey(question.examQuestionId, option)}
                  className={`h-6 w-6 rounded text-[10px] font-bold transition-colors ${question.answerKeyPreview === option ? "bg-primary text-primary-foreground" : "text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 max-[900px]:opacity-100"}`}
                >{option}</button>
              ))}
            </div>
          ) : <span className="rounded bg-muted px-1.5 py-1 text-[10px] font-semibold text-muted-foreground">SPR</span>}
          <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-[900px]:opacity-100">
            <button type="button" disabled={disabled || index <= 0} onClick={() => move(-1)} aria-label="Move question up" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-20"><ChevronUp size={12} aria-hidden="true" /></button>
            <button type="button" disabled={disabled || index >= moduleQuestions.length - 1} onClick={() => move(1)} aria-label="Move question down" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-20"><ChevronDown size={12} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueueReadinessDot({ question }: { question: AssessmentQuestionSummary }) {
  const status = question.readiness.status;
  const label = status === "ready" ? "Ready" : status === "error" ? "Error" : "Incomplete";
  return (
    <span role="img" aria-label={label} className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
      {status === "ready" ? (
        <CheckCircle2 size={11} aria-hidden="true" />
      ) : status === "error" ? (
        <AlertCircle size={11} aria-hidden="true" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-muted-foreground/30" aria-hidden="true" />
      )}
    </span>
  );
}

function QueueEmptyRow({ displayOrder, disabled, onCreate }: { displayOrder: number; disabled: boolean; onCreate: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onCreate} aria-label={`Add question ${displayOrder + 1}`} className="mx-2 my-px flex min-h-[56px] w-[calc(100%_-_1rem)] items-center gap-3 rounded-md border border-dashed border-border px-3 text-left text-muted-foreground transition-colors hover:border-ring/40 hover:bg-muted/50 hover:text-foreground disabled:opacity-40">
      <span className="w-6 text-xs font-semibold tabular-nums">{displayOrder + 1}</span>
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded bg-muted" aria-hidden="true"><Plus size={13} /></span>
      <span className="text-xs font-medium">Add question</span>
    </button>
  );
}

function QueueBulkToolbar(props: QuestionQueueRailProps & { selectedIds: string[] }) {
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
      await props.onBulkAction(props.selectedIds, { type: "patch_metadata", patch: metadata }, expectedRevisions);
    } catch {
      // Parent owns the visible navigation error; avoid unhandled rejection.
    }
  };
  const run = (action: BulkQuestionAction) => {
    void props.onBulkAction(props.selectedIds, action).catch(() => undefined);
  };
  return (
    <div className="border-t border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-foreground">{props.selectedIds.length} selected</span><button type="button" onClick={props.onClearSelection} aria-label="Clear selection" className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"><X size={12} aria-hidden="true" /></button></div>
      <div className="grid grid-cols-2 gap-1.5">
        <select value={domain} onChange={(event) => { setDomain(event.target.value); setSkill(""); if (event.target.value) void patch({ domain: event.target.value }); }} aria-label="Bulk domain" className="h-8 rounded bg-muted px-2 text-xs font-medium text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"><option value="">Set domain…</option>{domains.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
        <select value={skill} disabled={!domain} onChange={(event) => { setSkill(event.target.value); if (event.target.value) void patch({ skill: event.target.value }); }} aria-label="Bulk skill" className="h-8 rounded bg-muted px-2 text-xs font-medium text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><option value="">Set skill…</option>{skills.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1">{(["easy", "medium", "hard"] as Difficulty[]).map((value) => <button key={value} type="button" onClick={() => void patch({ difficulty: value })} className="h-8 rounded bg-muted text-xs font-semibold capitalize text-muted-foreground hover:bg-muted/70 hover:text-foreground">{value}</button>)}</div>
      <div className="mt-1.5 flex gap-1.5"><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Replace tags…" aria-label="Bulk tags" className="h-8 min-w-0 flex-1 rounded bg-muted px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" /><button type="button" disabled={!tags.trim()} onClick={() => void patch({ tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) })} className="rounded px-2.5 text-xs font-semibold text-primary hover:bg-muted disabled:opacity-30">Apply</button></div>
      {props.moveTargets.length ? <div className="mt-1.5 flex gap-1.5"><select value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} aria-label="Move selected to module" className="h-8 min-w-0 flex-1 rounded bg-muted px-2 text-xs text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring">{props.moveTargets.map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}</select><button type="button" disabled={!moveTarget} onClick={() => run({ type: "move", destinationModuleId: moveTarget })} className="flex h-8 items-center gap-1 rounded px-2.5 text-xs font-semibold text-primary hover:bg-muted"><MoveRight size={11} aria-hidden="true" />Move</button></div> : null}
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <button type="button" onClick={() => run({ type: "duplicate", destinationModuleId: props.module.id })} className="flex h-9 items-center justify-center gap-1 rounded text-xs font-semibold text-muted-foreground hover:bg-muted"><Copy size={11} aria-hidden="true" />Duplicate</button>
        <button type="button" onClick={() => run({ type: "set_pretest", value: true })} className="flex h-9 items-center justify-center gap-1 rounded text-xs font-semibold text-muted-foreground hover:bg-muted"><RotateCcw size={11} aria-hidden="true" />Pretest</button>
        <div className="relative"><button type="button" onClick={() => setDeleteOpen(true)} className="flex h-9 w-full items-center justify-center gap-1 rounded text-xs font-semibold text-destructive hover:bg-destructive/10"><Trash2 size={11} aria-hidden="true" />Delete</button><AuthoringConfirmDialog open={deleteOpen} title={`Delete ${props.selectedIds.length} questions?`} description="This removes the selected questions from the module." confirmLabel="Delete selected" destructive busy={deleteBusy} onCancel={() => setDeleteOpen(false)} onConfirm={async () => { if (deleteBusy) return; setDeleteBusy(true); try { await props.onBulkAction(props.selectedIds, { type: "delete" }); setDeleteOpen(false); } catch { /* Parent surfaces the failure; keep the confirmation available for retry. */ } finally { setDeleteBusy(false); } }} /></div>
      </div>
    </div>
  );
}
