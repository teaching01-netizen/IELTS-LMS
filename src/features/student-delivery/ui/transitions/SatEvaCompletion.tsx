import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, LoaderCircle } from "lucide-react";
import { ApiError } from "@/src/shared/api-client/errors";
import {
  AnswerList,
  EvaEmbedFrame,
  FORM_REASONS,
  FormFields,
  buildAnswers,
  errorReason,
  rawFromAnswers,
  serverFieldErrors,
  type EmbedEvaState,
  type EvaAck,
  type EvaState,
  type NativeEvaState,
  type RawAnswers,
  type SubmitEvaRequest,
} from "@/src/features/assessment-forms/api/assessmentForms";
import { assessmentDeliveryApi } from "../../api/assessmentDeliveryApi";
import { useEvaSimState } from "../../hooks/useEvaSimState";
import { SatCenterModal } from "../primitives/SatCenterModal";

/* Eva SIM after SAT completion (UX spec §3–4). The gate decides between the
 * SAT Complete page (with one shared Eva status group in both report
 * branches) and the Eva subview. Nothing here touches exam state. */

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sat-surface)]";
const PRIMARY = `sat-touch-target sat-pressable inline-flex items-center justify-center gap-2 rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] ${FOCUS_RING}`;
const SECONDARY = `sat-touch-target sat-pressable inline-flex items-center justify-center gap-2 rounded-full border border-[var(--sat-divider-strong)] bg-[var(--sat-surface)] px-5 text-[14px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed ${FOCUS_RING}`;
const LINK = `sat-touch-target inline-flex items-center gap-1.5 rounded-md px-1 text-[14px] font-semibold text-[var(--sat-accent-strong)] underline underline-offset-2 ${FOCUS_RING}`;

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

type View = "auto" | "complete" | "eva";

function viewKey(attemptId: string): string {
  return `sat-eva-view:${attemptId}`;
}
function loadView(attemptId: string): View {
  try {
    return window.sessionStorage.getItem(viewKey(attemptId)) === "complete" ? "complete" : "auto";
  } catch {
    return "auto";
  }
}
function storeCompleteView(attemptId: string): void {
  try {
    window.sessionStorage.setItem(viewKey(attemptId), "complete");
  } catch {
    // Preference only; Back still works in memory.
  }
}

function focusAfterReturn(): void {
  requestAnimationFrame(() => {
    const target =
      document.querySelector<HTMLElement>("[data-eva-action]") ??
      document.querySelector<HTMLElement>("[data-sat-stage-heading]");
    target?.focus();
  });
}

function focusCompletionHeading(): void {
  requestAnimationFrame(() => {
    const heading =
      document.querySelector<HTMLElement>(
        "[data-sat-stage]:not([data-sat-stage-exiting]) [data-sat-stage-heading]"
      ) ?? document.querySelector<HTMLElement>("[data-sat-stage-heading]");
    heading?.focus({ preventScroll: true });
  });
}

export interface SatEvaCompletionGateProps {
  scheduleId: string;
  attemptId: string;
  /** True when SAT finalization recorded a recovery exception (keep its wording). */
  recoveryException: boolean;
  /** Renders SAT Complete with the Eva group slot (null: no Eva card). */
  renderComplete: (eva: ReactNode) => ReactNode;
}

