import { useEffect, useState, type ReactNode } from "react";
import type {
  AssessmentValidationIssue,
  QuestionRevision,
  StructuredContent,
} from "../../contracts/assessment";
import type {
  RichComposerCollaboration,
  SmartPasteStatus,
} from "../../editor/RichQuestionComposer";
import type {
  AnalyzeWholeQuestionInput,
  SuggestionOutcome,
  WholeQuestionAnalysis,
} from "../../editor/ingestion/exam/wholeQuestionTypes";
import { analyzeWholeQuestion, toOutcome } from "../../editor/ingestion/exam";
import { buildSplitQuestion } from "../../editor/ingestion/exam/applyWholeQuestionSplit";
import { ImportSuggestion } from "./ImportSuggestion";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";
import { FastQuestionComposer } from "../../editor/FastQuestionComposer";
import {
  createSatSupportingMaterial,
  type SatSupportingMaterialStarter,
} from "../../providers/sat/contentTemplates";
import { hasStructuredContent, plainTextFromContent } from "../../editor/richContent";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import { AnswerKeyField } from "./AnswerKeyField";
import { SatStudentResponseEditor } from "../SatStudentResponseEditor";
import { AuthoringSegmented } from "../AuthoringSegmented";
import { SpineSaveFooter } from "./SpineSaveFooter";
import { QuestionHeader } from './QuestionHeader';
import { SectionRule } from './SectionRule';
import { issuesForField } from './readinessFamilies';

