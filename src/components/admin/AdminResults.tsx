import { useMemo, useState, type ReactNode } from "react";
import { BarChart2, CheckCircle2, Clock3, RefreshCw, Search, Users, X } from "lucide-react";
import { ErrorSurface } from "../ui/ErrorSurface";
import { LoadingSurface } from "../ui/LoadingSurface";
import {
  useAdminResultsQuery,
  useResultsAnalyticsQuery,
  type AdminResultRow,
  type ResultProviderKey,
} from "../../features/results/api/resultsQueries";

type ProviderFilter = ResultProviderKey | "all";

function providerLabel(provider: ResultProviderKey): string {
  return provider === "act" ? "ACT Science" : provider === "sat" ? "Digital SAT" : "IELTS";
}

function releaseLabel(status: string): string {
  switch (status) {
    case "released":
      return "Released";
    case "ready_to_release":
      return "Ready to release";
    case "reopened":
      return "Reopened";
    case "grading_complete":
      return "Grading complete";
    case "invalidated":
      return "Invalidated";
    default:
      return status.replaceAll("_", " ");
  }
}

function outcomeLabel(result: AdminResultRow): string {
  switch (result.outcomeStatus) {
    case "invalidated_proctor":
      return "Exam terminated by proctor";
    case "invalidated_timeout":
      return "Exam ended before scoring";
    case "pending":
      return "Scoring pending";
    default:
      return releaseLabel(result.releaseStatus);
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(time));
}

function scoreLabel(result: AdminResultRow): string {
  if (
    result.outcomeStatus === "invalidated_proctor" ||
    result.outcomeStatus === "invalidated_timeout"
  ) {
    return "Not scored";
  }
  if (
    result.providerKey === "ielts" &&
    typeof result.overallBand === "number" &&
    Number.isFinite(result.overallBand)
  ) {
    return `Band ${result.overallBand.toFixed(1)}`;
  }
  if (typeof result.totalScore === "number" && Number.isFinite(result.totalScore)) {
    return typeof result.maxScore === "number" && Number.isFinite(result.maxScore)
      ? `${result.totalScore}/${result.maxScore}`
      : String(result.totalScore);
  }
  return result.outcomeStatus === "pending" ? "Pending" : "—";
}

function scoreTone(result: AdminResultRow): string {
  if (result.outcomeStatus !== "scored") return "text-slate-400";
  return "text-slate-900";
}

function bandValue(result: AdminResultRow, key: string): string {
  const value = result.sectionBands?.[key];
  return typeof value === "number" ? value.toFixed(1) : "—";
}

