import { useEffect, useMemo, useRef, useState } from "react";
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
import { AuthoringDialog } from "../ui/authoringPrimitives";

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
type FailedStep = "check" | "stage" | "commit";

const FAILED_STEP_RETRY_LABEL: Record<FailedStep, string> = {
  check: "Retry checking workbook",
  stage: "Retry securing visuals",
  commit: "Retry import",
};

function questionsLabel(count: number): string {
  return `${count} ${count === 1 ? "question" : "questions"}`;
}

export function SatWorkbookImportSheet({
  open,
  examId,
  shell,
  existingQuestionCount,
  onClose,
  onCommitted,
}: SatWorkbookImportSheetProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const commitInFlightRef = useRef(false);
  // Commit-scoped idempotency key: minted when a valid preview lands, reset
  // when the sheet closes or a new file is chosen. A lost-response commit
  // retry reuses it; committing a different workbook always mints a fresh one.
  const commitKeyRef = useRef<string | null>(null);
  const [activity, setActivity] = useState<Activity>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SatWorkbookPreview | null>(null);
  const [renderModules, setRenderModules] = useState<SatWorkbookModuleDraft[] | null>(null);
  const [stagedAssets, setStagedAssets] = useState<SatWorkbookStagedAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<FailedStep | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const busy = activity !== "idle";
  const replacesContent = existingQuestionCount > 0;

  useEffect(() => {
    if (open) return;
    commitKeyRef.current = null;
    setActivity("idle");
    setFile(null);
    setPreview(null);
    setRenderModules(null);
    setStagedAssets([]);
    setError(null);
    setFailedStep(null);
    setReplaceConfirmed(false);
    setSelectedModuleKey(null);
    setSelectedQuestionIndex(0);
  }, [open]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const beforeCountByModule = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of shell.sections) {
      for (const module of section.modules) counts.set(module.moduleKey, module.questions.length);
    }
    return counts;
  }, [shell]);

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

  const stageAssets = async (nextPreview: SatWorkbookPreview) => {
    setActivity("staging");
    setError(null);
    setFailedStep(null);
    try {
      const staged = await stageWorkbookAssets(nextPreview);
      setStagedAssets(staged.assets);
      setRenderModules(staged.renderModules);
      const firstModule =
        staged.renderModules.find((module) => module.questions.length > 0) ?? null;
      setSelectedModuleKey((current) => current ?? firstModule?.moduleKey ?? null);
    } catch (cause) {
      setFailedStep("stage");
      setError(cause instanceof Error ? cause.message : "The workbook visuals could not be secured.");
    } finally {
      setActivity("idle");
    }
  };

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
    setFailedStep(null);
    setReplaceConfirmed(false);
    setFile(nextFile);
    setPreview(null);
    setRenderModules(null);
    setStagedAssets([]);
    setSelectedModuleKey(null);
    try {
      const nextPreview = await assessmentAuthoringApi.previewSatWorkbook(examId, nextFile);
      // New workbook, new commit identity: the previous key must never leak
      // across workbooks, or a retry could replay the wrong replacement.
      commitKeyRef.current = nextPreview.valid ? crypto.randomUUID() : null;
      setPreview(nextPreview);
      setRenderModules(nextPreview.modules);
      const firstModule = nextPreview.modules.find((module) => module.questions.length > 0) ?? null;
      setSelectedModuleKey(firstModule?.moduleKey ?? null);
      setSelectedQuestionIndex(0);
      if (nextPreview.valid && nextPreview.assets.length > 0) {
        await stageAssets(nextPreview);
        return;
      }
    } catch (cause) {
      setFailedStep("check");
      setError(cause instanceof Error ? cause.message : "The workbook could not be checked.");
    }
    setActivity("idle");
  };

  const downloadTemplate = async () => {
    setError(null);
    setFailedStep(null);
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

  const stagingComplete = preview ? stagedAssets.length === preview.assets.length : false;
  let importDisabledReason: string | null = null;
  if (!preview) importDisabledReason = "Choose a workbook to check before importing.";
  else if (!preview.valid) importDisabledReason = "Fix the workbook issues, then choose the file again.";
  else if (!stagingComplete) importDisabledReason = "Workbook visuals must finish securing first.";
  else if (replacesContent && !replaceConfirmed) {
    importDisabledReason = "Confirm the replacement to continue.";
  }
  const canCommit = importDisabledReason === null && !busy;

  const commit = async () => {
    if (!preview?.valid || !canCommit || commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    setActivity("importing");
    setError(null);
    setFailedStep(null);
    try {
      if (!commitKeyRef.current) commitKeyRef.current = crypto.randomUUID();
      const result = await assessmentAuthoringApi.commitSatWorkbook(examId, {
        importId: preview.importId,
        expectedVersionId: shell.versionId,
        expectedVersionRevision: shell.versionRevision,
        modules: preview.modules,
        assets: stagedAssets,
        operationKey: commitKeyRef.current,
      });
      onCommitted(result);
    } catch (cause) {
      setFailedStep("commit");
      setError(cause instanceof Error ? cause.message : "The SAT workbook could not be imported.");
      setActivity("idle");
    } finally {
      commitInFlightRef.current = false;
    }
  };

  const retryFailedStep = () => {
    if (failedStep === "check" && file) void inspectFile(file);
    else if (failedStep === "stage" && preview) void stageAssets(preview);
    else if (failedStep === "commit") void commit();
  };

  const importLabel = !preview?.valid
    ? "Import workbook"
    : replacesContent
      ? `Replace draft with ${questionsLabel(preview.questionCount)}`
      : `Import ${questionsLabel(preview.questionCount)}`;

  return (
    <AuthoringDialog
      open={open}
      title="Import SAT from Excel"
      onClose={onClose}
      closeDisabled={busy}
      showHeader={false}
      contentClassName="authoring-dialog-content--workbook au-elevation-sheet flex max-h-[94vh] max-w-[1320px] flex-col overflow-hidden rounded-[20px] p-0"
    >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-au-separator px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-base font-semibold tracking-[-0.02em] text-slate-950">
                  Import SAT from Excel
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  One workbook replaces the complete six-module draft pinned to the revision you
                  inspected. If another author saves first, the import conflicts instead of
                  overwriting. Published versions are untouched. After the import you can undo it
                  until you edit further or publish. Nothing changes until you confirm.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-au-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-35"
                aria-label="Close SAT workbook import"
              >
                <X size={16} aria-hidden="true" />
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
                  className="authoring-interactive mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-[11px] text-xs font-semibold text-au-accent hover:bg-au-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent"
                >
                  <Download size={14} aria-hidden="true" />
                  Download SAT Excel template
                </button>

                {error ? (
                  <div
                    ref={errorRef}
                    tabIndex={-1}
                    role="alert"
                    className="mt-3 rounded-xl bg-au-danger-tint px-3 py-2.5 text-xs leading-5 text-au-danger-text outline-none focus-visible:ring-2 focus-visible:ring-au-accent"
                  >
                    <div className="flex gap-2">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{error}</span>
                    </div>
                    {failedStep ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={retryFailedStep}
                        className="authoring-interactive mt-2 min-h-11 rounded-[10px] bg-au-surface px-3 text-xs font-semibold text-au-danger-text ring-1 ring-au-danger-text/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-40"
                      >
                        {FAILED_STEP_RETRY_LABEL[failedStep]}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {file ? (
                  <ol aria-label="Import progress" className="mt-3 space-y-1 text-xs">
                    <ProgressStep
                      label="Check workbook"
                      state={stepState("check", activity, failedStep, Boolean(preview))}
                    />
                    {preview && preview.assets.length > 0 ? (
                      <ProgressStep
                        label={`Secure ${preview.assets.length} workbook visual${preview.assets.length === 1 ? "" : "s"}`}
                        state={stepState("stage", activity, failedStep, stagingComplete)}
                      />
                    ) : null}
                    <ProgressStep
                      label="Replace the draft"
                      state={stepState("commit", activity, failedStep, false)}
                    />
                  </ol>
                ) : null}

                {preview ? (
                  <>
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      <Metric label="Questions" value={preview.questionCount} />
                      <Metric label="Modules" value={preview.modules.length} />
                      <Metric label="Visuals" value={preview.assets.length} />
                      <Metric label="Issues" value={preview.issues.length} bad={!preview.valid} />
                    </div>
                    <div className="mt-4">
                      <p className="px-1 text-xs font-semibold text-slate-600">
                        Before and after, by module
                      </p>
                      <table className="mt-1 w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-600">
                            <th scope="col" className="px-2.5 py-1 font-semibold">
                              Module
                            </th>
                            <th scope="col" className="px-2 py-1 text-right font-semibold">
                              Now
                            </th>
                            <th scope="col" className="px-2 py-1 text-right font-semibold">
                              After
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.modules.map((module) => {
                            const selected = module.moduleKey === selectedModuleKey;
                            const target = module.moduleKey.startsWith("rw-") ? 27 : 22;
                            return (
                              <tr key={module.moduleKey}>
                                <td colSpan={1} className="p-0">
                                  <button
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => {
                                      setSelectedModuleKey(module.moduleKey);
                                      setSelectedQuestionIndex(0);
                                    }}
                                    className={`flex min-h-11 w-full items-center rounded-[10px] px-2.5 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent ${
                                      selected
                                        ? "bg-au-accent-tint-strong text-au-accent"
                                        : "text-slate-700 hover:bg-au-fill"
                                    }`}
                                  >
                                    <span className="truncate font-semibold">
                                      {MODULE_LABELS[module.moduleKey] ?? module.moduleKey}
                                    </span>
                                  </button>
                                </td>
                                <td className="px-2 text-right tabular-nums text-slate-600">
                                  {beforeCountByModule.get(module.moduleKey) ?? 0}
                                </td>
                                <td className="px-2 text-right font-semibold tabular-nums text-slate-900">
                                  {module.questions.length}/{target}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {preview.issues.length ? (
                      <div className="mt-4">
                        <p className="px-1 text-xs font-semibold text-slate-600">Needs attention</p>
                        <div className="mt-1.5 space-y-1.5">
                          {preview.issues.slice(0, 60).map((issue, index) => (
                            <div
                              key={`${issue.row}-${issue.field}-${index}`}
                              className="rounded-[10px] bg-au-warning-tint px-3 py-2 text-xs leading-4 text-au-warning-text"
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
                    ) : stagingComplete && activity !== "staging" ? (
                      <div className="mt-4 flex items-center gap-2 rounded-xl bg-au-success-tint px-3 py-2.5 text-xs font-medium text-au-success-text">
                        <CheckCircle2 size={15} aria-hidden="true" />
                        Complete SAT ready to import
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="flex min-h-[420px] min-w-0 flex-col bg-au-fill">
                {selectedModule && selectedQuestion ? (
                  <>
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-au-separator px-4 py-3 authoring-glass sm:px-5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-800">
                          {MODULE_LABELS[selectedModule.moduleKey] ?? selectedModule.moduleKey}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">Actual student renderer</p>
                      </div>
                      <select
                        aria-label="Preview workbook question"
                        value={selectedQuestionIndex}
                        onChange={(event) => setSelectedQuestionIndex(Number(event.target.value))}
                        className="min-h-11 rounded-[9px] border-0 bg-au-fill px-3 text-xs font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-au-accent"
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
                      <FileSpreadsheet size={30} className="mx-auto text-slate-400" aria-hidden="true" />
                      <p className="mt-3 text-sm font-semibold text-slate-700">
                        Your SAT appears here before import
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        Tables, LaTeX math, code blocks, formatting, choices, and adaptive-module
                        placement render with the same components students use.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <footer className="shrink-0 border-t border-au-separator px-5 py-3 sm:px-6">
              {replacesContent && preview?.valid ? (
                <label className="mb-3 flex min-h-11 items-start gap-3 rounded-[12px] bg-au-warning-tint px-3 py-2.5 text-xs leading-5 text-au-warning-text">
                  <input
                    type="checkbox"
                    checked={replaceConfirmed}
                    disabled={busy}
                    onChange={(event) => setReplaceConfirmed(event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--au-accent,#2563eb)]"
                  />
                  <span>
                    I understand this replaces all {questionsLabel(existingQuestionCount)} in the
                    current draft with the {questionsLabel(preview.questionCount)} from this
                    workbook. Published versions are untouched, and I can undo until I edit or
                    publish.
                  </span>
                </label>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p
                  id="sat-workbook-import-hint"
                  aria-live="polite"
                  className="max-w-xl text-xs leading-4 text-slate-600"
                >
                  {activity === "importing"
                    ? "Importing… keep this window open."
                    : importDisabledReason ??
                      (replacesContent
                        ? `${questionsLabel(existingQuestionCount)} in the current draft will be replaced.`
                        : "Import creates the complete draft atomically; a failed import changes nothing.")}
                </p>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onClose}
                    className="min-h-11 rounded-full px-4 text-xs font-semibold text-slate-600 hover:bg-au-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-35"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!canCommit}
                    aria-describedby="sat-workbook-import-hint"
                    onClick={() => void commit()}
                    className="authoring-interactive min-h-11 rounded-[11px] bg-au-accent px-4 text-sm font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {activity === "importing" ? "Importing…" : importLabel}
                  </button>
                </div>
              </div>
            </footer>
    </AuthoringDialog>
  );
}

type StepState = "pending" | "active" | "done" | "failed";

function stepState(
  step: FailedStep,
  activity: Activity,
  failedStep: FailedStep | null,
  done: boolean
): StepState {
  if (failedStep === step) return "failed";
  const active: Activity =
    step === "check" ? "checking" : step === "stage" ? "staging" : "importing";
  if (activity === active) return "active";
  return done ? "done" : "pending";
}

const STEP_STATE_TEXT: Record<StepState, string> = {
  pending: "Waiting",
  active: "In progress…",
  done: "Done",
  failed: "Failed",
};

function ProgressStep({ label, state }: { label: string; state: StepState }) {
  return (
    <li className="flex min-h-8 items-center justify-between gap-2 rounded-[9px] px-2.5 text-slate-700">
      <span>{label}</span>
      <span
        className={`font-semibold ${state === "failed" ? "text-au-danger-text" : state === "done" ? "text-au-success-text" : "text-slate-600"}`}
      >
        {STEP_STATE_TEXT[state]}
      </span>
    </li>
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
      className={`min-h-11 w-full rounded-[16px] border border-dashed p-5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:cursor-wait ${
        dragging ? "border-au-accent/55 bg-au-accent-tint" : "border-au-separator bg-au-fill"
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
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-au-surface text-au-accent shadow-sm" aria-hidden="true">
        <UploadCloud size={18} aria-hidden="true" />
      </span>
      <p className="mt-3 truncate text-sm font-semibold text-slate-800">
        {checking ? "Preparing workbook…" : (file?.name ?? "Drop your SAT Excel workbook")}
      </p>
      <p className="mt-1 text-xs leading-4 text-slate-600">.xlsx · up to 12 MB</p>
      <span className="mt-3 inline-flex min-h-11 items-center rounded-full bg-au-surface px-3.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-au-accent/10">
        Choose File
      </span>
    </button>
  );
}

function Metric({ label, value, bad = false }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-[11px] bg-au-fill px-2.5 py-2">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p
        className={`mt-0.5 text-[15px] font-semibold tabular-nums ${bad ? "text-au-warning-text" : "text-slate-800"}`}
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
