import { useState } from "react";
import { Copy, Save } from "lucide-react";
import type {
  AssessmentValidationIssue,
  QuestionRevision,
  StructuredContent,
} from "../../contracts/assessment";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";
import { FastQuestionComposer } from "../../editor/FastQuestionComposer";
import {
  createSatSupportingMaterial,
  type SatSupportingMaterialStarter,
} from "../../providers/sat/contentTemplates";
import { hasStructuredContent, plainTextFromContent } from "../../editor/richContent";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import { ClassificationFieldset } from "./ClassificationFieldset";
import { AnswerKeyField } from "./AnswerKeyField";
import { SatStudentResponseEditor } from "../SatStudentResponseEditor";
import { AuthoringSegmented } from "../AuthoringSegmented";
import { ValidationChecklist } from "./ValidationChecklist";
import { SpineSaveFooter } from "./SpineSaveFooter";

export interface SpineQuestionViewProps {
  question: QuestionRevision;
  questionNumber?: number | undefined;
  saveStatus: QuestionSaveStatus;
  lastSavedAt: Date | null;
  issues: AssessmentValidationIssue[];
  keepMetadataForNext: boolean;
  onKeepMetadataForNextChange: (value: boolean) => void;
  onChange: (question: QuestionRevision) => void;
  onSaveNow: () => void;
  onSaveAndNext: () => void;
  onRetrySave: () => void;
  onDuplicate: () => void;
  onDelete: () => boolean | Promise<boolean>;
  onPreview: () => void;
  onIssueSelect: (field: string | null) => void;
}

function emptyContent(): StructuredContent {
  return { version: 2, nodes: [], document: { type: "doc", content: [{ type: "paragraph" }] } };
}

/**
 * Spine question view (plan Phases 4-7): single-column order — prompt,
 * supporting material, ClassificationFieldset, answer key, rationale
 * (disclosed), ValidationChecklist, footer save cluster. One spine: no
 * QuestionMetadataBar / QuestionProperties / inspector-tab copies.
 */
export function SpineQuestionView({
  question,
  questionNumber,
  saveStatus,
  lastSavedAt,
  issues,
  keepMetadataForNext,
  onKeepMetadataForNextChange,
  onChange,
  onSaveNow,
  onSaveAndNext,
  onRetrySave,
  onDuplicate,
  onDelete,
  onPreview,
  onIssueSelect,
}: SpineQuestionViewProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pendingQuestionType, setPendingQuestionType] = useState<
    QuestionRevision["questionType"] | null
  >(null);
  const answer = question.answer;
  const isSpr = answer.kind === "student_produced_response";
  const stimulusEmpty = !hasStructuredContent(question.stimulus);

  const applyKindChange = (kind: QuestionRevision["questionType"]) => {
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

  const changeKind = (kind: QuestionRevision["questionType"]) => {
    if (kind === question.questionType) return;
    const answerHasContent =
      question.answer.kind === "single_choice"
        ? Boolean(question.answer.correctOptionId) ||
          question.answer.options.some(
            (option) =>
              hasStructuredContent(option.content) || plainTextFromContent(option.content).trim(),
          )
        : question.answer.acceptedResponses.some((response) => response.trim().length > 0);
    if (answerHasContent) {
      setPendingQuestionType(kind);
      return;
    }
    applyKindChange(kind);
  };

  return (
    <article aria-labelledby="spine-question-heading">
      <header className="mb-7 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="spine-question-heading" className="text-[22px] font-semibold tracking-tight text-foreground">
            {questionNumber ? `Question ${questionNumber}` : "Edit question"}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onPreview}
            aria-label="Preview question as students will see it"
            title="Preview as students will see it (Space)"
            className="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicate question"
            className="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Copy size={13} aria-hidden="true" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={onSaveNow}
            aria-label="Save now"
            title="Save now"
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Save size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="space-y-6">
        <section data-authoring-field="prompt">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-foreground">Question prompt</span>
            <span className="text-[10px] font-medium text-muted-foreground">Required</span>
          </div>
          <FastQuestionComposer
            label="Question prompt"
            value={question.prompt}
            onChange={(prompt) => onChange({ ...question, prompt })}
            placeholder="Write the exact question students will see…"
            assetOwnerId={question.id}
            minHeightClassName="min-h-[112px]"
          />
        </section>

        <section data-authoring-field="stimulus">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold text-muted-foreground">Supporting material</span>
            <span className="text-[10px] text-muted-foreground">Optional</span>
          </div>
          {stimulusEmpty ? (
            <SpineSupportingStarters
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
        </section>

        <ClassificationFieldset question={question} onChange={onChange} issues={issues} />

        <div className="border-t border-border pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Set the response type and key without leaving the editing flow.
            </p>
            <AuthoringSegmented
              ariaLabel="Response type"
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
            <AnswerKeyField question={question} onChange={onChange} />
          )}
        </div>

        <details className="rounded-lg border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-foreground marker:hidden">
            <span>Rationale</span>
            <span className="text-xs font-normal text-muted-foreground">Internal · recommended</span>
          </summary>
          <div className="border-t border-border p-4" data-authoring-field="rationale">
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

        <ValidationChecklist
          issues={issues}
          onIssueSelect={(selected) => onIssueSelect(selected.field ?? selected.path)}
        />

        <SpineSaveFooter
          status={saveStatus}
          lastSavedAt={lastSavedAt}
          keepMetadataForNext={keepMetadataForNext}
          saveDisabled={saveStatus === "saving"}
          onKeepMetadataForNextChange={onKeepMetadataForNextChange}
          onSaveAndNext={onSaveAndNext}
          onRetry={onRetrySave}
        />
      </div>

      <AuthoringConfirmDialog
        open={pendingQuestionType !== null}
        title="Change response type?"
        description="Changing the response type replaces the current answer key and response choices. This cannot be undone from the editor."
        confirmLabel="Change response type"
        destructive
        onCancel={() => setPendingQuestionType(null)}
        onConfirm={() => {
          const nextType = pendingQuestionType;
          setPendingQuestionType(null);
          if (nextType) applyKindChange(nextType);
        }}
      />
      <AuthoringConfirmDialog
        open={deleteOpen}
        title="Delete this question?"
        description="The question will be removed from this SAT module. Cancel is focused by default."
        confirmLabel={deleteBusy ? "Working…" : "Delete question"}
        destructive
        busy={deleteBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          void (async () => {
            if (deleteBusy) return;
            setDeleteBusy(true);
            try {
              if (await onDelete()) setDeleteOpen(false);
            } finally {
              setDeleteBusy(false);
            }
          })();
        }}
      />
    </article>
  );
}

function SpineSupportingStarters({
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
    <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Supporting material starters">
      <span className="mr-1 text-xs font-medium text-muted-foreground">Quick start</span>
      {starters.map((starter) => (
        <button
          key={starter.key}
          type="button"
          onClick={() => onSelect(starter.key)}
          className="rounded-md bg-muted px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          {starter.label}
        </button>
      ))}
    </div>
  );
}
