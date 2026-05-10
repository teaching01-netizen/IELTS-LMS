import React from 'react';
import { ArrowLeft, ArrowRight, Flag } from 'lucide-react';
import { getBlockQuestionCount } from '../../utils/examUtils';
import {
  getQuestionStartNumber,
  type StudentQuestionDescriptor,
} from '../../services/examAdapterService';
import type { QuestionAnswer, QuestionBlock } from '../../types';
import type { StudentHighlightColor } from './highlightPalette';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import { QuestionRenderer } from './QuestionRenderer';
import { SubAnswerTreeQuestionList } from './SubAnswerTreeQuestionList';
import { formatQuestionRange } from './questionRangeLabel';
import { resolveSharedStudentAnswerMeta } from './resolveSharedStudentAnswerMeta';

interface StudentQuestionPanelProps {
  blocks: QuestionBlock[];
  allQuestions: StudentQuestionDescriptor[];
  answers: Record<string, QuestionAnswer>;
  onAnswerChange: (
    answerKey: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta,
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
  renderBlockInstruction: (instruction: string) => React.ReactNode;
  expandedQuestionGapClassName?: string | undefined;
  hideDiagramReferenceForBlock?: ((blockId: string) => boolean) | undefined;
}

function FlagButton({
  flagged,
  tabletMode,
  onClick,
}: {
  flagged: boolean;
  tabletMode: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  if (tabletMode) {
    return (
      <div className="flex justify-end">
        <button
          onClick={onClick}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-all ${
            flagged
              ? 'bg-amber-700 text-white border-amber-700'
              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
          title={flagged ? 'Unflag question' : 'Flag question'}
        >
          <Flag size={14} className={flagged ? 'fill-current' : ''} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10 shadow-sm ${
        flagged
          ? 'bg-amber-700 text-white'
          : 'bg-white border border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
      }`}
      title={flagged ? 'Unflag question' : 'Flag question'}
    >
      <Flag size={14} className={flagged ? 'fill-current' : ''} />
    </button>
  );
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
  expandedQuestionGapClassName = 'space-y-8',
  hideDiagramReferenceForBlock,
}: StudentQuestionPanelProps) {
  const currentIndex = allQuestions.findIndex((question) => question.id === currentQuestionId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allQuestions.length - 1;
  const previousQuestion = hasPrev ? allQuestions[currentIndex - 1] : undefined;
  const nextQuestion = hasNext ? allQuestions[currentIndex + 1] : undefined;
  const getAnswerValue = (answerKey: string): QuestionAnswer => answers[answerKey] ?? null;

  return (
    <div className={`relative flex h-full min-w-0 flex-col min-h-0 ${tabletMode ? 'w-[var(--question-pane-width)] min-w-[48px]' : 'w-full md:min-w-[320px] lg:w-[var(--question-pane-width)]'}`}>
      <div
        className={`flex-1 overflow-y-auto break-words [overflow-wrap:anywhere] ${
          answerCompact ? 'p-2.5 md:p-3 space-y-4 md:space-y-5' : 'p-4 md:p-5 lg:p-8 space-y-6 md:space-y-8'
        } pb-20 md:pb-24 ${
          tabletMode ? 'pb-28 md:pb-28' : ''
        }`}
        ref={questionContainerRef}
        data-student-zoom-scroll
        data-testid={panelTestId}
        style={contentZoomStyle}
      >
        {blocks.map((block) => {
          const blockQuestions = allQuestions.filter((question) => question.blockId === block.id);
          const singleBlockQuestion = blockQuestions.length === 1 ? blockQuestions[0] : undefined;
          const treeQuestions = blockQuestions.filter((question) => question.isSubAnswerTreeLeaf);
          const rootNumbers = Array.from(
            new Set(
              blockQuestions
                .map((question) => question.rootNumber)
                .filter((value): value is number => typeof value === 'number'),
            ),
          ).sort((left, right) => left - right);
          const blockStartQ = getBlockStartQuestionNumber(block.id);
          const numberedBlockStart = rootNumbers[0] ?? blockStartQ;
          const numberedBlockEnd =
            rootNumbers[rootNumbers.length - 1] ??
            blockStartQ + getBlockQuestionCount(block) - 1;

          return (
            <div key={block.id} className={`${answerCompact ? 'space-y-3 mb-3 md:mb-4' : 'space-y-4 md:space-y-6 mb-4 md:mb-6'}`}>
              <div className={answerCompact ? 'mb-2' : 'mb-3 md:mb-4'}>
                {numberedBlockStart !== numberedBlockEnd ? (
                  <h3 className={`font-bold text-gray-900 break-words [overflow-wrap:anywhere] ${answerCompact ? 'mb-1 text-sm md:text-base' : 'mb-1 md:mb-2 text-base md:text-lg'}`}>
                    Questions {formatQuestionRange(numberedBlockStart, numberedBlockEnd)}
                  </h3>
                ) : null}
                {renderBlockInstruction(block.instruction)}
              </div>

              <div className={answerCompact ? 'space-y-5' : expandedQuestionGapClassName}>
                {treeQuestions.length > 0 ? (
                  <SubAnswerTreeQuestionList
                    questions={treeQuestions}
                    answers={answers}
                    currentQuestionId={currentQuestionId}
                    flags={flags}
                    onToggleFlag={onToggleFlag}
                    tabletMode={tabletMode}
                    onAnswerChange={onAnswerChange}
                  />
                ) : ('questions' in block) ? (
                  block.questions.map((question, questionIndex) => {
                    const questionEntries = blockQuestions.filter((entry) => entry.question?.id === question.id);
                    const firstEntry = questionEntries[0];
                    const globalQuestionNumber =
                      (firstEntry ? getQuestionStartNumber(allQuestions, firstEntry.id) : null) ??
                      blockStartQ + questionIndex;
                    const isActive = questionEntries.some((entry) => entry.id === currentQuestionId);
                    const inlineFlags = block.type === 'SENTENCE_COMPLETION' || block.type === 'NOTE_COMPLETION';
                    const flagId = firstEntry?.id;
                    const answerKey = firstEntry?.answerKey ?? question.id;

                    return (
                      <div
                        key={question.id}
                        id={!inlineFlags && flagId ? `question-${flagId}` : undefined}
                        className={`relative ${tabletMode ? 'space-y-2' : ''}`}
                      >
                        {onToggleFlag && flagId && !inlineFlags ? (
                          <FlagButton
                            flagged={Boolean(flags[flagId])}
                            tabletMode={tabletMode}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleFlag(flagId);
                            }}
                          />
                        ) : null}
                        <QuestionRenderer
                          question={question}
                          block={block}
                          number={globalQuestionNumber}
                          answer={getAnswerValue(answerKey)}
                          onChange={(value, meta) =>
                            onAnswerChange(
                              answerKey,
                              value,
                              resolveSharedStudentAnswerMeta({
                                value,
                                slotId: firstEntry?.id,
                                defaultEntryAnswerIndex: firstEntry?.answerIndex,
                                slotCount: questionEntries.length,
                                incomingMeta: meta,
                              }),
                            )
                          }
                          registerLiveAnswer={({ value }: { value: QuestionAnswer }) =>
                            registerLiveAnswer?.(answerKey, value)
                          }
                          isFlagged={flagId ? Boolean(flags[flagId]) : false}
                          isActive={isActive}
                          slotIds={questionEntries.map((entry) => entry.id)}
                          slotNumbers={questionEntries.map((entry, index) => entry.rootNumber ?? (blockStartQ + index))}
                          currentQuestionId={currentQuestionId}
                          flags={flags}
                          onToggleFlag={onToggleFlag}
                          tabletMode={tabletMode}
                          compactPane={answerCompact}
                          highlightEnabled={highlightEnabled}
                          highlightColor={highlightColor}
                          hideDiagramReference={hideDiagramReferenceForBlock?.(block.id)}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div key={block.id} className="relative">
                    {onToggleFlag && singleBlockQuestion ? (
                      <FlagButton
                        flagged={Boolean(flags[singleBlockQuestion.id])}
                        tabletMode={tabletMode}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleFlag(singleBlockQuestion.id);
                        }}
                      />
                    ) : null}
                    <QuestionRenderer
                      question={null}
                      block={block}
                      number={(singleBlockQuestion ? getQuestionStartNumber(allQuestions, singleBlockQuestion.id) : null) ?? blockStartQ}
                      answer={getAnswerValue(singleBlockQuestion?.answerKey ?? block.id)}
                      onChange={(value, meta) =>
                        onAnswerChange(singleBlockQuestion?.answerKey ?? block.id, value, meta)
                      }
                      registerLiveAnswer={({ value }: { value: QuestionAnswer }) =>
                        registerLiveAnswer?.(singleBlockQuestion?.answerKey ?? block.id, value)
                      }
                      isFlagged={singleBlockQuestion ? Boolean(flags[singleBlockQuestion.id]) : false}
                      isActive={blockQuestions.some((entry) => entry.id === currentQuestionId)}
                      slotIds={blockQuestions.map((entry) => entry.id)}
                      slotNumbers={blockQuestions.map((entry, index) => entry.rootNumber ?? (blockStartQ + index))}
                      currentQuestionId={currentQuestionId}
                      flags={flags}
                      onToggleFlag={onToggleFlag}
                      tabletMode={tabletMode}
                      compactPane={answerCompact}
                      highlightEnabled={highlightEnabled}
                      highlightColor={highlightColor}
                      hideDiagramReference={hideDiagramReferenceForBlock?.(block.id)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className={`absolute ${tabletMode ? 'bottom-4 right-4' : 'bottom-16 md:bottom-20 right-4 md:right-6'} flex shadow-md z-20`}>
        <button
          onClick={() => previousQuestion && onNavigate(previousQuestion.id)}
          className={`w-10 h-10 md:w-11 md:h-11 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasPrev ? 'bg-gray-200 hover:bg-gray-300 text-white' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
        >
          <ArrowLeft size={16} strokeWidth={3} />
        </button>
        <button
          onClick={() => nextQuestion && onNavigate(nextQuestion.id)}
          className={`w-10 h-10 md:w-11 md:h-11 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasNext ? 'bg-black hover:bg-gray-800 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
        >
          <ArrowRight size={16} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
