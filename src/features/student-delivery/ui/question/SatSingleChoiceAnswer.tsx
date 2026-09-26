import type { ChoiceOption } from "../../../exam-rendering/api/assessmentContracts";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import { isSatSelectionGestureEcho } from "../annotations/satSelectionDragGuard";
import { SatCutChoiceGlyph } from "./SatCutChoiceGlyph";
import type { ReactNode } from "react";

export interface SatSingleChoiceAnswerProps {
  questionId: string;
  options: ChoiceOption[];
  value?: string | undefined;
  eliminatedOptionIds: ReadonlySet<string>;
  eliminationMode: boolean;
  disabled: boolean;
  onChange: (optionId: string) => void;
  /** Flush the latest local answer draft when focus leaves the choices. */
  onBlur?: (() => void) | undefined;
  onToggleElimination: (optionId: string) => void;
  /** Reuse the question's text surface while keeping radio controls outside it. */
  renderOptionContent?: ((option: ChoiceOption) => ReactNode) | undefined;
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
        // The cut-choice control appears while the eliminator is armed, and
        // stays on any choice already crossed out — an eliminated choice must
        // remain recoverable without re-arming the mode. A selected choice
        // never gets one: elimination of the chosen answer is not expressible.
        const showEliminationControl = !selected && (props.eliminationMode || eliminated);
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
                onBlur={props.onBlur}
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
                className={`sat-state-transition grid h-[var(--sat-choice-marker-size)] w-[var(--sat-choice-marker-size)] shrink-0 place-items-center rounded-full border-2 text-[14px] font-semibold ${selected ? "border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]" : "border-[var(--sat-text-secondary)] text-[var(--sat-text)]"} ${eliminated ? "line-through decoration-[1.5px]" : ""}`}
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
                {props.renderOptionContent
                  ? props.renderOptionContent(option)
                  : <StructuredContentRenderer content={option.content} />}
              </div>
            </label>
            {eliminated ? (
              <span id={eliminatedStatusId} className="sr-only">
                Option {letter} is eliminated.
              </span>
            ) : null}
            {/* Audit finding 3: the selected choice offers no cross-out control.
                Elimination must never be expressible on the answer the student
                picked — the domain mutation refuses it, and the UI does not
                offer a control whose only possible effect is a contradiction.

                The control is a SIBLING of the choice label, never inside it:
                a button nested in a <label> would activate the radio, so
                crossing a choice out could select it. Crossing out is its own
                action, and the answer changes only through the radio. */}
            {showEliminationControl ? (
              <button
                type="button"
                // No answer change rides along, and the domain mutation is the
                // only writer of `eliminatedOptionIds` — this control just
                // reports the intent to toggle it.
                onClick={() => props.onToggleElimination(option.id)}
                disabled={props.disabled}
                aria-pressed={eliminated}
                // Icon-only control, exactly like the header eliminator: the
                // accessible name carries the action ("Undo option B") and the
                // state rides on the glyph's ink plus aria-pressed. The name is
                // never drawn, so there is no visible word the name could
                // contradict — and the badge keeps one identity across both
                // states. `title` keeps that name discoverable on hover.
                aria-label={`${eliminated ? "Undo" : "Eliminate"} option ${letter}`}
                title={`${eliminated ? "Undo" : "Eliminate"} option ${letter}`}
                data-sat-cut-choice={option.id}
                data-sat-cut-choice-state={eliminated ? "cut" : "open"}
                className="sat-pressable sat-state-transition absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-[6px] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <SatCutChoiceGlyph
                  size="sm"
                  // Every choice box wears the SAME cut badge; a crossed-out
                  // choice keeps it rather than becoming the word "Undo". The
                  // applied state is the same outline, dashed and muted, so the
                  // control the student just used is still where they left it —
                  // and one press puts the choice back.
                  className={
                    eliminated
                      ? "border-dashed border-[var(--sat-text-secondary)] bg-transparent text-[var(--sat-text-secondary)]"
                      : "border-[var(--sat-answer-border)] bg-[var(--sat-answer-bg)] text-[var(--sat-text)]"
                  }
                />
              </button>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
