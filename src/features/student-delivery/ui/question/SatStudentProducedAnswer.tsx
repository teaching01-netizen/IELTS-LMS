/* eslint-disable jsx-a11y/control-has-associated-label -- wrapping label + htmlFor double-associates the input; the rule misreads the nested-input pattern (same as the pre-existing notes/annotation editors). */
import { useId, useState } from "react";
import {
  sanitizeSatStudentResponseInput,
  validateSatStudentResponse,
} from "../../../exam-authoring/api/renderingPublic";

export interface SatStudentProducedAnswerProps {
  questionId: string;
  value?: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** Flush the latest local draft when the student leaves the answer field. */
  onBlur?: (() => void) | undefined;
}

/**
 * Student-produced response input (Phase 6a: validate-then-announce).
 *
 * Typing stays forgiving (sanitize-only on change — never error mid-key).
 * Validation runs on BLUR against the committed draft and announces through
 * a single describedby chain: format help + error (role=alert when present).
 * Single label source: the wrapping label; no redundant aria-label.
 */
export function SatStudentProducedAnswer({
  questionId,
  value = "",
  disabled,
  onChange,
  onBlur,
}: SatStudentProducedAnswerProps) {
  const inputId = `sat-spr-${questionId}`;
  const helpId = `${inputId}-help`;
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);

  const commitOnBlur = (): void => {
    // Empty is not an error (unanswered is a legal review state); only
    // validate non-empty drafts so "You may still submit" stays true.
    if (value.trim() === "") {
      setError(null);
      onBlur?.();
      return;
    }
    const verdict = validateSatStudentResponse(value);
    setError(verdict.valid ? null : verdict.message);
    onBlur?.();
  };

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
          onChange={(event) => {
            if (error !== null) setError(null);
            onChange(sanitizeSatStudentResponseInput(event.target.value));
          }}
          onBlur={commitOnBlur}
          disabled={disabled}
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={false}
          maxLength={6}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? helpId + " " + errorId : helpId}
          // Bluebook SPR input (Phase 6): answer-grade border + 8px
          // radius from component tokens; focus ring keeps the 3px focus
          // token (existing behavior — tokenize only).
          className="sat-tabular mt-2 h-12 w-full rounded-[var(--sat-answer-radius)] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] px-3 sat-type-input font-medium text-[var(--sat-text)] outline-none focus:border-[var(--sat-accent)] focus:ring-2 focus:ring-[var(--sat-focus)]/25 disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]"
        />
      </label>
      <p
        id={helpId}
        className="sat-reading-copy mt-2 sat-type-metadata text-[var(--sat-text-secondary)]"
      >
        Fractions use a/b, max 5 characters (6 with a leading minus).
      </p>
      {error !== null ? (
        <p id={errorId} role="alert" className="mt-2 text-[14px] font-medium text-[var(--sat-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
