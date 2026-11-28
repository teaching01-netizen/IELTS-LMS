import { useEffect, useRef, useState } from "react";
import { Download, UploadCloud, X } from "lucide-react";
import { SatButton } from "../../../products/sat/ui/SatPage";
import { wordCountLabel as words } from "@shared/sat/wordVault";
import { wordVaultApi, type WordVaultPreview } from "../api/wordVaultApi";
import { hasBackendStatusCode } from "../infrastructure/examAuthoringBackendGateway";
import { AuthoringDialog } from "../ui/authoringPrimitives";

const maxWorkbookBytes = 2 * 1024 * 1024;

/**
 * The Word Vault workbook importer.
 *
 * It stages a vocabulary workbook against the CURRENT draft and commits a
 * whole-vault replacement, so it is opened from wherever the author is already
 * editing that draft: the Questions workspace Import menu, beside the exam
 * workbook import, and the Settings Word Vault panel that publishes a stale
 * reference finding.
 *
 * The sheet OWNS its parse → preview → commit state machine. Callers own only
 * when it may open and what a confirmed commit means for their projections.
 *
 * There is no acknowledgement checkbox: the preview states exactly what is
 * replaced, and the primary button names the replacement. A short line beside
 * it repeats the one consequence that is not visible in the entry list — the
 * modules this file does not mention lose their words too.
 */