export function SatEvaCompletionGate({ scheduleId, attemptId, recoveryException, renderComplete }: SatEvaCompletionGateProps) {
  const eva = useEvaSimState(scheduleId, attemptId);
  const [view, setView] = useState<View>(() => loadView(attemptId));
  const resolvedEvaAttempt = useRef<string | null>(null);
  const returnFocusPending = useRef(false);
  const state = eva.state;

  // A native form with no accepted response while open is mandatory; an open
  // embed opens by default until the student chooses Back.
  const forcedNative = state?.eligibility === "eligible" && state.mode === "native" && !state.canReturnToComplete;
  const autoEmbed = view === "auto" && state?.eligibility === "eligible" && state.mode === "embed" && state.collection === "open";
  if ((forcedNative || autoEmbed) && view !== "eva") setView("eva");

  useEffect(() => {
    if (!state || resolvedEvaAttempt.current === attemptId) return;
    resolvedEvaAttempt.current = attemptId;
    if (state.eligibility === "eligible" && (view === "eva" || forcedNative)) return;
    focusCompletionHeading();
  }, [attemptId, forcedNative, state, view]);

  // Restore only after the surviving completion controls have committed.
  useEffect(() => {
    if (view !== "complete" || forcedNative || !state || !returnFocusPending.current) return;
    returnFocusPending.current = false;
    focusAfterReturn();
  }, [view, forcedNative, state]);

  const backToComplete = () => {
    storeCompleteView(attemptId);
    returnFocusPending.current = true;
    setView("complete");
  };

  if (!state) {
    return (
      <EvaShell recoveryException={recoveryException}>
        {eva.isError ? (
          <div role="alert">
            <h2 className="text-[20px] font-semibold">Unable to load Eva SIM. Your SAT submission is recorded.</h2>
            <p className="mt-2 text-[14px] leading-6 text-[var(--sat-text-secondary)]">Try again, or ask your proctor for help.</p>
            <button type="button" className={`${PRIMARY} mt-5`} onClick={() => void eva.refetch()} disabled={eva.isFetching}>
              {eva.isFetching ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-2 text-[15px] text-[var(--sat-text-secondary)]">
            <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />
            Checking Eva SIM…
          </p>
        )}
      </EvaShell>
    );
  }

  if (state.eligibility !== "eligible") return <>{renderComplete(null)}</>;

  if (view === "eva" || forcedNative) {
    return (
      <EvaShell recoveryException={recoveryException} wide={state.mode === "embed"}>
        {state.mode === "native" ? (
          <NativeEvaView
            key={`${state.versionId}:${state.response}`}
            scheduleId={scheduleId}
            attemptId={attemptId}
            state={state}
            onAccepted={(ack) => {
              eva.applyAck(ack);
              returnFocusPending.current = true;
              setView("complete");
            }}
            onReload={async () => (await eva.refetch()).data}
            onConfirmed={() => {
              returnFocusPending.current = true;
              setView("complete");
            }}
            onBack={backToComplete}
          />
        ) : (
          <EmbedEvaView
            state={state}
            revalidationFailed={eva.isError}
            retrying={eva.isFetching}
            onRetry={() => void eva.refetch()}
            onBack={backToComplete}
          />
        )}
      </EvaShell>
    );
  }

  return (
    <>
      {renderComplete(
        <SatEvaStatusGroup
          state={state}
          onOpen={() => setView("eva")}
        />
      )}
    </>
  );
}

function EvaShell({ recoveryException, wide, children }: { recoveryException: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className="sat-ui min-h-[100dvh] bg-[var(--sat-background)] pl-[calc(1rem+var(--student-safe-left))] pr-[calc(1rem+var(--student-safe-right))] pt-[calc(2rem+var(--student-safe-top))] pb-[calc(3rem+var(--student-safe-bottom))] text-[var(--sat-text)] sm:pl-[calc(1.5rem+var(--student-safe-left))] sm:pr-[calc(1.5rem+var(--student-safe-right))]">
      <main className={`mx-auto w-full ${wide ? "max-w-[1120px]" : "max-w-[640px]"}`}>
        <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
        <p role="status" className="mt-2 flex items-start gap-2 rounded-xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-4 text-[15px] font-semibold">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--sat-success,var(--sat-accent-strong))]" aria-hidden="true" />
          {recoveryException ? "SAT submission confirmed with a recovery exception" : "SAT submission confirmed"}
        </p>
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

/** The one Eva status/action group on SAT Complete (completion-only and score report). */
export function SatEvaStatusGroup({ state, onOpen }: { state: Exclude<EvaState, { eligibility: "not_applicable" }>; onOpen: () => void }) {
  let status: string;
  let detail: string | null = null;
  let action: string | null = null;
  if (state.mode === "native") {
    const submitted = state.response === "submitted";
    const open = state.collection === "open";
    if (submitted && open) {
      status = "Eva SIM submitted";
      detail = formatTime(state.updatedAt) ? `Accepted ${formatTime(state.updatedAt)}` : null;
      action = "Edit Eva SIM";
    } else if (submitted) {
      status = "Eva SIM submitted · collection closed";
    } else if (!open) {
      status = "Eva SIM closed · not submitted";
    } else {
      status = "Eva SIM not submitted";
      action = "Open Eva SIM";
    }
  } else if (state.collection === "open" && state.canOpen) {
    status = "External Eva SIM · submission not tracked";
    action = "Open Eva SIM";
  } else {
    status = "Eva SIM access closed · submission not tracked";
  }
  return (
    <section aria-label="Eva SIM" className="mt-6 rounded-xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-4 text-left">
      <p className="text-[15px] font-semibold text-[var(--sat-text)]">{status}</p>
      {detail ? <p className="sat-tabular mt-1 text-[13px] text-[var(--sat-text-secondary)]">{detail}</p> : null}
      {action ? (
        <button type="button" data-eva-action="true" className={`${SECONDARY} mt-3`} onClick={onOpen}>
          {action}
        </button>
      ) : null}
    </section>
  );
}

function ClosedHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Closure removed the form or frame the student may have been using.
    const active = document.activeElement;
    if (!active || active === document.body || !document.contains(active)) ref.current?.focus();
  }, []);
  return (
    <h2 ref={ref} tabIndex={-1} data-eva-closed-heading="true" className="text-[22px] font-semibold tracking-tight focus-visible:outline-none">
      {children}
    </h2>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={SECONDARY} onClick={onClick}>
      <ArrowLeft size={16} aria-hidden="true" />
      Back to SAT Complete
    </button>
  );
}

