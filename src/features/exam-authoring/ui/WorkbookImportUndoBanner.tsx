interface WorkbookImportUndoBannerProps {
  busy: boolean;
  onUndo: () => void;
}

export function WorkbookImportUndoBanner({ busy, onUndo }: WorkbookImportUndoBannerProps) {
  return (
    <div className="shrink-0 border-b border-au-separator bg-white/85 px-4 py-2 authoring-glass">
      <div className="mx-auto flex max-w-[1920px] items-center justify-center gap-2 text-[12px] font-medium text-slate-500">
        <span>Imported from Excel</span>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onUndo}
          className="authoring-interactive min-h-8 rounded-[9px] px-2.5 text-[12px] font-semibold text-au-accent hover:bg-au-accent-tint disabled:opacity-40"
        >
          {busy ? "Undoing…" : "Undo Import"}
        </button>
      </div>
    </div>
  );
}
