import type { ButtonHTMLAttributes, HTMLInputTypeAttribute, ReactNode } from "react";
import { AlertCircle, ArrowRight, Info, LoaderCircle } from "lucide-react";

/* Form controls for the SAT entry portal. Same tokens as the exam surface:
 * royal accent for the one primary action, hairline borders for structure,
 * no shadows. Labels sit above fields (never placeholder-as-label), and every
 * field's error is wired to it with aria-describedby. */

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sat-surface)]";

/** Moves focus to the first field flagged invalid once its error has rendered. */
export function focusFirstInvalidField(form: HTMLFormElement): void {
  requestAnimationFrame(() => {
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

export interface SatEntryFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  type?: HTMLInputTypeAttribute | undefined;
  autoComplete?: string | undefined;
  /** Student IDs/WCODEs are typed from memory or a slip of paper: no autocorrect, wider tracking. */
  code?: boolean | undefined;
}

export function SatEntryField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  disabled,
  placeholder,
  type = "text",
  autoComplete,
  code,
}: SatEntryFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className="block text-[14px] font-semibold text-[var(--sat-text)]">
        {label}
        <input
          id={id}
          aria-label={label}
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize={code || type === "email" ? "off" : undefined}
          autoCorrect={code || type === "email" ? "off" : undefined}
          spellCheck={code || type === "email" ? false : undefined}
          inputMode={type === "email" ? "email" : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={`mt-2 block min-h-12 w-full rounded-lg border bg-[var(--sat-surface)] px-3.5 text-[length:var(--sat-type-input)] leading-6 text-[var(--sat-text)] font-normal placeholder:text-[var(--sat-text-secondary)]/60 hover:border-[var(--sat-divider-strong)] focus-visible:border-[var(--sat-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] ${
            error ? "border-[var(--sat-danger)]" : "border-[var(--sat-answer-border)]"
          } ${code ? "sat-tabular tracking-[0.06em]" : ""}`}
        />
      </label>
      {error ? (
        <p
          id={errorId}
          className="mt-2 flex items-start gap-1.5 text-[13px] font-medium leading-5 text-[var(--sat-danger)]"
        >
          <AlertCircle size={14} className="mt-[3px] shrink-0" />
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="mt-2 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type SatEntryButtonVariant = "primary" | "secondary" | "link";

const BUTTON_VARIANT: Record<SatEntryButtonVariant, string> = {
  primary:
    "rounded-full bg-[var(--sat-accent)] px-6 text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-hover)] active:bg-[var(--sat-accent-pressed)] disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]",
  secondary:
    "rounded-full border border-[var(--sat-divider-strong)] bg-[var(--sat-surface)] px-5 text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:border-transparent disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]",
  link: "rounded-md px-1 text-[var(--sat-accent-strong)] underline underline-offset-2 hover:text-[var(--sat-accent-pressed)] disabled:text-[var(--sat-disabled-text)]",
};

export function SatEntryButton({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: SatEntryButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`sat-touch-target sat-pressable inline-flex items-center justify-center gap-2 text-[15px] font-semibold disabled:cursor-not-allowed ${FOCUS_RING} ${BUTTON_VARIANT[variant]} ${className}`}
    />
  );
}

/** The form's one primary action: full width, with the busy state built in. */
export function SatEntrySubmit({
  busy,
  disabled,
  children,
}: {
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <SatEntryButton
      type="submit"
      disabled={disabled}
      aria-busy={busy || undefined}
      className="mt-2 min-h-12 w-full"
    >
      {children}
      {busy ? (
        <LoaderCircle size={16} className="motion-safe:animate-spin" />
      ) : (
        <ArrowRight size={16} />
      )}
    </SatEntryButton>
  );
}

const NOTICE_TONE = {
  error: "border-[var(--sat-danger)] bg-[var(--sat-danger-soft)] text-[var(--sat-danger)]",
  warning: "border-[var(--sat-warning)] bg-[var(--sat-warning-soft)] text-[var(--sat-warning)]",
  info: "border-[var(--sat-accent)] bg-[var(--sat-accent-soft)] text-[var(--sat-accent-strong)]",
} as const;

/** Inline status in the card. Errors interrupt; everything else waits its turn. */
export function SatEntryNotice({
  tone,
  title,
  icon,
  actions,
  children,
}: {
  tone: keyof typeof NOTICE_TONE;
  title?: string | undefined;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`mb-5 flex items-start gap-3 rounded-lg border p-3.5 ${NOTICE_TONE[tone]}`}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {icon ?? (tone === "info" ? <Info size={18} /> : <AlertCircle size={18} />)}
      </span>
      <div className="min-w-0 flex-1 text-[14px] leading-5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <p className={`${title ? "mt-1 " : "font-medium "}text-[var(--sat-text)]`}>{children}</p>
        ) : null}
        {actions ? <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