function ResultDetail({ result, onClose }: { result: AdminResultRow; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-detail-title"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {providerLabel(result.providerKey)} result
            </p>
            <h2
              id="result-detail-title"
              className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-900"
            >
              {result.studentName}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {result.studentId} · {result.cohortName} · {formatDate(result.submittedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close result report"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              Score
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{scoreLabel(result)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              Outcome
            </p>
            <p className="mt-1 text-sm font-semibold capitalize text-slate-700">
              {outcomeLabel(result)}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              Release
            </p>
            <p className="mt-1 text-sm font-semibold capitalize text-slate-700">
              {releaseLabel(result.releaseStatus)}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              Version
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {result.versionNumber || "—"}
            </p>
          </div>
        </div>

        {result.providerKey === "ielts" ? (
          <div className="mt-6 border-y border-black/[0.06] py-4">
            <h3 className="text-sm font-semibold text-slate-900">IELTS section bands</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["listening", "reading", "writing", "speaking"] as const).map((key) => (
                <div key={key}>
                  <p className="text-[10px] capitalize text-slate-400">{key}</p>
                  <p className="mt-1 text-base font-semibold text-slate-800">
                    {bandValue(result, key)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : typeof result.percentage === "number" && Number.isFinite(result.percentage) ? (
          <div className="mt-6 border-y border-black/[0.06] py-4">
            <h3 className="text-sm font-semibold text-slate-900">Objective performance</h3>
            <p className="mt-2 text-sm text-slate-600">
              {result.percentage.toFixed(1)}% correct
              {typeof result.maxScore === "number"
                ? ` · ${result.maxScore} weighted points available`
                : ""}
              .
            </p>
          </div>
        ) : null}

        <p className="mt-5 text-[11px] leading-5 text-slate-400">
          {result.examTitle} · {result.scheduleId}
        </p>
      </section>
    </div>
  );
}

export function AdminResults() {
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedResult, setSelectedResult] = useState<AdminResultRow | null>(null);
  const query = useAdminResultsQuery(provider);
  const analytics = useResultsAnalyticsQuery();

  const filteredResults = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (query.data ?? []).filter((result) => {
      if (!needle) return true;
      return [
        result.studentName,
        result.studentId,
        result.studentEmail,
        result.cohortName,
        result.examTitle,
        providerLabel(result.providerKey),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [query.data, search]);

  const visibleResults = query.data ?? [];
  const releasedCount = visibleResults.filter(
    (result) => result.releaseStatus === "released"
  ).length;
  const readyCount = visibleResults.filter(
    (result) => result.releaseStatus === "ready_to_release"
  ).length;
  const averageBand = analytics.data?.averageOverallBand ?? null;

  if (query.isLoading) return <LoadingSurface label="Opening results…" />;
  if (query.error)
    return (
      <ErrorSurface
        title="Results could not load"
        description={
          query.error instanceof Error ? query.error.message : "Results are unavailable."
        }
        actionLabel="Retry"
        onAction={() => void query.refetch()}
      />
    );

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-6 px-4 pb-14 pt-7 sm:px-6 md:pt-10 lg:px-10">
      <div className="flex flex-col gap-4 border-b border-black/[0.065] pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Assessment outcomes
          </p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.045em] text-slate-900">
            Results &amp; Analytics
          </h1>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
            Provider-backed results from sealed attempts and released IELTS snapshots. Scores are
            never fabricated when a provider has no result.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
              size={16}
              aria-hidden="true"
            />
            <span className="sr-only">Search results</span>
            <input
              id="admin-results-search"
              type="search"
              aria-label="Search results"
              placeholder="Search results..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <select
            id="admin-results-provider"
            aria-label="Filter by provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as ProviderFilter)}
            className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">All providers</option>
            <option value="ielts">IELTS</option>
            <option value="sat">Digital SAT</option>
            <option value="act">ACT Science</option>
          </select>
          <button
            type="button"
            onClick={() => {
              void query.refetch();
              void analytics.refetch();
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Users size={19} />}
          label="Visible results"
          value={String(visibleResults.length)}
          tone="blue"
        />
        <MetricCard
          icon={<CheckCircle2 size={19} />}
          label="Released"
          value={String(releasedCount)}
          tone="emerald"
        />
        <MetricCard
          icon={<Clock3 size={19} />}
          label="Ready to release"
          value={String(readyCount)}
          tone="amber"
        />
        <MetricCard
          icon={<BarChart2 size={19} />}
          label="IELTS average band"
          value={averageBand === null ? "—" : averageBand.toFixed(1)}
          tone="purple"
        />
      </div>

      <section
        className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
        aria-labelledby="recent-results-heading"
      >
        <div className="flex flex-col gap-2 border-b border-gray-200 bg-gray-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="recent-results-heading" className="text-lg font-semibold text-gray-900">
            Recent results
          </h2>
          <p className="text-xs text-gray-500">
            {filteredResults.length} shown{search ? ` for “${search}”` : ""}
          </p>
        </div>
        {filteredResults.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-5 py-3 font-medium">Student</th>
                  <th className="px-5 py-3 font-medium">Cohort</th>
                  <th className="px-5 py-3 font-medium">Exam</th>
                  <th className="px-5 py-3 font-medium">Provider</th>
                  <th className="px-5 py-3 font-medium">Submitted</th>
                  <th className="px-5 py-3 text-right font-medium">Score</th>
                  <th className="px-5 py-3 font-medium">Release</th>
                  <th className="px-5 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-sm">
                {filteredResults.map((result) => (
                  <tr
                    key={`${result.providerKey}:${result.id}`}
                    data-result-card
                    className="hover:bg-gray-50"
                  >
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">{result.studentName}</p>
                      <p className="mt-1 text-xs text-gray-500">{result.studentId}</p>
                    </td>
                    <td className="px-5 py-4 text-gray-600">{result.cohortName}</td>
                    <td className="max-w-[220px] px-5 py-4 text-gray-700">
                      <p className="truncate">{result.examTitle}</p>
                      <p className="mt-1 text-xs text-gray-400">v{result.versionNumber}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {providerLabel(result.providerKey)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-500">{formatDate(result.submittedAt)}</td>
                    <td
                      className={`px-5 py-4 text-right font-semibold tabular-nums ${scoreTone(result)}`}
                    >
                      {scoreLabel(result)}
                    </td>
                    <td className="px-5 py-4 capitalize text-gray-600">{outcomeLabel(result)}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedResult(result)}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        View Report
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-400">
              —
            </div>
            <h3 className="mt-4 text-base font-semibold text-gray-900">
              {search ? "No matching results" : "No results yet"}
            </h3>
            <p className="mt-1 max-w-sm text-xs leading-5 text-gray-500">
              {search
                ? "Try another student, cohort, exam, or provider."
                : "A result appears here after an attempt is sealed or an IELTS grade is released."}
            </p>
          </div>
        )}
      </section>
      {selectedResult ? (
        <ResultDetail result={selectedResult} onClose={() => setSelectedResult(null)} />
      ) : null}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "blue" | "emerald" | "amber" | "purple";
}) {
  const tones = {
    blue: "bg-blue-100 text-blue-600",
    emerald: "bg-emerald-100 text-emerald-600",
    amber: "bg-amber-100 text-amber-600",
    purple: "bg-purple-100 text-purple-600",
  };
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${tones[tone]}`}>
        {icon}
      </div>
    </div>
  );
}
