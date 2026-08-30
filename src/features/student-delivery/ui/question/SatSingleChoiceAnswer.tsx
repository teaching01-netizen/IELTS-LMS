import { CircleSlash2 } from "lucide-react";
import type { ChoiceOption } from "../../../exam-rendering/api/assessmentContracts";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";

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
    <fieldset className="space-y-3" disabled={props.disabled}>
      <legend className="sr-only">Answer choices</legend>
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
              className={`sat-answer-choice group flex min-h-[68px] cursor-pointer items-start gap-3 rounded-[7px] border bg-[var(--sat-surface)] px-4 py-3.5 pr-14 ${selected ? "border-[var(--sat-accent)] ring-2 ring-[var(--sat-accent)]/20" : eliminated ? "border-[var(--sat-divider)] bg-[var(--sat-surface-subtle)]" : "border-[var(--sat-text)] hover:border-[var(--sat-accent)]"}`}
            >
              <input
                id={inputId}
                type="radio"
                name={`sat-answer-${props.questionId}`}
                value={option.id}
                checked={selected}
                onChange={() => props.onChange(option.id)}
                aria-labelledby={`${optionLetterId} ${optionContentId}`}
                aria-describedby={eliminated ? eliminatedStatusId : undefined}
                className="sr-only"
              />
              <span id={optionLetterId} className="sr-only">
                Option {letter}.
              </span>
              <span
                className={`sat-state-transition grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[14px] font-semibold ${selected ? "border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]" : "border-[var(--sat-text-secondary)] text-[var(--sat-text)]"}`}
                aria-hidden="true"
              >
                {letter}
              </span>
              <div
                id={optionContentId}
                className={`min-w-0 flex-1 sat-type-body text-[var(--sat-text)] ${eliminated ? "[&_p]:line-through [&_p]:decoration-[1.5px]" : ""}`}
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
