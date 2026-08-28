export interface ReferenceSheetProps {
  onClose: () => void;
}

export function ReferenceSheet({ onClose }: ReferenceSheetProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="Math reference sheet">
      <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-600">Reference sheet</h3><button type="button" onClick={onClose} className="text-xs font-semibold text-slate-500">Close</button></div>
      <div className="space-y-2 text-xs leading-5 text-slate-700">
        <p><span className="font-semibold">Triangle:</span> A = ½bh</p>
        <p><span className="font-semibold">Circle:</span> C = 2πr, A = πr²</p>
        <p><span className="font-semibold">Pythagorean:</span> a² + b² = c²</p>
        <p><span className="font-semibold">Quadratic:</span> x = (−b ± √(b² − 4ac)) / 2a</p>
      </div>
    </section>
  );
}