export function WordVaultImportSheet({ open, examId, onClose, onSaved }: {
  open: boolean;
  examId: string;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const active = useRef(false);
  const operation = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WordVaultPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const replacing = (preview?.before ?? 0) > 0;
  const count = preview?.entries.length ?? 0;
  const valid = preview !== null && preview.issues.length === 0 && (replacing || count > 0);
  const closeDisabled = busy !== null || downloading;

  useEffect(() => { if (preview) heading.current?.focus(); }, [preview]);
  useEffect(() => { if (error) errorElement.current?.focus(); }, [error]);

  async function inspect(selected: File) {
    if (active.current) return;
    setFile(selected);
    setPreview(null);
    setNeedsCheck(false);
    setError("");
    operation.current = null;
    if (!/\.xlsx$/i.test(selected.name) || selected.size > maxWorkbookBytes) {
      setError("Choose an .xlsx vocabulary workbook up to 2 MB.");
      return;
    }
    active.current = true;
    setBusy("check");
    try {
      setPreview(await wordVaultApi.preview(examId, selected));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t check the workbook. Try again.");
    } finally {
      active.current = false;
      setBusy(null);
    }
  }

  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      const blob = await wordVaultApi.template(examId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "SAT-Vocabulary-Template.xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setDownloadError("Couldn’t download the template. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function commit() {
    if (!file || !preview || !valid || needsCheck || active.current) return;
    active.current = true;
    setBusy("save");
    setError("");
    try {
      operation.current ??= crypto.randomUUID();
      const receipt = await wordVaultApi.commit(examId, file, preview, operation.current);
      onSaved(receipt.count);
    } catch (cause) {
      if (hasBackendStatusCode(cause, 409)) {
        setNeedsCheck(true);
        setError("The draft changed. Check this workbook again and review the updated replacement.");
      } else {
        setError(cause instanceof Error ? cause.message : "Couldn’t import the workbook. Try again.");
      }
    } finally {
      active.current = false;
      setBusy(null);
    }
  }

  return (
    <AuthoringDialog
      open={open} title="Import Vocabulary Excel"
      description="Upload the vocabulary you want to save for this draft."
      showHeader={false}
      onClose={onClose} closeDisabled={closeDisabled}
      contentClassName={`flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-[24px] p-0 ${preview ? "max-w-[860px]" : "max-w-[540px]"}`}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-au-separator px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-slate-950">Import Vocabulary Excel</h2>
          <p className="mt-1 text-sm leading-5 text-slate-600">Add words to any Reading &amp; Writing questions in this draft. You can skip questions or modules.</p>
        </div>
        <button
          type="button"
          disabled={closeDisabled}
          onClick={onClose}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-au-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-35"
          aria-label="Close Import Vocabulary Excel"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain bg-au-surface px-5 pb-5 pt-4 sm:px-6">
        <button
          data-dialog-initial-focus type="button" aria-disabled={busy !== null}
          aria-describedby="word-vault-file-hint"
          className={`flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed px-5 py-6 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-au-accent aria-disabled:opacity-60 ${dragging ? "border-au-accent bg-au-accent-tint" : "border-au-separator bg-au-fill hover:border-au-accent/40 hover:bg-au-accent-tint/50"}`}
          onClick={() => { if (!active.current) input.current?.click(); }}
          onDragOver={(event) => { event.preventDefault(); if (!active.current) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files[0];
            if (dropped) void inspect(dropped);
          }}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-au-surface text-au-accent shadow-sm ring-1 ring-au-separator" aria-hidden="true">
            <UploadCloud size={20} />
          </span>
          <span className="inline-flex min-h-10 items-center rounded-full bg-au-accent px-4 text-sm font-semibold text-white">
            {file ? "Upload another workbook" : "Upload workbook"}
          </span>
          <span id="word-vault-file-hint" className="max-w-full break-words text-xs leading-5 text-slate-600">
            {file ? file.name : ".xlsx up to 2 MB · drag and drop works too"}
          </span>
        </button>
        <input
          ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Choose vocabulary workbook"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            if (selected) void inspect(selected);
            event.currentTarget.value = "";
          }}
        />
        {!preview ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-au-fill px-4 py-3">
            <p className="text-xs leading-5 text-slate-600">New here? The template includes the full guide and a copyable AI prompt.</p>
            <SatButton variant="secondary" disabled={downloading} onClick={() => void download()}>
              <Download size={16} aria-hidden="true" /> {downloading ? "Downloading…" : "Download vocabulary template"}
            </SatButton>
            {downloadError ? <p className="w-full text-sm text-au-danger-text" role="alert">{downloadError}</p> : null}
          </div>
        ) : null}
        <p role="status" className={busy ? "text-sm text-muted-foreground" : "sr-only"}>
          {busy === "check" ? "Checking vocabulary…" : busy === "save" ? "Saving vocabulary…" : ""}
        </p>
        {error ? <p ref={errorElement} tabIndex={-1} role="alert" className="rounded-2xl bg-au-danger-tint p-3 text-sm leading-5 text-au-danger-text">{error}</p> : null}
        {needsCheck && file ? <SatButton variant="secondary" onClick={() => void inspect(file)}>Check again</SatButton> : null}
        {preview ? (
          <section aria-labelledby="word-vault-review">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 ref={heading} id="word-vault-review" tabIndex={-1} className="text-[15px] font-semibold text-slate-950">
                {preview.issues.length ? "Workbook needs attention" : "Review vocabulary"}
              </h3>
              {!preview.issues.length ? (
                <p className="text-xs tabular-nums text-slate-600">
                  {words(preview.before)} in the draft now · <strong className="text-slate-900">{words(count)}</strong> after import
                </p>
              ) : null}
            </div>
            {preview.issues.length ? (
              <>
                <p className="mt-1 text-sm leading-5 text-slate-600">Fix the cells in Excel and upload the corrected workbook.</p>
                <ul className="mt-2 space-y-2">
                  {preview.issues.map(({ row, column, message }, index) => (
                    <li key={index} className="rounded-2xl bg-au-warning-tint px-3 py-2.5 text-sm leading-5 text-au-warning-text">
                      <strong className="tabular-nums">Vocabulary · {column}{row}</strong>
                      <span className="mt-1 block text-xs leading-5">{message}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                {!valid ? <p className="mt-1 text-sm text-slate-600">Add at least one vocabulary entry and upload again.</p> : null}
                {preview.impact.length ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {preview.impact.map(({ module, before, after }) => (
                      <li key={module} className="rounded-full bg-au-fill px-3 py-1 text-xs text-slate-700">
                        {module} · <span className="tabular-nums">{before} → {after}</span>
                        {after === 0 ? " · removed" : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ul className="mt-3 divide-y divide-au-separator overflow-hidden rounded-2xl border border-au-separator">
                  {preview.entries.map((entry, index) => (
                    <li key={index} className="grid gap-2 p-3 text-sm [overflow-wrap:anywhere] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] sm:items-start sm:gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-950">{entry.word}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{entry.module} · Question {entry.question}</p>
                      </div>
                      <p lang="th" className="w-fit max-w-full rounded-lg bg-au-fill px-2 py-0.5 text-[13px] leading-6">{entry.thai}</p>
                      <div className="min-w-0 text-xs leading-5 text-slate-600">
                        <p className="text-slate-800">{entry.definition}</p>
                        <p className="mt-0.5">{entry.example}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : null}
      </div>
      {valid ? (
        <footer className="shrink-0 border-t border-au-separator bg-au-surface px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-sm text-xs leading-5 text-slate-600">
              {count === 0
                ? "Removes every word from this draft, including modules this file does not mention."
                : replacing
                  ? `Replaces all ${words(preview.before)} in this draft, including modules this file does not mention.`
                  : `${words(count)} will be added to the draft.`}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={onClose}
                className="min-h-11 rounded-full px-4 text-sm font-semibold text-slate-600 hover:bg-au-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-35"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null || needsCheck}
                onClick={() => void commit()}
                className="min-h-11 rounded-full bg-au-accent px-5 text-sm font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {count === 0 ? "Remove all draft words" : replacing ? "Replace Word Vault" : `Import ${words(count)}`}
              </button>
            </div>
          </div>
        </footer>
      ) : null}
    </AuthoringDialog>
  );
}
