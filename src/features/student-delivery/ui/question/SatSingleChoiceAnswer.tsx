import { CircleSlash2 } from "lucide-react";
import type { ChoiceOption } from "../../../exam-rendering/api/assessmentContracts";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import { isSatSelectionGestureEcho } from "../annotations/satSelectionDragGuard";

export interface SatSingleChoiceAnswerProps {
  questionId: string;
  options: ChoiceOption[];
  value?: string | undefined;
  eliminatedOptionIds: ReadonlySet<string>;
  eliminationMode: boolean;
  disabled: boolean;
  onChange: (optionId: string) => void;
  onToggleElimination: (optionId: string) => void;
}

export function SatSingleChoiceAnswer(props: SatSingleChoiceAnswerProps) {
  return (
    // Phase 6d: the blocked fieldset keeps its disabled treatment AND names
    // the reason — a greyed control with no explanation reads as broken.
    <fieldset
      className="space-y-3"
      disabled={props.disabled}
      aria-describedby={props.disabled ? "sat-answers-blocked-reason" : undefined}
    >
      <legend className="sr-only">Answer choices</legend>
      {props.disabled ? (
        <p id="sat-answers-blocked-reason" className="sr-only">
          Answer choices unavailable: paused by the proctor, answers safe.
        </p>
      ) : null}
      {props.options.map((option, index) => {
        const eliminated = props.eliminatedOptionIds.has(option.id);
        const selected = props.value === option.id;
        const letter = String.fromCharCode(65 + index);
        const inputId = `sat-answer-${props.questionId}-${index}`;
        const eliminatedStatusId = `${inputId}-eliminated`;
        const optionLetterId = `${inputId}-letter`;
        const optionContentId = `${inputId}-content`;
        return (
          <div key={option.id} className="relative">
            <label
              htmlFor={inputId}
              // Bluebook answer system (Phase 6): min-height + radius +
              // 1px answer-border from component tokens; selected = 2px
              // accent border + accent-soft tint (never flooded blue);
              // hover = subtle surface token; borders carry the structure
              // (no shadow utilities on rows).
              className={`sat-answer-choice group flex min-h-[var(--sat-answer-min-height)] cursor-pointer items-start gap-3 rounded-[var(--sat-answer-radius)] border border-[var(--sat-answer-border)] bg-[var(--sat-answer-bg)] px-4 py-3.5 pr-14 ${selected ? "border-2 border-[var(--sat-accent)] bg-[var(--sat-accent-soft)]" : eliminated ? "bg-[var(--sat-surface-subtle)]" : "hover:bg-[var(--sat-surface-hover)] hover:border-[var(--sat-accent)]"}`}
            >
              <input
                id={inputId}
                type="radio"
                name={`sat-answer-${props.questionId}`}
                value={option.id}
                checked={selected}
                // Answer safety (spec §34): a drag that ends on an answer choice
                // must never choose it. Touch selection of other text can return
                // as a click on the row under the finger, so an activation
                // arriving inside the guard window is treated as the tail of that
                // selection gesture, not as intent to answer. Read at activation
                // time on purpose: the gesture lands on the label or its text,
                // never on this visually hidden input, so arming from a
                // pointerdown here would never happen.
                onChange={() => { if (isSatSelectionGestureEcho()) return; props.onChange(option.id); }}
                aria-labelledby={`${optionLetterId} ${optionContentId}`}
                aria-describedby={eliminated ? eliminatedStatusId : undefined}
                className="sr-only"
              />
              <span id={optionLetterId} className="sr-only">
                Option {letter}.
              </span>
              <span
                // Bluebook marker (Phase 6): 28px circle with a 2px border.
                // Selected fill lives HERE only — the row itself keeps the
                // calm accent-soft tint, never a flooded blue fill.
                className={`sat-state-transition grid h-[var(--sat-choice-marker-size)] w-[var(--sat-choice-marker-size)] shrink-0 place-items-center rounded-full border-2 text-[14px] font-semibold ${selected ? "border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]" : "border-[var(--sat-text-secondary)] text-[var(--sat-text)]"}`}
                aria-hidden="true"
              >
                {letter}
              </span>
              <div
                id={optionContentId}
                // Whole-content strikethrough (Phase 6): eliminated choices
                // strike lists, equations, and mixed content — not just <p>.
                className={`min-w-0 flex-1 sat-type-body text-[var(--sat-text)] ${eliminated ? "line-through decoration-[1.5px]" : ""}`}
              >
                <StructuredContentRenderer content={option.content} />
              </div>
            </label>
            {eliminated ? (
              <span id={eliminatedStatusId} className="sr-only">
                Option {letter} is eliminated.
              </span>
            ) : null}
            {props.eliminationMode ? (
              <button
                type="button"
                onClick={() => props.onToggleElimination(option.id)}
                disabled={props.disabled}
                aria-pressed={eliminated}
                aria-label={`${eliminated ? "Restore" : "Eliminate"} option ${letter}`}
                className={`sat-pressable sat-state-transition absolute right-2.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] ${eliminated ? "bg-[var(--sat-text)] text-[var(--sat-background)]" : "text-[var(--sat-text-secondary)] hover:bg-[var(--sat-surface-hover)]"} disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]`}
              >
                <CircleSlash2 className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
