import { sanitizeSatStudentResponseInput } from "../../../exam-authoring/api/renderingPublic";

export interface SatStudentProducedAnswerProps {
  questionId: string;
  value?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function SatStudentProducedAnswer({
  questionId,
  value = "",
  disabled,
  onChange,
}: SatStudentProducedAnswerProps) {
  const inputId = `sat-spr-${questionId}`;
  const helpId = `${inputId}-help`;
  return (
    <div className="max-w-md border-t border-[var(--sat-divider-soft)] pt-5">
      <label
        htmlFor={inputId}
        className="block sat-type-control-secondary font-semibold text-[var(--sat-text)]"
      >
        <span>Enter your answer</span>
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(sanitizeSatStudentResponseInput(event.target.value))}
          disabled={disabled}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          maxLength={6}
          aria-label="Enter your answer"
          aria-describedby={helpId}
          className="sat-tabular mt-2 h-12 w-full rounded-[6px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-3 sat-type-input font-medium text-[var(--sat-text)] outline-none focus:border-[var(--sat-accent)] focus:ring-2 focus:ring-[var(--sat-focus)]/25 disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]"
        />
      </label>
      <p
        id={helpId}
        className="sat-reading-copy mt-2 sat-type-metadata text-[var(--sat-text-secondary)]"
      >
        Use an integer, decimal, or fraction. Up to 5 characters, or 6 with a leading minus sign.
      </p>
    </div>
  );
}
