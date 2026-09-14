import { useEffect, useState } from 'react';
import type { DeliveredQuestion } from "../../contracts/assessmentDelivery";
import { hasStructuredContent } from "../../../exam-authoring/api/renderingPublic";
import type { StructuredContent } from '../../../exam-authoring/api/assessmentContracts';
import { SatAnnotatedContent } from '../annotations/SatAnnotatedContent';
import { resolveSatExamToolPolicy } from '../../domain/satToolPolicy';
import { SatAnnotationNoteEditor } from '../annotations/SatAnnotationNoteEditor';
import type { SatQuestionAnnotations, SatQuestionResponseDraft } from "../../domain/satResponses";
import type { SatSectionKey } from "../../application/satRunnerReducer";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { SatQuestionBody } from "../../../exam-rendering/api/SatQuestionBody";
import { renderSatQuestionImageEnlarge } from "../media/SatQuestionImageEnlarge";
import { SatQuestionHeader } from "./SatQuestionHeader";
import { SatQuestionWorkspace } from "./SatQuestionWorkspace";
import { SatSingleChoiceAnswer } from "./SatSingleChoiceAnswer";
import { SatStudentProducedAnswer } from "./SatStudentProducedAnswer";

export interface SatQuestionRendererProps {
  sectionKey: SatSectionKey;
  questionNumber: number;
  question: DeliveredQuestion;
  response: SatQuestionResponseDraft;
  eliminationMode: boolean;
  disabled: boolean;
  readingPreferences: SatReadingPreferences;
  onReadingSplitRatioChange: (ratio: number) => void;
  onAnswerChange: (answer: string) => void;
  onAnnotationsChange?: (annotations: SatQuestionAnnotations) => void;
  onFlushAnnotations?: () => void;
  onToggleReview: () => void;
  onToggleEliminationMode: () => void;
  onToggleEliminatedOption: (optionId: string) => void;
}

export function SatQuestionRenderer(props: SatQuestionRendererProps) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  useEffect(() => { setEditingNoteId(null); }, [props.question.examQuestionId, props.disabled]);
  useEffect(() => {
    if (editingNoteId && !props.response.annotations.annotations.some((annotation) => annotation.id === editingNoteId)) {
      setEditingNoteId(null);
    }
  }, [props.response.annotations, editingNoteId]);
  useEffect(() => {
    return props.onFlushAnnotations;
  }, [props.question.examQuestionId, props.onFlushAnnotations]);
  const editingNote = props.response.annotations.annotations.find((annotation) => annotation.id === editingNoteId);
  const editNote = (note: string | undefined) => {
    if (!editingNoteId || props.disabled) return;
    // Deleting from a note-less mark removes the whole annotation. Note-bearing
    // marks keep their highlight and lose only the note text here; the Eraser
    // tool removes the entire mark, including any attached note.
    const target = props.response.annotations.annotations.find((annotation) => annotation.id === editingNoteId);
    if (note === undefined && target && !target.note) {
      props.onAnnotationsChange?.({ ...props.response.annotations, annotations: props.response.annotations.annotations.filter((annotation) => annotation.id !== editingNoteId) });
      return;
    }
    props.onAnnotationsChange?.({ ...props.response.annotations, annotations: props.response.annotations.annotations.map((annotation) => {
      if (annotation.id !== editingNoteId) return annotation;
      const { note: _previous, ...rest } = annotation;
      return { ...rest, ...(note ? { note } : {}), updatedAt: new Date().toISOString() };
    }) });
  };
  const hasStimulus = hasStructuredContent(props.question.stimulus);
  // Both SAT sections use the Bluebook two-pane layout when a question has
  // supporting material. Reading and Writing calls that pane a passage;
  // Math uses the product's supporting-material label.
  const split = hasStimulus;
  const stimulusLabel = props.sectionKey === "math" ? "Supporting material" : "Passage";
  const eliminationAvailable = props.question.answer.kind === "single_choice";
  const eliminated = new Set(props.response.eliminatedOptionIds);
  const policy = resolveSatExamToolPolicy(props.sectionKey, []);
  const renderContent = (content: StructuredContent, region: 'stimulus' | 'prompt') => (
    <SatAnnotatedContent content={content} region={region} annotations={props.response.annotations} enabled={policy.highlight || policy.underline} enlarge={props.disabled ? undefined : { renderEnlarge: renderSatQuestionImageEnlarge }} onChange={props.disabled ? undefined : props.onAnnotationsChange} onEditNote={(annotation) => setEditingNoteId(annotation.id)} />
  );

  const questionContent = (
    <div className="pb-8">
      <SatQuestionHeader
        questionNumber={props.questionNumber}
        markedForReview={props.response.markedForReview}
        eliminationAvailable={eliminationAvailable}
        eliminationMode={props.eliminationMode}
        disabled={props.disabled}
        onToggleReview={props.onToggleReview}
        onToggleEliminationMode={props.onToggleEliminationMode}
      />
      <SatQuestionBody
        sectionKey={props.sectionKey}
        question={props.question}
        stimulusPlacement={split ? "split" : "inline"}
        renderContent={renderContent}
      >
        {props.question.answer.kind === "single_choice" ? (
          <SatSingleChoiceAnswer
            questionId={props.question.examQuestionId}
            options={props.question.answer.options}
            value={props.response.answer || undefined}
            eliminatedOptionIds={eliminated}
            eliminationMode={props.eliminationMode}
            disabled={props.disabled}
            onChange={props.onAnswerChange}
            onToggleElimination={props.onToggleEliminatedOption}
          />
        ) : (
          <SatStudentProducedAnswer
            questionId={props.question.examQuestionId}
            value={props.response.answer}
            disabled={props.disabled}
            onChange={props.onAnswerChange}
          />
        )}
      </SatQuestionBody>
      {editingNote && !props.disabled ? <SatAnnotationNoteEditor annotation={editingNote} onChange={editNote} onFlush={props.onFlushAnnotations} onClose={() => setEditingNoteId(null)} onDelete={() => { editNote(undefined); setEditingNoteId(null); }} /> : null}
    </div>
  );

  return (
    <SatQuestionWorkspace
      split={split}
      stimulusLabel={stimulusLabel}
      readingPreferences={props.readingPreferences}
      onSplitRatioChange={props.onReadingSplitRatioChange}
      {...(split
        ? {
            stimulus: renderContent(props.question.stimulus, 'stimulus'),
          }
        : {})}
      question={questionContent}
    />
  );
}
