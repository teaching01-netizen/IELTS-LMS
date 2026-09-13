import React from "react";
import type { QuestionAnswer } from "../../types";
import type { StudentAnswerMutationMeta } from "../../types/studentAttempt";
import type { StudentQuestionDescriptor } from "@student/application/studentExamContentFacade";
import { ProtectedInput } from "./ProtectedInput";
import { StudentFlagButton } from "./StudentFlagButton";
import { StudentQuestionText } from "./StudentQuestionText";
import { StudentQuestionNumber } from "./StudentQuestionNumber";
import type { StudentHighlightColor } from "./highlightPalette";

interface SubAnswerTreeQuestionListProps {
  questions: StudentQuestionDescriptor[];
  answers: Record<string, QuestionAnswer>;
  currentQuestionId: string | null;
  flags?: Record<string, boolean>;
  onToggleFlag?: ((id: string) => void) | undefined;
  tabletMode?: boolean;
  highlightEnabled?: boolean;
  highlightColor?: StudentHighlightColor | undefined;
  onAnswerChange: (
    answerKey: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta
  ) => void;
  /**
   * P4: working in a leaf makes it THE active question, so the single global
   * navigator can never point at a question the student has moved on from.
   * Optional so existing callers keep compiling unchanged.
   */
  onActivate?: ((id: string) => void) | undefined;
}

export function SubAnswerTreeQuestionList({
  questions,
  answers,
  currentQuestionId,
  flags = {},
  onToggleFlag,
  tabletMode = false,
  highlightEnabled = false,
  highlightColor,
  onAnswerChange,
  onActivate,
}: SubAnswerTreeQuestionListProps) {
  const rootOrder = new Map<string, number>();
  const groups: Array<{
    rootId: string;
    rootNumber: number;
    prompt: string;
    leaves: StudentQuestionDescriptor[];
  }> = [];

  questions.forEach((question) => {
    if (!question.rootId || typeof question.rootNumber !== "number") {
      return;
    }

    if (!rootOrder.has(question.rootId)) {
      rootOrder.set(question.rootId, groups.length);
      groups.push({
        rootId: question.rootId,
        rootNumber: question.rootNumber,
        prompt: "",
        leaves: [],
      });
    }
    const group = groups[rootOrder.get(question.rootId)!];
    if (!group) return;
    if (!group.prompt) {
      const prompt = typeof question.treePrompt === "string" ? question.treePrompt.trim() : "";
      if (prompt) {
        group.prompt = prompt;
      }
    }
    group.leaves.push(question);
  });

  groups.forEach((group) => {
    group.leaves.sort((left, right) => {
      const order = left.rootLeafQuestionIds ?? right.rootLeafQuestionIds ?? [];
      const leftIndex = order.indexOf(left.id);
      const rightIndex = order.indexOf(right.id);
      if (leftIndex >= 0 && rightIndex >= 0) {
        return leftIndex - rightIndex;
      }
      return (left.numberLabel ?? String(left.rootNumber)).localeCompare(
        right.numberLabel ?? String(right.rootNumber),
        undefined,
        { numeric: true }
      );
    });
  });

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.rootId} className="space-y-2">
          {group.prompt ? (
            <div className="flex gap-3">
              <StudentQuestionNumber number={group.rootNumber} />
              <StudentQuestionText
                as="span"
                className="text-gray-800"
                text={group.prompt}
                highlightEnabled={highlightEnabled}
                highlightColor={highlightColor}
                highlightSurfaceId={`question:${questions[0]?.blockId ?? "unknown"}:${group.rootId}:root-prompt`}
              />
            </div>
          ) : null}
          <div className={`${tabletMode ? "ml-0" : "ml-9"} space-y-2`}>
            {group.leaves.map((leaf) => {
              const slotId = leaf.id;
              const value = typeof answers[slotId] === "string" ? (answers[slotId] as string) : "";
              const isCurrent = currentQuestionId === slotId;
              const isFlagged = Boolean(flags[slotId]);
              const showLeafNumber = group.leaves.length > 1;
              const displayNumber = showLeafNumber
                ? (leaf.numberLabel ?? String(group.rootNumber))
                : String(group.rootNumber);

              return (
                <div
                  key={slotId}
                  id={`question-${slotId}`}
                  tabIndex={-1}
                  // Focus capture covers both clicking into the input and
                  // tabbing to it, so answering activates without a separate
                  // click handler racing the input's own focus.
                  onFocusCapture={() => {
                    if (!isCurrent) {
                      onActivate?.(slotId);
                    }
                  }}
                  className={`rounded-lg p-1 transition-colors ${
                    isCurrent ? "ring-2 ring-blue-800 ring-offset-2" : ""
                  } ${isFlagged ? "bg-amber-50" : ""}`}
                >
                  <div
                    className={
                      tabletMode ? "flex flex-col items-stretch gap-2" : "flex items-center gap-3"
                    }
                  >
                    {showLeafNumber ? (
                      <StudentQuestionNumber number={displayNumber} isActive={isCurrent} />
                    ) : null}
                    <div className="flex-1">
                      <ProtectedInput
                        type="text"
                        name={slotId}
                        security={{ preventAutofill: true, preventAutocorrect: true }}
                        value={value}
                        onChange={(event) =>
                          onAnswerChange(slotId, event.target.value, {
                            interactionType: "typing",
                          })
                        }
                        className="w-full rounded-md border border-gray-300 px-4 py-2 text-base transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/25"
                        placeholder="Enter answer..."
                        aria-label={`Answer for question ${displayNumber}`}
                      />
                    </div>
                    {onToggleFlag ? (
                      <StudentFlagButton
                        flagged={isFlagged}
                        size="compact"
                        onToggle={() => onToggleFlag(slotId)}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
