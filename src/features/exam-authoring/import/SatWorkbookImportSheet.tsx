import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, UploadCloud, X } from "lucide-react";
import type {
  AssessmentAuthoringShell,
  QuestionRevision,
  SatWorkbookCommitResult,
  SatWorkbookCommitRequest,
  SatWorkbookPreviewModule,
  SatWorkbookPreviewQuestion,
  SatWorkbookPreview,
  SatWorkbookStagedAsset,
} from "../contracts/assessment";
import { assessmentAuthoringApi } from "../api/assessmentAuthoringApi";
import { uploadAssessmentImportAsset } from "../api/assessmentMediaApi";
import { SatQuestionPreview } from "../../student-delivery/api/SatQuestionPreview";
import { AuthoringDialog } from "../ui/authoringPrimitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { SAT_WORKBOOK_EXAMPLES } from "./satWorkbookExamples";
import { SatWorkbookExampleGuide } from "./SatWorkbookExampleGuide";

const MODULE_LABELS: Record<string, string> = {
  "rw-m1": "Reading & Writing · Module 1",
  "rw-m2-lower": "Reading & Writing · Module 2 — Lower",
  "rw-m2-higher": "Reading & Writing · Module 2 — Higher",
  "math-m1": "Math · Module 1",
  "math-m2-lower": "Math · Module 2 — Lower",
  "math-m2-higher": "Math · Module 2 — Higher",
};

const ALL_MODULE_KEYS = Object.keys(MODULE_LABELS);

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

