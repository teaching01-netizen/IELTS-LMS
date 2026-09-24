import { useMemo, useState } from "react";

export interface QuestionRawRow {
  key: string;
  index: number;
  question: string;
  section?: string | undefined;
  studentAnswer: unknown;
  correctAnswer: unknown;
  /** Null = pretest, unanswered, missing key, or unscored. Never render null as incorrect. */
  isCorrect: boolean | null;
  score?: string | undefined;
  badges?: string[] | undefined;
  hasOverride?: boolean | undefined;
  answered?: boolean | undefined;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "(empty)";
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" | ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "(unserializable)";
    }
  }
  return String(value);
}

function verdictLabel(row: QuestionRawRow): { text: string; className: string } {
  if (row.isCorrect === true)
    return { text: "Correct", className: "bg-emerald-100 text-emerald-800" };
  if (row.isCorrect === false) return { text: "Incorrect", className: "bg-red-100 text-red-800" };
  return { text: "Not scored", className: "bg-slate-100 text-slate-500" };
}

export function QuestionRawTable({ rows, caption, showVerdictFilters = true }: { rows: QuestionRawRow[]; caption?: string | undefined; showVerdictFilters?: boolean | undefined }) {
  const [search, setSearch] = useState("");
  const [onlyIncorrect, setOnlyIncorrect] = useState(false);
  const [onlyOverrides, setOnlyOverrides] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (onlyIncorrect && row.isCorrect !== false) return false;
      if (onlyOverrides && !row.hasOverride) return false;
      if (!needle) return true;
      return [row.question, row.section ?? "", toText(row.studentAnswer), toText(row.correctAnswer)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, search, onlyIncorrect, onlyOverrides]);

  if (rows.length === 0) {
    return <p className="py-4 text-sm text-slate-500">No question-level responses recorded.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          aria-label="Search questions"
          placeholder="Search questions or answers..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 sm:max-w-xs"
        />
        {showVerdictFilters ? <div className="flex flex-wrap gap-2 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-gray-300 px-2.5 py-1 font-medium text-gray-600 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700">
            <input type="checkbox" checked={onlyIncorrect} onChange={(event) => setOnlyIncorrect(event.target.checked)} className="sr-only" />
            Only incorrect
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-gray-300 px-2.5 py-1 font-medium text-gray-600 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50 has-[:checked]:text-blue-700">
            <input type="checkbox" checked={onlyOverrides} onChange={(event) => setOnlyOverrides(event.target.checked)} className="sr-only" />
            Only overrides
          </label>
        </div> : null}
        <p className="text-xs text-gray-400 sm:ml-auto" role="status">
          {filtered.length} of {rows.length} shown
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left" aria-label={caption ?? "Question raw answers"}>
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
              <th className="w-12 px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Question</th>
              <th className="px-4 py-2 font-medium">Student raw</th>
              <th className="px-4 py-2 font-medium">Key</th>
              <th className="px-4 py-2 font-medium">Result</th>
              <th className="px-4 py-2 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {filtered.map((row) => {
              const verdict = verdictLabel(row);
              const studentText = toText(row.studentAnswer);
              const keyText = toText(row.correctAnswer);
              const isOpen = expanded === row.key;
              const long = studentText.length > 120 || keyText.length > 120;
              return (
                <tr key={row.key} className="align-top hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 tabular-nums text-gray-400">{row.index}</td>
                  <td className="max-w-[180px] px-4 py-2.5">
                    <p className="font-medium text-gray-900">{row.question}</p>
                    {row.section ? <p className="mt-0.5 text-xs capitalize text-gray-400">{row.section}</p> : null}
                    {row.badges?.length ? (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {row.badges.map((badge) => (
                          <span key={badge} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            {badge}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </td>
                  <td className="max-w-[220px] px-4 py-2.5 text-gray-700">
                    <p className={isOpen ? "whitespace-pre-wrap break-words" : "truncate"} title={studentText}>
                      {studentText}
                    </p>
                    {long ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : row.key)}
                        className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? "Show less" : "Show full"}
                      </button>
                    ) : null}
                  </td>
                  <td className="max-w-[180px] px-4 py-2.5 text-gray-500">
                    <p className={isOpen ? "whitespace-pre-wrap break-words" : "truncate"} title={keyText}>
                      {keyText}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${verdict.className}`}>
                      {verdict.text}
                    </span>
                    {row.hasOverride ? (
                      <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                        Override
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{row.score ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">No questions match the current filters.</p>
      ) : null}
    </div>
  );
}
