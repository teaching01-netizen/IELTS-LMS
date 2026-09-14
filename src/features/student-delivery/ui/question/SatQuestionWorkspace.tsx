import { useRef, type ReactNode } from "react";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { satReadingStyle } from "../reading/satReadingStyle";
import { SatReadingSplitHandle } from "./SatReadingSplitHandle";
import { useSatMediaQuery } from '../useSatMediaQuery';

export interface SatQuestionWorkspaceProps {
  split: boolean;
  stimulus?: ReactNode;
  stimulusLabel?: string;
  question: ReactNode;
  readingPreferences: SatReadingPreferences;
  onSplitRatioChange: (ratio: number) => void;
}

export function SatQuestionWorkspace({
  split,
  stimulus,
  stimulusLabel = "Passage",
  question,
  readingPreferences,
  onSplitRatioChange,
}: SatQuestionWorkspaceProps) {
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const compact = useSatMediaQuery('(max-width: 767px)');
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
      className="sat-reading-surface grid h-full min-h-0 overflow-hidden bg-[var(--sat-background)]"
      data-sat-reading-split
      style={{
        ...readingStyle,
        // Bluebook 2px hard divider between passage and question.
        gridTemplateColumns: compact ? 'minmax(0, 1fr)' : `minmax(0, ${readingPreferences.splitRatio}fr) 2px minmax(0, ${questionRatio}fr)`,
        gridTemplateRows: compact ? 'repeat(2, minmax(0, 1fr))' : undefined,
      }}
    >
      <section
        className="min-h-0 overflow-y-auto px-5 py-6 md:px-10 md:py-8"
        aria-label={stimulusLabel}
        data-sat-passage-scroll
      >
        <div className="mx-auto max-w-[660px] sat-exam-prose sat-type-body text-[var(--sat-text)]">
          {stimulus}
        </div>
      </section>
      {!compact ? <SatReadingSplitHandle
        containerRef={splitContainerRef}
        ratio={readingPreferences.splitRatio}
        leftPaneLabel={stimulusLabel}
        onChange={onSplitRatioChange}
      /> : null}
      <section
        className="min-h-0 overflow-y-auto px-5 py-5 md:px-10 md:py-8"
        aria-label="Question"
        data-sat-question-scroll
      >
        <div className="mx-auto max-w-[650px]">{question}</div>
      </section>
    </div>
  );
}
