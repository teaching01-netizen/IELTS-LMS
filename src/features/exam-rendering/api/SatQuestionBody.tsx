import type { ReactNode } from "react";
import type { DeliveredQuestion, StructuredContent } from "./assessmentContracts";
import { hasStructuredContent } from "../../exam-authoring/api/renderingPublic";
import { StructuredContentRenderer } from "./structuredContent";

export interface SatQuestionBodyProps {
  sectionKey: "math" | "reading-writing";
  question: Pick<DeliveredQuestion, "stimulus" | "prompt">;
  stimulusPlacement?: "inline" | "split";
  children: ReactNode;
  renderContent?: (content: StructuredContent, region: 'stimulus' | 'prompt') => ReactNode;
}

export function SatQuestionBody({
  sectionKey,
  question,
  stimulusPlacement,
  children,
  renderContent,
}: SatQuestionBodyProps) {
  const hasStimulus = hasStructuredContent(question.stimulus);
  const split = (stimulusPlacement ?? (sectionKey === "reading-writing" ? "split" : "inline")) === "split";

  return (
    <div className="pb-8" data-sat-question-body>
      <div className="pt-4 sat-exam-prose sat-type-body text-[var(--sat-text)]">
        {!split && hasStimulus ? (
          <section aria-label="Stimulus" className="mb-6 border-b border-[var(--sat-divider-soft)] pb-5">
            {renderContent ? renderContent(question.stimulus, 'stimulus') : <StructuredContentRenderer content={question.stimulus} />}
          </section>
        ) : null}
        <section aria-label="Question" className="mb-5">
          {renderContent ? renderContent(question.prompt, 'prompt') : <StructuredContentRenderer content={question.prompt} />}
        </section>
      </div>
      {children}
    </div>
  );
}
