import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { AuthoringDialog } from "@/src/features/exam-authoring/ui/authoringPrimitives";
import { useProctorSessionSummaries } from "@/src/features/proctor/api/proctorQueries";
import { proctorFacade } from "@/src/features/proctor/application/proctorFacade";
import { useFormResponseDetail, useFormResponses } from "@/src/features/assessment-forms/api/assessmentForms";
import type { EvaMode, FormKey, FormResponseFilters, FormResponseRow, ResponseStatus } from "@/src/features/assessment-forms/api/assessmentForms";
import {
  SatButton,
  SatContainer,
  SatEmptyState,
  SatInlineError,
  SatList,
  SatListRow,
  SatListSkeleton,
  SatListToolbar,
  SatPageHeader,
  SatStatusPill,
  SatToolbarSelect,
  type SatStatusTone,
} from "../ui/SatPage";

/* Staff Form responses (/sat/forms): registration and Eva SIM answers, kept
 * apart from exam results. Filters live in the URL so a detail view and
 * Back return to the same list; the detail opens over the list, which keeps
 * the scroll position. External Eva is never counted as a submission. */

const STATUS_LABEL: Record<ResponseStatus, string> = {
  submitted: "Submitted",
  not_submitted: "Not submitted",
  pending_completion: "Exam not completed",
  pending_section: "Section not available",
  not_tracked: "External · not tracked",
  not_applicable: "Not applicable",
};
const STATUS_TONE: Record<ResponseStatus, SatStatusTone> = {
  submitted: "ready",
  not_submitted: "pending",
  pending_completion: "neutral",
  pending_section: "neutral",
  not_tracked: "info",
  not_applicable: "neutral",
};

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

type StatusChoice = "" | ResponseStatus;

function statusChoices(formKey: FormKey, mode: "" | EvaMode): ReadonlyArray<{ value: StatusChoice; label: string }> {
  const native = [
    { value: "submitted" as const, label: "Submitted" },
    { value: "not_submitted" as const, label: "Not submitted" },
  ];
  if (formKey === "registration") return [{ value: "", label: "All" }, ...native];
  if (formKey === "verbal_entry" || formKey === "math_entry") return [{ value: "", label: "All" }, ...native, { value: "pending_section", label: "Section not available" }];
  if (mode === "embed") return [{ value: "", label: "All" }];
  if (mode === "native") return [{ value: "", label: "All" }, ...native, { value: "pending_completion", label: "Exam not completed" }];
  return [{ value: "", label: "All" }, ...native, { value: "pending_completion", label: "Exam not completed" }, { value: "not_tracked", label: "External · not tracked" }];
}

