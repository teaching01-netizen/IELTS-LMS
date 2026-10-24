import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";
import type { SatStartPolicy } from "../../contracts/assessmentDelivery";
import type { SatStartCodeRefusal } from "../../application/satStartCode";

export interface SatStartCodeScreenProps {
  policy: Extract<SatStartPolicy, { mode: "access_code" }>;
  submitting: boolean;
  onSubmit: (code: string) => Promise<{ ok: boolean; refusal: SatStartCodeRefusal | null }>;
  onExit: () => void;
  /** Secondary, non-exam action (e.g. allowing a pre-start device change). */
  footer?: ReactNode;
}

function formatWindowTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The SAT access-code start surface: one field, one explicit submission.
 *
 * Typing the sixth digit never submits — the candidate presses "Enter code and
 * begin exam" (or Enter). The value is validated after trimming and is never
 * silently stripped of letters or separators; it stays in memory only and is
 * gone once the exam opens (this surface unmounts) or the candidate exits.
 */
export function SatStartCodeScreen({ policy, submitting, onSubmit, onExit, footer = null }: SatStartCodeScreenProps) {
  const inputId = useId();
  const messageId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (cooldownUntil === null) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= cooldownUntil) setCooldownUntil(null);
    }, 500);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const cooldownSeconds = cooldownUntil === null ? 0 : Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const opensAt = formatWindowTime(policy.opensAt);
  const closesAt = formatWindowTime(policy.closesAt);

  if (policy.state === "closed") {
    return (
      <SatPresenceSurface className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-center text-[var(--sat-text)]">
        <main className="w-full max-w-lg py-10">
          <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
          <h1
            data-sat-stage-heading="true"
            tabIndex={-1}
            className="mt-3 text-2xl font-semibold tracking-tight"
          >
            The start window has closed
          </h1>
          <p className="mt-3 sat-type-control-primary leading-6 text-[var(--sat-text-secondary)]" role="status">
            This exam can no longer be started. If you think this is a mistake, ask your proctor for help.
          </p>
          <button
            type="button"
            className="sat-touch-target sat-pressable mt-6 rounded-full bg-[var(--sat-text)] px-6 text-[14px] font-semibold text-[var(--sat-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            onClick={onExit}
          >
            Exit
          </button>
        </main>
      </SatPresenceSurface>
    );
  }

  const blockedMessage =
    policy.blockedReason === "not_open"
      ? opensAt ? `This exam opens ${opensAt}. You can enter the code then.` : "This exam is not open yet."
      : policy.blockedReason === "paused"
        ? "Starting is paused right now. Wait for your proctor."
        : policy.blockedReason === "revoked"
          ? "This exam is no longer available. Ask your proctor for help."
          : null;
  const disabled = submitting || cooldownSeconds > 0 || blockedMessage !== null;
  const shownMessage = cooldownSeconds > 0
    ? `${message ?? "Too many start code attempts."} You can try again in ${cooldownSeconds} s.`
    : message;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    setMessage(null);
    const outcome = await onSubmit(code);
    if (outcome.ok || !outcome.refusal) return;
    setMessage(outcome.refusal.message);
    if (outcome.refusal.retryAfterSeconds) {
      const until = Date.now() + outcome.refusal.retryAfterSeconds * 1000;
      setNow(Date.now());
      setCooldownUntil(until);
    }
    // Keep the typed value for correction; return focus to the field.
    inputRef.current?.focus();
  };

  return (
    <SatPresenceSurface className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-[var(--sat-text)]">
      <main className="w-full max-w-md py-10">
        <p className="sat-type-control-secondary text-center font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
        <h1
          data-sat-stage-heading="true"
          tabIndex={-1}
          className="mt-3 text-center text-2xl font-semibold tracking-tight"
        >
          Enter your exam start code
        </h1>
        <p className="mt-3 text-center sat-type-control-primary leading-6 text-[var(--sat-text-secondary)]">
          Your timer starts when your exam opens; it does not run while your start is being checked.
          {closesAt ? ` New starts close ${closesAt}.` : ""}
        </p>
        <form className="mt-8 grid gap-3" onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor={inputId} className="sat-type-control-primary font-semibold">
            6-digit exam start code
          </label>
          <input
            ref={inputRef}
            id={inputId}
            name="examStartCode"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            value={code}
            disabled={submitting}
            onChange={(event) => {
              setCode(event.target.value);
              if (message && cooldownSeconds === 0) setMessage(null);
            }}
            aria-invalid={message !== null && cooldownSeconds === 0 ? true : undefined}
            aria-describedby={shownMessage || blockedMessage ? messageId : undefined}
            className="min-h-12 rounded-lg border border-[var(--sat-divider-strong)] bg-[var(--sat-surface)] px-4 text-center font-mono text-2xl tracking-[0.4em] text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] aria-[invalid=true]:border-[var(--sat-danger)]"
          />
          <p
            id={messageId}
            role={shownMessage ? "alert" : "status"}
            aria-live="polite"
            className={`min-h-6 sat-type-control-secondary ${shownMessage ? "text-[var(--sat-danger)]" : "text-[var(--sat-text-secondary)]"}`}
          >
            {shownMessage ?? blockedMessage ?? ""}
          </p>
          <button
            type="submit"
            disabled={disabled}
            aria-busy={submitting || undefined}
            className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:bg-[var(--sat-surface-subtle)] disabled:text-[var(--sat-disabled-text)]"
          >
            {submitting ? "Starting your exam…" : "Enter code and begin exam"}
          </button>
        </form>
        {footer}
      </main>
    </SatPresenceSurface>
  );
}
