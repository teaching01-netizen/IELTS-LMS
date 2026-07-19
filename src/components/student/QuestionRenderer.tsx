import React from 'react';
import {
  ClassificationBlock,
  ClozeBlock,
  ClozeQuestion,
  DiagramLabelingBlock,
  FlowChartBlock,
  MapBlock,
  MapQuestion,
  MatchingBlock,
  MatchingFeaturesBlock,
  MatchingQuestion,
  MultiMCQBlock,
  NoteCompletionQuestion,
  QuestionAnswer,
  QuestionBlock,
  SentenceCompletionBlock,
  SentenceCompletionQuestion,
  ShortAnswerBlock,
  ShortAnswerQuestion,
  SingleMCQBlock,
  SingleMCQQuestion,
  TableCompletionBlock,
  TFNGBlock,
  TFNGQuestion,
} from '../../types';
import { ProtectedInput } from './ProtectedInput';
import { StudentQuestionText } from './StudentQuestionText';
import { stripBoldMarkdown } from '../../utils/boldMarkdown';
import { getImageUrlCandidates } from '../../utils/imageUrl';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import type { StudentHighlightColor } from './highlightPalette';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import { TableCompletionSlotCell } from './TableCompletionSlotCell';
import { emitAnswerMutationDebugLog } from './answerMutationDebug';
import { getMultiSelectSelectionLimit } from '../../utils/multiSelectMcq';

interface QuestionRendererProps {
  question:
    | TFNGQuestion
    | ClozeQuestion
    | MapQuestion
    | MatchingQuestion
    | ShortAnswerQuestion
    | SentenceCompletionQuestion
    | SingleMCQQuestion
    | NoteCompletionQuestion
    | null;
  block: QuestionBlock;
  number: number;
  answer: QuestionAnswer;
  onChange: (val: QuestionAnswer, meta?: StudentAnswerMutationMeta) => void;
  isFlagged?: boolean | undefined;
  isActive?: boolean | undefined;
  slotIds?: string[] | undefined;
  slotNumbers?: number[] | undefined;
  currentQuestionId?: string | null | undefined;
  flags?: Record<string, boolean> | undefined;
  onToggleFlag?: ((id: string) => void) | undefined;
  tabletMode?: boolean | undefined;
  compactPane?: boolean | undefined;
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  security?: {
    preventAutofill: boolean;
    preventAutocorrect: boolean;
  } | undefined;
  sessionId?: string | undefined;
  studentId?: string | undefined;
  hideDiagramReference?: boolean | undefined;
  registerLiveAnswer?: ((payload: { value: QuestionAnswer }) => void) | undefined;
}

