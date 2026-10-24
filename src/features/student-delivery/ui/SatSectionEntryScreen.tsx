import { ApiError } from "@/src/shared/api-client/errors";
import { useRef, useState, type ReactNode } from "react";
import {
  buildAnswers,
  FormFields,
  rawFromAnswers,
  serverFieldErrors,
  type RawAnswers,
  type SectionEntryState,
  type SittingSection,
} from "@/src/features/assessment-forms/api/assessmentForms";
import { assessmentDeliveryApi } from "../api/assessmentDeliveryApi";

export function SatSectionEntryScreen({
  scheduleId,
  attemptId,
  sectionKey,
  state,
  loading,
  error,
  onRefresh,
  footer,
}: {
  scheduleId: string;
  attemptId: string;
  sectionKey?: SittingSection | undefined;
  state: SectionEntryState | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<unknown>;
  footer?: ReactNode;
}) {
  const [values, setValues] = useState<RawAnswers>(() => rawFromAnswers(state?.answers));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const pending = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const title = (state?.sectionKey ?? sectionKey) === "math" ? "Before Math" : "Before Verbal";
  const closed = state?.state === "closed";
  const submit = async () => {
    if (!state?.canSubmit || submitting || accepted) return;
    const result = buildAnswers(state.fields ?? [], values);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    const fingerprint = JSON.stringify([state.versionId, state.sectionKey, result.answers]);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, operationId: crypto.randomUUID() };
    setSubmitting(true);
    setFailure(null);
    try {
      await assessmentDeliveryApi.submitSectionEntry(scheduleId, attemptId, state.sectionKey, {
        operationId: pending.current.operationId,
        versionId: state.versionId,
        answers: result.answers,
      });
      setAccepted(true);
      await onRefresh();
    } catch (error) {
      const fields = serverFieldErrors(error);
      setErrors(fields ?? {});
      const definitive =
        fields !== null || (error instanceof ApiError && error.status >= 400 && error.status < 500);
      setUncertain(!definitive);
      if (definitive) pending.current = null;
      setFailure(
        error instanceof Error
          ? error.message
          : "Your form could not be submitted. Retry to confirm it."
      );
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      );
      // Discover a committed submission after a lost acknowledgement.
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-5 py-10 text-[var(--sat-text)]">
      <main className="w-full max-w-xl rounded-2xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-6 sm:p-8">
        <h1 data-sat-stage-heading tabIndex={-1} className="text-2xl font-semibold">
          {closed ? "This section is closed" : title}
        </h1>
        <p className="mt-3 text-[15px] leading-6 text-[var(--sat-text-secondary)]">
          {closed
            ? "Staff have ended this sitting. No further answers can be submitted."
            : "Complete these details before starting your section. Filling this form does not use your exam time. Answers cannot be changed after submission."}
        </p>
        {loading ? (
          <p role="status" className="mt-5">
            Loading section details…
          </p>
        ) : null}
        {error || failure ? (
          <div role="alert" className="mt-5 text-[var(--sat-danger)]">
            <p>{error || failure}</p>
            <button
              type="button"
              className="sat-btn sat-btn--secondary mt-3"
              onClick={() => void onRefresh()}
            >
              Check status
            </button>
          </div>
        ) : null}
        {state?.state === "required" ? (
          <form
            ref={form}
            className="mt-6"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <FormFields
              fields={state.fields ?? []}
              values={values}
              errors={errors}
              disabled={submitting || accepted || uncertain || !state.canSubmit}
              idPrefix={`section-${state.sectionKey}`}
              onChange={(id, value) => setValues((previous) => ({ ...previous, [id]: value }))}
            />
            {accepted ? (
              <p role="status" className="mt-4">
                Section details submitted. Checking entry status…
              </p>
            ) : null}
            {uncertain ? (
              <p role="status" className="mt-4">
                Submission is unconfirmed. Check status or retry the same answers before making
                changes.
              </p>
            ) : null}
            {!state.canSubmit ? (
              <p role="status" className="mt-4">
                Your sitting is paused. Wait for staff to continue.
              </p>
            ) : null}
            <button
              type="submit"
              className="sat-btn sat-btn--primary mt-6 min-h-12 w-full"
              disabled={submitting || accepted || !state.canSubmit}
              aria-busy={submitting}
            >
              {accepted
                ? "Submitted"
                : submitting
                  ? "Submitting…"
                  : uncertain
                    ? "Retry submission"
                    : "Submit and continue"}
            </button>
          </form>
        ) : null}
        {state?.state === "waiting" ? (
          <p role="status" className="mt-5">
            Waiting for the section to become available.
          </p>
        ) : null}
        {footer ? <div className="mt-6">{footer}</div> : null}
      </main>
    </div>
  );
}
