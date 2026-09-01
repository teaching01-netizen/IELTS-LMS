import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, UploadCloud, X } from "lucide-react";
import type {
  AssessmentAuthoringShell,
  BatchQuestionDraft,
  QuestionRevision,
  SatWorkbookCommitResult,
  SatWorkbookModuleDraft,
  SatWorkbookPreview,
  SatWorkbookStagedAsset,
} from "../contracts/assessment";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import { uploadAssessmentImportAsset } from "../api/assessmentMediaApi";
import { ExamQuestionRenderer } from "../../exam-rendering/api/ExamQuestionRenderer";
import { authoringMotion } from "../ui/authoringMotion";

const MODULE_LABELS: Record<string, string> = {
  "rw-m1": "Reading & Writing · Module 1",
  "rw-m2-lower": "Reading & Writing · Module 2 — Lower",
  "rw-m2-higher": "Reading & Writing · Module 2 — Higher",
  "math-m1": "Math · Module 1",
  "math-m2-lower": "Math · Module 2 — Lower",
  "math-m2-higher": "Math · Module 2 — Higher",
};

interface SatWorkbookImportSheetProps {
  open: boolean;
  examId: string;
  shell: AssessmentAuthoringShell;
  existingQuestionCount: number;
  onClose: () => void;
  onCommitted: (result: SatWorkbookCommitResult) => void;
}

type Activity = "idle" | "checking" | "staging" | "importing";

