import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { satReadingStyle } from "../reading/satReadingStyle";
import { SatReadingSplitHandle } from "./SatReadingSplitHandle";
import { useSatMediaQuery } from '../useSatMediaQuery';

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
  const passageRef = useRef<HTMLElement>(null);
  const questionRef = useRef<HTMLElement>(null);
  const scroll = useRef({ passage: 0, question: 0 });
  const previousRatio = useRef(readingPreferences.splitRatio);
  const [focus, setFocus] = useState<'split' | 'passage' | 'question'>('split');
  const [mobilePane, setMobilePane] = useState<'passage' | 'question'>('passage');
  const compact = useSatMediaQuery('(max-width: 767px)');
  const passageId = useId();
  const questionId = useId();
  const showPassage = compact ? mobilePane === 'passage' : focus !== 'question';
  const showQuestion = compact ? mobilePane === 'question' : focus !== 'passage';
  useLayoutEffect(() => {
    if (showPassage && passageRef.current) passageRef.current.scrollTop = scroll.current.passage;
    if (showQuestion && questionRef.current) questionRef.current.scrollTop = scroll.current.question;
  }, [showPassage, showQuestion]);
  const expand = (pane: 'passage' | 'question') => {
    if (focus === 'split') previousRatio.current = readingPreferences.splitRatio;
    setFocus(pane);
  };
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
    <div className="flex h-full min-h-0 flex-col">
      {/* One segmented control everywhere (Phase 4): Split view | Passage only
          | Question only. "Expand" (which hid a pane) is now honest "Focus"
          language; mobile tabs and desktop buttons share one vocabulary. */}
      <div role="group" aria-label="Passage and question layout" className="flex shrink-0 items-center gap-2 border-b border-[var(--sat-divider)] bg-[var(--sat-surface)] px-3 py-1">
        {compact ? <>
          <button type="button" aria-pressed={mobilePane === 'passage'} aria-controls={passageId} onClick={() => setMobilePane('passage')}
            className="sat-touch-target flex-1 rounded px-3 aria-pressed:bg-[var(--sat-accent-soft)] focus-visible:outline focus-visible:outline-2">Passage only</button>
          <button type="button" aria-pressed={mobilePane === 'question'} aria-controls={questionId} onClick={() => setMobilePane('question')}
            className="sat-touch-target flex-1 rounded px-3 aria-pressed:bg-[var(--sat-accent-soft)] focus-visible:outline focus-visible:outline-2">Question only</button>
        </> : <>
          <button type="button" aria-pressed={focus === 'split'} onClick={() => { onSplitRatioChange(previousRatio.current); setFocus('split'); }} className="sat-touch-target rounded px-3 aria-pressed:bg-[var(--sat-accent-soft)] focus-visible:outline focus-visible:outline-2">Split view</button>
          <button type="button" aria-pressed={focus === 'passage'} onClick={() => expand('passage')} className="sat-touch-target rounded px-3 aria-pressed:bg-[var(--sat-accent-soft)] focus-visible:outline focus-visible:outline-2">Passage only</button>
          <button type="button" aria-pressed={focus === 'question'} onClick={() => expand('question')} className="sat-touch-target rounded px-3 aria-pressed:bg-[var(--sat-accent-soft)] focus-visible:outline focus-visible:outline-2">Question only</button>
        </>}
      </div>
    <div
      ref={splitContainerRef}
      className="sat-reading-surface grid min-h-0 flex-1 overflow-hidden bg-[var(--sat-background)]"
      data-sat-reading-split
      style={{
        ...readingStyle,
        // Bluebook 2px hard divider between passage and question.
        gridTemplateColumns: !compact && focus === 'split' ? `minmax(0, ${readingPreferences.splitRatio}fr) 2px minmax(0, ${questionRatio}fr)` : 'minmax(0, 1fr)',
      }}
    >
      <section
        ref={passageRef} id={passageId} hidden={!showPassage}
        onScroll={(event) => { if (showPassage) scroll.current.passage = event.currentTarget.scrollTop; }}
        className="min-h-0 overflow-y-auto px-5 py-6 md:px-10 md:py-8"
        aria-label="Passage"
        data-sat-passage-scroll
      >
        <div className="mx-auto max-w-[660px] sat-exam-prose sat-type-body text-[var(--sat-text)]">
          {stimulus}
        </div>
      </section>
      {!compact && focus === 'split' ? <SatReadingSplitHandle
        containerRef={splitContainerRef}
        ratio={readingPreferences.splitRatio}
        onChange={onSplitRatioChange}
      /> : null}
      <section
        ref={questionRef} id={questionId} hidden={!showQuestion}
        onScroll={(event) => { if (showQuestion) scroll.current.question = event.currentTarget.scrollTop; }}
        className="min-h-0 overflow-y-auto px-5 py-5 md:px-10 md:py-8"
        aria-label="Question"
        data-sat-question-scroll
      >
        <div className="mx-auto max-w-[650px]">{question}</div>
      </section>
    </div>
    </div>
  );
}
