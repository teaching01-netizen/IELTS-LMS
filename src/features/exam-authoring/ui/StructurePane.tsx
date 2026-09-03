import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortableOperation, useSortable } from "@dnd-kit/react/sortable";
import { arrayMove } from "@dnd-kit/helpers";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  GripVertical,
  LoaderCircle,
  MoveRight,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type {
  AssessmentAuthoringShell,
  AssessmentModuleShell,
  AssessmentQuestionSummary,
  BulkQuestionAction,
} from "../contracts/assessment";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";
import { ConfirmPopover } from "./ConfirmPopover";
import { authoringMotion } from "./authoringMotion";

export interface StructurePaneProps {
  shell: AssessmentAuthoringShell;
  selectedModuleId: string | null;
  selectedExamQuestionId: string | null;
  onSelectModule: (moduleId: string) => void;
  onSelectQuestion: (examQuestionId: string, moduleId: string) => void;
  onCreateQuestion: (moduleId: string) => void;
  onReorderQuestions: (
    moduleId: string,
    questionIds: string[],
    expectedQuestionIds: string[]
  ) => Promise<void>;
  onBulkAction: (questionIds: string[], action: BulkQuestionAction) => Promise<void>;
  pendingQuestionId?: string | null;
  emphasizedQuestionId?: string | null;
  currentSaveStatus?: QuestionSaveStatus;
  isCreating?: boolean;
  isMutating?: boolean;
}