export function SatWorkbookImportSheet({
  open,
  examId,
  shell,
  existingQuestionCount,
  onClose,
  onCommitted,
}: SatWorkbookImportSheetProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const [activity, setActivity] = useState<Activity>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SatWorkbookPreview | null>(null);
  const [renderModules, setRenderModules] = useState<SatWorkbookModuleDraft[] | null>(null);
  const [stagedAssets, setStagedAssets] = useState<SatWorkbookStagedAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const busy = activity !== "idle";

  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        surfaceRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((control) => !control.classList.contains("sr-only"));
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", listener);
      previousActiveRef.current?.focus();
    };
  }, [busy, onClose, open]);

  useEffect(() => {
    if (open) return;
    setActivity("idle");
    setFile(null);
    setPreview(null);
    setRenderModules(null);
    setStagedAssets([]);
    setError(null);
    setSelectedModuleKey(null);
    setSelectedQuestionIndex(0);
  }, [open]);

  const selectedModule = useMemo(
    () =>
      (renderModules ?? preview?.modules)?.find((module) => module.moduleKey === selectedModuleKey) ??
      null,
    [preview, renderModules, selectedModuleKey]
  );
  const selectedDraft = selectedModule?.questions[selectedQuestionIndex] ?? null;
  const selectedQuestion = useMemo(
    () => (selectedDraft ? revisionForPreview(selectedDraft, selectedQuestionIndex) : null),
    [selectedDraft, selectedQuestionIndex]
  );

  const inspectFile = async (nextFile: File) => {
    if (!nextFile.name.toLowerCase().endsWith(".xlsx")) {
      setError("Choose an .xlsx SAT workbook.");
      return;
    }
    if (nextFile.size > 12 * 1024 * 1024) {
      setError("SAT workbooks must be 12 MB or smaller.");
      return;
    }
    setActivity("checking");
    setError(null);
    setFile(nextFile);
    setPreview(null);
    setRenderModules(null);
    setStagedAssets([]);
    setSelectedModuleKey(null);
    try {
      const nextPreview = await assessmentAuthoringApi.previewSatWorkbook(examId, nextFile);
      setPreview(nextPreview);
      let nextRenderModules = nextPreview.modules;
      if (nextPreview.valid && nextPreview.assets.length > 0) {
        setActivity("staging");
        const staged = await stageWorkbookAssets(nextPreview);
        setStagedAssets(staged.assets);
        nextRenderModules = staged.renderModules;
      }
      setRenderModules(nextRenderModules);
      const firstModule = nextRenderModules.find((module) => module.questions.length > 0) ?? null;
      setSelectedModuleKey(firstModule?.moduleKey ?? null);
      setSelectedQuestionIndex(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workbook could not be checked.");
    } finally {
      setActivity("idle");
    }
  };

  const downloadTemplate = async () => {
    setError(null);
    try {
      const blob = await assessmentAuthoringApi.getSatWorkbookTemplate(examId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "SAT-Authoring-Template.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The SAT template could not be downloaded."
      );
    }
  };

  const commit = async () => {
    if (!preview?.valid || stagedAssets.length !== preview.assets.length) return;
    setActivity("importing");
    setError(null);
    try {
      const result = await assessmentAuthoringApi.commitSatWorkbook(examId, {
        importId: preview.importId,
        expectedVersionId: shell.versionId,
        expectedVersionRevision: shell.versionRevision,
        modules: preview.modules,
        assets: stagedAssets,
      });
      onCommitted(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The SAT workbook could not be imported.");
      setActivity("idle");
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={authoringMotion.surface}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/28 p-3 authoring-glass sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="Import SAT from Excel"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) onClose();
          }}
        >
          <motion.div
            ref={surfaceRef}
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={authoringMotion.surface}
            className="au-elevation-sheet flex max-h-[94vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-[20px] border border-au-separator bg-white"
          >
            <header className="flex shrink-0 items-start justify-between border-b border-au-separator px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-950">
                  Import SAT from Excel
                </h2>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  One workbook can replace the complete six-module SAT draft. Nothing changes until
                  you choose Import.
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                disabled={busy}
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-au-fill disabled:opacity-35"
                aria-label="Close SAT workbook import"
              >
                <X size={16} />
              </button>
            </header>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[430px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto border-b border-au-separator p-4 sm:p-5 lg:border-b-0 lg:border-r">
                <DropTarget
                  file={file}
                  checking={activity === "checking" || activity === "staging"}
                  onChoose={() => fileInputRef.current?.click()}
                  onDrop={(nextFile) => void inspectFile(nextFile)}
                />
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  aria-label="Choose SAT Excel workbook"
                  onChange={(event) => {
                    const nextFile = event.currentTarget.files?.[0];
                    if (nextFile) void inspectFile(nextFile);
                    event.currentTarget.value = "";
                  }}
                />

                <button
                  type="button"
                  onClick={() => void downloadTemplate()}
                  className="authoring-interactive mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-[11px] text-[11px] font-semibold text-au-accent hover:bg-au-accent-tint"
                >
                  <Download size={14} />
                  Download SAT Excel template
                </button>

                {error ? (
                  <div className="mt-3 flex gap-2 rounded-xl bg-au-danger-tint px-3 py-2.5 text-[11px] leading-5 text-au-danger-text">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}

                {activity === "staging" ? (
                  <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-au-accent-tint px-3 py-2.5 text-[11px] font-medium text-au-accent">
                    <UploadCloud size={14} />
                    Securing {preview?.assets.length ?? 0} workbook visual{
                      preview?.assets.length === 1 ? "" : "s"
                    }…
                  </div>
                ) : null}

                {preview ? (
                  <>
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      <Metric label="Questions" value={preview.questionCount} />
                      <Metric label="Modules" value={preview.modules.length} />
                      <Metric label="Visuals" value={preview.assets.length} />
                      <Metric label="Issues" value={preview.issues.length} bad={!preview.valid} />
                    </div>
                    <div className="mt-4 space-y-1">
                      <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                        Modules
                      </p>
                      {preview.modules.map((module) => {
                        const selected = module.moduleKey === selectedModuleKey;
                        const target = module.moduleKey.startsWith("rw-") ? 27 : 22;
                        return (
                          <button
                            key={module.moduleKey}
                            type="button"
                            onClick={() => {
                              setSelectedModuleKey(module.moduleKey);
                              setSelectedQuestionIndex(0);
                            }}
                            className={`flex min-h-10 w-full items-center justify-between rounded-[10px] px-2.5 text-left text-[11px] transition ${
                              selected
                                ? "bg-au-accent-tint-strong text-au-accent"
                                : "text-slate-600 hover:bg-black/[0.04]"
                            }`}
                          >
                            <span className="truncate font-semibold">
                              {MODULE_LABELS[module.moduleKey] ?? module.moduleKey}
                            </span>
                            <span className="ml-3 shrink-0 tabular-nums text-[10px] opacity-70">
                              {module.questions.length}/{target}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {preview.issues.length ? (
                      <div className="mt-4">
                        <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                          Needs attention
                        </p>
                        <div className="mt-1.5 space-y-1.5">
                          {preview.issues.slice(0, 60).map((issue, index) => (
                            <div
                              key={`${issue.row}-${issue.field}-${index}`}
                              className="rounded-[10px] bg-au-warning-tint px-2.5 py-2 text-[10px] leading-4 text-au-warning-text"
                            >
                              <strong>
                                {issue.row > 0 ? `Questions · Row ${issue.row} · ` : ""}
                                {issue.field}
                              </strong>
                              <br />
                              {issue.message}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : stagedAssets.length === preview.assets.length && activity !== "staging" ? (
                      <div className="mt-4 flex items-center gap-2 rounded-xl bg-au-success-tint px-3 py-2.5 text-[11px] font-medium text-au-success-text">
                        <CheckCircle2 size={15} />
                        Complete SAT ready to import
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="flex min-h-[420px] min-w-0 flex-col bg-au-fill">
                {selectedModule && selectedQuestion ? (
                  <>
                    <div className="flex shrink-0 items-center justify-between border-b border-au-separator bg-white px-4 py-3 authoring-glass sm:px-5">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-slate-800">
                          {MODULE_LABELS[selectedModule.moduleKey] ?? selectedModule.moduleKey}
                        </p>
                        <p className="mt-0.5 text-[9px] text-slate-400">Actual student renderer</p>
                      </div>
                      <select
                        aria-label="Preview workbook question"
                        value={selectedQuestionIndex}
                        onChange={(event) => setSelectedQuestionIndex(Number(event.target.value))}
                        className="h-9 rounded-[9px] border-0 bg-au-fill px-3 text-[10px] font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-au-accent/30"
                      >
                        {selectedModule.questions.map((_, index) => (
                          <option key={index} value={index}>
                            Question {index + 1}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
                      <div className="mx-auto max-w-[760px]">
                        <ExamQuestionRenderer question={selectedQuestion} disabled />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-8 text-center">
                    <div className="max-w-sm">
                      <FileSpreadsheet size={30} className="mx-auto text-slate-300" />
                      <p className="mt-3 text-[13px] font-semibold text-slate-700">
                        Your SAT appears here before import
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">
                        Tables, LaTeX math, code blocks, formatting, choices, and adaptive-module
                        placement render with the same components students use.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-au-separator px-5 py-3 sm:px-6">
              <p className="hidden max-w-xl text-[10px] leading-4 text-slate-400 sm:block">
                {existingQuestionCount > 0
                  ? `${existingQuestionCount} current draft questions will be replaced. Published versions are untouched.`
                  : "Import creates the complete draft atomically; a failed import changes nothing."}
              </p>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onClose}
                  className="min-h-10 rounded-full px-4 text-[11px] font-semibold text-slate-600 hover:bg-au-fill disabled:opacity-35"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    !preview?.valid || stagedAssets.length !== preview.assets.length || busy
                  }
                  onClick={() => void commit()}
                  className="authoring-interactive min-h-10 rounded-[11px] bg-au-accent px-4 text-[12px] font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {activity === "importing"
                    ? "Importing…"
                    : `Import ${preview?.questionCount ?? 147} Questions`}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

async function stageWorkbookAssets(preview: SatWorkbookPreview): Promise<{
  assets: SatWorkbookStagedAsset[];
  renderModules: SatWorkbookModuleDraft[];
}> {
  if (preview.assets.length === 0) {
    return { assets: [], renderModules: preview.modules };
  }
  const staged = new Array<SatWorkbookStagedAsset>(preview.assets.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < preview.assets.length) {
      const index = nextIndex;
      nextIndex += 1;
      const asset = preview.assets[index];
      if (!asset) continue;
      const file = fileFromWorkbookAsset(asset);
      const uploaded = await uploadAssessmentImportAsset(file, preview.importId);
      staged[index] = { key: asset.key, assetId: uploaded.id };
    }
  };
  const workerCount = Math.min(4, preview.assets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const assetIdByKey = new Map(staged.map((asset) => [asset.key, asset.assetId]));
  return {
    assets: staged,
    renderModules: materializePreviewAssetIds(preview.modules, assetIdByKey),
  };
}

function fileFromWorkbookAsset(asset: SatWorkbookPreview["assets"][number]): File {
  if (!asset.dataBase64) {
    throw new Error(`Workbook visual “${asset.key}” could not be staged.`);
  }
  const binary = atob(asset.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength !== asset.sizeBytes) {
    throw new Error(`Workbook visual “${asset.key}” changed while it was being prepared.`);
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new File([buffer], asset.fileName, { type: asset.contentType });
}

function materializePreviewAssetIds(
  modules: SatWorkbookModuleDraft[],
  assetIdByKey: Map<string, string>
): SatWorkbookModuleDraft[] {
  const copy = JSON.parse(JSON.stringify(modules)) as SatWorkbookModuleDraft[];
  replaceWorkbookAssetIds(copy, assetIdByKey);
  return copy;
}

function replaceWorkbookAssetIds(value: unknown, assetIdByKey: Map<string, string>): void {
  if (Array.isArray(value)) {
    value.forEach((child) => replaceWorkbookAssetIds(child, assetIdByKey));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (object["type"] === "image") {
    const attrs = object["attrs"];
    if (attrs && typeof attrs === "object") {
      const imageAttrs = attrs as Record<string, unknown>;
      const assetId = typeof imageAttrs["assetId"] === "string" ? imageAttrs["assetId"] : "";
      const key = assetId.startsWith("workbook:") ? assetId.slice("workbook:".length) : null;
      if (key) {
        const stagedAssetId = assetIdByKey.get(key);
        if (!stagedAssetId) throw new Error(`Workbook visual “${key}” was not staged.`);
        imageAttrs["assetId"] = stagedAssetId;
        delete imageAttrs["src"];
      }
    }
  }
  Object.values(object).forEach((child) => replaceWorkbookAssetIds(child, assetIdByKey));
}

function DropTarget({
  file,
  checking,
  onChoose,
  onDrop,
}: {
  file: File | null;
  checking: boolean;
  onChoose: () => void;
  onDrop: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <button
      type="button"
      disabled={checking}
      aria-label="Choose or drop SAT Excel workbook"
      onClick={onChoose}
      className={`w-full rounded-[16px] border border-dashed p-5 text-center transition disabled:cursor-wait ${
        dragging ? "border-au-accent/55 bg-au-accent-tint" : "border-black/[0.14] bg-au-fill"
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const nextFile = event.dataTransfer.files[0];
        if (nextFile) onDrop(nextFile);
      }}
    >
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-au-accent shadow-sm" aria-hidden="true">
        <UploadCloud size={18} />
      </span>
      <p className="mt-3 truncate text-[12px] font-semibold text-slate-800">
        {checking ? "Preparing workbook…" : (file?.name ?? "Drop your SAT Excel workbook")}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-slate-400">.xlsx · up to 12 MB</p>
      <span className="mt-3 inline-flex min-h-9 items-center rounded-full bg-white px-3.5 text-[10px] font-semibold text-slate-700 shadow-sm ring-1 ring-au-accent/10">
        Choose File
      </span>
    </button>
  );
}

function Metric({ label, value, bad = false }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-[11px] bg-au-fill px-2.5 py-2">
      <p className="text-[9px] font-medium text-slate-400">{label}</p>
      <p
        className={`mt-0.5 text-[15px] font-semibold tabular-nums ${bad ? "text-amber-700" : "text-slate-800"}`}
      >
        {value}
      </p>
    </div>
  );
}

function revisionForPreview(draft: BatchQuestionDraft, index: number): QuestionRevision {
  return {
    id: `workbook-preview-${index}`,
    questionId: `workbook-preview-${index}`,
    semanticRevision: 1,
    revision: 0,
    state: "draft",
    questionType: draft.questionType,
    stimulus: draft.stimulus,
    prompt: draft.prompt,
    answer: draft.answer,
    rationale: draft.rationale,
    metadata: draft.metadata,
    accessibility: draft.accessibility,
  };
}
