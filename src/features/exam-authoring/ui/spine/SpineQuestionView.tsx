import { useState } from "react";
import { ChevronRight, Copy, Save } from "lucide-react";
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
import { SpineFieldLabel } from "./SpineFieldLabel";
import { SpineStep } from "./SpineStep";
import { SaveCluster } from "./SaveCluster";
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
        <div className="flex shrink-0 items-center gap-1.5">
          <SaveCluster status={saveStatus} lastSavedAt={lastSavedAt} onRetry={onRetrySave} />
          <button
            type="button"
            onClick={onPreview}
            aria-label="Preview question as students will see it"
            title="Preview as students will see it (Space)"
            className="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicate question"
            className="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
          >
            <Copy size={13} aria-hidden="true" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={onSaveNow}
            disabled={saveStatus === "saving"}
            aria-label="Save now"
            title="Save now"
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:opacity-45"
          >
            <Save size={14} aria-hidden="true" />
            {saveStatus === "saving" ? "Saving…" : "Save now"}
          </button>
        </div>
      </header>

      <div className="space-y-6">
        <SpineStep step="01" title="Prompt" field="prompt">
          <SpineFieldLabel label="Question prompt" required />
          <FastQuestionComposer
            label="Question prompt"
            value={question.prompt}
            onChange={(prompt) => onChange({ ...question, prompt })}
            placeholder="Write the exact question students will see…"
            assetOwnerId={question.id}
            minHeightClassName="min-h-[112px]"
          />
        </SpineStep>

        <SpineStep step="02" title="Supporting material" field="stimulus">
          <SpineFieldLabel label="Supporting material" required={false} />
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
        </SpineStep>

        <SpineStep step="03" title="Classification">
          <ClassificationFieldset question={question} onChange={onChange} issues={issues} />
        </SpineStep>

        <SpineStep step="04" title="Answer key">
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
        </SpineStep>

        <SpineStep step="05" title="Rationale">
        <details className="group rounded-lg border border-border transition-colors duration-150 open:bg-muted/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground transition-transform duration-150 group-open:rotate-90" />
              <span>Rationale</span>
            </span>
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
        </SpineStep>

        <SpineStep step="06" title="Validation">
        <ValidationChecklist
          issues={issues}
          onIssueSelect={(selected) => onIssueSelect(selected.field ?? selected.path)}
        />
        </SpineStep>

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
    <div className="mb-2">
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Supporting material starters">
      <span className="mr-1 text-xs font-medium text-muted-foreground">Quick start</span>
      {starters.map((starter) => (
        <button
          key={starter.key}
          type="button"
          onClick={() => onSelect(starter.key)}
          className="rounded-md bg-muted px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.95]"
        >
          {starter.label}
        </button>
      ))}
    </div>
    <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">Students see this above the question.</p>
    </div>
  );
}
