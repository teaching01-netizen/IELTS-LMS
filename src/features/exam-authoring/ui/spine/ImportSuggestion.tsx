import { useEffect, useRef } from "react";
import type {
  AnalyzeWholeQuestionInput,
  SuggestionOutcome,
  WholeQuestionAnalysis,
} from "../../editor/ingestion/exam/wholeQuestionTypes";
import { toOutcome } from "../../editor/ingestion/exam/wholeQuestionTypes";

export interface ImportSuggestionProps {
  analysis: WholeQuestionAnalysis;
  targetField: AnalyzeWholeQuestionInput["targetField"];
  sectionKey: AnalyzeWholeQuestionInput["sectionKey"];
  onAccept: () => void;
  onDismiss: (outcome: SuggestionOutcome) => void;
  onOutcome?: ((outcome: SuggestionOutcome) => void) | undefined;
}

function truncate(text: string, limit = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? collapsed.slice(0, limit - 1).trimEnd() + "\u2026" : collapsed;
}

function branchPreview(branch: WholeQuestionAnalysis["prompt"]): string | null {
  if (!branch) return null;
  const parts: string[] = [];
  for (const node of branch.nodes) {
    if (node.kind === "paragraph" || node.kind === "heading") {
      for (const inline of node.children) parts.push(inline.kind === "text" ? inline.text : inline.latex);
    } else if (node.kind === "codeBlock") parts.push(node.text);
  }
  const text = truncate(parts.join(" "));
  return text ? text : null;
}

export function ImportSuggestion({ analysis, targetField, sectionKey, onAccept, onDismiss, onOutcome }: ImportSuggestionProps) {
  const cardRef = useRef<HTMLElement>(null);
  const outcomeOf = (accepted: boolean): SuggestionOutcome => toOutcome(analysis, sectionKey, accepted);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        const outcome = outcomeOf(false);
        onOutcome?.(outcome);
        onDismiss(outcome);
      }
    };
    card.addEventListener("keydown", onKeyDown);
    return () => card.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- outcome is derived from stable analysis prop
  }, [onDismiss, onOutcome]);

  const choiceCount = analysis.choices.length;
  const summaryParts: string[] = ["question stem", choiceCount + " choices (" + analysis.choices.map((c) => c.label).join("\u2013") + ")"];
  if (analysis.correctChoice) summaryParts.push("answer " + analysis.correctChoice);
  if (analysis.rationale) summaryParts.push("explanation");
  if (analysis.stimulus) summaryParts.push("passage");
  const summary = "Found " + summaryParts.join(", ") + ".";
  const stemPreview = branchPreview(analysis.prompt);
  const rationalePreview = branchPreview(analysis.rationale);
  const stimulusPreview = branchPreview(analysis.stimulus);

  const dismiss = (): void => {
    const outcome = outcomeOf(false);
    onOutcome?.(outcome);
    onDismiss(outcome);
  };
  const accept = (): void => {
    onOutcome?.(outcomeOf(true));
    onAccept();
  };

  return (
    <section ref={cardRef} aria-label="Paste suggestion" className="sat-spine__import-suggestion">
      <h4>Looks like a whole question</h4>
      <p aria-live="polite">{summary}</p>
      <dl>
        {stemPreview ? (<><dt>Stem</dt><dd>{stemPreview}</dd></>) : null}
        <dt>Choices</dt>
        <dd>
          <ul>
            {analysis.choices.map((choice) => (
              <li key={choice.label}>
                <span aria-hidden="true">{choice.label}. </span>
                {truncate(branchPreview(choice.content) ?? "")} 
                {analysis.correctChoice === choice.label ? <span>(key)</span> : null}
              </li>
            ))}
          </ul>
        </dd>
        {rationalePreview ? (<><dt>Explanation</dt><dd>{rationalePreview}</dd></>) : null}
        {stimulusPreview ? (<><dt>Passage</dt><dd>{stimulusPreview}</dd></>) : null}
      </dl>
      {targetField === "answer-choice" ? <p>Choices will replace the current 4 options.</p> : null}
      {analysis.stimulus ? <p>Passage moves to Supporting material.</p> : null}
      {!analysis.correctChoice && analysis.choices.length > 0 ? <p>No answer key detected \u2014 you will pick the key after splitting.</p> : null}
      <p>You can edit any field after splitting.</p>
      <div>
        <button type="button" aria-label="Split pasted content into question fields" onClick={accept}>
          Split into fields
        </button>
        <button type="button" aria-label="Keep pasted content as is" onClick={dismiss}>
          Keep as pasted
        </button>
      </div>
    </section>
  );
}