export function QuestionRenderer({
  question,
  block,
  number,
  answer,
  onChange,
  isActive = false,
  slotIds = [],
  slotNumbers,
  currentQuestionId = null,
  flags = {},
  onToggleFlag,
  tabletMode = false,
  compactPane = false,
  highlightEnabled = false,
  highlightColor,
  security = { preventAutofill: false, preventAutocorrect: false },
  sessionId,
  studentId,
  hideDiagramReference = false,
  registerLiveAnswer,
}: QuestionRendererProps) {
  const stringArrayAnswer = Array.isArray(answer) ? answer : [];
  const isCompactPane = tabletMode && compactPane;
  const fieldIndentClass = tabletMode ? 'ml-0' : 'ml-9';
  const inputWidthClass = isCompactPane ? 'w-full min-w-0 max-w-full' : tabletMode ? 'max-w-full' : 'max-w-md';
  const getHighlightSurfaceId = (ownerId: string, slot: string) =>
    `question:${block.id}:${ownerId}:${slot}`;

  const getSlotId = (index: number, fallback: string) => slotIds[index] ?? fallback;
  const hasDuplicateSlotNumbers = React.useMemo(() => {
    if (!Array.isArray(slotNumbers) || slotNumbers.length === 0) {
      return false;
    }
    const seen = new Set<number>();
    for (const value of slotNumbers) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue;
      }
      if (seen.has(value)) {
        return true;
      }
      seen.add(value);
    }
    return false;
  }, [slotNumbers]);
  const getSlotNumber = (index: number, fallback: number) => slotNumbers?.[index] ?? fallback;
  const getSlotAriaLabelSuffix = (slotIndex: number) =>
    hasDuplicateSlotNumbers ? ` (blank ${slotIndex + 1})` : '';
  const getSlotClassName = (slotId: string) => {
    const activeClass = currentQuestionId === slotId ? 'ring-2 ring-blue-500 ring-offset-2' : '';
    const flaggedClass = flags[slotId] ? 'border-amber-300 bg-amber-50' : 'border-transparent';
    return `rounded-lg border p-2 transition-colors ${activeClass} ${flaggedClass}`;
  };

  const renderFlagButton = (slotId: string) => {
    if (!onToggleFlag) {
      return null;
    }

    return (
      <button
        type="button"
        onClick={() => onToggleFlag(slotId)}
        className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
          flags[slotId]
            ? 'border-amber-700 bg-amber-700 text-white'
            : 'border-gray-300 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700'
        }`}
        aria-label={flags[slotId] ? 'Unflag question' : 'Flag question'}
        title={flags[slotId] ? 'Unflag question' : 'Flag question'}
      >
        <span aria-hidden="true" className="text-sm">
          ⚑
        </span>
      </button>
    );
  };

  const updateIndexedAnswer = (index: number, value: string, total: number, slotId?: string) => {
    const next = Array.from({ length: total }, (_, candidateIndex) =>
      candidateIndex === index ? value : (stringArrayAnswer[candidateIndex] ?? ''),
    );
    emitAnswerMutationDebugLog('QuestionRenderer.updateIndexedAnswer', {
      blockType: block.type,
      blockId: block.id,
      slotIndex: index,
      slotId: slotId ?? null,
      slotCount: total,
      slotValue: value,
      nextAnswer: next,
      currentAnswer: stringArrayAnswer,
    });
    onChange(next, {
      slotIndex: index,
      slotId,
      slotCount: total,
      slotValue: value,
      interactionType: 'typing',
    });
    registerLiveAnswer?.({ value: next });
  };

  const commitAnswerChange = (value: QuestionAnswer, meta?: StudentAnswerMutationMeta) => {
    onChange(value, meta);
    registerLiveAnswer?.({ value });
  };

  const renderTextField = (
    slotId: string,
    slotNumber: number,
    value: string,
    changeValue: (nextValue: string) => void,
    extraCopy?: string,
    extraCopyPosition: 'top' | 'bottom' = 'bottom',
  ) => (
    <div id={`question-${slotId}`} className={getSlotClassName(slotId)}>
      {extraCopy && extraCopyPosition === 'top' ? (
        <StudentQuestionText
          as="p"
          className="mb-2 text-[length:var(--student-meta-font-size)] font-medium text-gray-600"
          text={extraCopy}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
          highlightSurfaceId={getHighlightSurfaceId(slotId, 'extra-copy-top')}
        />
      ) : null}
      <div className={isCompactPane ? 'flex flex-col items-stretch gap-2' : 'flex items-center gap-3'}>
        <StudentQuestionText as="span" className="min-w-[2rem] font-bold text-gray-900" text={`${slotNumber}.`} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(slotId, 'number')} />
        <ProtectedInput
          type="text"
          name={slotId}
          value={value}
          onChange={(event) => changeValue(event.target.value)}
          className={`w-full rounded-md border-2 border-gray-300 px-4 py-2 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${inputWidthClass}`}
          placeholder="Enter answer..."
          security={security}
          sessionId={sessionId}
          studentId={studentId}
          aria-label={`Answer for question ${slotNumber}`}
        />
        {renderFlagButton(slotId)}
      </div>
      {extraCopy && extraCopyPosition === 'bottom' ? (
        <StudentQuestionText
          as="p"
          className={`mt-2 text-sm text-gray-600 ${tabletMode ? 'pl-0' : 'pl-11'}`}
          text={extraCopy}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
          highlightSurfaceId={getHighlightSurfaceId(slotId, 'extra-copy-bottom')}
        />
      ) : null}
    </div>
  );

  const renderTFNG = (tfngBlock: TFNGBlock, q: TFNGQuestion) => {
    const options = tfngBlock.mode === 'TFNG' ? (['T', 'F', 'NG'] as const) : (['Y', 'N', 'NG'] as const);
    const labels =
      tfngBlock.mode === 'TFNG'
        ? { T: 'TRUE', F: 'FALSE', NG: 'NOT GIVEN' }
        : { Y: 'YES', N: 'NO', NG: 'NOT GIVEN' };

    return (
      <fieldset className="flex flex-col gap-4">
        <legend className="flex gap-3 items-start">
          <div className="mt-0.5 flex h-6 min-w-[1.75rem] items-center justify-center border-2 border-blue-500 text-[length:var(--student-chip-font-size)] font-bold text-blue-600">
            {number}
          </div>
          <StudentQuestionText
            as="span"
            className="leading-relaxed text-gray-900"
            text={q.statement}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightSurfaceId={getHighlightSurfaceId(q.id, 'statement')}
          />
        </legend>
        <div className={`${fieldIndentClass} flex flex-col gap-3`}>
          {options.map((option) => (
            <label key={option} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name={`q-${q.id}`}
                checked={answer === option}
                onChange={() => commitAnswerChange(option)}
                className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm uppercase text-gray-900">{labels[option as keyof typeof labels]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  };

  const renderCloze = (clozeBlock: ClozeBlock, q: ClozeQuestion) => {
    void clozeBlock;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <span className="min-w-[1.75rem] font-bold text-gray-900">{number}.</span>
          <StudentQuestionText
            as="span"
            className="text-gray-800"
            text={q.prompt}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightSurfaceId={getHighlightSurfaceId(q.id, 'prompt')}
          />
        </div>
        <div className={`${fieldIndentClass} mt-2`}>
          <ProtectedInput
            type="text"
            name={q.id}
            value={typeof answer === 'string' ? answer : ''}
            onChange={(event) => commitAnswerChange(event.target.value)}
            className={`w-full rounded-md border-2 border-gray-300 px-4 py-2 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${inputWidthClass}`}
            placeholder="Enter answer..."
            security={security}
            sessionId={sessionId}
            studentId={studentId}
            aria-label={`Answer for question ${number}`}
          />
        </div>
      </div>
    );
  };

  const renderMatching = (matchingBlock: MatchingBlock, q: MatchingQuestion) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
          <StudentQuestionText as="span" className="min-w-[1.75rem] font-bold text-gray-900" text={`${number}.`} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(q.id, 'number')} />
        <StudentQuestionText as="span" className="font-medium text-gray-800 text-[length:var(--student-control-font-size)]" text={`Paragraph ${q.paragraphLabel}`} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(q.id, 'paragraph-label')} />

        <select
          value={typeof answer === 'string' ? answer : ''}
          onChange={(event) => commitAnswerChange(event.target.value)}
          className={`flex-1 rounded-md border-2 border-gray-300 px-3 py-2 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0 max-w-full' : tabletMode ? 'max-w-full' : 'max-w-xs'}`}
          aria-label={`Heading selection for question ${number}`}
        >
          <option value="">Choose heading…</option>
          {matchingBlock.headings?.map((heading, index) => {
            const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][index];
            return (
              <option key={heading.id} value={roman}>
                {roman}. {stripBoldMarkdown(heading.text)}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );

  const renderMultiMCQ = (mcqBlock: MultiMCQBlock, blockNum: number) => {
    const selectedOptions = Array.isArray(answer) ? answer : [];
    const selectionLimit = getMultiSelectSelectionLimit(mcqBlock);

    const toggleOption = (optionId: string) => {
      if (selectedOptions.includes(optionId)) {
        commitAnswerChange(
          selectedOptions.filter((candidate) => candidate !== optionId),
          { arrayUpdateMode: 'replace', interactionType: 'discrete' },
        );
        return;
      }

      if (selectedOptions.length < selectionLimit) {
        commitAnswerChange(
          [...selectedOptions, optionId],
          { arrayUpdateMode: 'replace', interactionType: 'discrete' },
        );
      }
    };

    return (
      <fieldset className="flex flex-col gap-4">
        <legend className="flex gap-3">
          <span className="min-w-[1.75rem] font-bold text-gray-900">{blockNum}.</span>
        <StudentQuestionText
          as="span"
          className="text-gray-800"
          text={mcqBlock.stem || 'Select the correct options:'}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
          highlightSurfaceId={getHighlightSurfaceId(mcqBlock.id, 'stem')}
        />
        </legend>
        <div className={`${fieldIndentClass} space-y-3`}>
          {mcqBlock.options?.map((option, index) => {
            const letter = String.fromCharCode(65 + index);
            const isSelected = selectedOptions.includes(option.id);
            const isDisabled = !isSelected && selectedOptions.length >= selectionLimit;

            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border-2 p-3 transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : isDisabled
                      ? 'cursor-not-allowed border-gray-200 opacity-50'
                      : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => toggleOption(option.id)}
                  className="peer sr-only"
                  aria-label={`Option ${letter}. ${stripBoldMarkdown(option.text)}`}
                />
                <div
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                    isSelected ? 'border-blue-600 bg-blue-600' : 'border-gray-400 bg-white'
                  }`}
                >
                  {isSelected ? <div className="h-3 w-3 bg-white" style={{ clipPath: 'polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%)' }}></div> : null}
                </div>
                <div className="flex gap-2">
                  <StudentQuestionText as="span" className="font-bold text-gray-700" text={`${letter}.`} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(`${mcqBlock.id}:${option.id}`, 'option-letter')} />
                  <StudentQuestionText as="span" className="text-gray-800" text={option.text} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(`${mcqBlock.id}:${option.id}`, 'option-text')} />
                </div>
              </label>
            );
          })}
        </div>
        <div className={`${fieldIndentClass} text-[length:var(--student-meta-font-size)] font-medium text-gray-500`}>
          Selections: {selectedOptions.length}/{selectionLimit} required
        </div>
      </fieldset>
    );
  };

  const renderMap = (mapBlock: MapBlock, q: MapQuestion, num: number) => (
    <div className="flex flex-col gap-4">
      <StudentZoomableMedia
        sources={getImageUrlCandidates(mapBlock.assetUrl ?? '')}
        alt="Map reference"
        label="Map reference image"
        hint="Tap to zoom the map"
      />
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <span className="min-w-[1.75rem] font-bold text-gray-900">{num}.</span>
          <StudentQuestionText as="span" className="text-gray-800" text={`Label ${q.label}`} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(q.id, 'label')} />
        </div>
        <div className={`${fieldIndentClass} mt-2`}>
          <ProtectedInput
            type="text"
            name={q.id}
            value={typeof answer === 'string' ? answer : ''}
            onChange={(event) => commitAnswerChange(event.target.value)}
            className={`w-full rounded-md border-2 border-gray-300 px-4 py-2 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${inputWidthClass}`}
            placeholder="Enter label..."
            security={security}
            sessionId={sessionId}
            studentId={studentId}
            aria-label={`Answer for question ${num}`}
          />
        </div>
      </div>
    </div>
  );

  const renderSingleMCQ = (
    mcqBlock: SingleMCQBlock,
    blockNum: number,
    questionLevel: SingleMCQQuestion | null,
  ) => {
    const stem = questionLevel?.stem || mcqBlock.stem || 'Select the correct option:';
    const options = Array.isArray(questionLevel?.options) && questionLevel.options.length > 0
      ? questionLevel.options
      : mcqBlock.options ?? [];
    const inputGroupName = questionLevel ? `q-${questionLevel.id}` : `q-${mcqBlock.id}`;

    return (
      <fieldset className="flex flex-col gap-4">
        <legend className="flex gap-3">
          <span className="min-w-[1.75rem] font-bold text-gray-900">{blockNum}.</span>
          <StudentQuestionText
            as="span"
            className="text-gray-800"
            text={stem}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightSurfaceId={getHighlightSurfaceId(questionLevel?.id ?? mcqBlock.id, 'stem')}
          />
        </legend>
        <div className={`${fieldIndentClass} space-y-3`}>
          {options.map((option, index) => {
            const letter = String.fromCharCode(65 + index);
            return (
              <label key={option.id} className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name={inputGroupName}
                  checked={answer === option.id}
                  onChange={() => commitAnswerChange(option.id)}
                  className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <StudentQuestionText as="span" className="font-bold text-gray-700" text={`${letter}.`} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(`${questionLevel?.id ?? mcqBlock.id}:${option.id}`, 'option-letter')} />
                  <StudentQuestionText
                    as="span"
                    className="text-gray-800"
                    text={option.text}
                    highlightEnabled={highlightEnabled}
                    highlightColor={highlightColor}
                    highlightSurfaceId={getHighlightSurfaceId(`${questionLevel?.id ?? mcqBlock.id}:${option.id}`, 'option-text')}
                  />
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  };

  const renderShortAnswer = (shortBlock: ShortAnswerBlock, q: ShortAnswerQuestion, num: number) => {
    void shortBlock;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <span className="min-w-[1.75rem] font-bold text-gray-900">{num}.</span>
          <StudentQuestionText as="span" className="text-gray-800" text={q.prompt} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(q.id, 'prompt')} />
        </div>
        <div className={`${fieldIndentClass} mt-2`}>
          <ProtectedInput
            type="text"
            name={q.id}
            value={typeof answer === 'string' ? answer : ''}
            onChange={(event) => commitAnswerChange(event.target.value)}
            className={`w-full rounded-md border-2 border-gray-300 px-4 py-2 text-base transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${inputWidthClass}`}
            placeholder="Enter answer..."
            security={security}
            sessionId={sessionId}
            studentId={studentId}
            aria-label={`Answer for question ${num}`}
          />
        </div>
      </div>
    );
  };

  const renderSentenceCompletion = (sentenceBlock: SentenceCompletionBlock, q: SentenceCompletionQuestion) => {
    void sentenceBlock;
    const parts = q.sentence.split(/_{2,}/);
    const blanks = q.blanks.length;

    return (
      <div className="flex flex-col gap-4">
        <div className="leading-8 text-gray-900 [white-space:pre-wrap]">
          {parts.map((part, index) => (
            <React.Fragment key={`${q.id}-${index}`}>
              <StudentQuestionText as="span" text={part} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(q.id, `sentence-segment-${index}`)} />
              {index < blanks ? (
                (() => {
                  const slotId = getSlotId(index, `${q.id}:${index}`);
                  const slotNumber = getSlotNumber(index, number + index);
                  const ariaSuffix = getSlotAriaLabelSuffix(index);
                  return (
                <span
                  id={`question-${slotId}`}
                  className={`mx-1 inline-flex items-center gap-2 rounded-lg border px-2 py-1 align-middle ${getSlotClassName(
                    slotId,
                  )}`}
                >
                  <span className="min-w-[1.75rem] text-[length:var(--student-chip-font-size)] font-bold text-blue-700">
                    {slotNumber}
                  </span>
                  <ProtectedInput
                    type="text"
                    name={slotId}
                    value={stringArrayAnswer[index] ?? ''}
                    onChange={(event) =>
                      updateIndexedAnswer(index, event.target.value, blanks, slotId)
                    }
                    className={`rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0' : 'w-28'} ${tabletMode && !isCompactPane ? 'max-w-full' : ''}`}
                    placeholder="Answer..."
                    security={security}
                    sessionId={sessionId}
                    studentId={studentId}
                    aria-label={`Answer for question ${slotNumber}${ariaSuffix}`}
                  />
                  {renderFlagButton(slotId)}
                </span>
                  );
                })()
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  const renderNoteCompletion = (noteQuestion: NoteCompletionQuestion) => {
    const parts = noteQuestion.noteText.split(/_{2,}/);
    const blanks = noteQuestion.blanks.length;

    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <div className="leading-8 text-gray-900 [white-space:pre-wrap]">
          {parts.map((part, index) => (
            <React.Fragment key={`${noteQuestion.id}-${index}`}>
              <StudentQuestionText as="span" text={part} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(noteQuestion.id, `note-segment-${index}`)} />
              {index < blanks ? (
                (() => {
                  const slotId = getSlotId(index, `${noteQuestion.id}:${index}`);
                  const slotNumber = getSlotNumber(index, number + index);
                  const ariaSuffix = getSlotAriaLabelSuffix(index);
                  return (
                <span
                  id={`question-${slotId}`}
                  className={`mx-1 inline-flex items-center gap-2 rounded-lg border px-2 py-1 align-middle ${getSlotClassName(
                    slotId,
                  )}`}
                >
                  <span className="min-w-[1.75rem] text-[length:var(--student-chip-font-size)] font-bold text-blue-700">
                    {slotNumber}
                  </span>
                  <ProtectedInput
                    type="text"
                    name={slotId}
                    value={stringArrayAnswer[index] ?? ''}
                    onChange={(event) =>
                      updateIndexedAnswer(
                        index,
                        event.target.value,
                        blanks,
                        slotId,
                      )
                    }
                    className={`rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0' : 'w-28'} ${tabletMode && !isCompactPane ? 'max-w-full' : ''}`}
                    placeholder="Answer..."
                    security={security}
                    sessionId={sessionId}
                    studentId={studentId}
                    aria-label={`Answer for question ${slotNumber}${ariaSuffix}`}
                  />
                  {renderFlagButton(slotId)}
                </span>
                  );
                })()
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  const renderDiagramFallbackFields = (diagramBlock: DiagramLabelingBlock) => (
    <div className="space-y-3" data-testid="diagram-answer-panel">
      {diagramBlock.labels.map((label, index) => (
        <React.Fragment key={label.id}>
          {renderTextField(
            getSlotId(index, `${diagramBlock.id}:${label.id}`),
            getSlotNumber(index, number + index),
            stringArrayAnswer[index] ?? '',
            (nextValue) =>
              updateIndexedAnswer(
                index,
                nextValue,
                diagramBlock.labels.length,
                getSlotId(index, `${diagramBlock.id}:${label.id}`),
              ),
            label.prompt?.trim() || `Label ${index + 1}`,
            'top',
          )}
        </React.Fragment>
      ))}
    </div>
  );

  const renderDiagramLabeling = (diagramBlock: DiagramLabelingBlock) => {
    const sources = getImageUrlCandidates(diagramBlock.imageUrl ?? '');
    const hasImage = Boolean(sources[0]);

    if (hideDiagramReference) {
      return renderDiagramFallbackFields(diagramBlock);
    }

    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:items-start">
        <div className="sticky top-0 z-20 bg-white pb-3" data-testid="diagram-sticky-reference">
          {hasImage ? (
            <StudentZoomableMedia
              sources={sources}
              alt="Diagram reference"
              label="Diagram reference image"
              hint="Tap to zoom the diagram"
              imageClassName="max-h-[48dvh]"
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
              <div className="p-6 text-center text-sm text-gray-500">Diagram image URL is missing or inaccessible.</div>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-[length:var(--student-meta-font-size)] font-black uppercase tracking-[0.18em] text-gray-500">
            Answers
          </div>
          {renderDiagramFallbackFields(diagramBlock)}
        </div>
      </div>
    );
  };

  const renderFlowChart = (flowChartBlock: FlowChartBlock) => (
    <div className="space-y-3">
      {flowChartBlock.steps.map((step, index) =>
        renderTextField(
          getSlotId(index, `${flowChartBlock.id}:${step.id}`),
          getSlotNumber(index, number + index),
          stringArrayAnswer[index] ?? '',
          (nextValue) =>
            updateIndexedAnswer(
              index,
              nextValue,
              flowChartBlock.steps.length,
              getSlotId(index, `${flowChartBlock.id}:${step.id}`),
            ),
          step.label,
        ),
      )}
    </div>
  );

  const renderTableCompletion = (tableBlock: TableCompletionBlock) => {
    type TableSlot = {
      cell: TableCompletionBlock['cells'][number];
      index: number;
      slotId: string;
      placeholderIndex: number;
    };

    const slotsByCoordinate = new Map<string, TableSlot[]>();
    for (const [index, cell] of tableBlock.cells.entries()) {
      const placeholderIndex =
        typeof cell.placeholderIndex === 'number' &&
        Number.isInteger(cell.placeholderIndex) &&
        cell.placeholderIndex >= 0
          ? cell.placeholderIndex
          : -1;
      const coordinateKey = `${cell.row}:${cell.col}`;
      const next = slotsByCoordinate.get(coordinateKey) ?? [];
      next.push({
        cell,
        index,
        slotId: getSlotId(index, `${tableBlock.id}:${cell.id}`),
        placeholderIndex,
      });
      slotsByCoordinate.set(coordinateKey, next);
    }

    const placeholderPattern = /_{2,}/g;

    return (
      <div className="overflow-x-auto rounded-2xl border border-gray-200">
        <table
          className={`w-full border-collapse text-[length:var(--student-control-font-size)] ${
            isCompactPane ? 'min-w-[360px]' : 'min-w-[480px]'
          }`}
        >
          <thead className="bg-gray-50">
            <tr>
              {tableBlock.headers.map((header, index) => (
                <th
                  key={`${header}-${index}`}
                  className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900"
                >
                  <StudentQuestionText
                    as="span"
                    className="text-gray-900"
                    text={header}
                    highlightEnabled={highlightEnabled}
                    highlightColor={highlightColor}
                    highlightSurfaceId={getHighlightSurfaceId(tableBlock.id, `header-${index}`)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableBlock.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cellValue, cellIndex) => {
                  const slots = slotsByCoordinate.get(`${rowIndex}:${cellIndex}`) ?? null;

                  if (!slots) {
                    return (
                      <td
                        key={`cell-${rowIndex}-${cellIndex}`}
                        className="border border-gray-200 px-3 py-2 text-gray-800"
                      >
                        <StudentQuestionText
                          as="span"
                          className="text-gray-800"
                          text={cellValue}
                          highlightEnabled={highlightEnabled}
                          highlightColor={highlightColor}
                          highlightSurfaceId={getHighlightSurfaceId(tableBlock.id, `cell-${rowIndex}-${cellIndex}`)}
                        />
                      </td>
                    );
                  }

                  const promptSegmentsFromText = cellValue.split(placeholderPattern);
                  const placeholderCountFromText = Math.max(0, promptSegmentsFromText.length - 1);
                  const placeholderCount = Math.max(
                    1,
                    placeholderCountFromText,
                    slots.length,
                  );
                  const promptSegments =
                    placeholderCountFromText > 0 ? promptSegmentsFromText : [cellValue, ''];
                  while (promptSegments.length < placeholderCount + 1) {
                    promptSegments.push('');
                  }

                  const orderedSlots = [...slots].sort((left, right) => left.index - right.index);
                  const slotByPlaceholderPosition: Array<TableSlot | null> = Array.from(
                    { length: placeholderCount },
                    () => null,
                  );
                  const usedSlotIds = new Set<string>();
                  for (const slot of orderedSlots) {
                    const index = slot.placeholderIndex;
                    if (index >= 0 && index < placeholderCount && !slotByPlaceholderPosition[index]) {
                      slotByPlaceholderPosition[index] = slot;
                      usedSlotIds.add(slot.slotId);
                    }
                  }
                  for (const slot of orderedSlots) {
                    if (usedSlotIds.has(slot.slotId)) {
                      continue;
                    }
                    const openIndex = slotByPlaceholderPosition.findIndex((value) => value === null);
                    if (openIndex < 0) {
                      break;
                    }
                    slotByPlaceholderPosition[openIndex] = slot;
                    usedSlotIds.add(slot.slotId);
                  }

                  if (placeholderCount === 1 && orderedSlots.length === 1) {
                    const slot = orderedSlots[0];
                    if (!slot) {
                      return null;
                    }
                    const promptPrefixText = (promptSegments[0] ?? '').trimEnd();
                    const promptSuffixText =
                      promptSegments.length > 1
                        ? promptSegments.slice(1).join(' ').trimStart()
                        : '';

                    return (
                      <TableCompletionSlotCell
                        key={slot.cell.id}
                        slotId={slot.slotId}
                        highlightSurfaceIdPrefix={`question:${tableBlock.id}:${slot.slotId}`}
                        isActive={currentQuestionId === slot.slotId}
                        isFlagged={Boolean(flags[slot.slotId])}
                        promptPrefixText={promptPrefixText}
                        promptSuffixText={promptSuffixText}
                        slotNumber={getSlotNumber(slot.index, number + slot.index)}
                        answerValue={stringArrayAnswer[slot.index] ?? ''}
                        ariaLabel={`Answer for question ${getSlotNumber(slot.index, number + slot.index)}`}
                        highlightEnabled={highlightEnabled}
                        highlightColor={highlightColor}
                        security={security}
                        sessionId={sessionId}
                        studentId={studentId}
                        onChange={(nextValue) =>
                          updateIndexedAnswer(
                            slot.index,
                            nextValue,
                            tableBlock.cells.length,
                            slot.slotId,
                          )
                        }
                        renderFlagButton={renderFlagButton}
                      />
                    );
                  }

                  const isActive = orderedSlots.some(
                    (candidate) => candidate.slotId === currentQuestionId,
                  );
                  const isFlagged = orderedSlots.some((candidate) => Boolean(flags[candidate.slotId]));

                  return (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className={`border border-gray-200 px-3 py-2 align-top ${
                        isActive ? 'ring-2 ring-blue-500 ring-inset' : ''
                      } ${isFlagged ? 'bg-amber-50' : ''}`}
                    >
                      <div className="space-y-2">
                        <div className="text-[length:var(--student-control-font-size)] text-gray-800 [white-space:pre-wrap]">
                          {promptSegments.map((segment, segmentIndex) => {
                            const slot =
                              segmentIndex < placeholderCount
                                ? slotByPlaceholderPosition[segmentIndex]
                                : null;
                            return (
                              <React.Fragment
                                key={`table-segment-${rowIndex}-${cellIndex}-${segmentIndex}`}
                              >
                                <StudentQuestionText
                                  as="span"
                                  className="text-[length:var(--student-control-font-size)] text-gray-800"
                                  text={segment}
                                  highlightEnabled={highlightEnabled}
                                  highlightColor={highlightColor}
                                  highlightSurfaceId={getHighlightSurfaceId(tableBlock.id, `cell-${rowIndex}-${cellIndex}-segment-${segmentIndex}`)}
                                />
                                {segmentIndex < placeholderCount && slot ? (
                                  <span
                                    id={`question-${slot.slotId}`}
                                    className="mx-1 inline-flex items-center gap-2 align-middle"
                                  >
                                    <span className="font-bold text-gray-900">
                                      {getSlotNumber(slot.index, number + slot.index)}.
                                    </span>
                                    <span className="inline-block min-w-[11rem] max-w-full align-middle">
                                      <ProtectedInput
                                        type="text"
                                        name={slot.slotId}
                                        value={stringArrayAnswer[slot.index] ?? ''}
                                        onChange={(event) =>
                                          updateIndexedAnswer(
                                            slot.index,
                                            event.target.value,
                                            tableBlock.cells.length,
                                            slot.slotId,
                                          )
                                        }
                                        className="w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-[length:var(--student-control-font-size)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        placeholder="Enter answer..."
                                        security={security}
                                        sessionId={sessionId}
                                        studentId={studentId}
                                        aria-label={`Answer for question ${getSlotNumber(slot.index, number + slot.index)}`}
                                      />
                                    </span>
                                  </span>
                                ) : null}
                              </React.Fragment>
                            );
                          })}
                        </div>
                        <div className="flex justify-end">
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {orderedSlots.map((slot) => (
                              <React.Fragment key={`flag-${slot.slotId}`}>
                                {renderFlagButton(slot.slotId)}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderClassification = (classificationBlock: ClassificationBlock) => (
    <div className="space-y-4">
      <div className="space-y-3">
        {classificationBlock.items.map((item, index) => {
          const slotId = getSlotId(index, `${classificationBlock.id}:${item.id}`);
          const slotNumber = getSlotNumber(index, number + index);
          return (
            <div key={item.id} id={`question-${slotId}`} className={getSlotClassName(slotId)}>
              <div className={`flex flex-col gap-3 ${isCompactPane ? '' : 'md:flex-row md:items-center'}`}>
                <div className="flex items-start gap-3 md:flex-1">
                  <span className="min-w-[2rem] font-bold text-gray-900">{slotNumber}.</span>
                  <StudentQuestionText as="span" className="text-gray-800" text={item.text} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(slotId, 'item-text')} />
                </div>
                <div className={isCompactPane ? 'flex w-full flex-col items-stretch gap-2' : 'flex items-center gap-3'}>
                  <select
                    value={typeof stringArrayAnswer[index] === 'string' ? stringArrayAnswer[index] : ''}
                    onChange={(event) =>
                      updateIndexedAnswer(
                        index,
                        event.target.value,
                        classificationBlock.items.length,
                        slotId,
                      )
                    }
                    className={`rounded-md border border-gray-300 px-3 py-2 text-[length:var(--student-control-font-size)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0' : 'min-w-[11rem]'}`}
                    aria-label={`Category selection for question ${slotNumber}`}
                  >
                    <option value="">Choose category…</option>
                    {classificationBlock.categories.map((category) => (
                      <option key={category} value={category}>
                        {stripBoldMarkdown(category)}
                      </option>
                    ))}
                  </select>
                  {renderFlagButton(slotId)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderMatchingFeatures = (matchingFeaturesBlock: MatchingFeaturesBlock) => (
    <div className="space-y-4">
      <div className="space-y-3">
        {matchingFeaturesBlock.features.map((feature, index) => {
          const slotId = getSlotId(index, `${matchingFeaturesBlock.id}:${feature.id}`);
          const slotNumber = getSlotNumber(index, number + index);
          return (
            <div key={feature.id} id={`question-${slotId}`} className={getSlotClassName(slotId)}>
              <div className={`flex flex-col gap-3 ${isCompactPane ? '' : 'md:flex-row md:items-center'}`}>
                <div className="flex items-start gap-3 md:flex-1">
                  <span className="min-w-[2rem] font-bold text-gray-900">{slotNumber}.</span>
                  <StudentQuestionText as="span" className="text-gray-800" text={feature.text} highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightSurfaceId={getHighlightSurfaceId(slotId, 'feature-text')} />
                </div>
                <div className={isCompactPane ? 'flex w-full flex-col items-stretch gap-2' : 'flex items-center gap-3'}>
                  <select
                    value={typeof stringArrayAnswer[index] === 'string' ? stringArrayAnswer[index] : ''}
                    onChange={(event) =>
                      updateIndexedAnswer(
                        index,
                        event.target.value,
                        matchingFeaturesBlock.features.length,
                        slotId,
                      )
                    }
                    className={`rounded-md border border-gray-300 px-3 py-2 text-[length:var(--student-control-font-size)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0' : 'min-w-[11rem]'}`}
                    aria-label={`Matching selection for question ${slotNumber}`}
                  >
                    <option value="">Choose match…</option>
                    {matchingFeaturesBlock.options.map((option) => (
                      <option key={option} value={option}>
                        {stripBoldMarkdown(option)}
                      </option>
                    ))}
                  </select>
                  {renderFlagButton(slotId)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="relative">
      {block.type === 'TFNG' && question ? renderTFNG(block as TFNGBlock, question as TFNGQuestion) : null}
      {block.type === 'CLOZE' && question ? renderCloze(block as ClozeBlock, question as ClozeQuestion) : null}
      {block.type === 'MATCHING' && question ? renderMatching(block as MatchingBlock, question as MatchingQuestion) : null}
      {block.type === 'MULTI_MCQ' ? renderMultiMCQ(block as MultiMCQBlock, number) : null}
      {block.type === 'MAP' && question ? renderMap(block as MapBlock, question as MapQuestion, number) : null}
      {block.type === 'SINGLE_MCQ'
        ? renderSingleMCQ(block as SingleMCQBlock, number, question as SingleMCQQuestion | null)
        : null}
      {block.type === 'SHORT_ANSWER' && question
        ? renderShortAnswer(block as ShortAnswerBlock, question as ShortAnswerQuestion, number)
        : null}
      {block.type === 'SENTENCE_COMPLETION' && question
        ? renderSentenceCompletion(block as SentenceCompletionBlock, question as SentenceCompletionQuestion)
        : null}
      {block.type === 'DIAGRAM_LABELING' ? renderDiagramLabeling(block as DiagramLabelingBlock) : null}
      {block.type === 'FLOW_CHART' ? renderFlowChart(block as FlowChartBlock) : null}
      {block.type === 'TABLE_COMPLETION' ? renderTableCompletion(block as TableCompletionBlock) : null}
      {block.type === 'NOTE_COMPLETION' && question
        ? renderNoteCompletion(question as NoteCompletionQuestion)
        : null}
      {block.type === 'CLASSIFICATION' ? renderClassification(block as ClassificationBlock) : null}
      {block.type === 'MATCHING_FEATURES' ? renderMatchingFeatures(block as MatchingFeaturesBlock) : null}
    </div>
  );
}
