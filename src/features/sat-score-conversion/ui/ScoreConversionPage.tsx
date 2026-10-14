import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Download, Redo2, Undo2 } from "lucide-react";
import { SatConfirmDialog } from "../../../products/sat/ui/ConfirmDialog";
import { SatSegmentedControl } from "../../../products/sat/ui/SegmentedControl";
import { SatButton, SatContainer, SatInlineError, SatListSkeleton, SatPageHeader, SatSectionCard, SatStatusPill } from "../../../products/sat/ui/SatPage";
import {
  useCreateScoreConversionDraft,
  usePublishScoreConversionDraft,
  useSaveScoreConversionDraft,
  useScoreConversionImpact,
  useScoreConversionRevision,
  useScoreConversionRevisions,
  useScoreConversionSettings,
  useValidateScoreConversionDraft,
} from "../api/scoreConversionQueries";
import {
  FULL_TOPOLOGIES,
  SECTION_KEYS,
  SECTION_LABEL,
  STANDALONE_TOPOLOGIES,
  TOPOLOGY_LABEL,
  isStandalone,
  type ScoreConversionIssue,
  type ScoreConversionRevision,
  type SectionKey,
  type Topology,
} from "../contracts/scoreConversion";
import { addTable, changedCells, clearRoute, emptyDraft, isShared, parseCellText, setCells, setShared, tableCols, tableFor, tableRows, toContent, toDraft, type CellPatch, type DraftContent, type DraftTable } from "../model/draft";
import { editorReducer, initialEditorState, isDirty } from "../model/editorHistory";
import { downloadExport, exportTable, type ExportFormat } from "../model/exportTable";
import { describeError, issuesForTable, mergeFeedback, tableLevelIssues, type ConversionError } from "../model/issues";
import { quickValidateTable } from "../model/quickValidate";
import { parsePaste, tableTsv } from "../model/tsv";
import { CreateTableForm } from "./CreateTableForm";
import { HistoryDialog } from "./HistoryDialog";
import { LookupPreview } from "./LookupPreview";
import { PublishDialog } from "./PublishDialog";
import { ScoreGrid, type GridNotice } from "./ScoreGrid";

type Mode = "edit" | "import" | "preview";
type PendingAction = { kind: "close-draft" } | { kind: "open-draft"; id: string } | { kind: "discard" } | { kind: "view"; revision: ScoreConversionRevision } | { kind: "restore"; revisionId: string } | null;

const MODE_OPTIONS: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: "edit", label: "Edit table" },
  { value: "import", label: "Paste import" },
  { value: "preview", label: "Preview" },
];

const SECTION_OPTIONS = SECTION_KEYS.map((key) => ({ value: key, label: SECTION_LABEL[key] }));
const FULL_OPTIONS = FULL_TOPOLOGIES.map((key) => ({ value: key, label: key === "full_lower" ? "Lower Module 2" : "Higher Module 2" }));
const STANDALONE_OPTIONS = STANDALONE_TOPOLOGIES.map((key) => ({ value: key, label: key === "m2_lower_only" ? "Standalone lower" : "Standalone higher" }));

const formatWhen = (iso: string) => new Date(iso).toLocaleString();

