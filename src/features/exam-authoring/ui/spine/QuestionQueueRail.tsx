import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  AlertCircle,
  Check,
  Copy,
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
import { ModuleSwitcher } from "./ModuleSwitcher";
import { QuestionFilterMenu } from "./QuestionFilterMenu";
import { QuestionRowMenu } from "./QuestionRowMenu";
import { moduleReadyCount } from "./queueModel";
import {
  buildQueueRows,
  queueRowToken,
  countQueueReadiness,
  type SpineQueueFilter,
  type SpineQueueRow,
} from "./queueModel";
export type { SpineQueueFilter };

export interface QuestionQueueRailProps {
  module: AssessmentModuleShell;
  sections: AssessmentSectionShell[];
  sectionKey: string;
  sectionTitle?: string | undefined;
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
  /** Opens the full-draft workbook replacement flow. Defaults to the text-add sheet when absent. */
  onFilterChange: (value: SpineQueueFilter) => void;
  onSelectQuestion: (questionId: string) => void;
  onDuplicateQuestion?: ((id: string) => void) | undefined;
  onRequestDelete?: ((id: string) => void) | undefined;
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
  /**
   * Phase 05: per-row collaboration radar. The workspace supplies the node so
   * the rail stays presence-agnostic (props in, nothing more).
   */
  presenceSlot?: ((examQuestionId: string) => ReactNode) | undefined;
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
  const readinessCounts = useMemo(() => countQueueReadiness(props.module), [props.module]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedId = props.selectedQuestionId;
  const [selecting, setSelecting] = useState(false);
  const selectionMode = selecting || props.selectedQuestionIds.size > 0;
  const moduleId = props.module.id;

  // Per-module memory: last selected question and scroll offset, restored on
  // return so switching Module 1 -> 2 -> 1 never jumps back to question 1.
  const memoryRef = useRef<Map<string, { questionId: string; scrollTop: number }>>(new Map());
  const activeModuleRef = useRef(moduleId);
  const suppressRestoreRef = useRef(false);

  useLayoutEffect(() => {
    const previous = activeModuleRef.current;
    if (previous !== moduleId) {
      const list = listRef.current;
      if (list) memoryRef.current.set(previous, { questionId: selectedId ?? "", scrollTop: list.scrollTop });
      const remembered = memoryRef.current.get(moduleId);
      activeModuleRef.current = moduleId;
      if (remembered) {
        if (remembered.questionId && remembered.questionId !== selectedId) {
          suppressRestoreRef.current = true;
          props.onSelectQuestion(remembered.questionId);
        }
        window.requestAnimationFrame(() => {
          const target = listRef.current;
          if (target && Math.abs(target.scrollTop - remembered.scrollTop) > 1) {
            target.scrollTop = remembered.scrollTop;
          }
        });
      }
    }
  }, [moduleId, props, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    if (suppressRestoreRef.current) {
      suppressRestoreRef.current = false;
      return;
    }
    const row = listRef.current?.querySelector<HTMLElement>(
      '[data-question-list-row="' + CSS.escape(selectedId) + '"]',
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId, rows.length]);

  const onListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const ids = rows
        .filter((row): row is Extract<SpineQueueRow, { kind: "question" }> => row.kind === "question")
        .map((row) => row.question.examQuestionId);
      if (!ids.length) return;
      const current = selectedId ? ids.indexOf(selectedId) : -1;
      let next = -1;
      if (event.key === "ArrowDown") next = current < 0 ? 0 : Math.min(ids.length - 1, current + 1);
      else if (event.key === "ArrowUp") next = current < 0 ? 0 : Math.max(0, current - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = ids.length - 1;
      if (next < 0) return;
      event.preventDefault();
      const id = ids[next];
      if (id) props.onSelectQuestion(id);
    },
    [props, rows, selectedId],
  );

  const addQuestion = props.onCreateQuestion;

  const examAuthored = props.sections.reduce(
    (sum, section) => sum + section.modules.reduce((n, module) => n + module.questions.length, 0),
    0,
  );
  const examTarget = props.sections.reduce(
    (sum, section) => sum + section.modules.reduce((n, module) => n + module.targetQuestionCount, 0),
    0,
  );

  return (
    <nav
      aria-label="Question navigator"
      className={"flex min-h-0 min-w-0 flex-col bg-card" + (props.embedded ? " h-full w-full flex-1" : " h-full w-full")}
    >
      <div className="sat-spine__nav-region">
        <div className="sat-spine__nav-head">
          <h2 className="sat-spine__nav-title">{props.sectionTitle ?? props.module.title}</h2>
          <p className="sat-spine__nav-progress" aria-label={`Exam authoring progress: ${examAuthored} of ${examTarget} authored`}>
            {examAuthored} of {examTarget} authored
          </p>
        </div>
        <ModuleSwitcher
          sections={props.sections}
          selectedModuleId={props.module.id}
          disabled={props.isMutating}
          onSelectModule={props.onSelectModule}
        />
        <div className="relative mt-3">
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
                return;
              }
              if ((event.key === "ArrowDown" || event.key === "Enter") && rows.length) {
                event.preventDefault();
                const first = rows.find((row) => row.kind === "question");
                if (first && first.kind === "question") props.onSelectQuestion(first.question.examQuestionId);
              }
            }}
            placeholder="Search questions…"
            aria-label="Search questions"
            className="h-11 w-full rounded-md bg-muted pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:bg-card focus:ring-2 focus:ring-ring"
          />
          {props.searchQuery ? (
            <button type="button" onClick={() => props.onSearchQueryChange("")} aria-label="Clear question search" className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X size={12} aria-hidden="true" /></button>
          ) : null}
        </div>
        <div className="sat-spine__nav-tools">
          <span className="sat-spine__nav-count">
            {props.module.questions.length} questions
            {moduleReadyCount(props.module) !== props.module.questions.length
              ? ' · ' + moduleReadyCount(props.module) + ' ready'
              : ""}
            {props.searchQuery || props.filter !== "all" ? " · " + rows.length + " shown" : ""}
          </span>
          <div className="flex items-center gap-1">
            <QuestionFilterMenu filter={props.filter} counts={readinessCounts} onFilterChange={props.onFilterChange} />
            <QuestionRowMenu
              position={0}
              label="Question list actions"
              disabled={props.isMutating}
              canMoveUp={false}
              canMoveDown={false}
              onMove={() => undefined}
              onSelectQuestions={() => setSelecting(true)}
              onOpenImport={props.onOpenImport}
              importDisabled={props.module.questions.length >= props.module.targetQuestionCount}
            />
            <button
              type="button"
              onClick={addQuestion}
              aria-label="Add question"
              disabled={props.isMutating || props.module.questions.length >= props.module.targetQuestionCount}
              className="sat-spine__add"
            >
              <Plus size={15} aria-hidden="true" />
              Add
            </button>
          </div>
        </div>
      </div>

      {selectionMode ? (
        <div className="sat-spine__selection-bar" role="region" aria-label="Selection mode">
          <span>{props.selectedQuestionIds.size} selected</span>
          <button type="button" onClick={() => { setSelecting(false); props.onClearSelection(); }} className="sat-spine__add">Done</button>
        </div>
      ) : null}

      <div
        ref={listRef}
        className="sat-spine__list"
        data-queue-scroll-region
        onKeyDown={onListKeyDown}
      >
        {rows.length ? (
          <ol aria-label="Questions in this module" className="m-0 list-none p-0 py-1">
            {rows.map((row, index) =>
              row.kind === "empty" ? (
                <li key={"empty-" + String(index)}>
                  <QueueEmptyRow position={index + 1} disabled={props.isMutating} onCreate={addQuestion} />
                </li>
              ) : (
                <li key={row.question.examQuestionId}>
                  <QueueRow
                    question={row.question}
                    position={props.module.questions.findIndex(q => q.examQuestionId === row.question.examQuestionId) + 1}
                    selectionMode={selectionMode}
                    onDuplicate={props.onDuplicateQuestion}
                    onDelete={props.onRequestDelete}
                    selected={row.question.examQuestionId === props.selectedQuestionId}
                    checked={props.selectedQuestionIds.has(row.question.examQuestionId)}
                    disabled={props.isMutating}
                    moduleQuestions={props.module.questions}
                    onSelect={props.onSelectQuestion}
                    onToggleSelection={props.onToggleSelection}
                    onReorder={props.onReorder}
                    {...(props.presenceSlot ? { presenceSlot: props.presenceSlot(row.question.examQuestionId) } : {})}
                  />
                </li>
              ),
            )}
          </ol>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center"><div><p className="text-sm font-semibold text-foreground">No matching questions</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Change the search or readiness filter.</p><button type="button" className="min-h-11 text-sm underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {props.onFilterChange("all"); props.onSearchQueryChange("");}}>Clear filter and search</button></div></div>
        )}
      </div>

      {props.selectedQuestionIds.size ? (
        <QueueBulkToolbar {...props} selectedIds={[...props.selectedQuestionIds]} />
      ) : null}
    </nav>
  );
}

