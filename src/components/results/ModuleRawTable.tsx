export interface ModuleRawRow {
  key: string;
  label: string;
  sublabel?: string | undefined;
  correct: number | null;
  total: number | null;
  percentage?: number | null | undefined;
  status?: string | undefined;
  badges?: string[] | undefined;
}

function formatRaw(correct: number | null, total: number | null): string {
  if (typeof correct !== "number" || typeof total !== "number") return "—";
  if (!Number.isFinite(correct) || !Number.isFinite(total)) return "—";
  return `${correct} / ${total}`;
}

function formatPercent(value: number | null | undefined, correct: number | null, total: number | null): string {
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toFixed(1)}%`;
  if (typeof correct === "number" && typeof total === "number" && total > 0) {
    return `${((correct / total) * 100).toFixed(1)}%`;
  }
  return "—";
}

export function ModuleRawTable({ rows, caption }: { rows: ModuleRawRow[]; caption?: string | undefined }) {
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-slate-500">No module results recorded.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left" aria-label={caption ?? "Module raw scores"}>
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
            <th className="px-4 py-2 font-medium">Module</th>
            <th className="px-4 py-2 text-right font-medium">Raw</th>
            <th className="px-4 py-2 text-right font-medium">Percent</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-sm">
          {rows.map((row) => {
            const percent =
              typeof row.percentage === "number" && Number.isFinite(row.percentage)
                ? row.percentage
                : typeof row.correct === "number" && typeof row.total === "number" && row.total > 0
                  ? (row.correct / row.total) * 100
                  : null;
            return (
              <tr key={row.key}>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-gray-900">{row.label}</p>
                  {row.sublabel ? <p className="mt-0.5 text-xs text-gray-400">{row.sublabel}</p> : null}
                  {row.badges?.length ? (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {row.badges.map((badge) => (
                        <span key={badge} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {badge}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                  {formatRaw(row.correct, row.total)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                  {formatPercent(row.percentage, row.correct, row.total)}
                  {percent !== null ? (
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full bg-blue-500"
                        style={{ width: `${Math.max(0, Math.min(100, percent)).toFixed(1)}%` }}
                      />
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-gray-600">{row.status ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
