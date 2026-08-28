import { SatToolWindow } from './SatToolWindow';

export interface SatReferenceSheetPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SatReferenceSheetPanel({ open, onClose }: SatReferenceSheetPanelProps) {
  return (
    <SatToolWindow title="Math reference" open={open} onClose={onClose}>
      <div className="h-full overflow-y-auto bg-white p-5 sm:p-7">
        <div className="mx-auto max-w-2xl space-y-6 text-slate-900">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Reference formulas</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">Use this sheet as a quick reference while working in the Math section.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Formula label="Triangle area" value="A = ½bh" />
            <Formula label="Circle circumference" value="C = 2πr" />
            <Formula label="Circle area" value="A = πr²" />
            <Formula label="Pythagorean theorem" value="a² + b² = c²" />
            <Formula label="Quadratic formula" value="x = (−b ± √(b² − 4ac)) / 2a" />
          </div>
        </div>
      </div>
    </SatToolWindow>
  );
}

function Formula({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  );
}
