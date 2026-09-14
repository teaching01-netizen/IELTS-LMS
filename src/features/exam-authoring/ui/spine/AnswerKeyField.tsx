import { motion } from "motion/react";
import { Check } from "lucide-react";
import { authoringMotion } from "@/src/shared/motion";
import { FastQuestionComposer } from "../../editor/FastQuestionComposer";
import { SAT_CHOICE_COMPOSER_CAPABILITIES } from "../../editor/RichQuestionComposer";
import { plainTextFromContent } from "../../editor/richContent";
import type { QuestionRevision, StructuredContent } from "../../contracts/assessment";
import type { RichComposerCollaboration } from "../../editor/RichQuestionComposer";

function emptyContent(): StructuredContent {
  return {
    version: 2,
    nodes: [],
    document: { type: "doc", content: [{ type: "paragraph" }] },
  };
}

export interface AnswerKeyFieldProps {
  question: QuestionRevision;
  onChange: (question: QuestionRevision) => void;
  onLocalChange?: ((question: QuestionRevision) => void) | undefined;
  collaborationFor?: ((optionId: string) => RichComposerCollaboration | null | undefined) | undefined;
  readOnly?: boolean | undefined;
}

/**
 * Answer choices as first-class domain components (plan Phase 5, refined).
 *
 * Four options, one component: identical geometry in every state, so the set
 * reads as a single list rather than four different things. Selection changes
 * only the *surface treatment* — a soft tint, a leading rail, the filled letter
 * chip, and the word "Key" — never the size or position of anything.
 *
 * The editor inside a choice stays compact and hidden behind its own toolbar
 * until the row is focused, so content leads and editing mechanics follow.
 */
export function AnswerKeyField({ question, onChange, onLocalChange, collaborationFor, readOnly = false }: AnswerKeyFieldProps) {
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

  // Identity-safe reorder: swaps positions by stable option id. The key is a
  // stable id reference so it follows its content; displayed letters are
  // derived from order at render, never stored.
  const moveOption = (fromOptionId: string, direction: 1 | -1) => {
    const index = answer.options.findIndex((option) => option.id === fromOptionId);
    if (index < 0) return;
    const target = (index + direction + answer.options.length) % answer.options.length;
    if (target === index) return;
    const next = [...answer.options];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    onChange({ ...question, answer: { ...answer, options: next } });
  };

  return (
    <section data-answer-options="true" aria-labelledby="spine-answer-key-heading">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 id="spine-answer-key-heading" className="sr-only">
          Answer key
        </h3>
        <span className="sr-only">Required</span>
      </div>
      <p className="mb-3.5 text-xs leading-5 text-muted-foreground">
        Select the one correct choice. The key is marked by a letter chip, a row
        tint, and the word “Key” — never by color alone.
      </p>
      <div role="radiogroup" aria-label="Answer key choices" className="answer-list">
        {answer.options.map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          const checked = answer.correctOptionId === option.id;
          const content = option.content ?? emptyContent();
          const text = plainTextFromContent(content);
          return (
            <div
              key={option.id}
              data-spine-key-row={checked ? "key" : "option"}
              data-correct={checked ? "true" : "false"}
              className="answer-choice"
            >
              <motion.button
                type="button"
                role="radio"
                whileTap={authoringMotion.press}
                disabled={readOnly}
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
                className="answer-choice__letter flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
              >
                {letter}
              </motion.button>
              <div className="answer-choice__content">
                <FastQuestionComposer
                  label={`Answer choice ${letter}`}
                  value={content}
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
                  {...(onLocalChange && !collaborationFor
                    ? {
                        onLocalChange: (optionContent) =>
                          onLocalChange({
                            ...question,
                            answer: {
                              ...answer,
                              options: answer.options.map((candidate) =>
                                candidate.id === option.id
                                  ? { ...candidate, content: optionContent }
                                  : candidate,
                              ),
                            },
                          }),
                      }
                    : {})}
                  placeholder={`Choice ${letter}`}
                  compact
                  assetOwnerId={question.questionId}
                  capabilities={SAT_CHOICE_COMPOSER_CAPABILITIES}
                  minHeightClassName="min-h-[40px]"
                  {...(collaborationFor?.(option.id) ? { collaboration: collaborationFor(option.id)! } : {})}
                />
              </div>
              <div className="answer-choice__aside">
                <div
                  className="answer-choice__reorder sat-spine__choice-reorder"
                  role="group"
                  aria-label={`Reorder choice ${letter}`}
                >
                  <button
                    type="button"
                    disabled={readOnly || index === 0}
                    onClick={() => moveOption(option.id, -1)}
                    aria-label={`Move choice ${letter} earlier`}
                    title={`Move choice ${letter} earlier`}
                    className="flex min-h-8 min-w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    disabled={readOnly || index === answer.options.length - 1}
                    onClick={() => moveOption(option.id, 1)}
                    aria-label={`Move choice ${letter} later`}
                    title={`Move choice ${letter} later`}
                    className="flex min-h-8 min-w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                </div>
                {checked ? (
                  <motion.span
                    layoutId="spine-key-tag"
                    transition={authoringMotion.snap}
                    className="answer-choice__key"
                  >
                    <Check size={12} aria-hidden="true" strokeWidth={3} />
                    Key
                  </motion.span>
                ) : (
                  <span aria-hidden="true" className="answer-choice__key answer-choice__key--idle">
                    Set key
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