export function StructurePane({
  shell,
  selectedModuleId,
  selectedExamQuestionId,
  onSelectModule,
  onSelectQuestion,
  onCreateQuestion,
  onReorderQuestions,
  onBulkAction,
  pendingQuestionId = null,
  emphasizedQuestionId = null,
  currentSaveStatus = "saved",
  isCreating = false,
  isMutating = false,
}: StructurePaneProps) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkError(null);
  }, [selectedModuleId]);

  const selectedModule = useMemo(
    () =>
      shell.sections
        .flatMap((section) => section.modules)
        .find((module) => module.id === selectedModuleId),
    [selectedModuleId, shell.sections]
  );
  const selectedSection = useMemo(
    () =>
      shell.sections.find((section) =>
        section.modules.some((module) => module.id === selectedModuleId)
      ),
    [selectedModuleId, shell.sections]
  );

  const toggleSelection = (questionId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  const runBulkAction = async (action: BulkQuestionAction): Promise<boolean> => {
    if (!selectedIds.size) return false;
    setBulkError(null);
    try {
      await onBulkAction([...selectedIds], action);
      setSelectedIds(new Set());
      setSelectionMode(false);
      return true;
    } catch (error) {
      setBulkError(
        error instanceof Error ? error.message : "The bulk action could not be completed."
      );
      return false;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Questions
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">Drag questions to reorder</p>
          </div>
          {selectedModule?.questions.length ? (
            <motion.button
              type="button"
              whileTap={authoringMotion.press}
              transition={authoringMotion.fast}
              onClick={() => {
                setSelectionMode((value) => !value);
                setSelectedIds(new Set());
                setBulkError(null);
              }}
              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                selectionMode
                  ? "bg-au-accent text-white"
                  : "text-slate-500 hover:bg-au-fill hover:text-slate-900"
              }`}
            >
              {selectionMode ? "Done" : "Select"}
            </motion.button>
          ) : null}
        </div>

        <div className="space-y-5">
          {shell.sections.map((section) => (
            <section key={section.id}>
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <p className="min-w-0 truncate text-[12px] font-semibold text-slate-700">
                  {section.title}
                </p>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                  {Math.round(section.durationSeconds / 60)} min
                </span>
              </div>
              <div className="space-y-2">
                {section.modules.map((module) => {
                  const active = module.id === selectedModuleId;
                  const progress = module.targetQuestionCount
                    ? Math.min(100, (module.questions.length / module.targetQuestionCount) * 100)
                    : 0;
                  return (
                    <motion.div
                      layout
                      key={module.id}
                      transition={authoringMotion.panel}
                      className={`overflow-hidden rounded-xl transition-colors ${active ? "bg-au-tint-soft-strong" : "bg-transparent hover:bg-au-fill"}`}
                    >
                      <motion.button
                        type="button"
                        whileTap={authoringMotion.press}
                        transition={authoringMotion.fast}
                        onClick={() => onSelectModule(module.id)}
                        className="w-full px-3 py-2.5 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-[12px] font-semibold ${active ? "text-slate-950" : "text-slate-700"}`}
                          >
                            {module.title}
                          </span>
                          <span className="text-[10px] tabular-nums text-slate-400">
                            {module.questions.length}/{module.targetQuestionCount}
                          </span>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-au-fill-strong">
                          <div
                            className="h-full rounded-full bg-au-accent transition-[width]"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </motion.button>

                      <AnimatePresence initial={false}>
                        {active ? (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={authoringMotion.panel}
                            className="overflow-hidden border-t border-au-separator px-2.5 pb-3 pt-2.5"
                          >
                            <SortableQuestionGrid
                              module={module}
                              selectedQuestionId={selectedExamQuestionId}
                              selectionMode={selectionMode}
                              selectedIds={selectedIds}
                              disabled={isMutating}
                              pendingQuestionId={pendingQuestionId}
                              emphasizedQuestionId={emphasizedQuestionId}
                              currentSaveStatus={currentSaveStatus}
                              onSelectQuestion={(questionId) =>
                                onSelectQuestion(questionId, module.id)
                              }
                              onToggleSelection={toggleSelection}
                              onReorder={onReorderQuestions}
                            />

                            <motion.button
                              type="button"
                              whileTap={authoringMotion.press}
                              transition={authoringMotion.fast}
                              disabled={
                                isCreating ||
                                isMutating ||
                                module.questions.length >= module.targetQuestionCount
                              }
                              onClick={() => onCreateQuestion(module.id)}
                              className="mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-au-separator bg-au-surface px-2 py-2 text-[11px] font-semibold text-slate-500 transition hover:border-au-separator-strong hover:bg-au-fill-strong hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {module.questions.length >= module.targetQuestionCount ? (
                                <>
                                  <Check size={13} aria-hidden="true" /> Module complete
                                </>
                              ) : (
                                <>
                                  <Plus size={13} aria-hidden="true" /> {isCreating ? "Adding…" : "Add question"}
                                </>
                              )}
                            </motion.button>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
              {section.breakAfterSeconds ? (
                <p className="px-1 pt-2 text-[10px] font-medium text-slate-400">
                  {Math.round(section.breakAfterSeconds / 60)} min break
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {selectionMode && selectedModule ? (
          <BulkActionBar
            count={selectedIds.size}
            questions={selectedModule.questions}
            selectedQuestionIds={selectedIds}
            moduleId={selectedModule.id}
            moveTargets={(selectedSection?.modules ?? []).filter(
              (module) => module.id !== selectedModule.id
            )}
            disabled={isMutating}
            error={bulkError}
            onClear={() => setSelectedIds(new Set())}
            onAction={runBulkAction}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SortableQuestionGrid({
  module,
  selectedQuestionId,
  selectionMode,
  selectedIds,
  disabled,
  pendingQuestionId,
  emphasizedQuestionId,
  currentSaveStatus,
  onSelectQuestion,
  onToggleSelection,
  onReorder,
}: {
  module: AssessmentModuleShell;
  selectedQuestionId: string | null;
  selectionMode: boolean;
  selectedIds: Set<string>;
  disabled: boolean;
  pendingQuestionId: string | null;
  emphasizedQuestionId: string | null;
  currentSaveStatus: QuestionSaveStatus;
  onSelectQuestion: (questionId: string) => void;
  onToggleSelection: (questionId: string) => void;
  onReorder: (
    moduleId: string,
    questionIds: string[],
    expectedQuestionIds: string[]
  ) => Promise<void>;
}) {
  const [items, setItems] = useState(module.questions);
  const [reorderError, setReorderError] = useState<string | null>(null);

  useEffect(() => setItems(module.questions), [module.questions]);

  return (
    <>
      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled || !isSortableOperation(event.operation)) return;
          const source = event.operation.source;
          if (!source) return;
          const previous = items;
          const from = source.initialIndex;
          const to = event.operation.target?.index ?? source.index;
          const next = arrayMove(items, from, to);
          if (
            next.every(
              (question, index) => question.examQuestionId === previous[index]?.examQuestionId
            )
          )
            return;
          setItems(next);
          setReorderError(null);
          void onReorder(
            module.id,
            next.map((question) => question.examQuestionId),
            previous.map((question) => question.examQuestionId)
          ).catch((error) => {
            setItems(previous);
            setReorderError(
              error instanceof Error ? error.message : "Question order could not be saved."
            );
          });
        }}
      >
        <div className="grid grid-cols-5 gap-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((question, index) => (
              <SortableQuestionButton
                key={question.examQuestionId}
                question={question}
                index={index}
                selected={question.examQuestionId === selectedQuestionId}
                checked={selectedIds.has(question.examQuestionId)}
                selectionMode={selectionMode}
                disabled={disabled}
                pending={question.examQuestionId === pendingQuestionId}
                emphasized={question.examQuestionId === emphasizedQuestionId}
                saving={
                  question.examQuestionId === selectedQuestionId &&
                  (currentSaveStatus === "saving" || currentSaveStatus === "unsaved")
                }
                onClick={() =>
                  selectionMode
                    ? onToggleSelection(question.examQuestionId)
                    : onSelectQuestion(question.examQuestionId)
                }
              />
            ))}
          </AnimatePresence>
        </div>
      </DragDropProvider>
      {reorderError ? (
        <p className="mt-2 rounded-lg bg-au-danger-tint px-2 py-1.5 text-[10px] font-medium leading-4 text-au-danger-text">
          {reorderError}
        </p>
      ) : null}
    </>
  );
}

function SortableQuestionButton({
  question,
  index,
  selected,
  checked,
  selectionMode,
  disabled,
  pending,
  emphasized,
  saving,
  onClick,
}: {
  question: AssessmentQuestionSummary;
  index: number;
  selected: boolean;
  checked: boolean;
  selectionMode: boolean;
  disabled: boolean;
  pending: boolean;
  emphasized: boolean;
  saving: boolean;
  onClick: () => void;
}) {
  const { ref, isDragging } = useSortable({
    id: question.examQuestionId,
    index,
    group: "sat-question-order",
    disabled: disabled || selectionMode,
  });
  const readiness = question.readiness?.status ?? "incomplete";
  const statusTitle =
    readiness === "ready"
      ? "Ready to publish"
      : readiness === "error"
        ? `${question.readiness.blockingIssueCount} issue${question.readiness.blockingIssueCount === 1 ? "" : "s"} to fix`
        : "Incomplete";

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.84 }}
      transition={authoringMotion.settle}
      className="relative"
    >
      <div
        ref={ref}
        className={`relative rounded-lg ${isDragging ? "z-30 cursor-grabbing" : "cursor-grab"}`}
      >
        <motion.div
          animate={
            isDragging
              ? {
                  y: -3,
                  scale: 1.045,
                  opacity: 0.96,
                  boxShadow: "var(--au-elevation-drag)",
                }
              : emphasized
                ? {
                    y: 0,
                    scale: [1, 1.055, 1],
                    opacity: 1,
                    boxShadow: "none",
                  }
                : { y: 0, scale: 1, opacity: 1, boxShadow: "none" }
          }
          transition={
            emphasized ? { duration: 0.52, ease: AUTHORING_EMPHASIS_EASE } : authoringMotion.spring
          }
          className="relative rounded-lg"
        >
          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            onClick={onClick}
            title={`Question ${index + 1} · ${statusTitle}`}
            aria-label={`Question ${index + 1}. ${statusTitle}${question.isPretest ? ". Pretest" : ""}`}
            aria-pressed={selectionMode ? checked : undefined}
            aria-current={!selectionMode && selected ? "page" : undefined}
            className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border text-[11px] font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent ${
              checked
                ? "border-au-accent bg-au-accent-tint text-au-accent ring-2 ring-au-accent-tint"
                : selected && !selectionMode
                  ? "border-au-accent text-white"
                  : pending
                    ? "border-au-separator-strong bg-au-fill text-slate-800 ring-2 ring-au-accent-tint"
                    : "border-au-separator bg-au-surface text-slate-600 hover:border-au-separator-strong hover:bg-au-fill hover:text-slate-950"
            }`}
          >
            {selected && !selectionMode ? (
              <motion.span
                layoutId="sat-selected-question-tile"
                className="absolute inset-0 bg-au-accent"
                transition={authoringMotion.spring}
              />
            ) : null}
            <span className="relative z-10 flex items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={selectionMode && checked ? "checked" : "number"}
                  initial={{ opacity: 0, scale: 0.72 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.72 }}
                  transition={authoringMotion.state}
                >
                  {selectionMode && checked ? <Check size={14} strokeWidth={3} /> : index + 1}
                </motion.span>
              </AnimatePresence>
            </span>
            {question.isPretest ? (
              <span
                className="absolute right-1 top-1 z-10 h-1.5 w-1.5 rounded-full bg-au-warning"
                title="Pretest"
              />
            ) : null}
            <QuestionReadinessIcon
              status={readiness}
              inverted={selected && !selectionMode}
              saving={saving || pending}
            />
          </motion.button>
          {!selectionMode ? (
            <GripVertical
              size={10}
              aria-hidden="true"
              className={`pointer-events-none absolute left-0.5 top-1/2 z-10 -translate-y-1/2 ${selected ? "text-white/60" : "text-slate-300"}`}
            />
          ) : null}
        </motion.div>
      </div>
    </motion.div>
  );
}

const AUTHORING_EMPHASIS_EASE = [0.22, 1, 0.36, 1] as const;

function QuestionReadinessIcon({
  status,
  inverted,
  saving,
}: {
  status: "ready" | "incomplete" | "error";
  inverted: boolean;
  saving: boolean;
}) {
  const className = `pointer-events-none absolute bottom-0.5 right-0.5 z-10 ${inverted ? "text-white/80" : ""}`;
  const key = saving ? "saving" : status;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={key}
        initial={{ opacity: 0, scale: 0.55 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.55 }}
        transition={authoringMotion.state}
        className={className}
        aria-hidden="true"
      >
        {saving ? (
          <LoaderCircle
            size={9}
            className={`${inverted ? "" : "text-slate-400"} animate-spin`}
            strokeWidth={2.6}
          />
        ) : status === "ready" ? (
          <CheckCircle2 size={9} className={inverted ? "" : "text-au-success"} strokeWidth={2.6} />
        ) : status === "error" ? (
          <AlertCircle size={9} className={inverted ? "" : "text-au-danger"} strokeWidth={2.6} />
        ) : (
          <span
            className={`block h-1.5 w-1.5 rounded-full ${inverted ? "bg-au-surface/60" : "bg-au-fill-strong"}`}
          />
        )}
      </motion.span>
    </AnimatePresence>
  );
}

function BulkActionBar({
  count,
  questions,
  selectedQuestionIds,
  moduleId,
  moveTargets,
  disabled,
  error,
  onClear,
  onAction,
}: {
  count: number;
  questions: AssessmentQuestionSummary[];
  selectedQuestionIds: Set<string>;
  moduleId: string;
  moveTargets: AssessmentModuleShell[];
  disabled: boolean;
  error: string | null;
  onClear: () => void;
  onAction: (action: BulkQuestionAction) => Promise<boolean>;
}) {
  const selectedPretests = questions.filter(
    (question) => selectedQuestionIds.has(question.examQuestionId) && question.isPretest
  ).length;
  const allSelectedArePretest = count > 0 && selectedPretests === count;
  const [moveTargetId, setMoveTargetId] = useState(moveTargets[0]?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    setMoveTargetId(moveTargets[0]?.id ?? "");
  }, [moveTargets]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={authoringMotion.panel}
      className="authoring-glass au-elevation-card border-t border-au-separator p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={count}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={authoringMotion.state}
            className="text-[11px] font-semibold text-slate-700"
          >
            {count ? `${count} selected` : "Select questions"}
          </motion.span>
        </AnimatePresence>
        <motion.button
          type="button"
          whileTap={authoringMotion.press}
          transition={authoringMotion.fast}
          onClick={onClear}
          disabled={!count || disabled}
          className="rounded-md p-1 text-slate-400 hover:bg-au-fill hover:text-slate-700 disabled:opacity-30"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X size={13} aria-hidden="true" />
        </motion.button>
      </div>

      {moveTargets.length ? (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-au-fill p-1.5">
          <select
            value={moveTargetId}
            disabled={disabled}
            onChange={(event) => setMoveTargetId(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-au-separator bg-au-surface px-2 py-1.5 text-[10px] font-medium text-slate-600 outline-none focus:border-au-accent"
            aria-label="Move selected questions to module"
          >
            {moveTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.title}
              </option>
            ))}
          </select>
          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            disabled={!count || disabled || !moveTargetId}
            onClick={() => void onAction({ type: "move", destinationModuleId: moveTargetId })}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-au-fill-strong hover:text-slate-900 disabled:opacity-30"
          >
            <MoveRight size={12} aria-hidden="true" /> Move
          </motion.button>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-1">
        <BulkButton
          label="Duplicate"
          icon={<Copy size={13} />}
          disabled={!count || disabled}
          onClick={() => void onAction({ type: "duplicate", destinationModuleId: moduleId })}
        />
        <BulkButton
          label={allSelectedArePretest ? "Clear pretest" : "Pretest"}
          icon={<RotateCcw size={13} />}
          disabled={!count || disabled}
          onClick={() => void onAction({ type: "set_pretest", value: !allSelectedArePretest })}
        />
        <div className="relative">
          <BulkButton
            label="Delete"
            icon={<Trash2 size={13} />}
            danger
            disabled={!count || disabled}
            onClick={() => setDeleteOpen(true)}
          />
          <ConfirmPopover
            open={deleteOpen}
            title={`Delete ${count} question${count === 1 ? "" : "s"}?`}
            description="The selected questions will be removed from this module. Cancel is focused by default."
            confirmLabel="Delete selected"
            busy={deleteBusy}
            onCancel={() => setDeleteOpen(false)}
            onConfirm={async () => {
              if (deleteBusy) return;
              setDeleteBusy(true);
              try {
                if (await onAction({ type: "delete" })) setDeleteOpen(false);
              } finally {
                setDeleteBusy(false);
              }
            }}
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={authoringMotion.state}
            className="mt-2 rounded-lg bg-au-danger-tint px-2 py-1.5 text-[10px] font-medium leading-4 text-au-danger-text"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function BulkButton({
  label,
  icon,
  disabled,
  danger = false,
  title,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileTap={authoringMotion.press}
      transition={authoringMotion.fast}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={`authoring-interactive flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-lg text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? "text-au-danger hover:bg-au-danger-tint"
          : "text-slate-500 hover:bg-au-fill hover:text-slate-900"
      }`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </motion.button>
  );
}