export function SatFormResponsesRoute() {
  const [params, setParams] = useSearchParams();
  const formParam = params.get("form");
  const formKey: FormKey = formParam === "eva_sim" || formParam === "verbal_entry" || formParam === "math_entry" ? formParam : "registration";
  const modeParam = params.get("mode");
  const mode: "" | EvaMode = formKey === "eva_sim" && (modeParam === "native" || modeParam === "embed") ? modeParam : "";
  const choices = statusChoices(formKey, mode);
  const statusParam = (params.get("status") ?? "") as StatusChoice;
  const status: StatusChoice = choices.some((choice) => choice.value === statusParam) ? statusParam : "";
  const examId = params.get("examId") ?? "";
  const scheduleId = params.get("scheduleId") ?? "";
  const openAttempt = params.get("attempt");

  const filters: FormResponseFilters = useMemo(
    () => ({
      formKey,
      ...(examId ? { examId } : {}),
      ...(scheduleId ? { scheduleId } : {}),
      ...(mode ? { mode } : {}),
      ...(status ? { status } : {}),
    }),
    [examId, formKey, mode, scheduleId, status]
  );
  const query = useFormResponses(filters);
  // Exam and room choices come from the rooms this staff member can see, so
  // proctors are only offered their assigned rooms.
  const roomsQuery = useProctorSessionSummaries(0, "sat");
  const rooms = useMemo(
    () => (roomsQuery.data ?? []).filter((summary) => !proctorFacade.isPreviewRuntimeCohortName(summary.schedule.cohortName)).map((summary) => summary.schedule),
    [roomsQuery.data]
  );
  const examOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const room of rooms) if (!seen.has(room.examId)) seen.set(room.examId, room.examTitle);
    if (examId && !seen.has(examId)) seen.set(examId, "Selected exam");
    return [{ value: "", label: "All" }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [examId, rooms]);
  const roomOptions = useMemo(() => {
    const scoped = rooms.filter((room) => !examId || room.examId === examId);
    const options = scoped.map((room) => ({ value: room.id, label: room.cohortName }));
    if (scheduleId && !options.some((option) => option.value === scheduleId)) options.push({ value: scheduleId, label: "Selected room" });
    return [{ value: "", label: "All" }, ...options];
  }, [examId, rooms, scheduleId]);
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  const update = (next: Record<string, string | null>) => {
    setParams(
      (current) => {
        const out = new URLSearchParams(current);
        for (const [key, value] of Object.entries(next)) {
          if (value) out.set(key, value);
          else out.delete(key);
        }
        return out;
      },
      { replace: true }
    );
  };

  const filtered = Boolean(examId || scheduleId || mode || status);
  const scopeRow = rows[0];
  const activeSummary = [
    examId ? `Exam: ${examOptions.find((option) => option.value === examId)?.label ?? "selected exam"}` : null,
    scheduleId ? `Room: ${roomOptions.find((option) => option.value === scheduleId)?.label ?? "selected room"}` : null,
    mode ? `Mode: ${mode === "native" ? "Native" : "External"}` : null,
    status ? `Status: ${STATUS_LABEL[status]}` : null,
  ].filter(Boolean);

  return (
    <SatContainer>
      <SatPageHeader
        title="Form responses"
        description="Registration, section entry and Eva SIM responses. Exam answers and scores stay in Responses."
      />
      <SatListToolbar label="Response filters">
        <SatToolbarSelect<string>
          id="sat-forms-exam"
          label="Exam"
          value={examId}
          options={examOptions}
          onChange={(value) => update({ examId: value || null, scheduleId: null })}
        />
        <SatToolbarSelect<string>
          id="sat-forms-room"
          label="Room"
          value={scheduleId}
          options={roomOptions}
          onChange={(value) => update({ scheduleId: value || null })}
        />
        <SatToolbarSelect<FormKey>
          id="sat-forms-form"
          label="Form"
          value={formKey}
          options={[
            { value: "registration", label: "Registration" },
            { value: "verbal_entry", label: "Verbal entry" },
            { value: "math_entry", label: "Math entry" },
            { value: "eva_sim", label: "Eva SIM" },
          ]}
          onChange={(value) => update({ form: value, mode: null, status: null })}
        />
        {formKey === "eva_sim" ? (
          <SatToolbarSelect<"" | EvaMode>
            id="sat-forms-mode"
            label="Mode"
            value={mode}
            options={[
              { value: "", label: "All" },
              { value: "native", label: "Native" },
              { value: "embed", label: "External" },
            ]}
            onChange={(value) => update({ mode: value || null, status: null })}
          />
        ) : null}
        {choices.length > 1 ? (
          <SatToolbarSelect<StatusChoice>
            id="sat-forms-status"
            label="Status"
            value={status}
            options={choices}
            onChange={(value) => update({ status: value || null })}
          />
        ) : null}
      </SatListToolbar>
      {activeSummary.length > 0 ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">
          <span>{activeSummary.join(" · ")}</span>
          <SatButton variant="quiet" onClick={() => update({ examId: null, scheduleId: null, mode: null, status: null })}>
            Clear filters
          </SatButton>
        </p>
      ) : null}

      {query.isPending ? (
        <SatListSkeleton rows={4} label="Loading form responses" />
      ) : query.isError && rows.length === 0 ? (
        <SatInlineError
          title="Form responses could not load"
          description={query.error instanceof Error ? query.error.message : "Try again."}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        filtered ? (
          <SatEmptyState
            icon={<ClipboardList size={20} aria-hidden="true" />}
            title="No matches for these filters"
            hint="Try another status or mode, or clear the filters."
            action={<SatButton variant="secondary" onClick={() => update({ examId: null, scheduleId: null, mode: null, status: null })}>Clear filters</SatButton>}
          />
        ) : (
          <SatEmptyState
            icon={<ClipboardList size={20} aria-hidden="true" />}
            title="No form responses in this scope"
            hint="Responses appear here after students check in to rooms that ask exam details or Eva SIM questions."
          />
        )
      ) : (
        <>
          {scopeRow && scheduleId ? (
            <p className="mt-4 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">
              {scopeRow.examTitle} · {scopeRow.scheduleName} · Version {scopeRow.versionNumber}
            </p>
          ) : null}
          <div className="mt-3">
            <SatList>
              {rows.map((row) => (
                <ResponseListRow
                  key={`${row.attemptId}:${row.formKey}`}
                  row={row}
                  current={openAttempt === row.attemptId}
                  onOpen={() => update({ attempt: row.attemptId })}
                  onFilterRoom={() => update({ scheduleId: row.scheduleId })}
                />
              ))}
            </SatList>
          </div>
          {query.isError ? (
            <SatInlineError title="More responses could not load" description="Try again." onRetry={() => void query.fetchNextPage()} />
          ) : null}
          {query.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <SatButton variant="secondary" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? "Loading…" : "Load more"}
              </SatButton>
            </div>
          ) : null}
        </>
      )}

      <ResponseDetailDialog
        attemptId={openAttempt}
        formKey={formKey}
        onClose={() => {
          update({ attempt: null });
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sat-row-id="${CSS.escape(openAttempt ?? "")}"]`)?.focus());
        }}
      />
    </SatContainer>
  );
}

function ResponseListRow({
  row,
  current,
  onOpen,
  onFilterRoom,
}: {
  row: FormResponseRow;
  current: boolean;
  onOpen: () => void;
  onFilterRoom: () => void;
}) {
  const updated = row.mode !== "embed" ? formatTime(row.updatedAt) : "";
  return (
    <div className="flex flex-col sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <SatListRow onOpen={onOpen} rowId={row.attemptId} current={current} ariaLabel={`${row.studentName}, ${STATUS_LABEL[row.status]}. Open response`}>
          <span className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-4">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
                {row.studentName || row.studentCode}
              </span>
              <span className="block text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)] [overflow-wrap:anywhere]">
                {row.studentCode} · {row.studentEmail}
              </span>
              <span className="block text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)] [overflow-wrap:anywhere]">
                {row.examTitle} · {row.scheduleName} · v{row.versionNumber}
                {row.formKey === "eva_sim" && row.mode ? ` · ${row.mode === "native" ? "Native" : "External"}` : ""}
                {row.formKey === "eva_sim" && row.collection === "closed" ? " · Closed" : ""}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
              <SatStatusPill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</SatStatusPill>
              {updated ? <span className="tabular-nums text-[13px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">Updated {updated}</span> : null}
            </span>
          </span>
        </SatListRow>
      </div>
      <div className="px-4 pb-2 sm:pb-0">
        <SatButton variant="quiet" onClick={onFilterRoom} aria-label={`Show only room ${row.scheduleName}`}>
          This room
        </SatButton>
      </div>
    </div>
  );
}

function ResponseDetailDialog({ attemptId, formKey, onClose }: { attemptId: string | null; formKey: FormKey; onClose: () => void }) {
  const detail = useFormResponseDetail(attemptId, formKey);
  const data = detail.data;
  return (
    <AuthoringDialog
      open={attemptId !== null}
      title={formKey === "registration" ? "Registration response" : formKey === "verbal_entry" ? "Verbal entry response" : formKey === "math_entry" ? "Math entry response" : "Eva SIM response"}
      {...(data ? { description: `${data.studentName} · ${data.examTitle} · ${data.scheduleName} · Version ${data.versionNumber}` } : {})}
      onClose={onClose}
      contentClassName="max-w-[640px]"
    >
      {detail.isPending ? (
        <p role="status" className="text-[14px]">Loading response…</p>
      ) : !data ? (
        <SatInlineError title="This response could not load" description="Try again." onRetry={() => void detail.refetch()} />
      ) : (
        <div className="space-y-4 text-[14px] leading-5">
          <div className="flex flex-wrap items-center gap-2">
            <SatStatusPill tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</SatStatusPill>
            {data.formKey === "eva_sim" ? (
              <span className="text-[var(--sat-staff-text-secondary,#515154)]">
                {data.collection === "closed" ? `Closed${formatTime(data.closedAt) ? ` ${formatTime(data.closedAt)}` : ""}` : "Collection open"}
              </span>
            ) : null}
          </div>
          {data.mode === "embed" ? (
            <p className="text-[var(--sat-staff-text-secondary,#515154)]">
              External Eva SIM{data.embedHost ? ` on ${data.embedHost}` : ""}. Responses are collected by the external provider; this system does not track whether the student submitted it.
            </p>
          ) : data.status === "submitted" ? (
            <>
              <p className="tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">
                {formatTime(data.firstSubmittedAt) ? `First submitted ${formatTime(data.firstSubmittedAt)}` : ""}
                {formatTime(data.updatedAt) && data.updatedAt !== data.firstSubmittedAt ? ` · Last updated ${formatTime(data.updatedAt)}` : ""}
              </p>
              <dl className="divide-y divide-[var(--sat-staff-border-hairline)] rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline)]">
                {data.fields.map((field) => {
                  const raw = data.answers?.[field.id];
                  const shown =
                    raw === undefined
                      ? "Not answered"
                      : field.type === "single_choice"
                        ? (field.options.find((option) => option.id === raw)?.label ?? String(raw))
                        : String(raw);
                  return (
                    <div key={field.id} className="grid gap-1 p-3 sm:grid-cols-[200px_minmax(0,1fr)]">
                      <dt className="font-semibold [overflow-wrap:anywhere]">{field.label}</dt>
                      <dd className={`[overflow-wrap:anywhere] ${raw === undefined ? "text-[var(--sat-staff-text-tertiary,#6e6e73)]" : ""}`}>{shown}</dd>
                    </div>
                  );
                })}
              </dl>
            </>
          ) : (
            <p className="text-[var(--sat-staff-text-secondary,#515154)]">
              {data.status === "pending_completion" ? "The student has not completed the exam yet." : "No response was submitted."}
            </p>
          )}
        </div>
      )}
    </AuthoringDialog>
  );
}
