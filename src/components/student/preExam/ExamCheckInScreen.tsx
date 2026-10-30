import { useId, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { PreExamPage } from "./PreExamPage";
import {
  PreExamField,
  PreExamNotice,
  PreExamNoticeAction,
  PreExamSubmit,
} from "./PreExamFormControls";

/* The candidate check-in form.
 *
 * Requirements are unchanged: WCode, email, full name, nickname (50-char
 * limit) and the course are mandatory, the email is validated against the
 * shared schema, and queue retries keep the submitted payload. IELTS calls the
 * access code a WCode. */

export interface ExamCheckInValues {
  wcode: string;
  email: string;
  studentName: string;
  nickname: string;
  ieltsCourse: string;
}

export type ExamCheckInField = keyof ExamCheckInValues;
export type ExamCheckInErrors = Partial<Record<ExamCheckInField, string>>;

export interface ExamCheckInQueueFailure {
  message: string;
  attempts: number;
}

export interface ExamCheckInQueueState {
  active: boolean;
  etaSeconds: number;
  failure: ExamCheckInQueueFailure | null;
}

export interface ExamCheckInScreenProps {
  /** Provider badge in the header. IELTS unless an ACT schedule is known. */
  examBadge?: string | undefined;
  values: ExamCheckInValues;
  errors: ExamCheckInErrors;
  onChange: (field: ExamCheckInField, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEmailBlur?: (() => void) | undefined;
  isLoading: boolean;
  queue: ExamCheckInQueueState;
  onRetryQueue: () => void;
  onLeaveQueue: () => void;
  submitError: string | null;
  courseLabel: string;
}

export function ExamCheckInScreen({
  examBadge = "IELTS",
  values,
  errors,
  onChange,
  onSubmit,
  onEmailBlur,
  isLoading,
  queue,
  onRetryQueue,
  onLeaveQueue,
  submitError,
  courseLabel,
}: ExamCheckInScreenProps) {
  const titleId = useId();
  const locked = isLoading || queue.active;

  return (
    <PreExamPage examBadge={examBadge}>
      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pb-[calc(2rem+var(--student-safe-bottom))] pt-10 sm:px-6 sm:pt-16">
        <form
          aria-labelledby={titleId}
          onSubmit={onSubmit}
          noValidate
          className="rounded-xl border border-[var(--exam-hairline)] bg-[var(--exam-surface)] p-6 shadow-[0_1px_2px_rgba(24,24,27,0.04)] sm:p-7"
        >
          <h1
            id={titleId}
            className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-[var(--exam-ink)]"
          >
            Exam Check-in
          </h1>

          <div className="mt-5 space-y-4">
            {submitError ? <PreExamNotice tone="danger">{submitError}</PreExamNotice> : null}

            {queue.active ? (
              <PreExamNotice
                tone="info"
                icon={
                  <RefreshCw
                    size={16}
                    aria-hidden="true"
                    className="motion-safe:animate-spin motion-reduce:animate-none"
                  />
                }
                title={`High traffic; retrying in ${queue.etaSeconds} seconds.`}
                actions={
                  <PreExamNoticeAction onClick={onLeaveQueue}>Leave and edit</PreExamNoticeAction>
                }
              />
            ) : null}

            {queue.failure ? (
              <PreExamNotice
                tone="warning"
                title={`Retry failed after ${queue.failure.attempts} ${
                  queue.failure.attempts === 1 ? "attempt" : "attempts"
                }`}
                actions={
                  <>
                    <PreExamNoticeAction emphasis onClick={onRetryQueue}>
                      Retry
                    </PreExamNoticeAction>
                    <PreExamNoticeAction onClick={onLeaveQueue}>Leave and edit</PreExamNoticeAction>
                  </>
                }
              >
                {queue.failure.message}
              </PreExamNotice>
            ) : null}

            <PreExamField
              id="wcode"
              label="WCode"
              code
              value={values.wcode}
              onChange={(value) => onChange("wcode", value)}
              error={errors.wcode}
              placeholder="W250334"
              autoComplete="off"
              autoCapitalize="characters"
              disabled={locked}
            />

            <PreExamField
              id="email"
              label="Email"
              type="email"
              value={values.email}
              onChange={(value) => onChange("email", value)}
              {...(onEmailBlur ? { onBlur: onEmailBlur } : {})}
              error={errors.email}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
              disabled={locked}
            />

            <PreExamField
              id="studentName"
              label="Full name"
              value={values.studentName}
              onChange={(value) => onChange("studentName", value)}
              error={errors.studentName}
              autoComplete="name"
              disabled={locked}
            />

            <PreExamField
              id="nickname"
              label="Nickname"
              value={values.nickname}
              onChange={(value) => onChange("nickname", value)}
              error={errors.nickname}
              autoComplete="nickname"
              maxLength={50}
              disabled={locked}
            />

            <PreExamField
              id="ieltsCourse"
              label={courseLabel}
              value={values.ieltsCourse}
              onChange={(value) => onChange("ieltsCourse", value)}
              error={errors.ieltsCourse}
              autoComplete="off"
              disabled={locked}
            />

            <div className="pt-1">
              <PreExamSubmit busy={locked}>
                {queue.active ? "Waiting for admission…" : isLoading ? "Checking in…" : "Continue"}
              </PreExamSubmit>
            </div>
          </div>
        </form>
      </main>
    </PreExamPage>
  );
}
