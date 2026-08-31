import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, Copy, MoreHorizontal, Save, Trash2 } from "lucide-react";
import type { QuestionRevision, StructuredContent } from "../contracts/assessment";
import { FastQuestionComposer } from "../editor/FastQuestionComposer";
import { SAT_CHOICE_COMPOSER_CAPABILITIES } from "../editor/RichQuestionComposer";
import { hasStructuredContent, plainTextFromContent } from "../editor/richContent";
import {
  createSatSupportingMaterial,
  type SatSupportingMaterialStarter,
} from "../providers/sat/contentTemplates";
import { ConfirmPopover } from "./ConfirmPopover";
import { SatStudentResponseEditor } from "./SatStudentResponseEditor";
import { QuestionMetadataBar } from "./QuestionMetadataBar";
import { authoringMotion } from "./authoringMotion";

export interface QuestionEditorProps {
  question: QuestionRevision;
  questionNumber?: number;
  saveStatus: "saved" | "unsaved" | "saving" | "error";
  onChange: (question: QuestionRevision) => void;
  onSaveNow: () => void;
  onSaveAndNext: () => void;
  keepMetadataForNext: boolean;
  onKeepMetadataForNextChange: (value: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function emptyContent(): StructuredContent {
  return { version: 2, nodes: [], document: { type: "doc", content: [{ type: "paragraph" }] } };
}

export function QuestionEditor({
  question,
  questionNumber,
  saveStatus,
  onChange,
  onSaveNow,
  onSaveAndNext,
  keepMetadataForNext,
  onKeepMetadataForNextChange,
  onDuplicate,
  onDelete,
}: QuestionEditorProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const answer = question.answer;
  const isSpr = answer.kind === "student_produced_response";
  const promptReady = plainTextFromContent(question.prompt).length > 0;
  const stimulusEmpty = !hasStructuredContent(question.stimulus);
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
    <article className="authoring-editor-sheet mx-auto my-5 w-[calc(100%-2rem)] max-w-[940px] px-6 pb-24 pt-6 sm:my-7 sm:px-10 sm:pt-9">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400">
              <span>{questionNumber ? `Question ${questionNumber}` : "Question"}</span>
              <span>·</span>
              <ReadinessLabel ready={promptReady && answerReady} />
              <SaveState status={saveStatus} />
            </div>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.035em] text-slate-950">
              Edit question
            </h2>
          </div>
          <div className="relative flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onDuplicate}
              className="authoring-interactive flex min-h-10 items-center gap-1.5 rounded-[10px] px-3 text-[11px] font-semibold text-slate-600 hover:bg-black/[0.045]"
              title="Duplicate question (⌘D)"
            >
              <Copy size={13} />
              Duplicate
            </button>
            <button
              type="button"
              onClick={() => setMoreOpen((value) => !value)}
              className="authoring-interactive flex h-10 w-10 items-center justify-center rounded-[10px] text-slate-500 hover:bg-black/[0.045]"
              aria-label="More question actions"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={15} />
            </button>
            {moreOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-11 z-40 min-w-44 rounded-xl border border-black/[0.08] bg-white p-1.5 shadow-[0_12px_30px_rgba(0,0,0,0.14)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onSaveNow();
                  }}
                  role="menuitem"
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Save size={12} />
                  Save now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setDeleteOpen(true);
                  }}
                  role="menuitem"
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11px] font-semibold text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={12} />
                  Delete question
                </button>
              </div>
            ) : null}
            <ConfirmPopover
              open={deleteOpen}
              title="Delete this question?"
              description="The question will be removed from this SAT module. Cancel is focused by default."
              confirmLabel="Delete question"
              onCancel={() => setDeleteOpen(false)}
              onConfirm={() => {
                setDeleteOpen(false);
                onDelete();
              }}
            />
          </div>
        </div>
        <QuestionMetadataBar question={question} onChange={onChange} />
      </header>

      <div className="space-y-6">
        <EditorSection field="stimulus" label="Supporting material" hint="Optional">
          {stimulusEmpty ? (
            <SatSupportingMaterialStarters
              sectionKey={question.metadata.sectionKey}
              onSelect={(starter) =>
                onChange({ ...question, stimulus: createSatSupportingMaterial(starter) })
              }
            />
          ) : null}
          <FastQuestionComposer
            label="Supporting material"
            value={question.stimulus}
            onChange={(stimulus) => onChange({ ...question, stimulus })}
            placeholder="Passage, context, data, equation, table, or visual…"
            assetOwnerId={question.id}
            minHeightClassName="min-h-[92px]"
          />
        </EditorSection>

        <EditorSection field="prompt" label="Prompt" hint="Required" priority>
          <FastQuestionComposer
            label="Question prompt"
            value={question.prompt}
            onChange={(prompt) => onChange({ ...question, prompt })}
            placeholder="Write the exact question students will see…"
            assetOwnerId={question.id}
            minHeightClassName="min-h-[112px]"
          />
        </EditorSection>

        <section data-authoring-field="answer" className="border-t border-black/[0.06] pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900">Answer</h3>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Set the response type and key without leaving the editing flow.
              </p>
            </div>
            <div className="authoring-segmented inline-flex rounded-[10px] p-0.5">
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
          </div>

          {isSpr ? (
            <SatStudentResponseEditor
              acceptedResponses={answer.acceptedResponses}
              onChange={(acceptedResponses) =>
                onChange({
                  ...question,
                  answer: {
                    kind: "student_produced_response",
                    acceptedResponses,
                    normalizeFraction: true,
                    normalizeDecimal: true,
                    numericTolerance: null,
                  },
                })
              }
            />
          ) : (
            <div className="space-y-2">
              {answer.kind === "single_choice"
                ? answer.options.map((option, index) => {
                    const correct = answer.correctOptionId === option.id;
                    const letter = String.fromCharCode(65 + index);
                    return (
                      <motion.div
                        key={option.id}
                        layout
                        transition={authoringMotion.state}
                        className={`authoring-answer-row group flex items-start gap-2 rounded-[13px] border p-2 transition ${correct ? "border-black/[0.09] bg-black/[0.018]" : "border-transparent hover:bg-black/[0.022]"}`}
                      >
                        <motion.button
                          type="button"
                          whileTap={authoringMotion.press}
                          onClick={() =>
                            onChange({
                              ...question,
                              answer: { ...answer, correctOptionId: option.id },
                            })
                          }
                          className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${correct ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                          aria-label={`Mark choice ${letter} correct`}
                          title={`Set ${letter} correct · ⌘${index + 1}`}
                        >
                          {correct ? <Check size={14} strokeWidth={3} /> : letter}
                        </motion.button>
                        <div className="min-w-0 flex-1">
                          <FastQuestionComposer
                            label={`Answer choice ${letter}`}
                            value={option.content}
                            onChange={(content) => updateOption(option.id, content)}
                            placeholder={`Choice ${letter}`}
                            compact
                            assetOwnerId={question.id}
                            capabilities={SAT_CHOICE_COMPOSER_CAPABILITIES}
                            richTriggerAlwaysVisible
                            richTriggerLabel={`Add equation, code, image, graph, or table to choice ${letter}`}
                            minHeightClassName="min-h-[42px]"
                          />
                        </div>
                        <AnimatePresence>
                          {correct ? (
                            <motion.span
                              initial={{ opacity: 0, x: 3 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0 }}
                              className="mt-3 pr-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-700"
                            >
                              Key
                            </motion.span>
                          ) : null}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })
                : null}
            </div>
          )}
        </section>

        <details className="group border-t border-black/[0.06] pt-5">
          <summary className="cursor-pointer list-none text-[12px] font-semibold text-slate-600 marker:hidden hover:text-slate-950">
            Rationale{" "}
            <span className="ml-1 font-normal text-slate-400">Internal · recommended</span>
          </summary>
          <div className="mt-3" data-authoring-field="rationale">
            <FastQuestionComposer
              label="Question rationale"
              value={question.rationale}
              onChange={(rationale) => onChange({ ...question, rationale })}
              placeholder="Explain why the keyed answer is correct and common traps…"
              assetOwnerId={question.id}
              minHeightClassName="min-h-[92px]"
            />
          </div>
        </details>
      </div>

      <div className="authoring-editor-footer sticky bottom-0 z-20 mt-10 flex items-center justify-between border-t border-black/[0.08] px-1 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <SaveState status={saveStatus} verbose />
          <label
            htmlFor="sat-keep-metadata-next"
            className="hidden cursor-pointer items-center gap-1.5 text-[10px] font-medium text-slate-600 sm:flex"
            title="When Save & Next reaches an empty slot, carry Domain, Skill, and Difficulty into the new question."
          >
            <input
              id="sat-keep-metadata-next"
              aria-label="Keep metadata for next question"
              type="checkbox"
              checked={keepMetadataForNext}
              onChange={(event) => onKeepMetadataForNextChange(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-[#0071e3]"
            />
            Keep metadata for next
          </label>
        </div>
        <motion.button
          type="button"
          whileTap={authoringMotion.press}
          transition={authoringMotion.fast}
          onClick={onSaveAndNext}
          disabled={saveStatus === "saving"}
          className="authoring-interactive flex min-h-11 items-center gap-2 rounded-[10px] bg-[#0071e3] px-4 text-[11px] font-semibold text-white hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] focus-visible:ring-offset-2 disabled:opacity-45"
          title="Save and move to the next question (⌘Return)"
        >
          Save & Next <ChevronRight size={13} />
        </motion.button>
      </div>
    </article>
  );
}

function EditorSection({
  field,
  label,
  hint,
  priority = false,
  children,
}: {
  field: string;
  label: string;
  hint: string;
  priority?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section data-authoring-field={field}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span
          className={
            priority
              ? "text-[14px] font-semibold text-slate-950"
              : "text-[12px] font-semibold text-slate-700"
          }
        >
          {label}
        </span>
        <span
          className={`text-[10px] ${priority ? "font-medium text-slate-600" : "text-slate-500"}`}
        >
          {hint}
        </span>
      </div>
      {children}
    </section>
  );
}

function SatSupportingMaterialStarters({
  sectionKey,
  onSelect,
}: {
  sectionKey: string;
  onSelect: (starter: SatSupportingMaterialStarter) => void;
}) {
  const starters: Array<{ key: SatSupportingMaterialStarter; label: string }> =
    sectionKey === "reading-writing"
      ? [
          { key: "paired_texts", label: "Paired texts" },
          { key: "student_notes", label: "Student notes" },
          { key: "data_table", label: "Data table" },
        ]
      : [{ key: "data_table", label: "Data table" }];

  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1.5"
      aria-label="Supporting material starters"
    >
      <span className="mr-1 text-[10px] font-medium text-slate-400">Quick start</span>
      {starters.map((starter) => (
        <button
          key={starter.key}
          type="button"
          onClick={() => onSelect(starter.key)}
          className="rounded-[9px] bg-black/[0.045] px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 transition hover:bg-black/[0.075] hover:text-slate-900"
        >
          {starter.label}
        </button>
      ))}
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
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 rounded-[8px] px-3 text-[10px] font-semibold transition ${active ? "bg-white text-slate-950 shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-slate-500 hover:text-slate-800"}`}
    >
      {children}
    </button>
  );
}

function ReadinessLabel({ ready }: { ready: boolean }) {
  return (
    <span className={`flex items-center gap-1 ${ready ? "text-emerald-600" : "text-slate-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-slate-300"}`} />
      {ready ? "Core complete" : "Incomplete"}
    </span>
  );
}

function SaveState({
  status,
  verbose = false,
}: {
  status: QuestionEditorProps["saveStatus"];
  verbose?: boolean;
}) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "unsaved"
        ? "Changes pending"
        : status === "error"
          ? "Save failed"
          : "Saved";
  return (
    <span
      className={`text-[10px] font-medium ${status === "error" ? "text-red-600" : status === "saved" ? "text-emerald-600" : "text-slate-400"}`}
    >
      {verbose && status === "unsaved" ? "Autosave pending · ⌘S saves now" : label}
    </span>
  );
}
