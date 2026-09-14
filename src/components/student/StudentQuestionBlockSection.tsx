import React from 'react';
import { getBlockQuestionCount } from '../../utils/examUtils';
import {
  getQuestionStartNumber,
  type StudentQuestionDescriptor,
} from '@student/application/studentExamContentFacade';
import type { QuestionAnswer, QuestionBlock } from '../../types';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import type { StudentHighlightColor } from './highlightPalette';
import { QuestionRenderer } from './QuestionRenderer';
import { StudentFlagButton } from './StudentFlagButton';
import { SubAnswerTreeQuestionList } from './SubAnswerTreeQuestionList';
import { formatQuestionRange } from './questionRangeLabel';
import { resolveSharedStudentAnswerMeta } from './resolveSharedStudentAnswerMeta';

export interface StudentQuestionBlockSectionProps {
  block: QuestionBlock;
  blockQuestions: StudentQuestionDescriptor[];
  allQuestions: StudentQuestionDescriptor[];
  answers: Record<string, QuestionAnswer>;
  activeQuestionId: string | null;
  flags: Record<string, boolean>;
  onAnswerChange: (
    answerKey: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta,
  ) => void;
  onToggleFlag?: ((id: string) => void) | undefined;
  /** @deprecated Answer focus does not change navigation state. */
  onActivate?: ((id: string) => void) | undefined;
  tabletMode: boolean;
  answerCompact: boolean;
  /** P4: measured width says the pane is too narrow for a trailing flag column. */
  stackFlag?: boolean | undefined;
  highlightEnabled: boolean;
  highlightColor?: StudentHighlightColor | undefined;
  registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
  getBlockStartQuestionNumber: (blockId: string) => number;
  renderBlockInstruction: (instruction: string, blockId: string) => React.ReactNode;
  expandedQuestionGapClassName: string;
  hideDiagramReferenceForBlock?: ((blockId: string) => boolean) | undefined;
  eliminatedOptionIdsByQuestion?: Readonly<Record<string, readonly string[]>> | undefined;
  onToggleOptionElimination?: ((questionId: string, optionId: string) => void) | undefined;
  /** P3.4: render selects as the phone choice sheet (compact/phone). */
  selectSheetPresentation?: boolean | undefined;
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
    previous.activeQuestionId !== next.activeQuestionId ||
    previous.answerCompact !== next.answerCompact ||
    previous.stackFlag !== next.stackFlag ||
    previous.tabletMode !== next.tabletMode ||
    previous.highlightEnabled !== next.highlightEnabled ||
    previous.highlightColor !== next.highlightColor ||
    previous.onAnswerChange !== next.onAnswerChange ||
    previous.onToggleFlag !== next.onToggleFlag ||
    previous.registerLiveAnswer !== next.registerLiveAnswer ||
    previous.getBlockStartQuestionNumber !== next.getBlockStartQuestionNumber ||
    previous.renderBlockInstruction !== next.renderBlockInstruction ||
    previous.expandedQuestionGapClassName !== next.expandedQuestionGapClassName ||
    previous.hideDiagramReferenceForBlock !== next.hideDiagramReferenceForBlock ||
    previous.eliminatedOptionIdsByQuestion !== next.eliminatedOptionIdsByQuestion ||
    previous.onToggleOptionElimination !== next.onToggleOptionElimination ||
    previous.selectSheetPresentation !== next.selectSheetPresentation
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
    activeQuestionId,
    flags,
    onAnswerChange,
    onToggleFlag,
    tabletMode,
    answerCompact,
    stackFlag = false,
    highlightEnabled,
    highlightColor,
    registerLiveAnswer,
    getBlockStartQuestionNumber,
    renderBlockInstruction,
    expandedQuestionGapClassName,
    hideDiagramReferenceForBlock,
    eliminatedOptionIdsByQuestion,
    onToggleOptionElimination,
    selectSheetPresentation,
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
    const containsCurrentQuestion = blockQuestions.some((question) => question.id === activeQuestionId);
    const blockSpacingClassName = answerCompact
      ? 'space-y-3 mb-3 md:mb-4'
      : 'space-y-4 md:space-y-6 mb-4 md:mb-6';
    const deferredClassName = containsCurrentQuestion ? '' : 'student-question-block-deferred';
    // P4: the flag always owns a real layout slot. Above the measured
    // threshold it is a trailing action column; below it, the flag becomes a
    // metadata row above the prompt so the text keeps the full width.
    const rowClassName = (hasFlag: boolean) =>
      [
        'student-question-row',
        hasFlag ? 'student-question-row--flagged' : '',
        hasFlag && stackFlag ? 'student-question-row--stacked' : '',
      ]
        .filter(Boolean)
        .join(' ');
    return (
      <div className={`${deferredClassName} ${blockSpacingClassName}`.trim()}>
        <div className={answerCompact ? 'mb-2' : 'mb-3 md:mb-4'}>
          {numberedBlockStart !== numberedBlockEnd ? (
            <h3 className={`font-bold tracking-tight text-gray-900 break-words [overflow-wrap:anywhere] ${answerCompact ? 'mb-1 text-sm md:text-base' : 'mb-1 md:mb-2 text-lg md:text-xl'}`}>
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
              const inlineFlags = block.type === 'SENTENCE_COMPLETION' || block.type === 'NOTE_COMPLETION';
              const flagId = firstEntry?.id;
              const answerKey = firstEntry?.answerKey ?? question.id;
              const showFlag = Boolean(onToggleFlag && flagId && !inlineFlags);

              return (
                <div
                  key={question.id}
                  id={!inlineFlags && flagId ? `question-${flagId}` : undefined}
                  className={rowClassName(showFlag)}
                  tabIndex={-1}
                >
                  <div className="student-question-row-body">
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
                    slotIds={questionEntries.map((entry) => entry.id)}
                    slotNumbers={questionEntries.map((entry, index) => entry.rootNumber ?? (blockStartQ + index))}
                    flags={flags}
                    onToggleFlag={onToggleFlag}
                    tabletMode={tabletMode}
                    compactPane={answerCompact}
                    highlightEnabled={highlightEnabled}
                    highlightColor={highlightColor}
                    hideDiagramReference={hideDiagramReferenceForBlock?.(block.id)}
                    eliminatedOptionIds={eliminatedOptionIdsByQuestion?.[question.id]}
                    selectSheetPresentation={selectSheetPresentation}
                    onToggleOptionElimination={
                      onToggleOptionElimination
                        ? (optionId) => onToggleOptionElimination(question.id, optionId)
                        : undefined
                    }
                  />
                  </div>
                  {showFlag && flagId ? (
                    <div className="student-question-row-action">
                      <StudentFlagButton
                        flagged={Boolean(flags[flagId])}
                        onToggle={(event) => {
                          event.stopPropagation();
                          onToggleFlag?.(flagId);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div
              key={block.id}
              className={rowClassName(Boolean(onToggleFlag && singleBlockQuestion))}
              tabIndex={-1}
            >
              <div className="student-question-row-body">
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
                slotIds={blockQuestions.map((entry) => entry.id)}
                slotNumbers={blockQuestions.map((entry, index) => entry.rootNumber ?? (blockStartQ + index))}
                flags={flags}
                onToggleFlag={onToggleFlag}
                tabletMode={tabletMode}
                compactPane={answerCompact}
                highlightEnabled={highlightEnabled}
                highlightColor={highlightColor}
                hideDiagramReference={hideDiagramReferenceForBlock?.(block.id)}
                eliminatedOptionIds={
                  eliminatedOptionIdsByQuestion?.[singleBlockQuestion?.id ?? block.id]
                }
                selectSheetPresentation={selectSheetPresentation}
                onToggleOptionElimination={
                  onToggleOptionElimination
                    ? (optionId) =>
                        onToggleOptionElimination(singleBlockQuestion?.id ?? block.id, optionId)
                    : undefined
                }
              />
              </div>
              {onToggleFlag && singleBlockQuestion ? (
                <div className="student-question-row-action">
                  <StudentFlagButton
                    flagged={Boolean(flags[singleBlockQuestion.id])}
                    onToggle={(event) => {
                      event.stopPropagation();
                      onToggleFlag(singleBlockQuestion.id);
                    }}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  },
  areBlockPropsEqual,
);
