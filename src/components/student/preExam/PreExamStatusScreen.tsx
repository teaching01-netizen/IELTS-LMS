import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PreExamPage } from "./PreExamPage";

/* Terminal entry states: closed, unreachable, or still checking. One card,
 * one sentence, one action. */
export interface PreExamStatusScreenProps {
  /** Provider badge in the header. IELTS by default. */
  examBadge?: string | undefined;
  title: string;
  description: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  busy?: boolean | undefined;
}

export function PreExamStatusScreen({
  examBadge = "IELTS",
  title,
  description,
  actionLabel,
  onAction,
  busy = false,
}: PreExamStatusScreenProps) {
  // A live region present at mount is not reliably announced. Fill it one
  // frame later so a screen reader hears why the form is gone.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnnouncement(`${title}. ${description}`));
    return () => cancelAnimationFrame(frame);
  }, [title, description]);

  return (
    <PreExamPage examBadge={examBadge}>
      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-5 pb-[calc(2rem+var(--student-safe-bottom))] pt-10 sm:px-6">
        <div className="rounded-xl border border-[var(--exam-hairline)] bg-[var(--exam-surface)] p-6 shadow-[0_1px_2px_rgba(24,24,27,0.04)] sm:p-7">
          <div className="flex items-center gap-2">
            {busy ? (
              <Loader2
                size={16}
                aria-hidden="true"
                className="shrink-0 text-[var(--exam-ink-muted)] motion-safe:animate-spin"
              />
            ) : null}
            <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-[var(--exam-ink)]">
              {title}
            </h1>
          </div>
          <p className="mt-2 text-[14px] leading-6 text-[var(--exam-ink-secondary)]">
            {description}
          </p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="mt-5 h-11 w-full rounded-lg bg-[var(--exam-accent)] px-4 text-[15px] font-medium text-white transition-colors duration-150 ease-out hover:bg-[var(--exam-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--exam-focus)]"
            >
              {actionLabel}
            </button>
          ) : null}
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>
      </main>
    </PreExamPage>
  );
}
