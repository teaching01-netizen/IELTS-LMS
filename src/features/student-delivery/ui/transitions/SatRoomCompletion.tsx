import { useId, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { assessmentDeliveryApi } from "../../api/assessmentDeliveryApi";
import { SatCompleteScreen } from "./SatCompleteScreen";

type Props = ComponentProps<typeof SatCompleteScreen> & {
  scheduleId: string;
  attemptId: string;
};

export function SatRoomCompletion({ scheduleId, attemptId, ...current }: Props) {
  const pickerId = useId();
  const [selection, setSelection] = useState<string | null>(null);
  const selectedAttemptId = selection ?? attemptId;
  const isHistorical = selectedAttemptId !== attemptId;
  const historyKey = ["sat", "completed-attempts", scheduleId, attemptId];
  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => assessmentDeliveryApi.completedSatAttempts(scheduleId, attemptId, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const report = useQuery({
    queryKey: [...historyKey, selectedAttemptId],
    queryFn: ({ signal }) => assessmentDeliveryApi.completedSatResult(scheduleId, attemptId, selectedAttemptId, signal),
    enabled: isHistorical,
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
  });
  const attempts = history.data?.attempts ?? [];
  const selected = attempts.find((attempt) => attempt.attemptId === selectedAttemptId);
  const attemptLabel = selected ? `Attempt ${selected.ordinal}` : "Attempt";
  const canSelect = attempts.length > 1 && attempts.some((attempt) => attempt.attemptId === attemptId);
  const loading = isHistorical && (report.isPending || report.isFetching);

  return (
    <>
      {canSelect || history.isError ? (
        <div className="sat-ui bg-[var(--sat-background)] px-[calc(1rem+var(--student-safe-left))] pt-[calc(1.25rem+var(--student-safe-top))] text-[var(--sat-text)] sm:px-6 print:hidden">
          <div className="mx-auto flex max-w-[920px] flex-wrap items-center gap-3">
            {canSelect ? (
              <>
                <label htmlFor={pickerId} className="flex flex-wrap items-center gap-3 text-sm font-semibold">
                  <span>View results for</span>
                  <select
                    id={pickerId}
                    value={selectedAttemptId}
                    onChange={(event) => setSelection(event.target.value)}
                    className="min-h-11 max-w-full rounded-xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-3 py-2 text-[15px] font-semibold text-[var(--sat-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sat-focus)]"
                  >
                    {attempts.map((attempt, index) => (
                      <option key={attempt.attemptId} value={attempt.attemptId}>
                        {index === 0 ? `Attempt ${attempt.ordinal} (latest)` : `Attempt ${attempt.ordinal}`}
                      </option>
                    ))}
                  </select>
                </label>
                <span role="status" className="sr-only">
                  {loading ? `Loading ${attemptLabel} results` : report.isSuccess || !isHistorical ? `Showing ${attemptLabel}` : ""}
                </span>
              </>
            ) : null}
            {history.isError ? (
              <button type="button" className="sat-touch-target rounded-full border border-[var(--sat-divider)] px-4 text-sm font-semibold" onClick={() => void history.refetch()}>
                Retry loading attempt history
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {!isHistorical ? <SatCompleteScreen key={attemptId} {...current} /> : (
        loading || report.isError ? (
          <div className="sat-ui min-h-[70dvh] bg-[var(--sat-background)] px-4 py-8 text-[var(--sat-text)] sm:px-6">
            <main className="mx-auto max-w-[920px]">
              {loading ? (
                <section aria-busy="true" aria-label={`${attemptLabel} results`}>
                  <p className="text-sm font-semibold text-[var(--sat-text-secondary)]">Loading {attemptLabel} results…</p>
                  <div aria-hidden="true" className="mt-5 space-y-4 motion-safe:animate-pulse">
                    <div className="h-9 w-2/3 rounded-xl bg-[var(--sat-surface-subtle)]" />
                    <div className="h-48 rounded-2xl border border-[var(--sat-divider)] bg-[var(--sat-surface)]" />
                    <div className="h-32 rounded-2xl border border-[var(--sat-divider)] bg-[var(--sat-surface)]" />
                  </div>
                </section>
              ) : (
                <section className="rounded-2xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-6">
                  <p role="alert" className="font-semibold">Couldn’t load {attemptLabel} results.</p>
                  <button type="button" className="sat-touch-target mt-3 rounded-full border border-[var(--sat-divider)] px-4 text-sm font-semibold" onClick={() => void report.refetch()}>
                    Try again
                  </button>
                </section>
              )}
            </main>
          </div>
        ) : (
          <SatCompleteScreen
            key={selectedAttemptId}
            result={report.data?.result ?? null}
            onExit={current.onExit}
            retakeActions={current.retakeActions}
            answered={{
              key: `student:${scheduleId}:${selectedAttemptId}`,
              sections: current.answered?.sections ?? [],
              preparePdf: (request, signal) =>
                assessmentDeliveryApi.answeredExamPdf(scheduleId, attemptId, request, signal, selectedAttemptId),
            }}
          />
        )
      )}
    </>
  );
}