// -------------------------------------------------------------------- native

type SubmitProblem =
  | { kind: "uncertain" }
  | { kind: "conflict"; message: string }
  | { kind: "message"; message: string };

function isUncertain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 429 || error.status >= 500 || error.category === "network";
}

function NativeEvaView({
  scheduleId,
  attemptId,
  state,
  onAccepted,
  onReload,
  onConfirmed,
  onBack,
}: {
  scheduleId: string;
  attemptId: string;
  state: NativeEvaState;
  onAccepted: (ack: EvaAck) => void;
  onReload: () => Promise<EvaState | undefined>;
  /** A status check found the unconfirmed write accepted. */
  onConfirmed: () => void;
  onBack: () => void;
}) {
  const formId = useId();
  // The accepted response this edit started from. Background polls never
  // move it: only an explicit reload does, so the revision check still
  // catches a write from another tab.
  const [base, setBase] = useState(() => ({ revision: state.revision, raw: rawFromAnswers(state.answers) }));
  const initial = base.raw;
  const [values, setValues] = useState<RawAnswers>(base.raw);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SubmitProblem | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The exact request of an unconfirmed write: retry replays it unchanged.
  const pending = useRef<SubmitEvaRequest | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const editing = state.response === "submitted";
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  if (state.collection === "closed") {
    return (
      <section aria-label="Eva SIM">
        <ClosedHeading>{editing ? "Eva SIM is closed." : "Eva SIM is closed. No response was submitted."}</ClosedHeading>
        {editing ? (
          <>
            <p className="mt-2 text-[14px] leading-6 text-[var(--sat-text-secondary)]">
              Your accepted response is shown below{formatTime(state.closedAt) ? `. Closed ${formatTime(state.closedAt)}` : ""}.
              {dirty ? " Unsent changes were not saved." : ""}
            </p>
            <div className="mt-5 rounded-xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-4">
              <AnswerList fields={state.fields} answers={state.answers} />
            </div>
          </>
        ) : null}
        <div className="mt-6">
          <BackButton onClick={onBack} />
        </div>
      </section>
    );
  }

  const send = async (request: SubmitEvaRequest) => {
    setBusy(true);
    setProblem(null);
    try {
      const ack = await assessmentDeliveryApi.submitEvaSim(scheduleId, attemptId, request);
      pending.current = null;
      onAccepted(ack);
    } catch (error) {
      const fieldErrors = serverFieldErrors(error);
      const reason = errorReason(error);
      if (fieldErrors) {
        pending.current = null;
        setErrors(fieldErrors);
        if (formRef.current) focusFirstInvalid(formRef.current);
      } else if (reason === FORM_REASONS.responseChanged || reason === FORM_REASONS.versionChanged) {
        pending.current = null;
        setProblem({ kind: "conflict", message: "This response changed in another tab. Load the latest response before editing." });
      } else if (reason === FORM_REASONS.evaClosed) {
        pending.current = null;
        void onReload();
      } else if (isUncertain(error)) {
        setProblem({ kind: "uncertain" });
      } else {
        pending.current = null;
        setProblem({ kind: "message", message: error instanceof Error ? error.message : "Eva SIM could not be saved." });
      }
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = async () => {
    const fresh = await onReload().catch(() => undefined);
    if (fresh?.eligibility !== "eligible" || fresh.mode !== "native") return;
    const raw = rawFromAnswers(fresh.answers);
    setBase({ revision: fresh.revision, raw });
    setValues(raw);
    setErrors({});
    setProblem(null);
  };

  const checkStatus = async () => {
    const sent = pending.current;
    const fresh = await onReload().catch(() => undefined);
    if (!sent || fresh?.eligibility !== "eligible" || fresh.mode !== "native") return;
    // Our write landed only if the accepted answers are exactly what we sent;
    // another tab's newer write stays a conflict for the next save.
    if (fresh.response === "submitted" && fresh.revision > sent.expectedRevision && sameAnswers(fresh.answers, sent.answers)) {
      pending.current = null;
      onConfirmed();
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const { answers, errors: found } = buildAnswers(state.fields, values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(event.currentTarget);
      return;
    }
    pending.current = {
      operationId: globalThis.crypto.randomUUID(),
      expectedRevision: base.revision,
      versionId: state.versionId,
      answers,
    };
    void send(pending.current);
  };

  const label = editing ? "Save changes" : "Submit Eva SIM";
  return (
    <section aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="text-[24px] font-semibold tracking-tight">
        Eva SIM
      </h2>
      <p className="mt-2 text-[15px] leading-6 text-[var(--sat-text-secondary)]">
        {editing
          ? "You can edit your response until your proctor ends the exam."
          : "Submit Eva SIM to continue. You can edit your response until your proctor ends the exam."}
      </p>
      {problem ? (
        <div role="alert" className="mt-4 rounded-xl border border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] p-4 text-[14px] leading-6">
          <p className="flex items-start gap-2 font-semibold">
            <AlertCircle size={16} className="mt-1 shrink-0" aria-hidden="true" />
            {problem.kind === "uncertain" ? "Unable to confirm your submission. Check status or retry." : problem.message}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {problem.kind === "uncertain" ? (
              <>
                <button type="button" className={PRIMARY} disabled={busy} onClick={() => pending.current && void send(pending.current)}>
                  Retry
                </button>
                <button type="button" className={SECONDARY} disabled={busy} onClick={() => void checkStatus()}>
                  Check status
                </button>
              </>
            ) : problem.kind === "conflict" ? (
              <button type="button" className={SECONDARY} onClick={() => void loadLatest()}>
                Load latest response
              </button>
            ) : null}
          </div>
          {problem.kind === "conflict" && dirty ? (
            <p className="mt-2 text-[13px]">Loading the latest response discards your unsent changes.</p>
          ) : null}
        </div>
      ) : null}
      <form ref={formRef} onSubmit={submit} noValidate className="mt-6 space-y-6">
        <FormFields
          fields={state.fields}
          values={values}
          errors={errors}
          onChange={(id, value) => {
            setValues((prev) => ({ ...prev, [id]: value }));
            setErrors((prev) => {
              if (!prev[id]) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }}
          disabled={busy}
          idPrefix="eva-sim"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={PRIMARY} disabled={busy} aria-busy={busy || undefined}>
            {label}
            {busy ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          </button>
          {state.canReturnToComplete ? (
            <BackButton onClick={() => (dirty ? setConfirmDiscard(true) : onBack())} />
          ) : null}
        </div>
        {!state.canReturnToComplete ? (
          <p className="text-[13px] leading-5 text-[var(--sat-text-secondary)]">
            SAT Complete opens after your Eva SIM response is accepted.
          </p>
        ) : null}
      </form>
      <SatCenterModal
        open={confirmDiscard}
        title="Discard unsent changes?"
        closeLabel="Keep editing"
        onClose={() => setConfirmDiscard(false)}
        layer="breakConfirm"
        description="Your accepted Eva SIM response stays unchanged."
      >
        <div className="px-5 py-5 sm:px-7">
          <p className="text-[15px] leading-7">Your accepted Eva SIM response stays unchanged.</p>
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            <button type="button" className={SECONDARY} onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </button>
            <button
              type="button"
              className={PRIMARY}
              onClick={() => {
                setConfirmDiscard(false);
                onBack();
              }}
            >
              Discard changes
            </button>
          </div>
        </div>
      </SatCenterModal>
    </section>
  );
}

function sameAnswers(a: Record<string, string | number> | null | undefined, b: Record<string, string | number>): boolean {
  const left = a ?? {};
  const keys = Object.keys(b);
  return Object.keys(left).length === keys.length && keys.every((key) => left[key] === b[key]);
}

function focusFirstInvalid(form: HTMLFormElement): void {
  requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

// --------------------------------------------------------------------- embed

function EmbedEvaView({
  state,
  revalidationFailed,
  retrying,
  onRetry,
  onBack,
}: {
  state: EmbedEvaState;
  revalidationFailed: boolean;
  retrying: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(timer);
  }, []);

  const open = state.collection === "open" && state.canOpen && Boolean(state.embedUrl);
  if (!open) {
    return (
      <section aria-label="Eva SIM">
        <ClosedHeading>Eva SIM access is closed here. External submission is not tracked.</ClosedHeading>
        <div className="mt-6">
          <BackButton onClick={onBack} />
        </div>
      </section>
    );
  }
  if (revalidationFailed) {
    return (
      <section aria-label="Eva SIM">
        <h2 tabIndex={-1} className="text-[20px] font-semibold" role="alert">
          Unable to check Eva SIM access. Try again.
        </h2>
        <div className="mt-5 flex flex-wrap gap-3">
          <BackButton onClick={onBack} />
          <button type="button" className={PRIMARY} onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="eva-embed-title">
      <h2 id="eva-embed-title" className="text-[24px] font-semibold tracking-tight">
        Eva SIM
      </h2>
      <p className="mt-2 text-[15px] leading-6 text-[var(--sat-text-secondary)] [overflow-wrap:anywhere]">
        Complete the form below. Responses are collected by <span className="font-semibold text-[var(--sat-text)]">{state.embedHost}</span>.
        This SAT system does not track submission of this external form.
      </p>
      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <BackButton onClick={onBack} />
        {state.externalOpenUrl ? (
          <a href={state.externalOpenUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
            Open form in new tab
            <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
      <EvaEmbedFrame
        src={state.embedUrl ?? ""}
        host={state.embedHost}
        className="mt-4 block h-[75dvh] min-h-[480px] w-full rounded-xl border border-[var(--sat-divider)] bg-white"
      />
      <p className="mt-3 text-[13px] leading-5 text-[var(--sat-text-secondary)]" aria-live="polite">
        {slow ? "If the form is blank or unavailable, open it in a new tab." : ""}
      </p>
    </section>
  );
}
