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
          // The choice card and its cut control are SIBLINGS in this row: the
          // card keeps the Bluebook answer geometry and the eliminator control
          // sits in the row's own right gutter, vertically centered. The gutter
          // is reserved whether or not the control is drawn, so arming the
          // eliminator never reflows the card and a crossed-out row is exactly
          // as wide as its neighbours.
          <div key={option.id} className="flex items-center gap-2">
            <label
              htmlFor={inputId}
              // Bluebook answer system (Phase 6): min-height + radius +
              // 1px answer-border from component tokens; selected = 2px
              // accent border + accent-soft tint (never flooded blue);
              // hover = subtle surface token; borders carry the structure
              // (no shadow utilities on rows).
              className={`sat-answer-choice group relative flex min-h-[var(--sat-answer-min-height)] flex-1 cursor-pointer items-start gap-3 rounded-[var(--sat-answer-radius)] border border-[var(--sat-answer-border)] bg-[var(--sat-answer-bg)] px-4 py-3.5 ${selected ? "border-2 border-[var(--sat-accent)] bg-[var(--sat-accent-soft)]" : eliminated ? "bg-[var(--sat-surface-subtle)]" : "hover:bg-[var(--sat-surface-hover)] hover:border-[var(--sat-accent)]"}`}
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
              {/* One positioned surface for the marker and the answer content:
                  the crossed-out strike is anchored to the MARKER's center, so
                  it crosses the letter and the content at the same Y instead of
                  being a decoration per text node (which cannot cross an
                  equation or a multi-line list). */}
              <div className="relative flex min-w-0 flex-1 items-start gap-3">
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
                  // Muting only: the cross-out itself is the row strike below,
                  // so equations and mixed structured content stay readable
                  // (a per-node line-through would break them apart).
                  className={`min-w-0 flex-1 sat-type-body ${eliminated ? "text-[var(--sat-text-secondary)]" : "text-[var(--sat-text)]"}`}
                >
                  {props.renderOptionContent
                    ? props.renderOptionContent(option)
                    : <StructuredContentRenderer content={option.content} />}
                </div>
                {eliminated ? (
                  <span
                    aria-hidden="true"
                    data-sat-elimination-line="true"
                    className="sat-choice-elimination-line"
                  />
                ) : null}
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
            <div className="grid w-11 shrink-0 place-items-center">
              {showEliminationControl ? (
                <button
                  type="button"
                  // No answer change rides along, and the domain mutation is the
                  // only writer of `eliminatedOptionIds` — this control just
                  // reports the intent to toggle it.
                  onClick={() => props.onToggleElimination(option.id)}
                  disabled={props.disabled}
                  aria-pressed={eliminated}
                  // The accessible name carries the action and the option
                  // ("Eliminate option B" / "Undo option B"); the visible ink
                  // says the same thing, so a sighted reader and a screen reader
                  // learn the same control. Both states keep the full 44px hit
                  // target even though the visible glyph is much smaller.
                  aria-label={`${eliminated ? "Undo" : "Eliminate"} option ${letter}`}
                  title={`${eliminated ? "Undo" : "Eliminate"} option ${letter}`}
                  data-sat-cut-choice={option.id}
                  data-sat-cut-choice-state={eliminated ? "cut" : "open"}
                  className="sat-pressable sat-state-transition grid h-11 w-11 place-items-center rounded-[6px] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  {eliminated ? (
                    // Crossed out: the cut glyph is gone and the row offers the
                    // real Bluebook "Undo" — compact dark underlined text, no
                    // pill, background or border. One press restores the choice.
                    <span className="sat-type-control-secondary font-medium text-[var(--sat-text)] underline underline-offset-2">
                      Undo
                    </span>
                  ) : (
                    // This choice's own cut control: its letter in the strike
                    // circle, never the header's ABC toggle.
                    <SatCutChoiceGlyph variant="choice" letter={letter} />
                  )}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
