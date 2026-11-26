import { useEffect, useRef, useState } from "react";
import { Download, UploadCloud } from "lucide-react";
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
  const [confirmed, setConfirmed] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const replacing = (preview?.before ?? 0) > 0;
  const count = preview?.entries.length ?? 0;
  const valid = preview !== null && preview.issues.length === 0 && (replacing || count > 0);

  useEffect(() => { if (preview) heading.current?.focus(); }, [preview]);
  useEffect(() => { if (error) errorElement.current?.focus(); }, [error]);

  async function inspect(selected: File) {
    if (active.current) return;
    setFile(selected);
    setPreview(null);
    setConfirmed(false);
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
    if (!file || !preview || !valid || needsCheck || (replacing && !confirmed) || active.current) return;
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
        setConfirmed(false);
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
      description="Upload the full vocabulary list for this draft."
      onClose={onClose} closeDisabled={busy !== null || downloading}
      contentClassName={`flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden ${preview ? "max-w-[850px]" : "max-w-[520px]"}`}
    >
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 pb-4 pt-1 sm:px-6">
        <button
          data-dialog-initial-focus type="button" aria-disabled={busy !== null}
          aria-describedby="word-vault-file-hint"
          className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-4 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-au-accent aria-disabled:opacity-60 ${dragging ? "border-au-accent bg-au-accent-tint" : "border-au-separator bg-au-fill"}`}
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
          <UploadCloud size={20} className="text-au-accent" aria-hidden="true" />
          <span className="inline-flex min-h-11 items-center rounded-lg bg-au-accent px-4 text-sm font-semibold text-white">
            {file ? "Upload another workbook" : "Upload workbook"}
          </span>
        </button>
        <p id="word-vault-file-hint" className="break-words text-sm text-muted-foreground">
          {file ? file.name : "Drag and drop an .xlsx workbook up to 2 MB."}
        </p>
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-au-separator pt-3">
            <p className="text-sm text-muted-foreground">The template includes a guide and example.</p>
            <SatButton variant="secondary" disabled={downloading} onClick={() => void download()}>
              <Download size={16} aria-hidden="true" /> {downloading ? "Downloading…" : "Download vocabulary template"}
            </SatButton>
            {downloadError ? <p className="w-full text-sm text-au-danger-text" role="alert">{downloadError}</p> : null}
          </div>
        ) : null}
        <p role="status" className={busy ? "text-sm text-muted-foreground" : "sr-only"}>
          {busy === "check" ? "Checking vocabulary…" : busy === "save" ? "Saving vocabulary…" : ""}
        </p>
        {error ? <p ref={errorElement} tabIndex={-1} role="alert" className="rounded-lg bg-au-danger-tint p-3 text-sm text-au-danger-text">{error}</p> : null}
        {needsCheck && file ? <SatButton variant="secondary" onClick={() => void inspect(file)}>Check again</SatButton> : null}
        {preview ? (
          <section aria-labelledby="word-vault-review">
            <h3 ref={heading} id="word-vault-review" tabIndex={-1} className="font-semibold">
              {preview.issues.length ? "Workbook needs attention" : "Review vocabulary"}
            </h3>
            {preview.issues.length ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Fix the cells in Excel and upload the corrected workbook.</p>
                <ul className="mt-2 space-y-2">
                  {preview.issues.map(({ row, column, message }, index) => (
                    <li key={index} className="rounded-lg bg-au-warning-tint p-2 text-sm text-au-warning-text">
                      <strong>Vocabulary · {column}{row}</strong> · {message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  {words(preview.before)} in the draft now · {words(count)} after import
                </p>
                {!valid ? <p className="mt-2 text-sm text-muted-foreground">Add at least one vocabulary entry and upload again.</p> : null}
                <ul className="mt-2 space-y-1 text-sm">
                  {preview.impact.map(({ module, before, after }) => (
                    <li key={module}>{module} · {before} → {after}{after === 0 ? " (removed)" : ""}</li>
                  ))}
                </ul>
                <ul className="mt-3 divide-y divide-au-separator border-y border-au-separator">
                  {preview.entries.map((entry, index) => (
                    <li key={index} className="grid gap-1 py-3 text-sm [overflow-wrap:anywhere] sm:grid-cols-[1fr_1fr_2fr] sm:gap-3">
                      <div><strong>{entry.word}</strong><p className="text-xs text-muted-foreground">{entry.module} · Question {entry.question}</p></div>
                      <p lang="th">{entry.thai}</p>
                      <div>{entry.definition}<p className="mt-1 text-muted-foreground">{entry.example}</p></div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : null}
      </div>
      {valid ? (
        <footer className="shrink-0 space-y-2 border-t border-au-separator px-5 py-3 sm:px-6">
          {replacing ? (
            <label htmlFor="confirm-word-vault-replacement" className="flex min-h-11 items-center gap-2 text-sm">
              <input id="confirm-word-vault-replacement" aria-labelledby="word-vault-confirm-label" type="checkbox" checked={confirmed} disabled={busy !== null || needsCheck} onChange={(event) => setConfirmed(event.target.checked)} />
              <span id="word-vault-confirm-label">{count === 0 ? "Remove all vocabulary from this draft." : "Replace the entire draft Word Vault."}</span>
            </label>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <SatButton variant="secondary" disabled={busy !== null} onClick={onClose}>Cancel</SatButton>
            <SatButton disabled={busy !== null || needsCheck || (replacing && !confirmed)} onClick={() => void commit()}>
              {count === 0 ? "Remove all draft words" : replacing ? "Replace Word Vault" : `Import ${words(count)}`}
            </SatButton>
          </div>
        </footer>
      ) : null}
    </AuthoringDialog>
  );
}
