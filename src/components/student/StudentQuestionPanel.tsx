import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { StudentQuestionDescriptor } from "@student/application/studentExamContentFacade";
import type { QuestionAnswer, QuestionBlock } from "../../types";
import type { StudentHighlightColor } from "./highlightPalette";
import type { StudentAnswerMutationMeta } from "../../types/studentAttempt";
import { StudentQuestionBlockSection } from "./StudentQuestionBlockSection";

interface StudentQuestionPanelProps {
  blocks: QuestionBlock[];
  allQuestions: StudentQuestionDescriptor[];
  answers: Record<string, QuestionAnswer>;
  onAnswerChange: (
    answerKey: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta
  ) => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  flags: Record<string, boolean>;
  onToggleFlag?: ((id: string) => void) | undefined;
  tabletMode?: boolean | undefined;
  answerCompact: boolean;
  highlightEnabled: boolean;
  highlightColor?: StudentHighlightColor | undefined;
  registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
  questionContainerRef: React.RefObject<HTMLDivElement | null>;
  contentZoomStyle?: React.CSSProperties | undefined;
  panelTestId: string;
  getBlockStartQuestionNumber: (blockId: string) => number;
  renderBlockInstruction: (instruction: string, blockId: string) => React.ReactNode;
  expandedQuestionGapClassName?: string | undefined;
  hideDiagramReferenceForBlock?: ((blockId: string) => boolean) | undefined;
  hideStepper?: boolean | undefined;
  shouldFocusQuestion?: (() => boolean) | undefined;
}

export function StudentQuestionPanel({
  blocks,
  allQuestions,
  answers,
  onAnswerChange,
  currentQuestionId,
  onNavigate,
  flags,
  onToggleFlag,
  tabletMode = false,
  answerCompact,
  highlightEnabled,
  highlightColor,
  registerLiveAnswer,
  questionContainerRef,
  contentZoomStyle,
  panelTestId,
  getBlockStartQuestionNumber,
  renderBlockInstruction,
  expandedQuestionGapClassName = "space-y-8",
  hideDiagramReferenceForBlock,
  hideStepper = false,
  shouldFocusQuestion,
}: StudentQuestionPanelProps) {
  const currentIndex = allQuestions.findIndex((question) => question.id === currentQuestionId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allQuestions.length - 1;
  const previousQuestion = hasPrev ? allQuestions[currentIndex - 1] : undefined;
  const nextQuestion = hasNext ? allQuestions[currentIndex + 1] : undefined;

  const shouldFocusQuestionRef = React.useRef(shouldFocusQuestion);
  shouldFocusQuestionRef.current = shouldFocusQuestion;

  React.useEffect(() => {
    if (!currentQuestionId || shouldFocusQuestionRef.current?.() === false) {
      return;
    }

    const target = document.getElementById(`question-${currentQuestionId}`);
    if (!target) {
      return;
    }

    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start", behavior: "auto" });
  }, [currentQuestionId]);

  const questionsByBlockId = React.useMemo(() => {
    const map = new Map<string, StudentQuestionDescriptor[]>();
    for (const question of allQuestions) {
      const current = map.get(question.blockId);
      if (current) {
        current.push(question);
      } else {
        map.set(question.blockId, [question]);
      }
    }
    return map;
  }, [allQuestions]);

  return (
    <div
      className={`relative flex h-full min-w-0 flex-col min-h-0 ${tabletMode ? "w-[var(--question-pane-width)] min-w-[48px]" : "w-full md:min-w-[320px] lg:w-[var(--question-pane-width)]"}`}
    >
      <div
        className={`flex-1 overflow-y-auto break-words [overflow-wrap:anywhere] ${
          answerCompact
            ? "p-2.5 md:p-3 space-y-4 md:space-y-5"
            : "p-4 md:p-5 lg:p-8 space-y-6 md:space-y-8"
        }`}
        ref={questionContainerRef}
        data-student-zoom-scroll
        data-testid={panelTestId}
        style={{
          ...(contentZoomStyle ?? {}),
        }}
      >
        {blocks.map((block) => {
          const activeQuestionId = (questionsByBlockId.get(block.id) ?? []).some(
            (question) => question.id === currentQuestionId
          )
            ? currentQuestionId
            : null;

          return (
            <StudentQuestionBlockSection
              key={block.id}
              block={block}
              blockQuestions={questionsByBlockId.get(block.id) ?? []}
              allQuestions={allQuestions}
              answers={answers}
              activeQuestionId={activeQuestionId}
              flags={flags}
              onAnswerChange={onAnswerChange}
              onToggleFlag={onToggleFlag}
              tabletMode={tabletMode}
              answerCompact={answerCompact}
              highlightEnabled={highlightEnabled}
              highlightColor={highlightColor}
              registerLiveAnswer={registerLiveAnswer}
              getBlockStartQuestionNumber={getBlockStartQuestionNumber}
              renderBlockInstruction={renderBlockInstruction}
              expandedQuestionGapClassName={expandedQuestionGapClassName}
              hideDiagramReferenceForBlock={hideDiagramReferenceForBlock}
            />
          );
        })}
      </div>
      {!hideStepper ? (
        <div
          className={`student-question-stepper absolute ${tabletMode ? "right-4" : "right-4 md:right-6"} flex shadow-md z-20`}
        >
          <button
            type="button"
            onClick={() => previousQuestion && onNavigate(previousQuestion.id)}
            className={`w-10 h-10 md:w-11 md:h-11 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasPrev ? "bg-black hover:bg-gray-800 text-white" : "bg-gray-100 text-gray-300 cursor-not-allowed"}`}
            aria-label="Previous question"
            disabled={!hasPrev}
          >
            <ArrowLeft size={16} strokeWidth={3} />
          </button>
          <button
            type="button"
            onClick={() => nextQuestion && onNavigate(nextQuestion.id)}
            className={`w-10 h-10 md:w-11 md:h-11 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasNext ? "bg-black hover:bg-gray-800 text-white" : "bg-gray-800 text-gray-500 cursor-not-allowed"}`}
            aria-label="Next question"
            disabled={!hasNext}
          >
            <ArrowRight size={16} strokeWidth={3} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
