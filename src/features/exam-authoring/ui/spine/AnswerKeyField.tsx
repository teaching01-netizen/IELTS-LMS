import { motion } from "motion/react";
import { authoringMotion } from "@/src/shared/motion";
import { FastQuestionComposer } from "../../editor/FastQuestionComposer";
import { SAT_CHOICE_COMPOSER_CAPABILITIES } from "../../editor/RichQuestionComposer";
import { plainTextFromContent } from "../../editor/richContent";
import type { QuestionRevision } from "../../contracts/assessment";

export interface AnswerKeyFieldProps {
  question: QuestionRevision;
  onChange: (question: QuestionRevision) => void;
}

/**
 * Unmissable MCQ answer key (plan Phase 5): the key is a radiogroup of 44px
 * radio cards — filled selected state PLUS "Key" text, never color alone.
 * Same `{ ...answer, correctOptionId }` payload shape as the legacy editor;
 * choice text still edits through FastQuestionComposer (unchanged).
 */
export function AnswerKeyField({ question, onChange }: AnswerKeyFieldProps) {
  const answer = question.answer;
  if (answer.kind !== "single_choice") return null;

  const setKey = (optionId: string) => {
    onChange({ ...question, answer: { ...answer, correctOptionId: optionId } });
  };

  const moveKey = (fromOptionId: string, direction: 1 | -1) => {
    const index = answer.options.findIndex((option) => option.id === fromOptionId);
    const next = answer.options[(index + direction + answer.options.length) % answer.options.length];
    if (next) setKey(next.id);
  };

  return (
    <section data-authoring-field="answer" aria-labelledby="spine-answer-key-heading">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 id="spine-answer-key-heading" className="text-[13px] font-semibold text-foreground">
          Answer key
        </h3>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          Required
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Select the one correct choice. The key is shown with fill and text, not color alone.
      </p>
      <div role="radiogroup" aria-label="Answer key choices" className="space-y-2">
        {answer.options.map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          const checked = answer.correctOptionId === option.id;
          const text = plainTextFromContent(option.content);
          return (
            <div
              key={option.id}
              data-spine-key-row={checked ? "key" : undefined}
              className={`flex items-start gap-2 rounded-lg border p-2 transition-colors ${checked ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/60"}`}
            >
              <motion.button
                type="button"
                role="radio"
                whileTap={authoringMotion.press}
                aria-checked={checked}
                aria-label={`Choice ${letter}${text ? `: ${text}` : ""}${checked ? ", correct answer, key" : ""}`}
                onClick={() => setKey(option.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                    event.preventDefault();
                    moveKey(option.id, 1);
                  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    moveKey(option.id, -1);
                  }
                }}
                className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-xs font-bold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.93] ${checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {letter}
              </motion.button>
              <div className="min-w-0 flex-1">
                <FastQuestionComposer
                  label={`Answer choice ${letter}`}
                  value={option.content}
                  onChange={(optionContent) =>
                    onChange({
                      ...question,
                      answer: {
                        ...answer,
                        options: answer.options.map((candidate) =>
                          candidate.id === option.id ? { ...candidate, content: optionContent } : candidate,
                        ),
                      },
                    })
                  }
                  placeholder={`Choice ${letter}`}
                  compact
                  assetOwnerId={question.id}
                  capabilities={SAT_CHOICE_COMPOSER_CAPABILITIES}
                  minHeightClassName="min-h-[42px]"
                />
              </div>
              {checked ? (
                <motion.span
                  layoutId="spine-key-tag"
                  transition={authoringMotion.snap}
                  className="mt-3 shrink-0 pr-1 text-[10px] font-bold uppercase tracking-wider text-primary"
                >
                  Key
                </motion.span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
