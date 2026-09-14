import React from "react";
import { Virtuoso } from "react-virtuoso";
import type { StudentQuestionDescriptor } from "@student/application/studentExamContentFacade";
import type { QuestionAnswer, QuestionBlock } from "../../types";
import type { StudentHighlightColor } from "./highlightPalette";
import type { StudentAnswerMutationMeta } from "../../types/studentAttempt";
import { StudentQuestionBlockSection } from "./StudentQuestionBlockSection";
import { useStudentQuestionPaneComposition } from "./useStudentQuestionPaneComposition";

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
  /** @deprecated Pane events never dispatch navigation; footer/navigator own it. */
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
  /** @deprecated P4: the pane renders no navigation rail; the global navigator owns it. */
  hideStepper?: boolean | undefined;
  shouldFocusQuestion?: (() => boolean) | undefined;
  eliminatedOptionIdsByQuestion?: Readonly<Record<string, readonly string[]>> | undefined;
  onToggleOptionElimination?: ((questionId: string, optionId: string) => void) | undefined;
  /** P3.4: render selects as the phone choice sheet (compact/phone). */
  selectSheetPresentation?: boolean | undefined;
}

export const StudentQuestionPanel = React.memo(function StudentQuestionPanel({
  blocks,
  allQuestions,
  answers,
  onAnswerChange,
  currentQuestionId,
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
  shouldFocusQuestion,
  eliminatedOptionIdsByQuestion,
  onToggleOptionElimination,
  selectSheetPresentation = false,
}: StudentQuestionPanelProps) {
  // P4: flag composition follows the question pane's own measured width, not
  // the device or the viewport.
  const paneComposition = useStudentQuestionPaneComposition(questionContainerRef);

  const shouldFocusQuestionRef = React.useRef(shouldFocusQuestion);
  React.useEffect(() => {
    shouldFocusQuestionRef.current = shouldFocusQuestion;
  }, [shouldFocusQuestion]);

  // Explicit navigation (footer chip, Previous/Next, keyboard shortcut) brings
  // its destination to a stable reading position. Ordinary scrolling and
  // answer focus never update currentQuestionId, so this effect cannot create a
  // scroll/navigation feedback loop.
  const previousActiveQuestionRef = React.useRef(currentQuestionId);
  React.useEffect(() => {
    const previous = previousActiveQuestionRef.current;
    previousActiveQuestionRef.current = currentQuestionId;
    if (previous === currentQuestionId || currentQuestionId === null) {
      return;
    }
    if (shouldFocusQuestionRef.current?.() === false) {
      return;
    }
    const target = document.getElementById(`question-${currentQuestionId}`);
    if (!target) {
      return;
    }
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

  // Long exams can mount hundreds of question cards; virtualize the block list
  // so only visible blocks mount. Below the threshold the plain map preserves
  // exact scroll/anchor behavior.
  const useVirtualizedBlocks = blocks.length > 40;

  const renderQuestionBlock = React.useCallback(
    (block: QuestionBlock) => {
      const activeQuestionId = (questionsByBlockId.get(block.id) ?? []).some(
        (question) => question.id === currentQuestionId,
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
          stackFlag={paneComposition.stackFlag}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
          registerLiveAnswer={registerLiveAnswer}
          getBlockStartQuestionNumber={getBlockStartQuestionNumber}
          renderBlockInstruction={renderBlockInstruction}
          expandedQuestionGapClassName={expandedQuestionGapClassName}
          hideDiagramReferenceForBlock={hideDiagramReferenceForBlock}
          eliminatedOptionIdsByQuestion={eliminatedOptionIdsByQuestion}
          onToggleOptionElimination={onToggleOptionElimination}
          selectSheetPresentation={selectSheetPresentation}
        />
      );
    },
    [
      allQuestions,
      answers,
      answerCompact,
      currentQuestionId,
      eliminatedOptionIdsByQuestion,
      expandedQuestionGapClassName,
      flags,
      getBlockStartQuestionNumber,
      hideDiagramReferenceForBlock,
      highlightColor,
      highlightEnabled,
      onAnswerChange,
      onToggleFlag,
      onToggleOptionElimination,
      paneComposition.stackFlag,
      selectSheetPresentation,
      questionsByBlockId,
      registerLiveAnswer,
      renderBlockInstruction,
      tabletMode,
    ],
  );

  return (
    <div
      className={`student-question-pane relative flex h-full min-w-0 flex-col min-h-0 ${tabletMode ? "w-[var(--question-pane-width)] min-w-[48px]" : "w-full md:min-w-[320px] lg:w-[var(--question-pane-width)]"}`}
    >
      {/* P4: the global navigator sits outside this scroll surface already; the
          extra bottom padding is the reading breathing room that keeps the last
          question from ending flush against the bar. */}
      <div
        className={`student-question-scroll student-scroll-breathe flex-1 overflow-y-auto break-words [overflow-wrap:anywhere] ${
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
        {useVirtualizedBlocks ? (
          <Virtuoso
            data={blocks}
            overscan={600}
            itemContent={(_index, block) => renderQuestionBlock(block)}
            computeItemKey={(_index, block) => block.id}
          />
        ) : (
          blocks.map((block) => renderQuestionBlock(block))
        )}
      </div>
      {/* P4: there is exactly ONE navigation authority in the exam — the global
          bottom navigator. This pane deliberately renders no footer of its own;
          a second rail here duplicated the hierarchy and stole ~60px of reading
          height. `hideStepper` survives only as a deprecated no-op prop. */}
    </div>
  );
});
