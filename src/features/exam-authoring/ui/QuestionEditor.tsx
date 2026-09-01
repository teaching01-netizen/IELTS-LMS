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
import { AuthoringSegmented } from "./AuthoringSegmented";
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
    <article
      className="authoring-editor-sheet mx-auto my-5 w-[calc(100%-2rem)] max-w-[940px] px-6 pb-24 pt-7 sm:my-7 sm:px-10 sm:pt-9"
      data-committing={saveStatus === "saving" || undefined}
    >
      <header className="mb-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold tracking-[-0.035em] text-slate-950">
              {questionNumber ? `Question ${questionNumber}` : "Edit question"}
            </h2>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
              <ReadinessLabel ready={promptReady && answerReady} />
              <span aria-hidden="true" className="text-slate-300">·</span>
              <SaveState status={saveStatus} />
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onDuplicate}
              className="authoring-interactive flex min-h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-slate-600 hover:bg-au-fill"
              title="Duplicate question (⌘D)"
            >
              <Copy size={13} aria-hidden="true" />
              Duplicate
            </button>
            <button
              type="button"
              onClick={() => setMoreOpen((value) => !value)}
              className="authoring-interactive flex h-9 w-9 items-center justify-center rounded-[10px] text-slate-500 hover:bg-au-fill"
              aria-label="More question actions"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={15} aria-hidden="true" />
            </button>
            {moreOpen ? (
              <div
                role="menu"
                className="au-elevation-menu absolute right-0 top-11 z-40 min-w-44 rounded-[12px] border border-au-separator bg-white p-1.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onSaveNow();
                  }}
                  role="menuitem"
                  className="flex min-h-10 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px] font-semibold text-slate-700 hover:bg-au-fill"
                >
                  <Save size={12} aria-hidden="true" />
                  Save now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setDeleteOpen(true);
                  }}
                  role="menuitem"
                  className="flex min-h-10 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px] font-semibold text-au-danger-text hover:bg-au-danger-tint"
                >
                  <Trash2 size={12} aria-hidden="true" />
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
      </header>

      <div className="mt-8 border-t border-au-separator pt-7" data-authoring-hot-editor>
        <p className="mb-4 text-[13px] font-semibold tracking-[-0.01em] text-slate-800">Build this question</p>
        <div className="space-y-6">
        <EditorSection field="prompt" label="Question prompt" hint="Required" priority>
          <FastQuestionComposer
            label="Question prompt"
            value={question.prompt}
            onChange={(prompt) => onChange({ ...question, prompt })}
            placeholder="Write the exact question students will see…"
            assetOwnerId={question.id}
            minHeightClassName="min-h-[112px]"
          />
        </EditorSection>

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

        <section data-authoring-field="answer" className="border-t border-au-separator pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900">Answer</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Set the response type and key without leaving the editing flow.
              </p>
            </div>
            <AuthoringSegmented
              ariaLabel="Response type"
              layoutId="sat-response-type"
              value={isSpr ? "spr" : "choice"}
              onChange={(kind) =>
                changeKind(kind === "spr" ? "student_produced_response" : "single_choice")
              }
              options={[
                { value: "choice", label: "Multiple choice" },
                ...(question.metadata.sectionKey === "math"
                  ? [{ value: "spr" as const, label: "Student response" }]
                  : []),
              ]}
            />
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
                        className={`authoring-answer-row group flex items-start gap-2 rounded-[12px] border p-2 transition ${correct ? "border-au-success/25 bg-au-success/[0.05]" : "border-transparent hover:bg-au-fill"}`}
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
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[12px] font-bold ${correct ? "bg-au-success-text text-white" : "bg-au-fill-strong text-slate-600 hover:bg-au-fill-press"}`}
                          aria-label={`Mark choice ${letter} correct`}
                          aria-pressed={correct}
                          title={`Set ${letter} correct · ⌘${index + 1}`}
                        >
                          {correct ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : letter}
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
                            minHeightClassName="min-h-[42px]"
                          />
                        </div>
                        <AnimatePresence>
                          {correct ? (
                            <motion.span
                              initial={{ opacity: 0, x: 3 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0 }}
                              transition={authoringMotion.fast}
                              className="mt-3 pr-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-au-success-text"
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

        <details className="group border-t border-au-separator pt-5">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-slate-700 marker:hidden transition-colors hover:text-slate-950">
            <ChevronRight size={12} aria-hidden="true" className="text-slate-400 transition-transform duration-200 group-open:rotate-90" />
            Rationale
            <span className="font-normal text-slate-400">Internal · recommended</span>
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
      </div>

      <div className="authoring-editor-footer sticky bottom-3 z-20 mt-10 flex items-center justify-between gap-3 rounded-[14px] border border-au-separator px-3.5 py-2.5 shadow-[0_0_0_0.5px_rgba(0,0,0,0.03),0_8px_28px_rgba(0,0,0,0.08)]">
        <div className="flex min-w-0 items-center gap-3">
          <SaveState status={saveStatus} verbose />
          <label
            htmlFor="sat-keep-metadata-next"
            className="hidden cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-600 sm:flex"
            title="When Save & Next reaches an empty slot, carry Domain, Skill, and Difficulty into the new question."
          >
            <input
              id="sat-keep-metadata-next"
              aria-label="Keep metadata for next question"
              type="checkbox"
              checked={keepMetadataForNext}
              onChange={(event) => onKeepMetadataForNextChange(event.target.checked)}
              className="h-4 w-4 rounded border-au-separator accent-au-accent"
            />
            Carry metadata
          </label>
        </div>
        <motion.button
          type="button"
          whileTap={authoringMotion.press}
          transition={authoringMotion.fast}
          onClick={onSaveAndNext}
          disabled={saveStatus === "saving"}
          className="authoring-interactive flex min-h-10 items-center gap-2 rounded-[11px] bg-au-accent px-4 text-[13px] font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent focus-visible:ring-offset-2 disabled:opacity-45"
          title="Save and move to the next question (⌘Return)"
        >
          Save & Next <ChevronRight size={13} aria-hidden="true" />
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
      <span className="mr-1 text-[11px] font-medium text-slate-400">Quick start</span>
      {starters.map((starter) => (
        <button
          key={starter.key}
          type="button"
          onClick={() => onSelect(starter.key)}
          className="authoring-interactive rounded-[9px] bg-au-fill px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-au-fill-strong hover:text-slate-900"
        >
          {starter.label}
        </button>
      ))}
    </div>
  );
}

function ReadinessLabel({ ready }: { ready: boolean }) {
  return (
    <span className={`flex items-center gap-1 ${ready ? "text-au-success-text" : "text-slate-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-au-success" : "bg-black/[0.2]"}`} aria-hidden="true" />
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
      className={`text-[10px] font-medium ${status === "error" ? "text-au-danger-text" : status === "saved" ? "text-au-success-text" : "text-slate-400"}`}
    >
      {verbose && status === "unsaved" ? "Autosave pending · ⌘S saves now" : label}
    </span>
  );
}