export interface SpineQuestionViewProps {
  question: QuestionRevision;
  focusField?: string | null | undefined;
  onRequestDelete?: (()=>void)|undefined;
  onOpenSettings?: (()=>void)|undefined;
  onMove?: ((direction:-1|1)=>void)|undefined;
  canMoveUp?: boolean|undefined;
  canMoveDown?: boolean|undefined;
  readOnly?: boolean | undefined;
  isMutating?: boolean|undefined;
  questionNumber?: number | undefined;
  questionContext?: string | null | undefined;
  headerPresenceSlot?: ReactNode;
  headerSaveSlot?: ReactNode;
  hideFooterSaveStatus?: boolean | undefined;
  saveStatus: QuestionSaveStatus;
  lastSavedAt: Date | null;
  /**
   * Phase 05: the open question has unsaved work AND a newer revision exists.
   * Threaded to the footer save cluster so both SaveCluster render sites speak
   * one vocabulary — the footer is the one directly under the editor, so it is
   * the one an author actually reads while typing.
   */
  diverged?: boolean | undefined;
  issues: AssessmentValidationIssue[];
  /**
   * Prompt binding for the selected question, owned by AuthoringWorkspace.
   * Absent means the legacy non-collaborative editor. In the SAT workspace,
   * the same Yjs room also supplies `fieldCollaboration` for supporting
   * material, answer choices, and rationale.
   */
  promptCollaboration?: RichComposerCollaboration | undefined;
  /** Exam-workspace bindings for every rich field on the selected question. */
  fieldCollaboration?: ((fieldPath: string) => RichComposerCollaboration | null | undefined) | undefined;
  keepMetadataForNext: boolean;
  onKeepMetadataForNextChange: (value: boolean) => void;
  onChange: (question: QuestionRevision) => void;
  /** Local rich-editor transactions only; remote Yjs projections never call this. */
  onLocalRichChange?: ((question: QuestionRevision) => void) | undefined;
  onSaveNow: () => void;
  onSaveAndNext: () => void;
  onRetrySave: () => void;
  onReviewConflict?: (() => void) | undefined;
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
export function SpineQuestionView(props:SpineQuestionViewProps) { return <QuestionCanvas key={props.question.id} {...props}/>; }

function QuestionCanvas({
  focusField,onRequestDelete,onOpenSettings,onMove,canMoveUp,canMoveDown,isMutating,
  readOnly = false,
  question,
  questionNumber,
  questionContext,
  headerPresenceSlot,
  headerSaveSlot,
  hideFooterSaveStatus = false,
  saveStatus,
  lastSavedAt,
  diverged = false,
  issues,
  promptCollaboration,
  fieldCollaboration,
  keepMetadataForNext,
  onKeepMetadataForNextChange,
  onChange,
  onLocalRichChange,
  onSaveAndNext,
  onRetrySave,
  onReviewConflict,
  onDuplicate,
  onDelete,
  onPreview,
  onIssueSelect,
}: SpineQuestionViewProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pendingStarter, setPendingStarter] = useState<SatSupportingMaterialStarter | null>(null);
  const [pendingQuestionType, setPendingQuestionType] = useState<
    QuestionRevision["questionType"] | null
  >(null);
  const [suggestion, setSuggestion] = useState<{
    field: AnalyzeWholeQuestionInput["targetField"];
    analysis: WholeQuestionAnalysis;
    sectionKey: AnalyzeWholeQuestionInput["sectionKey"];
  } | null>(null);
  const [, setSuggestionOutcome] = useState<SuggestionOutcome | null>(null);
  /**
   * Whole-question split uses the shared roots in the exam workspace. The
   * legacy question-scoped room still blocks it because that room owns only
   * the prompt and cannot safely apply the other fields as one operation.
   */
  const [coeditSplitBlocked, setCoeditSplitBlocked] = useState(false);
  const sectionKeyForAnalysis = (question.metadata.sectionKey === "math" ? "math" : "reading-writing") as AnalyzeWholeQuestionInput["sectionKey"];
  const handleSmartPaste =
    (field: AnalyzeWholeQuestionInput["targetField"]) =>
    (info: SmartPasteStatus) => {
      if (!info.document) {
        setSuggestion(null);
        return;
      }
      const analysis = analyzeWholeQuestion({
        pasted: info.document,
        targetField: field,
        sectionKey: sectionKeyForAnalysis,
        pastedPlainText: info.pastedPlainText ?? "",
      });
      setSuggestionOutcome(null);
      setSuggestion(analysis.band === "suggest" ? { field, analysis, sectionKey: sectionKeyForAnalysis } : null);
    };
  const acceptSuggestion = (): void => {
    if (!suggestion) return;
    if (promptCollaboration && !fieldCollaboration) {
      // The legacy question-scoped room only owns the prompt. A whole-question
      // import would otherwise send a stale prompt through the partial-save
      // path. The exam-level SAT workspace owns every field, so it can apply
      // the same replacement through the shared roots below.
      setCoeditSplitBlocked(true);
      return;
    }
    const next = buildSplitQuestion(question, suggestion.analysis);
    onChange(next);
    if (fieldCollaboration) onLocalRichChange?.(next);
    setSuggestionOutcome(toOutcome(suggestion.analysis, suggestion.sectionKey, true));
    setSuggestion(null);
  };
  const dismissSuggestion = (outcome: SuggestionOutcome): void => {
    setSuggestionOutcome(outcome);
    setSuggestion(null);
    setCoeditSplitBlocked(false);
  };
  useEffect(() => {
    setSuggestion(null);
    setSuggestionOutcome(null);
    setCoeditSplitBlocked(false);
  }, [question.id]);
  const answer = question.answer;
  const isSpr = answer.kind === "student_produced_response";
  const stimulusEmpty = !hasStructuredContent(question.stimulus);
  const [expanded,setExpanded]=useState({stimulus:false,rationale:false});
  useEffect(()=>{if(focusField==='stimulus'||focusField==='rationale')setExpanded(current=>({...current,[focusField]:true}));},[focusField]);
  const showStimulus=!stimulusEmpty||expanded.stimulus||focusField==='stimulus';
  const showRationale=hasStructuredContent(question.rationale)||expanded.rationale||focusField==='rationale';
  const jump=(field:string|null)=>{if(field?.startsWith('stimulus'))setExpanded(current=>({...current,stimulus:true}));if(field?.startsWith('rationale'))setExpanded(current=>({...current,rationale:true}));onIssueSelect(field);};
  const promptBinding = promptCollaboration ?? fieldCollaboration?.("prompt") ?? undefined;

