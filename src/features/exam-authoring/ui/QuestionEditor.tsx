import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Save, Trash2 } from "lucide-react";
import type { QuestionRevision, StructuredContent } from "../contracts/assessment";
import { RichQuestionComposer } from "../editor/RichQuestionComposer";
import { plainTextFromContent } from "../editor/richContent";
import { ConfirmPopover } from "./ConfirmPopover";
import { authoringMotion } from "./authoringMotion";

export interface QuestionEditorProps {
  question: QuestionRevision;
  saveStatus: "saved" | "unsaved" | "saving" | "error";
  onChange: (question: QuestionRevision) => void;
  onSaveNow: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const inputClass =
  "w-full rounded-xl border border-transparent bg-[#f5f5f7] px-3.5 py-3 text-[14px] leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0071e3]/30 focus:bg-white focus:ring-4 focus:ring-[#0071e3]/10";

function emptyContent(): StructuredContent {
  return { version: 2, nodes: [], document: { type: "doc", content: [{ type: "paragraph" }] } };
}

export function QuestionEditor({
  question,
  saveStatus,
  onChange,
  onSaveNow,
  onDuplicate,
  onDelete,
}: QuestionEditorProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const answer = question.answer;
  const isSpr = answer.kind === "student_produced_response";
  const promptReady = plainTextFromContent(question.prompt).length > 0;
  const answerReady =
    answer.kind === "single_choice"
      ? Boolean(answer.correctOptionId) &&
        answer.options.every((option) => plainTextFromContent(option.content).length > 0)
      : answer.acceptedResponses.some((response) => response.trim().length > 0);

  const updateOption = (optionId: string, content: StructuredContent) => {
    if (question.answer.kind !== "single_choice") return;
    onChange({
      ...question,
      answer: {
        ...question.answer,
        options: question.answer.options.map((option) =>
          option.id === optionId ? { ...option, content } : option
        ),
      },
    });
  };

  const changeKind = (kind: QuestionRevision["questionType"]) => {
    if (kind === question.questionType) return;
    if (kind === "student_produced_response") {
      onChange({
        ...question,
        questionType: kind,
        answer: {
          kind,
          acceptedResponses: [],
          normalizeFraction: true,
          normalizeDecimal: true,
          numericTolerance: null,
        },
      });
      return;
    }
    onChange({
      ...question,
      questionType: kind,
      answer: {
        kind,
        options: ["A", "B", "C", "D"].map((id) => ({ id, content: emptyContent() })),
        correctOptionId: null,
      },
    });
  };

  return (
    <div className="mx-auto max-w-[860px] px-5 py-7 sm:px-8 sm:py-9">
      <div className="mb-9 flex items-start justify-between gap-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {question.metadata.sectionKey === "math" ? "Math" : "Reading & Writing"}
            </span>
            <span className="text-xs capitalize text-slate-400">
              {question.metadata.difficulty}
            </span>
            {question.metadata.domain ? (
              <span className="text-xs text-slate-400">
                · {question.metadata.domain.replaceAll("-", " ")}
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.025em] text-slate-950">
            Question content
          </h2>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-slate-400">
            Compose the student-facing item, then set the answer key below.
          </p>
          <div className="mt-2 flex items-center gap-3 text-[11px]">
            <ReadinessLabel ready={promptReady} label="Prompt" />
            <ReadinessLabel ready={answerReady} label="Answer key" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            onClick={onDuplicate}
            className="authoring-interactive flex h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-slate-600 hover:bg-black/[0.05]"
            title="Duplicate question (⌘D)"
          >
            <Copy size={14} />
            <span className="hidden sm:inline">Duplicate</span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={authoringMotion.press}
            transition={authoringMotion.fast}
            onClick={onSaveNow}
            disabled={saveStatus === "saving"}
            className="authoring-interactive flex h-11 items-center gap-2 rounded-full bg-black/[0.06] px-4 text-xs font-semibold text-slate-900 hover:bg-black/[0.10] disabled:opacity-50"
          >
            <Save size={14} /> Save
          </motion.button>
        </div>
      </div>

      <div className="space-y-8">
        <ComposerSection field="stimulus" label="Supporting material" hint="Optional">
          <RichQuestionComposer
            label="Passage or stimulus"
            value={question.stimulus}
            onChange={(stimulus) => onChange({ ...question, stimulus })}
            placeholder="Paste the passage, context, data, equation, table, or visual students need…"
            assetOwnerId={question.id}
            minHeightClassName="min-h-[150px]"
          />
        </ComposerSection>

        <ComposerSection field="prompt" label="Question prompt" hint="Required" priority>
          <RichQuestionComposer
            label="Question prompt"
            value={question.prompt}
            onChange={(prompt) => onChange({ ...question, prompt })}
            placeholder="Write the exact question students will see…"
            assetOwnerId={question.id}
            minHeightClassName="min-h-[150px]"
          />
        </ComposerSection>

        <section data-authoring-field="answer" className="border-t border-black/[0.06] pt-7">
          <div className="mb-3">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Answer setup</h3>
            <p className="mt-1 text-[11px] leading-4 text-slate-400">Choose how students respond, then define the accepted answer.</p>
          </div>
          <div className="authoring-segmented inline-flex rounded-full p-1">
            <ResponseTypeButton active={!isSpr} onClick={() => changeKind("single_choice")}>
              Multiple choice
            </ResponseTypeButton>
            {question.metadata.sectionKey === "math" ? (
              <ResponseTypeButton
                active={isSpr}
                onClick={() => changeKind("student_produced_response")}
              >
                Student response
              </ResponseTypeButton>
            ) : null}
          </div>
        </section>

        {isSpr ? (
          <section data-authoring-field="answer">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span id="sat-responses-label" className="text-[13px] font-semibold text-slate-800">
                Accepted responses
              </span>
              <span className="text-[11px] text-slate-400">Separate equivalents with commas</span>
            </div>
            <input
              id="sat-responses"
              aria-labelledby="sat-responses-label"
              value={
                answer.kind === "student_produced_response"
                  ? answer.acceptedResponses.join(", ")
                  : ""
              }
              onChange={(event) =>
                onChange({
                  ...question,
                  answer: {
                    kind: "student_produced_response",
                    acceptedResponses: event.target.value.split(",").map((value) => value.trim()),
                    normalizeFraction: true,
                    normalizeDecimal: true,
                    numericTolerance: null,
                  },
                })
              }
              className={inputClass}
              placeholder="Example: 12, 12.0, 24/2"
            />
          </section>
        ) : (
          <section data-authoring-field="answer">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-semibold text-slate-800">Answer choices</p>
              <span className="text-[11px] text-slate-400">Select the keyed answer</span>
            </div>
            <div className="space-y-2.5">
              {answer.kind === "single_choice"
                ? answer.options.map((option, index) => {
                    const correct = answer.correctOptionId === option.id;
                    const letter = String.fromCharCode(65 + index);
                    return (
                      <motion.div
                        layout
                        key={option.id}
                        animate={{
                          backgroundColor: correct ? "rgba(236,253,245,0.68)" : "rgba(255,255,255,0)",
                        }}
                        transition={authoringMotion.state}
                        className="flex items-start gap-2 rounded-[16px] p-2.5"
                      >
                        <motion.button
                          type="button"
                          whileTap={authoringMotion.press}
                          transition={authoringMotion.fast}
                          onClick={() =>
                            onChange({
                              ...question,
                              answer: { ...answer, correctOptionId: option.id },
                            })
                          }
                          className={`authoring-interactive mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${correct ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                          aria-label={`Mark choice ${letter} correct`}
                        >
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                              key={correct ? "correct" : "letter"}
                              initial={{ opacity: 0, scale: 0.72 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.72 }}
                              transition={authoringMotion.state}
                            >
                              {correct ? <Check size={15} strokeWidth={3} /> : letter}
                            </motion.span>
                          </AnimatePresence>
                        </motion.button>
                        <div className="min-w-0 flex-1">
                          <RichQuestionComposer
                            label={`Answer choice ${letter}`}
                            value={option.content}
                            onChange={(content) => updateOption(option.id, content)}
                            placeholder={`Choice ${letter}`}
                            compact
                            assetOwnerId={question.id}
                            minHeightClassName="min-h-[42px]"
                          />
                        </div>
                        <AnimatePresence initial={false}>
                          {correct ? (
                            <motion.span
                              initial={{ opacity: 0, x: 4 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 3 }}
                              transition={authoringMotion.state}
                              className="mt-3 pr-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                            >
                              Correct
                            </motion.span>
                          ) : null}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })
                : null}
            </div>
          </section>
        )}

        <ComposerSection
          field="rationale"
          label="Rationale"
          hint="Internal · recommended"
          separated
        >
          <RichQuestionComposer
            label="Question rationale"
            value={question.rationale}
            onChange={(rationale) => onChange({ ...question, rationale })}
            placeholder="Explain why the keyed answer is correct and common traps…"
            assetOwnerId={question.id}
            minHeightClassName="min-h-[110px]"
          />
          <p className="mt-2 text-[11px] leading-5 text-slate-400">
            Stored with the item for review and grading. It is not shown in the student exam.
          </p>
        </ComposerSection>

        <div className="flex items-center justify-between border-t border-slate-100 pt-5">
          <div
            className={`text-[11px] font-medium ${saveStatus === "error" ? "text-red-600" : saveStatus === "saved" ? "text-emerald-600" : "text-slate-400"}`}
          >
            {saveStatus === "saving"
              ? "Saving latest changes…"
              : saveStatus === "unsaved"
                ? "Autosave pending · ⌘S to save now"
                : saveStatus === "error"
                  ? "Autosave failed — use Save to retry"
                  : "All changes saved"}
          </div>
          <div className="relative">
            <motion.button
              type="button"
              whileTap={authoringMotion.press}
              transition={authoringMotion.fast}
              onClick={() => setDeleteOpen(true)}
              className="authoring-interactive flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={13} /> Delete question
            </motion.button>
            <ConfirmPopover
              open={deleteOpen}
              title="Delete this question?"
              description="The item will be removed from this module. Cancel is focused by default so an accidental click does not destroy work."
              confirmLabel="Delete question"
              onCancel={() => setDeleteOpen(false)}
              onConfirm={() => {
                setDeleteOpen(false);
                onDelete();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ResponseTypeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={authoringMotion.press}
      transition={authoringMotion.fast}
      onClick={onClick}
      className={`relative min-h-9 overflow-hidden rounded-full px-3.5 py-2 text-xs font-semibold ${active ? "text-slate-950" : "text-slate-500 hover:text-slate-800"}`}
    >
      {active ? (
        <motion.span
          layoutId="sat-response-type-pill"
          className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
          transition={authoringMotion.spring}
        />
      ) : null}
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}

function ComposerSection({
  field,
  label,
  hint,
  priority = false,
  separated = false,
  children,
}: {
  field: string;
  label: string;
  hint: string;
  priority?: boolean;
  separated?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      data-authoring-field={field}
      className={separated ? "border-t border-black/[0.06] pt-7" : undefined}
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p
          className={
            priority
              ? "text-[15px] font-semibold tracking-[-0.01em] text-slate-950"
              : "text-[13px] font-semibold text-slate-700"
          }
        >
          {label}
        </p>
        <span className={`text-[11px] ${priority ? "font-medium text-[#0066cc]" : "text-slate-400"}`}>
          {hint}
        </span>
      </div>
      {children}
    </section>
  );
}

function ReadinessLabel({ ready, label }: { ready: boolean; label: string }) {
  return (
    <motion.span
      animate={{ color: ready ? "rgb(5 150 105)" : "rgb(148 163 184)" }}
      transition={authoringMotion.state}
      className="flex items-center gap-1.5"
    >
      <span className="relative h-2 w-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={ready ? "ready" : "incomplete"}
            initial={{ opacity: 0, scale: 0.55 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.55 }}
            transition={authoringMotion.state}
            className={`absolute inset-0 rounded-full ${ready ? "bg-emerald-500" : "m-[1px] bg-slate-300"}`}
          />
        </AnimatePresence>
      </span>
      {label}
    </motion.span>
  );
}
