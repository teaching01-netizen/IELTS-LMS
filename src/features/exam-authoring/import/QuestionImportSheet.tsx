import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, X } from "lucide-react";
import type { BatchQuestionDraft } from "../contracts/assessment";
import { parseQuestionImport } from "./questionImportParser";
import { AuthoringDialog } from "../ui/authoringPrimitives";

export interface QuestionImportSheetProps {
  open: boolean;
  sectionKey: string;
  remainingCapacity: number;
  /** Human-readable destination, e.g. "Math · Module 1". Falls back to the section name. */
  destinationLabel?: string;
  isImporting: boolean;
  onClose: () => void;
  onImport: (drafts: BatchQuestionDraft[]) => Promise<void>;
}

const TEMPLATE = "Prompt\tA\tB\tC\tD\tCorrect\tDomain\tSkill\tDifficulty\n";

const SECTION_LABELS: Record<string, string> = {
  "reading-writing": "Reading & Writing",
  math: "Math",
};

function pluralQuestions(count: number): string {
  return `${count} ${count === 1 ? "question" : "questions"}`;
}

export function QuestionImportSheet({
  open,
  sectionKey,
  remainingCapacity,
  destinationLabel,
  isImporting,
  onClose,
  onImport,
}: QuestionImportSheetProps) {
  const [source, setSource] = useState(TEMPLATE);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const result = useMemo(() => parseQuestionImport(source, sectionKey), [sectionKey, source]);
  const validCount = result.drafts.length;
  const excludedRows = useMemo(() => {
    const byRow = new Map<number, string[]>();
    for (const issue of result.issues) {
      const messages = byRow.get(issue.row) ?? [];
      messages.push(`${issue.field}: ${issue.message}`);
      byRow.set(issue.row, messages);
    }
    return [...byRow.entries()];
  }, [result.issues]);
  const overCapacity = validCount > remainingCapacity;
  const pending = isImporting || submitting;
  const destination = destinationLabel ?? SECTION_LABELS[sectionKey] ?? sectionKey;

  let disabledReason: string | null = null;
  if (validCount === 0) disabledReason = "Add at least one valid row to import.";
  else if (overCapacity) {
    disabledReason = `Remove ${validCount - remainingCapacity} row${validCount - remainingCapacity === 1 ? "" : "s"}: this module has room for ${pluralQuestions(remainingCapacity)}.`;
  }
  const canImport = disabledReason === null && !pending;

  useEffect(() => {
    if (runtimeError) errorRef.current?.focus();
  }, [runtimeError]);

  const importReady = async () => {
    if (!canImport || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setRuntimeError(null);
    try {
      await onImport(result.drafts);
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : "Questions could not be imported."
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AuthoringDialog
      open={open}
      title="Paste or import SAT questions"
      onClose={onClose}
      closeDisabled={pending}
      showHeader={false}
      contentClassName="authoring-dialog-content--import flex max-h-[90vh] max-w-4xl flex-col overflow-hidden rounded-[20px] p-0"
    >
      <header className="flex items-start justify-between gap-3 border-b border-au-separator px-5 py-4">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.012em] text-slate-950">
            Import questions into {destination}
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Paste from Excel / Google Sheets or choose a CSV/TSV file. Questions are appended to this module; existing questions are not changed. The import is all-or-nothing.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onClose}
          className="authoring-icon-button min-h-11 min-w-11"
          aria-label="Close import"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[1.2fr_0.8fr]">
        <div className="flex min-h-0 flex-col border-r border-au-separator p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label htmlFor="sat-question-import-data" className="text-xs font-semibold text-slate-700">
              Spreadsheet data
            </label>
            <label
              htmlFor="sat-question-import-file"
              className="authoring-interactive focus-within:ring-2 focus-within:ring-au-accent flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[9px] px-3 text-xs font-semibold text-slate-600 hover:bg-au-fill"
            >
              <FileSpreadsheet size={14} aria-hidden="true" />
              Choose file
              <input
                id="sat-question-import-file"
                aria-label="Choose SAT question import file"
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                className="sr-only"
                disabled={pending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void file
                      .text()
                      .then(setSource)
                      .catch(() => setRuntimeError("The selected file could not be read."));
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <textarea
            id="sat-question-import-data"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            readOnly={pending}
            aria-label="Question import data"
            aria-invalid={validCount === 0 && result.issues.length > 0}
            className="min-h-[420px] flex-1 resize-none rounded-[12px] border border-au-separator bg-au-fill p-3 font-mono text-xs leading-5 text-slate-800 outline-none transition focus:border-au-accent/30 focus:bg-au-surface focus:ring-4 focus:ring-au-accent/10"
          />
          <p className="mt-2 text-xs leading-4 text-slate-600">
            Supported headers include Prompt, Stimulus, A–D, Correct, Response Type, Accepted
            Responses, Domain, Skill, Difficulty, Tags, Rationale, and Pretest.
          </p>
        </div>
        <section aria-label="Import review" className="min-h-0 overflow-y-auto p-4">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-[12px] bg-au-fill px-3 py-2.5">
              <dt className="font-semibold text-slate-600">Destination</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">{destination}</dd>
            </div>
            <div className="rounded-[12px] bg-au-fill px-3 py-2.5">
              <dt className="font-semibold text-slate-600">Capacity remaining</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                {pluralQuestions(remainingCapacity)}
              </dd>
            </div>
          </dl>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Metric label="Rows found" value={result.rowCount} />
            <Metric label="Accepted" value={validCount} good />
            <Metric label="Excluded" value={excludedRows.length} bad={excludedRows.length > 0} />
          </div>
          {overCapacity ? (
            <div className="mt-3 flex gap-2 rounded-[12px] bg-au-danger-tint p-3 text-xs leading-5 text-au-danger-text">
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                This module has room for {pluralQuestions(remainingCapacity)}, but {validCount} valid rows are ready.
              </span>
            </div>
          ) : null}
          {runtimeError ? (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="mt-3 rounded-[12px] bg-au-danger-tint p-3 text-xs leading-5 text-au-danger-text outline-none focus-visible:ring-2 focus-visible:ring-au-accent"
            >
              {runtimeError} Your data is still here; fix the problem and try again.
            </div>
          ) : null}
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-slate-800">Review</h3>
            {excludedRows.length ? (
              <ul aria-label="Excluded rows" className="mt-2 space-y-1.5">
                {excludedRows.slice(0, 40).map(([row, messages]) => (
                  <li
                    key={row}
                    className="flex gap-2 rounded-[10px] bg-au-warning-tint px-3 py-2 text-xs leading-4 text-au-warning-text"
                  >
                    <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      <strong>Row {row || "—"} excluded</strong>
                      {messages.map((message) => (
                        <span key={message} className="block">
                          {message}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : validCount ? (
              <div className="mt-2 flex items-center gap-2 rounded-[12px] bg-au-success-tint p-3 text-xs font-medium text-au-success-text">
                <CheckCircle2 size={15} aria-hidden="true" />
                {pluralQuestions(validCount)} accepted, no rows excluded
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Paste question rows to validate them before import.
              </p>
            )}
          </div>
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-au-separator px-5 py-3">
        <span id="sat-question-import-hint" className="text-xs text-slate-600" aria-live="polite">
          {pending
            ? "Importing… keep this window open."
            : disabledReason ?? "Excluded rows are never sent to the server."}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="authoring-button authoring-button--quiet min-h-11"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canImport}
            aria-describedby="sat-question-import-hint"
            onClick={() => void importReady()}
            className="authoring-button authoring-button--primary min-h-11"
          >
            {pending ? "Importing…" : `Import ${validCount} valid ${validCount === 1 ? "question" : "questions"}`}
          </button>
        </div>
      </footer>
    </AuthoringDialog>
  );
}

function Metric({
  label,
  value,
  good = false,
  bad = false,
}: {
  label: string;
  value: number;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="rounded-[12px] bg-au-fill px-3 py-2.5">
      <p
        className={`text-lg font-semibold tabular-nums ${good ? "text-au-success-text" : bad ? "text-au-danger-text" : "text-slate-900"}`}
      >
        {value}
      </p>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
    </div>
  );
}
