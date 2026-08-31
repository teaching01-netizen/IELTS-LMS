interface WorkbookImportUndoBannerProps {
  busy: boolean;
  onUndo: () => void;
}

export function WorkbookImportUndoBanner({ busy, onUndo }: WorkbookImportUndoBannerProps) {
  return (
    <div className="shrink-0 border-b border-black/[0.055] bg-white/80 px-4 py-1.5 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1920px] items-center justify-center gap-2 text-[10px] font-medium text-slate-500">
        <span>Imported from Excel</span>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onUndo}
          className="min-h-8 rounded-[8px] px-2 font-semibold text-[#0066cc] hover:bg-[#0071e3]/[0.07] disabled:opacity-40"
        >
          {busy ? "Undoing…" : "Undo Import"}
        </button>
      </div>
    </div>
  );
}
