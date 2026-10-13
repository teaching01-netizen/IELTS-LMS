import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, UploadCloud, X } from "lucide-react";
import type {
  AssessmentAuthoringShell,
  QuestionRevision,
  SatWorkbookCommitResult,
  SatWorkbookCommitRequest,
  SatWorkbookImportOptions,
  SatWorkbookPretestResolution,
  SatWorkbookPreviewModule,
  SatWorkbookPreviewQuestion,
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
  const inspectionRef = useRef(0);
  const commitRequestRef = useRef<SatWorkbookCommitRequest | null>(null);
  const [mode, setMode] = useState<SatWorkbookImportOptions["mode"]>("full");
  const [targetModuleKey, setTargetModuleKey] = useState("");
  const [pretestOrders, setPretestOrders] = useState<number[]>([]);
  const [designationSource, setDesignationSource] = useState<SatWorkbookPretestResolution["designationSource"] | "">("");
  const [pretestsConfirmed, setPretestsConfirmed] = useState(false);
  const [activity, setActivity] = useState<Activity>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SatWorkbookPreview | null>(null);
  const [renderModules, setRenderModules] = useState<SatWorkbookPreviewModule[] | null>(null);
  const [stagedAssets, setStagedAssets] = useState<SatWorkbookStagedAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<FailedStep | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const busy = activity !== "idle";
  const singleModule = mode === "single_module";

  const clearInspection = useCallback(() => {
    inspectionRef.current += 1;
    commitRequestRef.current = null;
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
    setPretestOrders([]);
    setDesignationSource("");
    setPretestsConfirmed(false);
  }, []);

  useEffect(() => {
    clearInspection();
    setMode("full");
    setTargetModuleKey("");
    return () => { inspectionRef.current += 1; };
  }, [open, examId, clearInspection]);

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

  const replacementCount = singleModule ? (beforeCountByModule.get(targetModuleKey) ?? 0) : existingQuestionCount;
  const replacesContent = replacementCount > 0;

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

  const stageAssets = async (nextPreview: SatWorkbookPreview, generation = inspectionRef.current) => {
    setActivity("staging");
    setError(null);
    setFailedStep(null);
    try {
      const staged = await stageWorkbookAssets(nextPreview);
      if (generation !== inspectionRef.current) return;
      setStagedAssets(staged.assets);
      setRenderModules(staged.renderModules);
      const firstModule =
        staged.renderModules.find((module) => module.questions.length > 0) ?? null;
      setSelectedModuleKey((current) => current ?? firstModule?.moduleKey ?? null);
    } catch (cause) {
      if (generation !== inspectionRef.current) return;
      setFailedStep("stage");
      setError(cause instanceof Error ? cause.message : "The workbook visuals could not be secured.");
    } finally {
      if (generation === inspectionRef.current) setActivity("idle");
    }
  };

  const inspectFile = async (nextFile: File) => {
    if (commitInFlightRef.current) return;
    clearInspection();
    const generation = inspectionRef.current;
    if (singleModule && !targetModuleKey) {
      setError("Choose the target module before checking the workbook.");
      return;
    }
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
      const nextPreview = singleModule
        ? await assessmentAuthoringApi.previewSatWorkbook(examId, nextFile, { mode, targetModuleKey })
        : await assessmentAuthoringApi.previewSatWorkbook(examId, nextFile);
      if (generation !== inspectionRef.current) return;
      if (singleModule && (nextPreview.mode !== "single_module" || nextPreview.targetModuleKey !== targetModuleKey)) {
        throw new Error("The server did not check the selected module. Refresh and check the workbook again.");
      }
      // New workbook, new commit identity: the previous key must never leak
      // across workbooks, or a retry could replay the wrong replacement.
      commitKeyRef.current = nextPreview.valid ? crypto.randomUUID() : null;
      setPreview(nextPreview);
      setRenderModules(nextPreview.modules);
      const firstModule = nextPreview.modules.find((module) => module.questions.length > 0) ?? null;
      setSelectedModuleKey(firstModule?.moduleKey ?? null);
      setSelectedQuestionIndex(0);
      setPretestOrders(nextPreview.modules[0]?.questions.flatMap((question, index) => question.isPretest === true ? [index + 1] : []) ?? []);
      if (nextPreview.valid && nextPreview.assets.length > 0) {
        await stageAssets(nextPreview, generation);
        return;
      }
    } catch (cause) {
      if (generation !== inspectionRef.current) return;
      setFailedStep("check");
      setError(cause instanceof Error ? cause.message : "The workbook could not be checked.");
    }
    if (generation === inspectionRef.current) setActivity("idle");
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
  else if (singleModule && (pretestOrders.length !== 2 || !designationSource || !pretestsConfirmed)) {
    importDisabledReason = "Pretest assignments are unresolved. Choose exactly two questions and confirm their designation source.";
  }
  else if (replacesContent && !replaceConfirmed) {
    importDisabledReason = "Confirm the replacement to continue.";
  }
  const canCommit = importDisabledReason === null && !busy;

  const commit = async () => {
    if (!preview?.valid || !canCommit || commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    const generation = inspectionRef.current;
    setActivity("importing");
    setError(null);
    setFailedStep(null);
    try {
      if (!commitKeyRef.current) commitKeyRef.current = crypto.randomUUID();
      if (!commitRequestRef.current) {
        const request: SatWorkbookCommitRequest = {
        importId: preview.importId,
        expectedVersionId: shell.versionId,
        expectedVersionRevision: shell.versionRevision,
        modules: preview.modules.map((module) => ({ ...module, questions: module.questions.map((question, index) => ({ ...question, isPretest: singleModule ? pretestOrders.includes(index + 1) : question.isPretest === true })) })),
        assets: stagedAssets,
        operationKey: commitKeyRef.current,
        ...(singleModule ? {
          mode, targetModuleKey,
          pretestResolution: { selectedOrders: [...pretestOrders].sort((a, b) => a - b), designationSource: designationSource as SatWorkbookPretestResolution["designationSource"], confirmed: pretestsConfirmed },
        } : {}),
        };
        commitRequestRef.current = JSON.parse(JSON.stringify(request)) as SatWorkbookCommitRequest;
      }
      const result = await assessmentAuthoringApi.commitSatWorkbook(examId, commitRequestRef.current);
      if (generation !== inspectionRef.current) return;
      onCommitted(result);
    } catch (cause) {
      if (generation !== inspectionRef.current) return;
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
      ? `Replace ${singleModule ? "module" : "draft"} with ${questionsLabel(preview.questionCount)}`
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
                  {singleModule ? "Import only the selected module after confirming two pretests. Other modules, routing and scoring settings stay unchanged. A stale draft conflicts; you can undo until the next edit or publication." : <>One workbook replaces the complete six-module draft pinned to the revision you
                  inspected. If another author saves first, the import conflicts instead of
                  overwriting. Published versions are untouched. After the import you can undo it
                  until you edit further or publish. Nothing changes until you confirm.</>}
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
                {shell.singleModuleImportEnabled ? (
                  <div className="mb-4 space-y-3 text-xs text-slate-700">
                    <label htmlFor="sat-workbook-import-scope" className="block font-semibold">
                      Import scope
                      <select id="sat-workbook-import-scope" aria-label="Import scope" value={mode} disabled={busy || failedStep === "commit"}
                        onChange={(event) => { clearInspection(); setMode(event.target.value as SatWorkbookImportOptions["mode"]); setTargetModuleKey(""); }}
                        className="mt-1 min-h-11 w-full rounded-[9px] bg-au-fill px-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-au-accent">
                        <option value="full">Complete SAT — all six modules</option>
                        <option value="single_module">Single module</option>
                      </select>
                    </label>
                    {singleModule ? (
                      <label htmlFor="sat-workbook-target-module" className="block font-semibold">
                        Target module
                        <select id="sat-workbook-target-module" aria-label="Target module" value={targetModuleKey} disabled={busy || failedStep === "commit"}
                          onChange={(event) => { clearInspection(); setTargetModuleKey(event.target.value); }}
                          className="mt-1 min-h-11 w-full rounded-[9px] bg-au-fill px-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-au-accent">
                          <option value="">Choose the destination module</option>
                          {Object.entries(MODULE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                      </label>
                    ) : null}
                  </div>
                ) : null}
                <DropTarget
                  file={file}
                  checking={busy || (singleModule && !targetModuleKey)}
                  onChoose={() => fileInputRef.current?.click()}
                  onDrop={(nextFile) => void inspectFile(nextFile)}
                />
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  disabled={activity === "importing" || (singleModule && !targetModuleKey)}
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
                  aria-describedby="sat-workbook-template-hint"
                  className="authoring-interactive mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-[11px] text-xs font-semibold text-au-accent hover:bg-au-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent"
                >
                  <Download size={14} aria-hidden="true" />
                  Download SAT Excel template
                </button>
                <p
                  id="sat-workbook-template-hint"
                  className="mt-1 px-2 text-center text-xs leading-4 text-slate-600"
                >
                  Includes a copyable AI prompt, authoring guide, and import checklist.
                </p>

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
                      label={singleModule ? "Import the selected module" : "Replace the draft"}
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
                    {singleModule && preview.valid ? (
                      <fieldset disabled={busy || failedStep === "commit"} className="mt-4 rounded-xl bg-au-fill p-3">
                        <legend className="px-1 text-sm font-semibold text-slate-800">Pretest designation</legend>
                        <p aria-live="polite" className="text-xs font-semibold text-slate-700">{pretestOrders.length} of 2 selected</p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">Unknown is the workbook's unresolved designation. Verify the source or deliberately designate two pretests for a custom practice test. No pair is generated automatically.</p>
                        <div className="mt-2 grid grid-cols-3 gap-1">
                          {preview.modules[0]?.questions.map((question, index) => {
                            const order = index + 1;
                            const selected = pretestOrders.includes(order);
                            return (
                              <label key={order} htmlFor={`sat-pretest-${order}`} className="flex min-h-11 items-center gap-2 rounded-lg bg-au-surface px-2 text-xs text-slate-700">
                                <input id={`sat-pretest-${order}`} type="checkbox" checked={selected} aria-label={`Designate question ${order} as pretest`}
                                  disabled={!selected && pretestOrders.length >= 2}
                                  onChange={() => { setPretestOrders((orders) => selected ? orders.filter((n) => n !== order) : [...orders, order].sort((a, b) => a-b)); setPretestsConfirmed(false); }}
                                  className="h-4 w-4 shrink-0 accent-[var(--au-accent,#2563eb)]" />
                                <span>{order}<span className="block text-xs text-slate-600">{question.isPretest == null ? "Unknown" : question.isPretest ? "Yes" : "No"}</span></span>
                              </label>
                            );
                          })}
                        </div>
                        <label htmlFor="sat-pretest-source" className="mt-3 block text-xs font-semibold text-slate-700">
                          Pretest designation source
                          <select id="sat-pretest-source" aria-label="Pretest designation source" value={designationSource}
                            onChange={(event) => { setDesignationSource(event.target.value as SatWorkbookPretestResolution["designationSource"] | ""); setPretestsConfirmed(false); }}
                            className="mt-1 min-h-11 w-full rounded-lg bg-au-surface px-2 outline-none focus-visible:ring-2 focus-visible:ring-au-accent">
                            <option value="">Choose how the pair was established</option>
                            <option value="source_verified">Verified against the source</option>
                            <option value="staff_defined">Staff-defined for a practice test</option>
                          </select>
                        </label>
                        <label htmlFor="sat-pretest-confirmation" className="mt-2 flex min-h-11 items-start gap-2 text-xs leading-5 text-slate-700">
                          <input id="sat-pretest-confirmation" type="checkbox" aria-labelledby="sat-pretest-confirmation-label" checked={pretestsConfirmed} disabled={!designationSource || pretestOrders.length !== 2}
                            onChange={(event) => setPretestsConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--au-accent,#2563eb)]" />
                          <span id="sat-pretest-confirmation-label">I confirm these two pretests {designationSource === "staff_defined" ? "are staff-defined for this practice test." : "were verified against the source."}</span>
                        </label>
                        {preview.ignoredScaffoldRows ? <p className="mt-2 text-xs leading-5 text-slate-600">{preview.ignoredScaffoldRows} untouched template rows from other modules were ignored.</p> : null}
                      </fieldset>
                    ) : null}
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
                                    aria-label={`Preview ${MODULE_LABELS[module.moduleKey] ?? module.moduleKey}`}
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
                        {singleModule ? "Module content checked" : "Complete SAT ready to import"}
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
                <label htmlFor="sat-workbook-replacement-confirmation" className="mb-3 flex min-h-11 items-start gap-3 rounded-[12px] bg-au-warning-tint px-3 py-2.5 text-xs leading-5 text-au-warning-text">
                  <input
                    id="sat-workbook-replacement-confirmation"
                    type="checkbox"
                    aria-labelledby="sat-workbook-replacement-confirmation-label"
                    checked={replaceConfirmed}
                    disabled={busy}
                    onChange={(event) => setReplaceConfirmed(event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--au-accent,#2563eb)]"
                  />
                  <span id="sat-workbook-replacement-confirmation-label">
                    {singleModule ? <>I understand this replaces the {questionsLabel(replacementCount)} in {MODULE_LABELS[targetModuleKey]} with {questionsLabel(preview.questionCount)}. The other five modules stay unchanged. I can undo until I edit or publish.</> : <>I understand this replaces all {questionsLabel(existingQuestionCount)} in the
                    current draft with the {questionsLabel(preview.questionCount)} from this
                    workbook. Published versions are untouched, and I can undo until I edit or
                    publish.</>}
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
                    : importDisabledReason ?? (singleModule ? `${questionsLabel(preview?.questionCount ?? 0)} will be imported into ${MODULE_LABELS[targetModuleKey]}. Other modules stay unchanged.` :
                      (replacesContent
                        ? `${questionsLabel(existingQuestionCount)} in the current draft will be replaced.`
                        : "Import creates the complete draft atomically; a failed import changes nothing."))}
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
  renderModules: SatWorkbookPreviewModule[];
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
  modules: SatWorkbookPreviewModule[],
  assetIdByKey: Map<string, string>
): SatWorkbookPreviewModule[] {
  const copy = JSON.parse(JSON.stringify(modules)) as SatWorkbookPreviewModule[];
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

function revisionForPreview(draft: SatWorkbookPreviewQuestion, index: number): QuestionRevision {
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