  const applyKindChange = (kind: QuestionRevision["questionType"]) => {
    if (kind === "student_produced_response") {
      const next = {
        ...question,
        questionType: kind,
        answer: {
          kind,
          acceptedResponses: [],
          normalizeFraction: true,
          normalizeDecimal: true,
          numericTolerance: null,
        },
      };
      onChange(next);
      if (fieldCollaboration) onLocalRichChange?.(next);
      return;
    }
    const next = {
      ...question,
      questionType: kind,
      answer: {
        kind,
        options: ["A", "B", "C", "D"].map((id) => ({ id, content: emptyContent() })),
        correctOptionId: null,
      },
    };
    onChange(next);
    if (fieldCollaboration) onLocalRichChange?.(next);
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
      <QuestionHeader number={questionNumber} contextLabel={questionContext} presenceSlot={headerPresenceSlot} saveSlot={headerSaveSlot} issues={issues} onIssueSelect={jump} onPreview={onPreview} onDuplicate={onDuplicate} onDelete={onRequestDelete??(()=>setDeleteOpen(true))} onSettings={onOpenSettings} onMove={onMove} canMoveUp={canMoveUp} canMoveDown={canMoveDown} busy={isMutating} readOnly={readOnly}/>
      <div className="space-y-10">
        <SectionRule title="Question" field="prompt" issues={issuesForField(issues,'prompt')}>
          <FastQuestionComposer label="Question prompt" value={question.prompt} onChange={prompt=>onChange({...question,prompt})} {...(onLocalRichChange && !promptBinding ? { onLocalChange: prompt => onLocalRichChange({...question,prompt}) } : {})} placeholder="Write or paste your question…" assetOwnerId={question.questionId} minHeightClassName="min-h-[140px]" onSmartPaste={handleSmartPaste("prompt")} {...(promptBinding ? { collaboration: promptBinding } : {})}/>
          {suggestion?.field === "prompt" ? <ImportSuggestion analysis={suggestion.analysis} targetField="prompt" sectionKey={suggestion.sectionKey} onAccept={acceptSuggestion} onDismiss={dismissSuggestion} onOutcome={setSuggestionOutcome}/> : null}
          {coeditSplitBlocked ? (
            <p role="status" className="text-xs leading-5 text-slate-500">
              This prompt is being edited collaboratively, so the whole-question suggestion can’t
              be applied. Dismiss it and paste into the prompt normally.
            </p>
          ) : null}
        </SectionRule>
        <SectionRule title="Supporting material" field="stimulus" hint="Optional" issues={issuesForField(issues,'stimulus')} actions={showStimulus?<label htmlFor="supporting-type" className="flex items-center gap-2 text-xs text-muted-foreground">Type<select id="supporting-type" aria-label="Supporting material type" value="" disabled={readOnly} className="min-h-11 max-w-44 rounded-md bg-transparent px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" onChange={e=>{const starter=e.target.value as SatSupportingMaterialStarter;if(!starter)return;const next={...question,stimulus:createSatSupportingMaterial(starter)};if(stimulusEmpty){onChange(next);onLocalRichChange?.(next);}else setPendingStarter(starter);}}><option value="">{stimulusEmpty?'Choose a starter':'Change type…'}</option>{question.metadata.sectionKey==='reading-writing'?<><option value="paired_texts">Paired texts</option><option value="student_notes">Student notes</option></>:null}<option value="data_table">Data table</option></select></label>:undefined}>
          {showStimulus?<FastQuestionComposer label="Supporting material" value={question.stimulus} onChange={stimulus=>onChange({...question,stimulus})} {...(onLocalRichChange && !fieldCollaboration?.("stimulus") ? { onLocalChange: stimulus => onLocalRichChange({...question,stimulus}) } : {})} placeholder="Passage, context, data, equation, table, or visual…" assetOwnerId={question.questionId} minHeightClassName="min-h-[120px]" onSmartPaste={handleSmartPaste("stimulus")} {...(fieldCollaboration?.("stimulus") ? { collaboration: fieldCollaboration("stimulus")! } : {})}/> :<button type="button" disabled={readOnly} className="sat-spine__add-content disabled:cursor-not-allowed disabled:opacity-50" onClick={()=>setExpanded(current=>({...current,stimulus:true}))}>+ Add supporting material</button>}
          {suggestion?.field === "stimulus" ? <ImportSuggestion analysis={suggestion.analysis} targetField="stimulus" sectionKey={suggestion.sectionKey} onAccept={acceptSuggestion} onDismiss={dismissSuggestion} onOutcome={setSuggestionOutcome}/> : null}
        </SectionRule>
        <SectionRule title="Answer" field="answer" issues={issuesForField(issues,'answer')} actions={<AuthoringSegmented ariaLabel="Response type" value={isSpr?'spr':'choice'} disabled={readOnly} onChange={kind=>changeKind(kind==='spr'?'student_produced_response':'single_choice')} options={[{value:'choice',label:'Multiple choice'},...(question.metadata.sectionKey==='math'?[{value:'spr' as const,label:'Student response'}]:[])]}/>}>
          {isSpr?<SatStudentResponseEditor acceptedResponses={answer.acceptedResponses} readOnly={readOnly} onChange={acceptedResponses=>onChange({...question,answer:{...answer,acceptedResponses}})}/>:<AnswerKeyField question={question} readOnly={readOnly} onChange={onChange} {...(onLocalRichChange && !fieldCollaboration ? { onLocalChange: onLocalRichChange } : {})} {...(fieldCollaboration ? { collaborationFor: (optionId) => fieldCollaboration(`choice/${optionId}`) } : {})}/>}
        </SectionRule>
        <SectionRule title="Explanation" field="rationale" hint="Optional" issues={issuesForField(issues,'rationale')}>
          {showRationale?<FastQuestionComposer label="Question explanation" value={question.rationale} onChange={rationale=>onChange({...question,rationale})} {...(onLocalRichChange && !fieldCollaboration?.("rationale") ? { onLocalChange: rationale => onLocalRichChange({...question,rationale}) } : {})} placeholder="Explain why the answer is correct…" assetOwnerId={question.questionId} minHeightClassName="min-h-[120px]" onSmartPaste={handleSmartPaste("rationale")} {...(fieldCollaboration?.("rationale") ? { collaboration: fieldCollaboration("rationale")! } : {})}/> :<button type="button" disabled={readOnly} className="sat-spine__add-content disabled:cursor-not-allowed disabled:opacity-50" onClick={()=>setExpanded(current=>({...current,rationale:true}))}>+ Add an explanation…</button>}
          {suggestion?.field === "rationale" ? <ImportSuggestion analysis={suggestion.analysis} targetField="rationale" sectionKey={suggestion.sectionKey} onAccept={acceptSuggestion} onDismiss={dismissSuggestion} onOutcome={setSuggestionOutcome}/> : null}
        </SectionRule>
        <SpineSaveFooter status={saveStatus} lastSavedAt={lastSavedAt} diverged={diverged} showSaveStatus={!hideFooterSaveStatus} keepMetadataForNext={keepMetadataForNext} saveDisabled={readOnly || saveStatus==='saving'||Boolean(isMutating)} onKeepMetadataForNextChange={onKeepMetadataForNextChange} onSaveAndNext={onSaveAndNext} onRetry={onRetrySave} onReviewConflict={onReviewConflict}/>
      </div>

      <AuthoringConfirmDialog
        open={pendingStarter !== null}
        title="Replace supporting material?"
        description="This replaces the current passage, notes, table, or visual with the starter layout. Your existing material cannot be recovered from the editor."
        confirmLabel="Replace material"
        destructive
        onCancel={() => setPendingStarter(null)}
        onConfirm={() => {
          const starter = pendingStarter;
          setPendingStarter(null);
          if (starter) {
            const next = { ...question, stimulus: createSatSupportingMaterial(starter) };
            onChange(next);
            onLocalRichChange?.(next);
          }
        }}
      />
      <AuthoringConfirmDialog
        open={pendingQuestionType !== null}
        title="Change response type?"
        description="Only the answer key is replaced — prompt, supporting material, rationale, classification, and accessibility are kept. The current key cannot be recovered from the editor."
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