export function ScoreConversionPage() {
  const settings = useScoreConversionSettings();
  const active = settings.data?.active ?? null;
  const blueprint = settings.data?.blueprint;

  const [section, setSection] = useState<SectionKey>("reading-writing");
  const [topology, setTopology] = useState<Topology>("full_lower");
  const [lastFull, setLastFull] = useState<Topology>("full_lower");
  const [mode, setMode] = useState<Mode>("edit");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [viewRevisionId, setViewRevisionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<GridNotice | null>(null);
  const [problem, setProblem] = useState<ConversionError | null>(null);
  const [serverIssues, setServerIssues] = useState<{ errors: ScoreConversionIssue[]; warnings: ScoreConversionIssue[] } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [importText, setImportText] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("tsv");
  const [saving, setSaving] = useState(false);

  const draftQuery = useScoreConversionRevision(draftId);
  const viewQuery = useScoreConversionRevision(viewRevisionId);
  const draft = draftQuery.data ?? null;
  const baseRevisionId = draft?.baseRevisionId ?? null;
  const baseIsActive = baseRevisionId !== null && baseRevisionId === active?.id;
  const baseQuery = useScoreConversionRevision(baseRevisionId && !baseIsActive ? baseRevisionId : null);
  const revisionsQuery = useScoreConversionRevisions(historyOpen);

  const createDraft = useCreateScoreConversionDraft();
  const saveDraft = useSaveScoreConversionDraft();
  const publishDraft = usePublishScoreConversionDraft();
  const validateDraft = useValidateScoreConversionDraft();
  const impactReport = useScoreConversionImpact();

  const [editor, dispatch] = useReducer(editorReducer, undefined, () => initialEditorState(emptyDraft()));
  const dirty = isDirty(editor);
  const loaded = useRef<{ id: string; version: number } | null>(null);

  // Load (or reload) the open draft into the editor. A newer server version of the
  // SAME draft replaces local state only when nothing local would be lost.
  useEffect(() => {
    if (!draft?.content) return;
    const current = loaded.current;
    if (!current || current.id !== draft.id || (current.version !== draft.version && !dirty)) {
      dispatch({ type: "reset", content: toDraft(draft.content) });
      loaded.current = { id: draft.id, version: draft.version };
      setServerIssues(null);
    }
  }, [draft, dirty]);

  const activeDraft = useMemo(() => (active?.content ? toDraft(active.content) : emptyDraft()), [active]);
  const viewDraft = useMemo(() => (viewQuery.data?.content ? toDraft(viewQuery.data.content) : null), [viewQuery.data]);
  const baseDraft = useMemo(() => {
    const content = baseIsActive ? active?.content : baseQuery.data?.content;
    return content ? toDraft(content) : null;
  }, [baseIsActive, active, baseQuery.data]);

  const editing = draftId !== null;
  const loadingDraft = editing && !draft?.content;
  const shown: DraftContent = editing ? editor.draft : (viewDraft ?? activeDraft);
  const viewing = !editing && viewRevisionId !== null ? viewQuery.data : null;
  const found = tableFor(shown, section, topology);
  const table: DraftTable | null = found?.table ?? null;

  const feedback = useMemo(() => {
    if (!table || !found || !editing) return { errors: new Map<string, string>(), warnings: new Map<string, string>() };
    const quick = quickValidateTable(table);
    return {
      errors: mergeFeedback(quick.errors, issuesForTable(serverIssues?.errors ?? [], section, found.id)),
      warnings: mergeFeedback(quick.warnings, issuesForTable(serverIssues?.warnings ?? [], section, found.id)),
    };
  }, [table, found, editing, serverIssues, section]);
  const changed = useMemo(() => (found && editing && baseDraft ? changedCells(shown, baseDraft, section, found.id) : new Set<string>()), [found, editing, baseDraft, shown, section]);

  const edit = useCallback(
    (next: DraftContent) => {
      dispatch({ type: "edit", next });
      setServerIssues(null);
      setProblem(null);
    },
    [],
  );

  const applyPatches = (patches: CellPatch[]) => {
    if (!found || patches.length === 0) return;
    edit(setCells(editor.draft, section, found.id, patches));
  };

  const selectSection = (next: SectionKey) => setSection(next);
  const selectTopology = (next: Topology) => {
    setTopology(next);
    if (!isStandalone(next)) setLastFull(next);
  };

  // ---- draft lifecycle ----

  const guard = (action: PendingAction, run: () => void) => {
    if (editing && dirty) setPending(action);
    else run();
  };

  const closeDraft = () => {
    setDraftId(null);
    setServerIssues(null);
    setProblem(null);
    loaded.current = null;
  };

  const startDraft = async (fromRevisionId?: string) => {
    setProblem(null);
    try {
      const created = await createDraft.mutateAsync(fromRevisionId);
      loaded.current = null;
      setViewRevisionId(null);
      setDraftId(created.id);
      setHistoryOpen(false);
      setNotice({ kind: "info", text: fromRevisionId ? "Restored as a new draft. It changes nothing until you publish it." : "Draft created from the active version. It changes nothing until you publish it." });
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const persist = async (calibrationSource?: string): Promise<boolean> => {
    if (!draft || !draftId) return false;
    const { content, invalid } = toContent(editor.draft);
    if (!content) {
      const first = invalid[0]!;
      setNotice({
        kind: "error",
        text: `${invalid.length} cell${invalid.length === 1 ? "" : "s"} contain text that is not a whole number (first: "${first.text}" at ${SECTION_LABEL[first.section]}, row ${first.row}${first.col > 0 ? `, column ${first.col}` : ""}). Fix or clear them before saving.`,
      });
      return false;
    }
    const version = loaded.current?.version ?? draft.version;
    setSaving(true);
    setProblem(null);
    try {
      const saved = await saveDraft.mutateAsync({ id: draftId, version, body: { content, calibrationSource: calibrationSource ?? draft.calibrationSource, note: draft.note } });
      loaded.current = { id: saved.id, version: saved.version };
      dispatch({ type: "saved", content: editor.draft });
      return true;
    } catch (error) {
      setProblem(describeError(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onSave = async () => {
    if (await persist()) setNotice({ kind: "info", text: "Draft saved. Released scores are unchanged." });
  };

  const reloadDraft = () => {
    loaded.current = null;
    dispatch({ type: "saved", content: editor.draft });
    void draftQuery.refetch();
    setProblem(null);
  };

  const onValidate = async () => {
    if (!draftId) return;
    if (dirty && !(await persist())) return;
    try {
      const result = await validateDraft.mutateAsync(draftId);
      setServerIssues({ errors: result.errors, warnings: result.warnings });
      setNotice({
        kind: result.valid ? "info" : "error",
        text: result.valid
          ? `The table is valid.${result.warnings.length > 0 ? ` ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} to review.` : ""}`
          : `${result.errors.length} error${result.errors.length === 1 ? "" : "s"} must be fixed before publishing.`,
      });
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const onPublishClick = async () => {
    if (dirty && !(await persist())) return;
    setPublishOpen(true);
  };

  const runPublish = async (calibrationSource: string) => {
    if (!draftId || !draft) return;
    if (calibrationSource !== draft.calibrationSource && !(await persist(calibrationSource))) {
      throw new Error("save failed");
    }
    const result = await publishDraft.mutateAsync(draftId);
    setPublishOpen(false);
    closeDraft();
    setNotice({
      kind: "info",
      text: `Version ${result.revision.revisionNumber} is now active. Every SAT result, past and future, uses it.`,
    });
  };

  // ---- import / export ----

  const onImport = () => {
    if (!table || !found) return;
    const result = parsePaste(importText, tableRows(table), tableCols(table), 0, 0);
    if (!result.ok) {
      setNotice({ kind: "error", text: result.errors.join(" ") });
      return;
    }
    const patches: CellPatch[] = [];
    result.values.forEach((line, r) => line.forEach((text, c) => patches.push({ row: result.row + r, col: result.col + c, value: parseCellText(text) })));
    applyPatches(patches);
    setImportText("");
    setMode("edit");
    setNotice({ kind: "info", text: `Imported ${patches.length} cells. Review them, then save the draft.` });
  };

  const onCopyTable = async () => {
    if (!table) return;
    try {
      await navigator.clipboard.writeText(tableTsv(table));
      setNotice({ kind: "info", text: "Table copied with headers. Paste it into Google Sheets." });
    } catch {
      setNotice({ kind: "error", text: "Copying is not available in this browser. Use Export instead." });
    }
  };

  const onExport = () => {
    if (!table) return;
    downloadExport(exportTable(table, exportFormat, `sat-${section}-${topology}`));
  };

  const onCreateTable = (created: DraftTable) => {
    edit(addTable(editor.draft, section, topology, created).draft);
    setNotice({ kind: "info", text: "Table created. Paste the scores or type them in, then save the draft." });
  };

  // ---- derived UI state ----

  const drafts = settings.data?.drafts ?? [];
  const title = editing ? "Editing a draft" : viewing ? `Version ${viewing.revisionNumber}` : active ? `Version ${active.revisionNumber}` : "Nothing published yet";
  const stale = problem?.kind === "stale-draft";
  const standalone = isStandalone(topology);
  const shared = isShared(shown, section);
  const tableLabel = `${SECTION_LABEL[section]}, ${TOPOLOGY_LABEL[topology]}`;
  const serverTableIssues = tableLevelIssues(serverIssues?.errors ?? []);
  const errorCount = feedback.errors.size;
  const warningCount = feedback.warnings.size;

  if (settings.isLoading) {
    return (
      <SatContainer measure="full">
        <SatPageHeader title="Score Conversion" description="Global SAT scoring configuration" />
        <SatListSkeleton label="Loading score conversion" />
      </SatContainer>
    );
  }
  if (settings.isError) {
    return (
      <SatContainer measure="full">
        <SatPageHeader title="Score Conversion" description="Global SAT scoring configuration" />
        <SatInlineError
          title="Score conversion could not be loaded"
          description={describeError(settings.error).message}
          onRetry={() => void settings.refetch()}
        />
      </SatContainer>
    );
  }

  return (
    <SatContainer measure="full">
      <SatPageHeader
        eyebrow="Global SAT settings"
        title="Score Conversion"
        description="Estimated SAT scores for every SAT exam, including results that were already released. Original answers and raw scores are never changed."
        meta={
          <>
            <SatStatusPill tone={active ? "published" : "neutral"}>{active ? `Active · Version ${active.revisionNumber}` : "No active version"}</SatStatusPill>
            <SatStatusPill tone="info">All SAT exams</SatStatusPill>
          </>
        }
        actions={
          <SatButton variant="secondary" onClick={() => setHistoryOpen(true)}>
            Version history
          </SatButton>
        }
      />

      <div className="mt-5 flex flex-col gap-4">
        <div role="status" aria-live="polite" className="min-h-6">
          {notice ? (
            <p className={"text-[14px] " + (notice.kind === "error" ? "text-[var(--sat-staff-danger,#b42318)]" : "text-[var(--sat-staff-text-secondary,#515154)]")}>{notice.text}</p>
          ) : null}
        </div>
        {problem ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface,#fff)] p-4 text-[14px]">
            <span className="min-w-0 flex-1">{problem.message}</span>
            {stale ? <SatButton variant="secondary" onClick={reloadDraft}>Reload latest draft</SatButton> : null}
            {problem.kind === "stale-base" ? <SatButton variant="secondary" onClick={() => void startDraft()}>Start a new draft from the active version</SatButton> : null}
          </div>
        ) : null}

        {/* Draft bar */}
        <SatSectionCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold">{title}</h2>
              <p className="text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">
                {editing
                  ? draft
                    ? `Draft saved ${formatWhen(draft.updatedAt)}${dirty ? " · unsaved changes" : " · no unsaved changes"}. Edits do not affect any score until you publish.`
                    : "Loading the draft…"
                  : viewing
                    ? `Published ${viewing.publishedAt ? formatWhen(viewing.publishedAt) : ""}. Read-only.`
                    : active
                      ? "Read-only. Create a draft to change the table."
                      : "Create a draft to set up the first conversion table. Until one is published, results show raw scores only."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <SatButton variant="secondary" pending={saving} disabled={!dirty} onClick={() => void onSave()}>
                    Save draft
                  </SatButton>
                  <SatButton variant="quiet" disabled={!dirty} onClick={() => setPending({ kind: "discard" })}>
                    Discard changes
                  </SatButton>
                  <SatButton variant="secondary" pending={validateDraft.isPending} onClick={() => void onValidate()}>
                    Validate
                  </SatButton>
                  <SatButton variant="primary" onClick={() => void onPublishClick()}>
                    Publish…
                  </SatButton>
                  <SatButton variant="quiet" onClick={() => guard({ kind: "close-draft" }, closeDraft)}>
                    Close draft
                  </SatButton>
                </>
              ) : (
                <SatButton variant="primary" pending={createDraft.isPending} onClick={() => void startDraft()}>
                  {active ? "New draft from active version" : "New draft"}
                </SatButton>
              )}
            </div>
          </div>
          {!editing && drafts.length > 0 ? (
            <div className="mt-4 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] pt-3">
              <p className="text-[14px] font-semibold">Open drafts</p>
              <ul className="mt-1 divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))]">
                {drafts.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
                    <span>
                      Draft by {item.createdBy} · edited {formatWhen(item.updatedAt)}
                      {item.baseRevisionId !== (active?.id ?? null) ? " · based on an older version" : ""}
                    </span>
                    <SatButton variant="secondary" onClick={() => guard({ kind: "open-draft", id: item.id }, () => { loaded.current = null; setViewRevisionId(null); setDraftId(item.id); })}>
                      Continue editing
                    </SatButton>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SatSectionCard>

        {loadingDraft ? (
          <SatListSkeleton label="Loading the draft" />
        ) : (
          <>
            {/* Subject and route */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-[300px]"><SatSegmentedControl label="Subject" value={section} options={SECTION_OPTIONS} onChange={selectSection} /></div>
              <div className="w-full sm:w-[320px]"><SatSegmentedControl label="Route" value={standalone ? lastFull : topology} options={FULL_OPTIONS} onChange={selectTopology} /></div>
              {!standalone ? (
                <label htmlFor="score-share-routes" className="flex min-h-11 items-center gap-2 text-[14px]">
                  <input
                    id="score-share-routes"
                    type="checkbox"
                    aria-label="Use the same table for both Module 2 routes"
                    checked={shared}
                    disabled={!editing || !tableFor(shown, section, "full_lower")}
                    onChange={(event) => edit(setShared(editor.draft, section, event.target.checked))}
                  />
                  <span aria-hidden="true">Use the same table for both Module 2 routes</span>
                </label>
              ) : null}
            </div>
            <details open={standalone} className="text-[14px]">
              <summary className="cursor-pointer font-medium">Advanced routing: standalone Module 2</summary>
              <p className="mt-1 max-w-2xl text-[var(--sat-staff-text-secondary,#515154)]">
                A student who sat only Module 2 is converted with its own one-column table; it never borrows a full two-module table.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {STANDALONE_OPTIONS.map((option) => (
                  <SatButton key={option.value} variant={topology === option.value ? "primary" : "secondary"} aria-pressed={topology === option.value} onClick={() => selectTopology(option.value)}>
                    {option.label}
                  </SatButton>
                ))}
                {standalone ? (
                  <SatButton variant="quiet" onClick={() => selectTopology(lastFull)}>
                    Back to full routes
                  </SatButton>
                ) : null}
              </div>
            </details>

            {/* Modes */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="w-full sm:w-[380px]"><SatSegmentedControl label="Mode" value={mode} options={MODE_OPTIONS} onChange={setMode} /></div>
              <div className="flex flex-wrap items-center gap-2">
                <SatButton variant="quiet" iconOnly icon={<Undo2 size={16} aria-hidden="true" />} aria-label="Undo" disabled={!editing || editor.past.length === 0} onClick={() => dispatch({ type: "undo" })} />
                <SatButton variant="quiet" iconOnly icon={<Redo2 size={16} aria-hidden="true" />} aria-label="Redo" disabled={!editing || editor.future.length === 0} onClick={() => dispatch({ type: "redo" })} />
                <SatButton variant="secondary" disabled={!table} onClick={() => void onCopyTable()}>
                  Copy table
                </SatButton>
                <select aria-label="Export format" className="sat-input sat-select w-24" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
                  <option value="tsv">TSV</option>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
                <SatButton variant="secondary" icon={<Download size={16} aria-hidden="true" />} disabled={!table} onClick={onExport}>
                  Export
                </SatButton>
              </div>
            </div>

            {viewing ? (
              <p className="text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">
                Viewing version {viewing.revisionNumber}.{" "}
                <button type="button" className="underline" onClick={() => setViewRevisionId(null)}>
                  Back to the active version
                </button>
              </p>
            ) : null}

            {!table ? (
              <CreateTableForm
                key={`${section}-${topology}`}
                section={section}
                topology={topology}
                defaults={blueprint?.[section]}
                disabled={!editing}
                onCreate={onCreateTable}
              />
            ) : mode === "preview" ? (
              <LookupPreview
                revisionId={editing ? (draftId as string) : (viewRevisionId ?? active?.id ?? "")}
                section={section}
                topology={topology}
                unsavedEdits={editing && dirty}
              />
            ) : mode === "import" ? (
              <section aria-label="Paste import" className="rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface,#fff)] p-4">
                <h3 className="text-[14px] font-semibold">Paste a table from Google Sheets</h3>
                <p className="mt-1 max-w-2xl text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                  Copy the whole table, with or without the row and column headers (0 to {tableRows(table) - 1} by 0 to {tableCols(table) - 1}), and paste it here. Nothing changes until you select Import.
                </p>
                <textarea
                  aria-label="Table to import"
                  className="sat-input mt-3 h-48 w-full font-mono text-[13px]"
                  value={importText}
                  disabled={!editing}
                  onChange={(event) => setImportText(event.target.value)}
                />
                <div className="mt-3 flex gap-2">
                  <SatButton variant="primary" disabled={!editing || importText.trim() === ""} onClick={onImport}>
                    Import into this table
                  </SatButton>
                </div>
              </section>
            ) : (
              <div>
                <p className="mb-2 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">
                  {tableLabel} · {matrixSummary(table)}
                  {editing && baseDraft ? ` · ${changed.size} changed from the version this draft started from` : ""}
                </p>
                <ScoreGrid
                  label={tableLabel}
                  table={table}
                  readOnly={!editing}
                  changed={changed}
                  errors={feedback.errors}
                  warnings={feedback.warnings}
                  onEdit={applyPatches}
                  onUndo={() => dispatch({ type: "undo" })}
                  onRedo={() => dispatch({ type: "redo" })}
                  onNotice={setNotice}
                />
                {editing && table && found ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[14px]">
                    <span role="status">
                      {errorCount > 0 ? `${errorCount} cell${errorCount === 1 ? "" : "s"} need attention before publishing.` : "Every cell in this table is valid."}
                      {warningCount > 0 ? ` ${warningCount} score${warningCount === 1 ? " is" : "s are"} lower than a neighbour (review only).` : ""}
                    </span>
                    <SatButton variant="quiet" onClick={() => edit(clearRoute(editor.draft, section, topology))}>
                      Remove this table
                    </SatButton>
                  </div>
                ) : null}
                {serverTableIssues.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-[14px] text-[var(--sat-staff-danger,#b42318)]">
                    {serverTableIssues.map((issue) => (
                      <li key={issue.path}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>

      <PublishDialog
        open={publishOpen}
        validate={() => validateDraft.mutateAsync(draftId as string)}
        impact={() => impactReport.mutateAsync(draftId as string)}
        initialCalibrationSource={draft?.calibrationSource ?? ""}
        hasActive={active !== null}
        onClose={() => setPublishOpen(false)}
        onPublish={runPublish}
      />
      <HistoryDialog
        open={historyOpen}
        revisions={revisionsQuery.data}
        loading={revisionsQuery.isLoading}
        error={revisionsQuery.isError}
        busy={createDraft.isPending}
        onClose={() => setHistoryOpen(false)}
        onView={(revision) => {
          setHistoryOpen(false);
          guard({ kind: "view", revision }, () => {
            closeDraft();
            setViewRevisionId(revision.id);
          });
        }}
        onRestore={(revision) => guard({ kind: "restore", revisionId: revision.id }, () => void startDraft(revision.id))}
      />
      <SatConfirmDialog
        open={pending !== null}
        title="Discard unsaved edits?"
        description="Your edits to this draft have not been saved. Discarding them cannot be undone."
        confirmLabel="Discard edits"
        destructive
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const action = pending;
          setPending(null);
          if (!action) return;
          if (action.kind === "discard") dispatch({ type: "reset", content: editor.saved });
          else if (action.kind === "close-draft") closeDraft();
          else if (action.kind === "view") {
            closeDraft();
            setViewRevisionId(action.revision.id);
          } else if (action.kind === "restore") void startDraft(action.revisionId);
          else {
            loaded.current = null;
            setViewRevisionId(null);
            setDraftId(action.id);
          }
        }}
      />
    </SatContainer>
  );
}

function matrixSummary(table: DraftTable): string {
  if (table.kind === "matrix") {
    return `${table.m1Operational + 1} × ${table.m2Operational + 1} · ${(table.m1Operational + 1) * (table.m2Operational + 1)} score cells`;
  }
  return `${table.operational + 1} scores`;
}
