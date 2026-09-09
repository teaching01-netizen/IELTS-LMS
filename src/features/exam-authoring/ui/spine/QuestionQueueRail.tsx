import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import {
  buildQueueRows,
  countQueueReadiness,
  type SpineQueueFilter,
  type SpineQueueRow,
} from "./queueModel";
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
  onReorder: (questionIds: string[], expectedQuestionIds: string[]) => Promise<void>;
  onBulkAction: (
    questionIds: string[],
    action: BulkQuestionAction,
    expectedRevisions?: Record<string, number>,
  ) => Promise<void>;
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
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedId = props.selectedQuestionId;
  const mountedRef = useRef(false);

  useEffect(() => {
    // Skip the initial mount: the selected row is already visible on first
    // paint, so scrolling would only fight the browser restore position.
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      '[data-question-list-row="' + CSS.escape(selectedId) + '"]',
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId, rows.length]);

  return (
    <section
      aria-label={`${props.module.title} questions`}
      className={"flex min-h-0 min-w-0 flex-col bg-card" + (props.embedded ? " h-full w-full flex-1" : " h-full w-full")}
    >
      <div className="relative z-10 border-b border-border px-3 pb-3 pt-2.5">
        <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
          <div className="min-w-0">
            <ModuleScopePicker
              sections={props.sections}
              selectedModuleId={props.module.id}
              disabled={props.isMutating}
              onSelectModule={props.onSelectModule}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={props.onOpenImport}
              disabled={props.isMutating || props.module.questions.length >= props.module.targetQuestionCount}
              aria-label="Paste or import questions into this module"
              title="Paste questions"
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
            >
              <FileUp size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={props.onCreateQuestion}
              disabled={props.isMutating || props.module.questions.length >= props.module.targetQuestionCount}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <Plus size={14} aria-hidden="true" /> Question
            </button>
          </div>
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
            className="h-9 w-full rounded-md bg-muted pl-9 pr-9 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:bg-card focus:ring-2 focus:ring-ring"
          />
          {props.searchQuery ? (
            <button type="button" onClick={() => props.onSearchQueryChange("")} aria-label="Clear question search" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X size={12} aria-hidden="true" /></button>
          ) : null}
        </div>
        <AuthoringSegmented
          className="mt-2 w-full"
          ariaLabel="Question readiness filters"
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

      <div ref={listRef} className="relative z-0 min-h-0 flex-1 overflow-y-auto" data-queue-scroll-region>
        {rows.length ? (
          <ol aria-label="Questions in this module" className="m-0 list-none p-0 py-1">
            {rows.map((row, index) =>
              row.kind === "empty" ? (
                <li key={"empty-" + String(index)}>
                  <QueueEmptyRow position={index + 1} disabled={props.isMutating} onCreate={props.onCreateQuestion} />
                </li>
              ) : (
                <li key={row.question.examQuestionId}>
                  <QueueRow
                    question={row.question}
                    position={index + 1}
                    selected={row.question.examQuestionId === props.selectedQuestionId}
                    checked={props.selectedQuestionIds.has(row.question.examQuestionId)}
                    disabled={props.isMutating}
                    moduleQuestions={props.module.questions}
                    onSelect={props.onSelectQuestion}
                    onToggleSelection={props.onToggleSelection}
                    onReorder={props.onReorder}
                  />
                </li>
              ),
            )}
          </ol>
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
  position,
  selected,
  checked,
  disabled,
  moduleQuestions,
  onSelect,
  onToggleSelection,
  onReorder,
}: {
  question: AssessmentQuestionSummary;
  position: number;
  selected: boolean;
  checked: boolean;
  disabled: boolean;
  moduleQuestions: AssessmentQuestionSummary[];
  onSelect: (questionId: string) => void;
  onToggleSelection: (questionId: string, range: boolean) => void;
  onReorder: (questionIds: string[], expectedQuestionIds: string[]) => Promise<void>;
}) {
  const index = moduleQuestions.findIndex((item) => item.examQuestionId === question.examQuestionId);
  const expectedIds = moduleQuestions.map((item) => item.examQuestionId);
  // Single-flight per row: closes the double-click window between click and
  // mutation start (flush-before-navigate is async). Order truth stays the
  // server shell refetch; this flag is feedback + duplicate guard only.
  const [reorderPending, setReorderPending] = useState(false);
  const move = (direction: -1 | 1) => {
    if (reorderPending || disabled) return;
    const target = index + direction;
    if (target < 0 || target >= expectedIds.length) return;
    const next = [...expectedIds];
    const current = next[index];
    const other = next[target];
    if (current === undefined || other === undefined) return;
    next[index] = other;
    next[target] = current;
    setReorderPending(true);
    void onReorder(next, expectedIds)
      .catch(() => undefined)
      .finally(() => setReorderPending(false));
  };
  const reorderBusy = reorderPending || disabled;
  return (
    <div
      data-question-list-row={question.examQuestionId}
      onClick={() => {
        if (!disabled) onSelect(question.examQuestionId);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, input, select, textarea, a[href], [role=button]")) return;
        event.preventDefault();
        onSelect(question.examQuestionId);
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-current={selected ? "true" : undefined}
      aria-disabled={disabled || undefined}
      aria-busy={reorderPending || undefined}
      aria-label={`Question ${position}: ${question.promptPreview || "Empty question"}${selected ? ", current" : ""}`}
      className={`group relative mx-2 my-px cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-muted" : "hover:bg-muted/60"}${reorderPending ? " opacity-60" : ""}`}
    >
      <div className="flex min-h-[56px] items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          disabled={disabled}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelection(question.examQuestionId, event.shiftKey);
          }}
          aria-label={`${checked ? "Deselect" : "Select"} question ${position}`}
          aria-pressed={checked}
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-muted-foreground/50 hover:text-muted-foreground"}`}
        >
          <Check size={11} strokeWidth={3.2} aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{position}</span>
          <QueueReadinessDot question={question} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{question.promptPreview || "Empty question"}</span>
          {question.questionType === "single_choice" && question.answerKeyPreview ? (
            <span aria-hidden="true" className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{question.answerKeyPreview}</span>
          ) : question.questionType !== "single_choice" ? (
            <span aria-hidden="true" className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">SPR</span>
          ) : null}
          {selected ? <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-foreground">Current</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-40 group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" disabled={reorderBusy || index <= 0} onClick={(event) => { event.stopPropagation(); move(-1); }} aria-label="Move question up" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-20"><ChevronUp size={12} aria-hidden="true" /></button>
          <button type="button" disabled={reorderBusy || index >= moduleQuestions.length - 1} onClick={(event) => { event.stopPropagation(); move(1); }} aria-label="Move question down" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-20"><ChevronDown size={12} aria-hidden="true" /></button>
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

function QueueEmptyRow({ position, disabled, onCreate }: { position: number; disabled: boolean; onCreate: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onCreate} aria-label={`Add question ${position}`} className="mx-2 my-px flex min-h-[48px] w-[calc(100%_-_1rem)] items-center gap-2.5 rounded-md border border-dashed border-border px-2.5 text-left text-muted-foreground hover:border-ring/40 hover:bg-muted/50 hover:text-foreground disabled:opacity-40">
      <span className="w-5 shrink-0 text-xs font-semibold tabular-nums">{position}</span>
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded bg-muted" aria-hidden="true"><Plus size={13} /></span>
      <span className="truncate text-xs font-medium">Add question</span>
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
  // One in-flight bulk op at a time: the invoking control shows disabled +
  // aria-busy. Errors surface via the parent navigationError; nothing new here.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  const domains = props.sectionKey === "math" ? SAT_DOMAINS.math : SAT_DOMAINS["reading-writing"];
  const skills = getSatSkills(domain || null);
  const expectedRevisions = Object.fromEntries(
    props.module.questions.filter((q) => props.selectedQuestionIds.has(q.examQuestionId)).map((q) => [q.examQuestionId, q.revision])
  );
  const patch = (key: string, metadata: BulkMetadataPatch) => {
    if (busy) return;
    setBusyAction(key);
    void props
      .onBulkAction(props.selectedIds, { type: "patch_metadata", patch: metadata }, expectedRevisions)
      .catch(() => undefined)
      .finally(() => setBusyAction(null));
  };
  const run = (key: string, action: BulkQuestionAction) => {
    if (busy) return;
    setBusyAction(key);
    void props
      .onBulkAction(props.selectedIds, action)
      .catch(() => undefined)
      .finally(() => setBusyAction(null));
  };
  const busyProps = (key: string) =>
    busyAction === key ? { disabled: true as const, "aria-busy": true as const } : {};
  return (
    <div className="border-t border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-foreground">{props.selectedIds.length} selected</span><button type="button" onClick={props.onClearSelection} aria-label="Clear selection" className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"><X size={12} aria-hidden="true" /></button></div>
      <div className="grid grid-cols-2 gap-1.5">
        <select value={domain} {...busyProps("bulk-domain")} onChange={(event) => { setDomain(event.target.value); setSkill(""); if (event.target.value) patch("bulk-domain", { domain: event.target.value }); }} aria-label="Bulk domain" className="h-8 rounded bg-muted px-2 text-xs font-medium text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"><option value="">Set domain…</option>{domains.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
        <select value={skill} disabled={!domain || busy} onChange={(event) => { setSkill(event.target.value); if (event.target.value) patch("bulk-skill", { skill: event.target.value }); }} aria-label="Bulk skill" className="h-8 rounded bg-muted px-2 text-xs font-medium text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><option value="">Set skill…</option>{skills.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1">{(["easy", "medium", "hard"] as Difficulty[]).map((value) => <button key={value} type="button" {...busyProps("bulk-difficulty-" + value)} onClick={() => patch("bulk-difficulty-" + value, { difficulty: value })} className="h-8 rounded bg-muted text-xs font-semibold capitalize text-muted-foreground hover:bg-muted/70 hover:text-foreground">{value}</button>)}</div>
      <div className="mt-1.5 flex gap-1.5"><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Replace tags…" aria-label="Bulk tags" className="h-8 min-w-0 flex-1 rounded bg-muted px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" /><button type="button" disabled={!tags.trim() || busy} onClick={() => patch("bulk-tags", { tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) })} className="rounded px-2.5 text-xs font-semibold text-primary hover:bg-muted disabled:opacity-30">Apply</button></div>
      {props.moveTargets.length ? <div className="mt-1.5 flex gap-1.5"><select value={moveTarget} disabled={busy} onChange={(event) => setMoveTarget(event.target.value)} aria-label="Move selected to module" className="h-8 min-w-0 flex-1 rounded bg-muted px-2 text-xs text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring">{props.moveTargets.map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}</select><button type="button" {...busyProps("bulk-move")} disabled={!moveTarget || busy} onClick={() => run("bulk-move", { type: "move", destinationModuleId: moveTarget })} className="flex h-8 items-center gap-1 rounded px-2.5 text-xs font-semibold text-primary hover:bg-muted"><MoveRight size={11} aria-hidden="true" />Move</button></div> : null}
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <button type="button" {...busyProps("bulk-duplicate")} disabled={busy} onClick={() => run("bulk-duplicate", { type: "duplicate", destinationModuleId: props.module.id })} className="flex h-9 items-center justify-center gap-1 rounded text-xs font-semibold text-muted-foreground hover:bg-muted"><Copy size={11} aria-hidden="true" />Duplicate</button>
        <button type="button" {...busyProps("bulk-pretest")} disabled={busy} onClick={() => run("bulk-pretest", { type: "set_pretest", value: true })} className="flex h-9 items-center justify-center gap-1 rounded text-xs font-semibold text-muted-foreground hover:bg-muted"><RotateCcw size={11} aria-hidden="true" />Pretest</button>
        <div className="relative"><button type="button" onClick={() => setDeleteOpen(true)} className="flex h-9 w-full items-center justify-center gap-1 rounded text-xs font-semibold text-destructive hover:bg-destructive/10"><Trash2 size={11} aria-hidden="true" />Delete</button><AuthoringConfirmDialog open={deleteOpen} title={`Delete ${props.selectedIds.length} questions?`} description="This removes the selected questions from the module." confirmLabel="Delete selected" destructive busy={deleteBusy} onCancel={() => setDeleteOpen(false)} onConfirm={async () => { if (deleteBusy) return; setDeleteBusy(true); try { await props.onBulkAction(props.selectedIds, { type: "delete" }); setDeleteOpen(false); } catch { /* Parent surfaces the failure; keep the confirmation available for retry. */ } finally { setDeleteBusy(false); } }} /></div>
      </div>
    </div>
  );
}
