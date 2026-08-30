import { useRef, type ReactNode } from "react";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { satReadingStyle } from "../reading/satReadingStyle";
import { SatReadingSplitHandle } from "./SatReadingSplitHandle";

export interface SatQuestionWorkspaceProps {
  split: boolean;
  stimulus?: ReactNode;
  question: ReactNode;
  readingPreferences: SatReadingPreferences;
  onSplitRatioChange: (ratio: number) => void;
}

export function SatQuestionWorkspace({
  split,
  stimulus,
  question,
  readingPreferences,
  onSplitRatioChange,
}: SatQuestionWorkspaceProps) {
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const readingStyle = satReadingStyle(readingPreferences);

  if (!split) {
    return (
      <div
        className="sat-reading-surface h-full min-h-0 overflow-y-auto bg-[var(--sat-background)]"
        data-sat-question-scroll
        style={readingStyle}
      >
        <div className="mx-auto w-full max-w-[760px] px-5 py-6 sm:px-8 sm:py-8">{question}</div>
      </div>
    );
  }

  const questionRatio = 1 - readingPreferences.splitRatio;
  return (
    <div
      ref={splitContainerRef}
      className="sat-reading-surface h-full min-h-0 overflow-y-auto bg-[var(--sat-background)] md:grid md:overflow-hidden"
      data-sat-reading-split
      style={{
        ...readingStyle,
        gridTemplateColumns: `minmax(0, ${readingPreferences.splitRatio}fr) 1px minmax(0, ${questionRatio}fr)`,
      }}
    >
      <section
        className="border-b border-[var(--sat-divider)] px-5 py-6 md:min-h-0 md:overflow-y-auto md:border-b-0 md:px-8 md:py-8"
        aria-label="Passage or source"
        data-sat-passage-scroll
      >
        <div className="mx-auto max-w-[660px] sat-exam-prose sat-type-body text-[var(--sat-text)]">
          {stimulus}
        </div>
      </section>
      <SatReadingSplitHandle
        containerRef={splitContainerRef}
        ratio={readingPreferences.splitRatio}
        onChange={onSplitRatioChange}
      />
      <section
        className="px-5 py-5 md:min-h-0 md:overflow-y-auto md:px-8 md:py-8"
        aria-label="Question"
        data-sat-question-scroll
      >
        <div className="mx-auto max-w-[650px]">{question}</div>
      </section>
    </div>
  );
}
