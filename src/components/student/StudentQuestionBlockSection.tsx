import React from 'react';
import { Flag } from 'lucide-react';
import { getBlockQuestionCount } from '../../utils/examUtils';
import {
  getQuestionStartNumber,
  type StudentQuestionDescriptor,
} from '../../services/examAdapterService';
import type { QuestionAnswer, QuestionBlock } from '../../types';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import type { StudentHighlightColor } from './highlightPalette';
import { QuestionRenderer } from './QuestionRenderer';
import { SubAnswerTreeQuestionList } from './SubAnswerTreeQuestionList';
import { formatQuestionRange } from './questionRangeLabel';
import { resolveSharedStudentAnswerMeta } from './resolveSharedStudentAnswerMeta';

export interface StudentQuestionBlockSectionProps {
  block: QuestionBlock;
  blockQuestions: StudentQuestionDescriptor[];
  allQuestions: StudentQuestionDescriptor[];
  answers: Record<string, QuestionAnswer>;
  currentQuestionId: string | null;
  flags: Record<string, boolean>;
  onAnswerChange: (
    answerKey: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta,
  ) => void;
  onToggleFlag?: ((id: string) => void) | undefined;
  tabletMode: boolean;
  answerCompact: boolean;
  highlightEnabled: boolean;
  highlightColor?: StudentHighlightColor | undefined;
  registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
  getBlockStartQuestionNumber: (blockId: string) => number;
  renderBlockInstruction: (instruction: string, blockId: string) => React.ReactNode;
  expandedQuestionGapClassName: string;
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

function getRelevantAnswerKeys(
  block: QuestionBlock,
  blockQuestions: StudentQuestionDescriptor[],
): string[] {
  const keys = new Set<string>();
  for (const question of blockQuestions) {
    keys.add(question.answerKey ?? question.id);
  }
  if (keys.size === 0) {
    keys.add(block.id);
  }
  return [...keys];
}

function areBlockPropsEqual(
  previous: StudentQuestionBlockSectionProps,
  next: StudentQuestionBlockSectionProps,
) {
  if (
    previous.block !== next.block ||
    previous.blockQuestions !== next.blockQuestions ||
    previous.allQuestions !== next.allQuestions ||
    previous.currentQuestionId !== next.currentQuestionId ||
    previous.answerCompact !== next.answerCompact ||
    previous.tabletMode !== next.tabletMode ||
    previous.highlightEnabled !== next.highlightEnabled ||
    previous.highlightColor !== next.highlightColor ||
    previous.onAnswerChange !== next.onAnswerChange ||
    previous.onToggleFlag !== next.onToggleFlag ||
    previous.registerLiveAnswer !== next.registerLiveAnswer ||
    previous.getBlockStartQuestionNumber !== next.getBlockStartQuestionNumber ||
    previous.renderBlockInstruction !== next.renderBlockInstruction ||
    previous.expandedQuestionGapClassName !== next.expandedQuestionGapClassName ||
    previous.hideDiagramReferenceForBlock !== next.hideDiagramReferenceForBlock
  ) {
    return false;
  }

  for (const answerKey of getRelevantAnswerKeys(previous.block, previous.blockQuestions)) {
    if (previous.answers[answerKey] !== next.answers[answerKey]) {
      return false;
    }
  }

  for (const question of previous.blockQuestions) {
    if (previous.flags[question.id] !== next.flags[question.id]) {
      return false;
    }
  }

  return true;
}

export const StudentQuestionBlockSection = React.memo(
  function StudentQuestionBlockSection({
    block,
    blockQuestions,
    allQuestions,
    answers,
    currentQuestionId,
    flags,
    onAnswerChange,
    onToggleFlag,
    tabletMode,
    answerCompact,
    highlightEnabled,
    highlightColor,
    registerLiveAnswer,
    getBlockStartQuestionNumber,
    renderBlockInstruction,
    expandedQuestionGapClassName,
    hideDiagramReferenceForBlock,
  }: StudentQuestionBlockSectionProps) {
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
    const getAnswerValue = (answerKey: string): QuestionAnswer => answers[answerKey] ?? null;
    const containsCurrentQuestion = blockQuestions.some((question) => question.id === currentQuestionId);
    const blockSpacingClassName = answerCompact
      ? 'space-y-3 mb-3 md:mb-4'
      : 'space-y-4 md:space-y-6 mb-4 md:mb-6';
    const deferredClassName = containsCurrentQuestion ? '' : 'student-question-block-deferred';

    return (
      <div className={`${deferredClassName} ${blockSpacingClassName}`.trim()}>
        <div className={answerCompact ? 'mb-2' : 'mb-3 md:mb-4'}>
          {numberedBlockStart !== numberedBlockEnd ? (
            <h3 className={`font-bold text-gray-900 break-words [overflow-wrap:anywhere] ${answerCompact ? 'mb-1 text-sm md:text-base' : 'mb-1 md:mb-2 text-base md:text-lg'}`}>
              Questions {formatQuestionRange(numberedBlockStart, numberedBlockEnd)}
            </h3>
          ) : null}
          {renderBlockInstruction(block.instruction, block.id)}
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
              highlightEnabled={highlightEnabled}
              highlightColor={highlightColor}
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
  },
  areBlockPropsEqual,
);
