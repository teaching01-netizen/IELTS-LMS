import { useId, type ReactNode } from "react";
import { AlertCircle, Loader2, TriangleAlert } from "lucide-react";

/* Check-in controls. Label above, field, error below. No helper prose: the
 * labels are the instructions. */

export interface PreExamFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | undefined;
  error?: string | undefined;
  placeholder?: string | undefined;
  autoComplete?: string | undefined;
  autoCapitalize?: "none" | "sentences" | "words" | "characters" | undefined;
  inputMode?: "text" | "email" | "numeric" | "tel" | undefined;
  maxLength?: number | undefined;
  disabled?: boolean | undefined;
  onBlur?: (() => void) | undefined;
  /** Codes are read back to a proctor, so they get the mono treatment. */
  code?: boolean | undefined;
}

export function PreExamField({
  id,
  label,
  value,
  onChange,
  type = "text",
  error,
  placeholder,
  autoComplete,
  autoCapitalize,
  inputMode,
  maxLength,
  disabled,
  onBlur,
  code = false,
}: PreExamFieldProps) {
  const generated = useId();
  const errorId = `${id}-${generated}-error`;
  const describedBy = error ? errorId : undefined;

  const borderClass = error
    ? "border-[var(--exam-danger)] focus:border-[var(--exam-danger)] focus:shadow-[0_0_0_3px_rgba(180,35,24,0.14)]"
    : "border-[var(--exam-control-border)] hover:border-[var(--exam-control-border-hover)] focus:border-[var(--exam-accent)] focus:shadow-[0_0_0_3px_rgba(218,41,28,0.14)]";

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium leading-5 text-[var(--exam-ink)]"
      >
        {label}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...(onBlur ? { onBlur } : {})}
          {...(placeholder ? { placeholder } : {})}
          {...(autoComplete ? { autoComplete } : {})}
          {...(autoCapitalize ? { autoCapitalize } : {})}
          {...(inputMode ? { inputMode } : {})}
          {...(maxLength !== undefined ? { maxLength } : {})}
          disabled={disabled}
          autoCorrect={code || type === "email" ? "off" : undefined}
          spellCheck={code || type === "email" ? false : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[
            "mt-1.5 h-11 w-full rounded-lg border bg-white px-3 text-[15px] leading-6 text-[var(--exam-ink)]",
            "placeholder:text-[var(--exam-ink-muted)]",
            "transition-[border-color,box-shadow] duration-150 ease-out",
            "focus:outline-none disabled:cursor-not-allowed disabled:bg-[var(--exam-canvas)] disabled:text-[var(--exam-ink-muted)]",
            code ? "font-mono tracking-[0.1em]" : "",
            borderClass,
          ]
            .filter(Boolean)
            .join(" ")}
        />
      </label>
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-5 text-[var(--exam-danger)]"
        >
          <AlertCircle size={14} aria-hidden="true" className="mt-[3px] shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface PreExamSubmitProps {
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  children: ReactNode;
}

export function PreExamSubmit({ busy = false, disabled = false, children }: PreExamSubmitProps) {
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--exam-accent)] px-4 text-[15px] font-medium text-white transition-colors duration-150 ease-out hover:bg-[var(--exam-accent-hover)] active:bg-[var(--exam-accent-pressed)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--exam-focus)] disabled:cursor-not-allowed disabled:bg-[#f4f4f5] disabled:text-[#6b6b73]"
    >
      {busy ? <Loader2 size={15} aria-hidden="true" className="motion-safe:animate-spin" /> : null}
      <span>{children}</span>
    </button>
  );
}

export type PreExamNoticeTone = "info" | "warning" | "danger";

const NOTICE_STYLES: Record<PreExamNoticeTone, { box: string; icon: string }> = {
  info: {
    box: "border-[#f4c9c3] bg-[var(--exam-accent-soft)] text-[var(--exam-ink)]",
    icon: "text-[var(--exam-accent-strong)]",
  },
  warning: {
    box: "border-[#f3d9a4] bg-[var(--exam-attention-soft)] text-[var(--exam-ink)]",
    icon: "text-[var(--exam-attention)]",
  },
  danger: {
    box: "border-[#f1c6c1] bg-[var(--exam-danger-soft)] text-[var(--exam-ink)]",
    icon: "text-[var(--exam-danger)]",
  },
};

export interface PreExamNoticeProps {
  tone: PreExamNoticeTone;
  title?: string | undefined;
  icon?: ReactNode | undefined;
  children?: ReactNode;
  actions?: ReactNode | undefined;
}

export function PreExamNotice({ tone, title, icon, children, actions }: PreExamNoticeProps) {
  const styles = NOTICE_STYLES[tone];
  const fallbackIcon =
    tone === "danger" ? (
      <AlertCircle size={16} aria-hidden="true" />
    ) : tone === "warning" ? (
      <TriangleAlert size={16} aria-hidden="true" />
    ) : null;

  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      aria-live={tone === "danger" ? undefined : "polite"}
      className={`rounded-lg border px-3.5 py-3 text-[13px] leading-5 ${styles.box}`}
    >
      <div className="flex items-start gap-2.5">
        {icon || fallbackIcon ? (
          <span className={`mt-px shrink-0 ${styles.icon}`}>{icon ?? fallbackIcon}</span>
        ) : null}
        <div className="min-w-0 flex-1">
          {title ? <p className="font-medium text-[var(--exam-ink)]">{title}</p> : null}
          {children ? (
            <div
              className={
                title
                  ? "mt-0.5 text-[var(--exam-ink-secondary)]"
                  : "text-[var(--exam-ink-secondary)]"
              }
            >
              {children}
            </div>
          ) : null}
          {actions ? (
            <div className="-mb-1 mt-1.5 flex flex-wrap items-center gap-4">{actions}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PreExamNoticeAction({
  onClick,
  emphasis = false,
  children,
}: {
  onClick: () => void;
  emphasis?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center text-[13px] font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--exam-focus)] ${
        emphasis ? "text-[var(--exam-accent-strong)]" : "text-[var(--exam-ink-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}
