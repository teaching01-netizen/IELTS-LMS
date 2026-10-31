/* eslint-disable jsx-a11y/control-has-associated-label -- wrapping label + htmlFor double-associates the input; the rule misreads the nested-input pattern (same as the pre-existing notes/annotation editors). */
import { useEffect, useId, useState } from "react";
import {
  SAT_SPR_MAX_INPUT_CHARACTERS,
  capSatStudentResponseInput,
  validateSatStudentResponse,
} from "@shared/sat/studentResponse";

export interface SatStudentProducedAnswerProps {
  questionId: string;
  value?: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** Flush the latest local draft when the student leaves the answer field. */
  onBlur?: (() => void) | undefined;
}

interface SatStudentResponseError {
  questionId: string;
  value: string;
  message: string;
}

/**
 * Student-produced response input (validate-then-announce).
 *
 * Typing stays forgiving (preserve text on change — never error mid-key).
 * The one boundary change is lookalike-glyph normalization plus a 64-character
 * safety bound: longer text can never be a legal SAT entry, and a pasted
 * Unicode minus must become the ASCII minus the server stores. The 5/6 rule is
 * validation-only; the input is never truncated into a different number.
 * Validation runs on BLUR against the committed draft and announces through a
 * single describedby chain: format help + error (role=alert when present).
 *
 * The error carries its question id so switching between two SPR questions
 * cannot paint the previous question's error onto the next one.
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
  const [error, setError] = useState<SatStudentResponseError | null>(null);
  const visibleError =
    error?.questionId === questionId && error.value === value ? error.message : null;

  // A draft restored from the server or the durable outbox may predate glyph
  // normalization or the input cap. Rewrite it through the same boundary as a
  // keystroke so validation, review status, and the stored value agree.
  useEffect(() => {
    const normalized = capSatStudentResponseInput(value);
    if (normalized !== value) onChange(normalized);
  }, [onChange, value]);

  const commitOnBlur = (): void => {
    // Empty is not an error (unanswered is a legal review state); only
    // validate non-empty drafts so "You may still submit" stays true.
    if (value.trim() === "") {
      setError(null);
      onBlur?.();
      return;
    }
    const verdict = validateSatStudentResponse(value);
    setError(verdict.valid ? null : { questionId, value, message: verdict.message });
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
          data-testid="sat-answer-control"
          value={value}
          onChange={(event) => {
            if (error !== null) setError(null);
            onChange(capSatStudentResponseInput(event.target.value));
          }}
          onBlur={commitOnBlur}
          disabled={disabled}
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={false}
          maxLength={SAT_SPR_MAX_INPUT_CHARACTERS}
          aria-invalid={visibleError !== null ? true : undefined}
          aria-describedby={visibleError !== null ? helpId + " " + errorId : helpId}
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
      {visibleError !== null ? (
        <p id={errorId} role="alert" className="mt-2 text-[14px] font-medium text-[var(--sat-danger)]">
          {visibleError}
        </p>
      ) : null}
    </div>
  );
}