function moduleLabel(moduleKey: string): string {
  return MODULE_LABELS[moduleKey] ?? moduleKey;
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
  const [activity, setActivity] = useState<Activity>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SatWorkbookPreview | null>(null);
  const [renderModules, setRenderModules] = useState<SatWorkbookPreviewModule[] | null>(null);
  const [stagedAssets, setStagedAssets] = useState<SatWorkbookStagedAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<FailedStep | null>(null);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [previewTab, setPreviewTab] = useState("examples");
  const [exampleId, setExampleId] = useState("text-only");
  const example = SAT_WORKBOOK_EXAMPLES.find((item) => item.id === exampleId) ?? SAT_WORKBOOK_EXAMPLES[0]!;
  const busy = activity !== "idle";

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
    setSelectedModuleKey(null);
    setSelectedQuestionIndex(0);
  }, []);

  useEffect(() => {
    clearInspection();
    setPreviewTab("examples");
    setExampleId("text-only");
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

  const detected = useMemo(() => preview?.detected ?? [], [preview]);
  const replacesWholeDraft = detected.length === ALL_MODULE_KEYS.length;
  const replacementCount = replacesWholeDraft
    ? existingQuestionCount
    : detected.reduce((sum, module) => sum + (beforeCountByModule.get(module.moduleKey) ?? 0), 0);
  const replacesContent = replacementCount > 0;
  const untouchedKeys = ALL_MODULE_KEYS.filter((key) => !detected.some((module) => module.moduleKey === key));

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
    setFile(nextFile);
    setPreviewTab("workbook");
    setPreview(null);
    setRenderModules(null);
    setStagedAssets([]);
    setSelectedModuleKey(null);
    try {
      const nextPreview = await assessmentAuthoringApi.previewSatWorkbook(examId, nextFile);
      if (generation !== inspectionRef.current) return;
      // New workbook, new commit identity: the previous key must never leak
      // across workbooks, or a retry could replay the wrong replacement.
      commitKeyRef.current = nextPreview.valid ? crypto.randomUUID() : null;
      setPreview(nextPreview);
      setRenderModules(nextPreview.modules);
      const firstModule = nextPreview.modules.find((module) => module.questions.length > 0) ?? null;
      setSelectedModuleKey(firstModule?.moduleKey ?? null);
      setSelectedQuestionIndex(0);
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
  const needsAttentionCount = detected.filter((module) => !module.ready).length;
  let importDisabledReason: string | null = null;
  if (!preview) importDisabledReason = "Choose a workbook to check before importing.";
  else if (detected.length === 0) importDisabledReason = "No module with questions was found in this workbook.";
  else if (!preview.valid) {
    importDisabledReason = needsAttentionCount === 0
      ? "Fix the workbook issues listed under Needs attention, then choose the file again."
      : `Fix the ${needsAttentionCount === 1 ? "module" : "modules"} marked Needs attention, then choose the file again.`;
  }
  else if (!stagingComplete) importDisabledReason = "Workbook visuals must finish securing first.";
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
          modules: preview.modules,
          assets: stagedAssets,
          operationKey: commitKeyRef.current,
          targetModuleKeys: preview.targetModuleKeys,
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
      ? `Replace ${replacesWholeDraft ? "draft" : detected.length === 1 ? "module" : "modules"} with ${questionsLabel(preview.questionCount)}`
      : `Import ${questionsLabel(preview.questionCount)}`;
  const detectedLabels = detected.map((module) => moduleLabel(module.moduleKey)).join(", ");

  return (
    <AuthoringDialog
      open={open}
      title="Import SAT from Excel"
      onClose={onClose}
      closeDisabled={busy}
      showHeader={false}
      contentClassName="authoring-dialog-content--workbook au-elevation-sheet flex max-h-[94vh] max-w-[1320px] flex-col overflow-hidden rounded-[24px] p-0"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-au-separator px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-slate-950">
            Import SAT from Excel
          </h2>
          <p className="mt-1 text-sm leading-5 text-slate-600">
            Upload one workbook, check every question, and import only the modules it contains.
          </p>
          <details className="mt-2 text-xs leading-5 text-slate-600">
            <summary className="cursor-pointer font-semibold text-au-accent">How the import works</summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>Only the modules in your workbook change. Routing, scoring and other modules stay as they are.</li>
              <li>If another author saves first, the import conflicts instead of overwriting. Published versions are untouched.</li>
              <li>Nothing changes until you confirm. Undo stays available until you edit further or publish.</li>
            </ul>
          </details>
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

      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[380px_minmax(0,1fr)] lg:overflow-hidden">
        <div className="min-h-0 border-b border-au-separator p-4 sm:p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <p className="mb-2 text-sm font-semibold text-slate-900">Workbook</p>
          <DropTarget
            file={file}
            checking={busy}
            onChoose={() => fileInputRef.current?.click()}
            onDrop={(nextFile) => void inspectFile(nextFile)}
          />
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            disabled={activity === "importing"}
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
            className="authoring-interactive mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-slate-700 hover:bg-au-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent"
          >
            <Download size={14} aria-hidden="true" />
            Download SAT Excel template
          </button>
          <p
            id="sat-workbook-template-hint"
            className="mt-1 px-2 text-center text-xs leading-4 text-slate-600"
          >
            Includes a copyable AI prompt, authoring guide, and import checklist. Fill in any
            modules you have; leave the rest untouched.
          </p>

          {previewTab === "examples" ? <SatWorkbookExampleGuide example={example} /> : (
            <p className="mt-3 rounded-2xl bg-au-fill p-3 text-xs leading-5 text-slate-600">
              Prompt → Question text. Stimulus → Passage or image (optional). Open Examples to see where each Excel value appears.
            </p>
          )}

          {error ? (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="mt-3 rounded-2xl bg-au-danger-tint px-3 py-2.5 text-xs leading-5 text-au-danger-text outline-none focus-visible:ring-2 focus-visible:ring-au-accent"
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
                  className="authoring-interactive mt-2 min-h-11 rounded-full bg-au-surface px-3 text-xs font-semibold text-au-danger-text ring-1 ring-au-danger-text/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-40"
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
                label={detected.length === 1 ? "Import the module" : detected.length > 1 ? "Import the modules" : "Import"}
                state={stepState("commit", activity, failedStep, false)}
              />
            </ol>
          ) : null}

          {preview ? (
            <>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Stat value={preview.questionCount} label="questions" />
                <Stat value={detected.length} label="modules" />
                <Stat value={preview.assets.length} label="visuals" />
                <Stat value={preview.issues.length} label="issues" tone={preview.valid ? "neutral" : "warning"} />
              </div>

              <div className="mt-4">
                <p className="px-1 text-sm font-semibold text-slate-900">
                  {detected.length === 0 ? "Found in your workbook" : `Found in your workbook · ${detected.filter((module) => module.ready).length} of ${detected.length} ready`}
                </p>
                {detected.length === 0 ? (
                  <p className="mt-1 rounded-2xl bg-au-warning-tint px-3 py-2 text-xs leading-5 text-au-warning-text">
                    No module with questions was found. Fill in the rows of at least one module in
                    the template, then choose the file again.
                  </p>
                ) : (
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
                      {detected.map((module) => {
                        const selected = module.moduleKey === selectedModuleKey;
                        const issueCount = preview.issues.filter((issue) => issue.moduleKey === module.moduleKey).length;
                        return (
                          <tr key={module.moduleKey}>
                            <td className="p-0">
                              <button
                                type="button"
                                aria-label={`Preview ${moduleLabel(module.moduleKey)}`}
                                aria-pressed={selected}
                                onClick={() => {
                                  setSelectedModuleKey(module.moduleKey);
                                  setSelectedQuestionIndex(0);
                                }}
                                className={`flex min-h-11 w-full flex-col justify-center rounded-xl px-2.5 py-1 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent ${
                                  selected
                                    ? "bg-au-accent-tint-strong text-au-accent"
                                    : "text-slate-700 hover:bg-au-fill"
                                }`}
                              >
                                <span className="truncate font-semibold">{moduleLabel(module.moduleKey)}</span>
                                <span
                                  className={`flex items-center gap-1 text-[11px] font-medium ${module.ready ? "text-au-success-text" : "text-au-warning-text"}`}
                                >
                                  {module.ready ? (
                                    <CheckCircle2 size={11} aria-hidden="true" />
                                  ) : (
                                    <AlertCircle size={11} aria-hidden="true" />
                                  )}
                                  {module.ready
                                    ? "Ready to import"
                                    : `Needs attention · ${issueCount} ${issueCount === 1 ? "issue" : "issues"}`}
                                </span>
                              </button>
                            </td>
                            <td className="px-2 text-right tabular-nums text-slate-600">
                              {beforeCountByModule.get(module.moduleKey) ?? 0}
                            </td>
                            <td className="px-2 text-right font-semibold tabular-nums text-slate-900">
                              {module.questionCount}/{module.expectedCount}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {detected.length > 0 && untouchedKeys.length > 0 ? (
                  <p className="mt-2 px-1 text-xs leading-5 text-slate-600">
                    Not in your workbook, left unchanged: {untouchedKeys.map(moduleLabel).join(", ")}.
                  </p>
                ) : null}
                {detected.length > 0 ? (
                  <p className="mt-1 px-1 text-xs leading-5 text-slate-600">
                    Every question is scored. A Pretest column from an older template is ignored.
                    {preview.ignoredScaffoldRows ? ` ${preview.ignoredScaffoldRows} untouched template rows were ignored.` : ""}
                  </p>
                ) : null}
              </div>

              {preview.issues.length ? (
                <div className="mt-4">
                  <p className="px-1 text-sm font-semibold text-slate-900">Needs attention</p>
                  <div className="mt-1.5 space-y-1.5">
                    {preview.issues.slice(0, 60).map((issue, index) => (
                      <div
                        key={`${issue.row}-${issue.field}-${index}`}
                        className="rounded-2xl bg-au-warning-tint px-3 py-2 text-xs leading-4 text-au-warning-text"
                      >
                        <strong>
                          {issue.moduleKey ? `${moduleLabel(issue.moduleKey)} · ` : ""}
                          {issue.row > 0 ? `Questions · Row ${issue.row} · ` : ""}
                          {issue.field}
                        </strong>
                        <br />
                        {issue.message}
                      </div>
                    ))}
                  </div>
                </div>
              ) : stagingComplete && activity !== "staging" && detected.length > 0 ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl bg-au-success-tint px-3 py-2.5 text-xs font-medium text-au-success-text">
                  <CheckCircle2 size={15} aria-hidden="true" />
                  {detected.length === 1 ? "Module checked and ready to import" : `All ${detected.length} modules checked and ready to import`}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <Tabs value={previewTab} onValueChange={setPreviewTab} className="min-h-[420px] min-w-0 gap-0 bg-au-fill lg:overflow-y-auto">
          <div className="shrink-0 border-b border-au-separator px-4 py-2 sm:px-5">
            <TabsList aria-label="Excel preview" className="h-auto min-h-11 bg-au-fill">
              <TabsTrigger value="examples" className="min-h-11 px-4 text-xs">Examples</TabsTrigger>
              <TabsTrigger value="workbook" className="min-h-11 px-4 text-xs">Your workbook</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="examples" className="min-w-0 flex-none">
            <div className="border-b border-au-separator bg-au-surface px-4 py-3 sm:px-5">
              <label htmlFor="sat-workbook-example" className="block text-xs font-semibold text-slate-800">Question example
              <select id="sat-workbook-example" value={exampleId} onChange={(event) => setExampleId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-au-separator bg-au-surface px-3 text-sm font-normal text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent">
                {SAT_WORKBOOK_EXAMPLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              </label>
              <p className="mt-2 text-xs leading-5 text-slate-600">{example.guidance}</p>
              <p className="mt-1 text-xs font-semibold text-slate-700">Student view · read-only example</p>
            </div>
            <SatQuestionPreview key={example.id} question={example.question} questionNumber={1} />
          </TabsContent>
          <TabsContent value="workbook" className="min-w-0 flex-none">
          {selectedModule && selectedQuestion ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-au-separator px-4 py-3 authoring-glass sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-800">
                    {moduleLabel(selectedModule.moduleKey)}
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
              {preview && preview.assets.length > 0 && !stagingComplete ? (
                <p role="status" className="p-6 text-sm leading-6 text-slate-600">
                  {!preview.valid
                    ? "Fix the workbook issues to preview its visuals."
                    : activity === "staging"
                      ? "Preparing workbook visuals for the student preview…"
                      : "Retry securing visuals to show the student preview."}
                </p>
              ) : (
                <SatQuestionPreview key={`${selectedModule.moduleKey}-${selectedQuestionIndex}`} question={selectedQuestion} questionNumber={selectedQuestionIndex + 1} />
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <FileSpreadsheet size={30} className="mx-auto text-slate-400" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  Your SAT appears here before import
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Tables, LaTeX math, code blocks, bold/italic/underline (++underlined text++),
                  choices, and adaptive-module placement render with the same components
                  students use. Note that raw HTML, Markdown links, and strikethrough import
                  as plain text; use LaTeX inside math for subscripts and superscripts (for
                  example {"\\(x_2\\)"} and {"\\(x^2\\)"}).
                </p>
              </div>
            </div>
          )}
          </TabsContent>
        </Tabs>
      </div>

      <footer className="shrink-0 border-t border-au-separator bg-au-surface px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            id="sat-workbook-import-hint"
            aria-live="polite"
            className="max-w-xl text-xs leading-5 text-slate-600"
          >
            {activity === "importing"
              ? "Importing… keep this window open."
              : importDisabledReason ?? (replacesWholeDraft
                ? replacesContent
                  ? `Replaces all ${questionsLabel(existingQuestionCount)} in this draft. Undo stays available until you edit or publish.`
                  : "Import creates the complete draft atomically; a failed import changes nothing."
                : `${questionsLabel(preview?.questionCount ?? 0)} will be imported into ${detectedLabels}. Other modules stay unchanged.`)}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="min-h-11 rounded-full px-4 text-sm font-semibold text-slate-600 hover:bg-au-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-35"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canCommit}
              aria-describedby="sat-workbook-import-hint"
              onClick={() => void commit()}
              className="authoring-interactive min-h-11 rounded-full bg-au-accent px-5 text-sm font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35"
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
      className={`min-h-11 w-full rounded-[20px] border border-dashed px-5 py-6 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:cursor-wait ${
        dragging ? "border-au-accent/55 bg-au-accent-tint" : "border-au-separator bg-au-fill hover:border-au-accent/40 hover:bg-au-accent-tint/50"
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
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-au-surface text-au-accent shadow-sm ring-1 ring-au-separator" aria-hidden="true">
        <UploadCloud size={20} aria-hidden="true" />
      </span>
      <p className="mt-3 truncate text-sm font-semibold text-slate-900">
        {checking ? "Preparing workbook…" : (file?.name ?? "Drop your SAT Excel workbook")}
      </p>
      <p className="mt-1 text-xs leading-4 text-slate-600">.xlsx · up to 12 MB</p>
      <span className="mt-3 inline-flex min-h-10 items-center rounded-full bg-au-accent px-4 text-sm font-semibold text-white">
        Choose File
      </span>
    </button>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "warning" }) {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 text-xs ${
        tone === "warning" ? "bg-au-warning-tint text-au-warning-text" : "bg-au-fill text-slate-700"
      }`}
    >
      <strong className="text-sm font-semibold tabular-nums">{value}</strong>
      {label}
    </span>
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
