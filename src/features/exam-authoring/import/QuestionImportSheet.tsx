import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, X } from "lucide-react";
import type { BatchQuestionDraft } from "../contracts/assessment";
import { parseQuestionImport } from "./questionImportParser";
import { authoringMotion } from "../ui/authoringMotion";

export interface QuestionImportSheetProps {
  open: boolean;
  sectionKey: string;
  remainingCapacity: number;
  isImporting: boolean;
  onClose: () => void;
  onImport: (drafts: BatchQuestionDraft[]) => Promise<void>;
}

const TEMPLATE = "Prompt\tA\tB\tC\tD\tCorrect\tDomain\tSkill\tDifficulty\n";

export function QuestionImportSheet({ open, sectionKey, remainingCapacity, isImporting, onClose, onImport }: QuestionImportSheetProps) {
  const [source, setSource] = useState(TEMPLATE);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const result = useMemo(() => parseQuestionImport(source, sectionKey), [sectionKey, source]);
  const overCapacity = result.drafts.length > remainingCapacity;
  const canImport = result.drafts.length > 0 && !overCapacity && !isImporting;

  useEffect(() => {
    if (!open) return;
    setRuntimeError(null);
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, open]);

  const importReady = async () => {
    if (!canImport) return;
    setRuntimeError(null);
    try { await onImport(result.drafts); }
    catch (error) { setRuntimeError(error instanceof Error ? error.message : "Questions could not be imported."); }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={authoringMotion.surface} className="fixed inset-0 z-[95] flex items-center justify-center bg-black/28 p-4 authoring-glass" role="dialog" aria-modal="true" aria-label="Paste or import SAT questions" onMouseDown={(event) => { if (event.target === event.currentTarget && !isImporting) onClose(); }}>
          <motion.div ref={surfaceRef} initial={{ opacity: 0, y: 12, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} transition={authoringMotion.settle} className="au-elevation-sheet flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[20px] border border-au-separator bg-white">
            <div className="flex items-center justify-between border-b border-au-separator px-5 py-4"><div><h2 className="text-[13px] font-semibold tracking-[-0.012em] text-slate-950">Paste questions</h2><p className="mt-0.5 text-[11px] text-slate-500">Paste from Excel / Google Sheets or choose a CSV/TSV file. Import is atomic.</p></div><button type="button" disabled={isImporting} onClick={onClose} className="authoring-interactive flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-au-fill disabled:opacity-30" aria-label="Close import"><X size={15} aria-hidden="true" /></button></div>
            <div className="grid min-h-0 flex-1 md:grid-cols-[1.2fr_0.8fr]">
              <div className="flex min-h-0 flex-col border-r border-au-separator p-4">
                <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-700">Spreadsheet data</span><label htmlFor="sat-question-import-file" className="authoring-interactive flex cursor-pointer items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-au-fill"><FileSpreadsheet size={12} aria-hidden="true" />Choose file<input id="sat-question-import-file" aria-label="Choose SAT question import file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setSource).catch(() => setRuntimeError("The selected file could not be read.")); event.currentTarget.value = ""; }}/></label></div>
                <textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} aria-label="Question import data" className="min-h-[420px] flex-1 resize-none rounded-[12px] border border-au-separator bg-au-fill p-3 font-mono text-[11px] leading-5 text-slate-800 outline-none transition focus:border-au-accent/30 focus:bg-white focus:ring-4 focus:ring-au-accent/10" />
                <p className="mt-2 text-[11px] leading-4 text-slate-400">Supported headers include Prompt, Stimulus, A–D, Correct, Response Type, Accepted Responses, Domain, Skill, Difficulty, Tags, Rationale, and Pretest.</p>
              </div>
              <div className="min-h-0 overflow-y-auto p-4">
                <div className="grid grid-cols-3 gap-2"><Metric label="Rows" value={result.rowCount} /><Metric label="Ready" value={result.drafts.length} good /><Metric label="Issues" value={result.issues.length} bad={result.issues.length > 0} /></div>
                {overCapacity ? <div className="mt-3 flex gap-2 rounded-[12px] bg-au-danger-tint p-3 text-[11px] leading-5 text-au-danger-text"><AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span>This module has room for {remainingCapacity} more question{remainingCapacity === 1 ? "" : "s"}, but {result.drafts.length} valid rows are ready.</span></div> : null}
                {runtimeError ? <div className="mt-3 rounded-[12px] bg-au-danger-tint p-3 text-[11px] text-au-danger-text">{runtimeError}</div> : null}
                <div className="mt-4"><h3 className="text-[11px] font-semibold text-slate-800">Review</h3>{result.issues.length ? <div className="mt-2 space-y-1.5">{result.issues.slice(0, 40).map((issue, index) => <div key={`${issue.row}-${issue.field}-${index}`} className="flex gap-2 rounded-[10px] bg-au-warning-tint px-2.5 py-2 text-[11px] leading-4 text-au-warning-text"><AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong>Row {issue.row || "—"} · {issue.field}</strong><br />{issue.message}</span></div>)}</div> : result.drafts.length ? <div className="mt-2 flex items-center gap-2 rounded-[12px] bg-au-success-tint p-3 text-[11px] font-medium text-au-success-text"><CheckCircle2 size={15} aria-hidden="true" />{result.drafts.length} question{result.drafts.length === 1 ? "" : "s"} ready to import</div> : <p className="mt-2 text-[11px] leading-5 text-slate-400">Paste question rows to validate them before import.</p>}</div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-au-separator px-5 py-3"><span className="text-[11px] text-slate-400">Invalid rows are never sent to the server.</span><div className="flex gap-2"><button type="button" disabled={isImporting} onClick={onClose} className="authoring-interactive min-h-9 rounded-[10px] px-3.5 text-[12px] font-semibold text-slate-600 hover:bg-au-fill">Cancel</button><button type="button" disabled={!canImport} onClick={() => void importReady()} className="authoring-interactive min-h-9 rounded-[10px] bg-au-accent px-3.5 text-[12px] font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active disabled:cursor-not-allowed disabled:opacity-35">{isImporting ? "Importing…" : `Import ${result.drafts.length} Ready`}</button></div></div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Metric({ label, value, good = false, bad = false }: { label: string; value: number; good?: boolean; bad?: boolean }) {
  return <div className="rounded-[12px] bg-au-fill px-3 py-2.5"><p className={`text-[17px] font-semibold tabular-nums ${good ? "text-au-success-text" : bad ? "text-au-danger-text" : "text-slate-900"}`}>{value}</p><p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400">{label}</p></div>;
}