function QueueRow({question, position, selected, checked, disabled, selectionMode, moduleQuestions, onSelect, onToggleSelection, onReorder, onDuplicate, onDelete, presenceSlot}: {
 question: AssessmentQuestionSummary; position:number; selected:boolean; checked:boolean; disabled:boolean; selectionMode:boolean;
 moduleQuestions:AssessmentQuestionSummary[]; onSelect:(id:string)=>void; onToggleSelection:(id:string,range:boolean)=>void;
 onReorder:(ids:string[],expected:string[])=>Promise<void>; onDuplicate?:((id:string)=>void)|undefined; onDelete?:((id:string)=>void)|undefined;
 /** Phase 05: the rail is the collaboration radar — a tiny per-row avatar. */
 presenceSlot?:ReactNode|undefined;
}) {
 const index=moduleQuestions.findIndex(q=>q.examQuestionId===question.examQuestionId);
 const [pending,setPending]=useState(false);
 const flight=useRef(false);
 const move=(direction:-1|1)=>{
  if(disabled||flight.current) return;
  const expected=moduleQuestions.map(q=>q.examQuestionId); const target=index+direction;
  if(index<0||target<0||target>=expected.length) return;
  const ids=[...expected]; const current=ids[index],other=ids[target]; if(!current||!other)return;
  ids[index]=other;ids[target]=current;flight.current=true;setPending(true);
  void onReorder(ids,expected).catch(()=>undefined).finally(()=>{flight.current=false;setPending(false);});
 };
 const token=queueRowToken(question);
 const issueCount=question.readiness.blockingIssueCount;
 const statusLabel = token?.kind === "issue"
   ? (issueCount > 1 ? String(issueCount) + " issues" : "Needs attention")
   : token?.label;
 const preview=question.promptPreview||"Empty question";
 const hasIssue=token?.kind==='issue';
 return <div className={'sat-spine__question-row'+(selected?' is-selected':'')+(pending?' is-busy':'')+(hasIssue?' has-issue':'')} data-question-list-row={question.examQuestionId} aria-busy={pending||undefined}>
  {selected?<span data-selected-bar aria-hidden="true"/> : null}
  {selectionMode?<button type="button" role="checkbox" aria-checked={checked} disabled={disabled} aria-label={(checked?'Deselect':'Select')+' question '+position} onClick={e=>onToggleSelection(question.examQuestionId,e.shiftKey)} className="sat-spine__check"><span className={'sat-spine__check-box'+(checked?' is-checked':'')}><Check size={13} aria-hidden="true" className={checked?'':'invisible'}/></span></button>:null}
  <button
    type="button"
    disabled={disabled}
    aria-current={selected?'true':undefined}
    aria-label={'Question '+position+': '+preview+', '+question.difficulty+(token?.kind==='issue'?(issueCount>1?', has '+issueCount+' issues':', has errors'):'')+(selected?', selected':'')}
    onClick={()=>onSelect(question.examQuestionId)}
    className="sat-spine__row-main"
  >
   <span className={'sat-spine__row-num'+(selected?' is-selected':'')}>{String(position).padStart(2,'0')}</span>
   <span className="sat-spine__row-preview">{preview}</span>
   <span className={'sat-spine__row-status'+(token?.kind==='issue'?' is-issue':'')}>
     {hasIssue?<><AlertCircle size={14} aria-hidden="true"/>{issueCount>1?<span className="sat-spine__row-count">{issueCount}</span>:null}</>:token?.label}
     <span className="sr-only">{statusLabel}</span>
   </span>
  </button>
  {presenceSlot?<span className="sat-spine__row-presence shrink-0">{presenceSlot}</span>:null}
  <div className="sat-spine__row-actions"><QuestionRowMenu position={position} disabled={disabled||pending} canMoveUp={index>0} canMoveDown={index<moduleQuestions.length-1} onMove={move} onDuplicate={onDuplicate?()=>onDuplicate(question.examQuestionId):undefined} onDelete={onDelete?()=>onDelete(question.examQuestionId):undefined}/></div>
 </div>;
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
