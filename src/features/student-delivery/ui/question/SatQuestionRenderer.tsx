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
    props.onAnnotationsChange?.({ ...props.response.annotations, annotations: props.response.annotations.annotations.map((annotation) => {
      if (annotation.id !== editingNoteId) return annotation;
      const { note: _previous, ...rest } = annotation;
      return { ...rest, ...(note ? { note } : {}), updatedAt: new Date().toISOString() };
    }) });
  };
  const hasStimulus = hasStructuredContent(props.question.stimulus);
  const split = props.sectionKey === "reading-writing" && hasStimulus;
  const eliminationAvailable = props.question.answer.kind === "single_choice";
  const eliminated = new Set(props.response.eliminatedOptionIds);
  const policy = resolveSatExamToolPolicy(props.sectionKey, []);
  const renderContent = (content: StructuredContent, region: 'stimulus' | 'prompt') => (
    <SatAnnotatedContent content={content} region={region} annotations={props.response.annotations} enabled={policy.highlight || policy.underline} onChange={props.disabled ? undefined : props.onAnnotationsChange} onEditNote={(annotation) => setEditingNoteId(annotation.id)} />
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
      {policy.notes && props.response.annotations.annotations.some((annotation) => annotation.note) ? (
        <section aria-label="Notes on this question" className="mt-4 border-t border-[var(--sat-divider)] pt-3">
          {props.response.annotations.annotations.filter((annotation) => annotation.note).map((annotation) => (
            <button key={annotation.id} type="button" disabled={props.disabled} onClick={() => setEditingNoteId(annotation.id)}
              className="sat-touch-target block w-full rounded px-3 text-left underline focus-visible:outline focus-visible:outline-2"
              aria-label={`Edit note: ${annotation.anchor.exact}`}>{annotation.anchor.exact}</button>
          ))}
        </section>
      ) : null}
      {editingNote && !props.disabled ? <SatAnnotationNoteEditor annotation={editingNote} onChange={editNote} onFlush={props.onFlushAnnotations} onClose={() => setEditingNoteId(null)} onDelete={() => { editNote(undefined); setEditingNoteId(null); }} /> : null}
    </div>
  );

  return (
    <SatQuestionWorkspace
      split={split}
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
