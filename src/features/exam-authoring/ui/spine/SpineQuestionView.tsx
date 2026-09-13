import { useEffect, useState } from "react";
import type {
  AssessmentValidationIssue,
  QuestionRevision,
  StructuredContent,
} from "../../contracts/assessment";
import type { SmartPasteStatus } from "../../editor/RichQuestionComposer";
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
  isMutating?: boolean|undefined;
  questionNumber?: number | undefined;
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
  keepMetadataForNext: boolean;
  onKeepMetadataForNextChange: (value: boolean) => void;
  onChange: (question: QuestionRevision) => void;
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
  question,
  questionNumber,
  saveStatus,
  lastSavedAt,
  diverged = false,
  issues,
  keepMetadataForNext,
  onKeepMetadataForNextChange,
  onChange,
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
    onChange(buildSplitQuestion(question, suggestion.analysis));
    setSuggestionOutcome(toOutcome(suggestion.analysis, suggestion.sectionKey, true));
    setSuggestion(null);
  };
  const dismissSuggestion = (outcome: SuggestionOutcome): void => {
    setSuggestionOutcome(outcome);
    setSuggestion(null);
  };
  useEffect(() => {
    setSuggestion(null);
    setSuggestionOutcome(null);
  }, [question.id]);
  const answer = question.answer;
  const isSpr = answer.kind === "student_produced_response";
  const stimulusEmpty = !hasStructuredContent(question.stimulus);
  const [expanded,setExpanded]=useState({stimulus:false,rationale:false});
  useEffect(()=>{if(focusField==='stimulus'||focusField==='rationale')setExpanded(current=>({...current,[focusField]:true}));},[focusField]);
  const showStimulus=!stimulusEmpty||expanded.stimulus||focusField==='stimulus';
  const showRationale=hasStructuredContent(question.rationale)||expanded.rationale||focusField==='rationale';
  const jump=(field:string|null)=>{if(field?.startsWith('stimulus'))setExpanded(current=>({...current,stimulus:true}));if(field?.startsWith('rationale'))setExpanded(current=>({...current,rationale:true}));onIssueSelect(field);};

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
      <QuestionHeader number={questionNumber} issues={issues} onIssueSelect={jump} onPreview={onPreview} onDuplicate={onDuplicate} onDelete={onRequestDelete??(()=>setDeleteOpen(true))} onSettings={onOpenSettings} onMove={onMove} canMoveUp={canMoveUp} canMoveDown={canMoveDown} busy={isMutating}/>
      <div className="space-y-10">
        <SectionRule title="Question" field="prompt" required issues={issuesForField(issues,'prompt')}>
          <FastQuestionComposer label="Question prompt" value={question.prompt} onChange={prompt=>onChange({...question,prompt})} placeholder="Write the question students will see…" assetOwnerId={question.questionId} minHeightClassName="min-h-[112px]" onSmartPaste={handleSmartPaste("prompt")}/>
          {suggestion?.field === "prompt" ? <ImportSuggestion analysis={suggestion.analysis} targetField="prompt" sectionKey={suggestion.sectionKey} onAccept={acceptSuggestion} onDismiss={dismissSuggestion} onOutcome={setSuggestionOutcome}/> : null}
        </SectionRule>
        <SectionRule title="Supporting material" field="stimulus" issues={issuesForField(issues,'stimulus')} actions={showStimulus?<label htmlFor="supporting-type" className="flex items-center gap-2 text-xs text-muted-foreground">Type<select id="supporting-type" aria-label="Supporting material type" value="" className="min-h-11 max-w-44 rounded-md bg-transparent px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring" onChange={e=>{const starter=e.target.value as SatSupportingMaterialStarter;if(!starter)return;if(stimulusEmpty)onChange({...question,stimulus:createSatSupportingMaterial(starter)});else setPendingStarter(starter);}}><option value="">{stimulusEmpty?'Choose a starter':'Change type…'}</option>{question.metadata.sectionKey==='reading-writing'?<><option value="paired_texts">Paired texts</option><option value="student_notes">Student notes</option></>:null}<option value="data_table">Data table</option></select></label>:undefined}>
          {showStimulus?<FastQuestionComposer label="Supporting material" value={question.stimulus} onChange={stimulus=>onChange({...question,stimulus})} placeholder="Passage, context, data, equation, table, or visual…" assetOwnerId={question.questionId} minHeightClassName="min-h-[92px]" onSmartPaste={handleSmartPaste("stimulus")}/> :<button type="button" className="sat-spine__add-content" onClick={()=>setExpanded(current=>({...current,stimulus:true}))}>+ Add supporting material</button>}
          {suggestion?.field === "stimulus" ? <ImportSuggestion analysis={suggestion.analysis} targetField="stimulus" sectionKey={suggestion.sectionKey} onAccept={acceptSuggestion} onDismiss={dismissSuggestion} onOutcome={setSuggestionOutcome}/> : null}
        </SectionRule>
        <SectionRule title="Answer" required field="answer" issues={issuesForField(issues,'answer')} actions={<AuthoringSegmented ariaLabel="Response type" value={isSpr?'spr':'choice'} onChange={kind=>changeKind(kind==='spr'?'student_produced_response':'single_choice')} options={[{value:'choice',label:'Multiple choice'},...(question.metadata.sectionKey==='math'?[{value:'spr' as const,label:'Student response'}]:[])]}/>}>
          {isSpr?<SatStudentResponseEditor acceptedResponses={answer.acceptedResponses} onChange={acceptedResponses=>onChange({...question,answer:{...answer,acceptedResponses}})}/>:<AnswerKeyField question={question} onChange={onChange}/>}
        </SectionRule>
        <SectionRule title="Explanation" field="rationale" issues={issuesForField(issues,'rationale')}>
          {showRationale?<FastQuestionComposer label="Question explanation" value={question.rationale} onChange={rationale=>onChange({...question,rationale})} placeholder="Explain why the answer is correct…" assetOwnerId={question.questionId} minHeightClassName="min-h-[92px]" onSmartPaste={handleSmartPaste("rationale")}/> :<button type="button" className="sat-spine__add-content" onClick={()=>setExpanded(current=>({...current,rationale:true}))}>+ Add an explanation…</button>}
          {suggestion?.field === "rationale" ? <ImportSuggestion analysis={suggestion.analysis} targetField="rationale" sectionKey={suggestion.sectionKey} onAccept={acceptSuggestion} onDismiss={dismissSuggestion} onOutcome={setSuggestionOutcome}/> : null}
        </SectionRule>
        <SpineSaveFooter status={saveStatus} lastSavedAt={lastSavedAt} diverged={diverged} keepMetadataForNext={keepMetadataForNext} saveDisabled={saveStatus==='saving'||Boolean(isMutating)} onKeepMetadataForNextChange={onKeepMetadataForNextChange} onSaveAndNext={onSaveAndNext} onRetry={onRetrySave} onReviewConflict={onReviewConflict}/>
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
          if (starter) onChange({ ...question, stimulus: createSatSupportingMaterial(starter) });
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
