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
  TableCompletionBlock,
  TFNGBlock,
  TFNGQuestion,
} from '../../types';
import { ProtectedInput } from './ProtectedInput';
import { FormattedText } from './FormattedText';
import { stripBoldMarkdown } from '../../utils/boldMarkdown';
import { getImageUrlCandidates } from '../../utils/imageUrl';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import type { StudentHighlightColor } from './highlightPalette';

interface QuestionRendererProps {
  question:
    | TFNGQuestion
    | ClozeQuestion
    | MapQuestion
    | MatchingQuestion
    | ShortAnswerQuestion
    | SentenceCompletionQuestion
    | NoteCompletionQuestion
    | null;
  block: QuestionBlock;
  number: number;
  answer: QuestionAnswer;
  onChange: (val: QuestionAnswer) => void;
  isFlagged?: boolean | undefined;
  isActive?: boolean | undefined;
  slotIds?: string[] | undefined;
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
}

export function QuestionRenderer({
  question,
  block,
  number,
  answer,
  onChange,
  isActive = false,
  slotIds = [],
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
}: QuestionRendererProps) {
  const stringArrayAnswer = Array.isArray(answer) ? answer : [];
  const isCompactPane = tabletMode && compactPane;
  const fieldIndentClass = tabletMode ? 'ml-0' : 'ml-9';
  const inputWidthClass = isCompactPane ? 'w-full min-w-0 max-w-full' : tabletMode ? 'max-w-full' : 'max-w-md';

  const getSlotId = (index: number, fallback: string) => slotIds[index] ?? fallback;
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

  const updateIndexedAnswer = (index: number, value: string, total: number) => {
    const next = Array.from({ length: total }, (_, candidateIndex) =>
      candidateIndex === index ? value : (stringArrayAnswer[candidateIndex] ?? ''),
    );
    onChange(next);
  };

  const renderTextField = (
    slotId: string,
    slotNumber: number,
    value: string,
    changeValue: (nextValue: string) => void,
    extraCopy?: string,
  ) => (
    <div id={`question-${slotId}`} className={getSlotClassName(slotId)}>
      <div className={isCompactPane ? 'flex flex-col items-stretch gap-2' : 'flex items-center gap-3'}>
        <span className="min-w-[2rem] font-bold text-gray-900">{slotNumber}.</span>
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
      {extraCopy ? (
        <FormattedText
          as="p"
          className={`mt-2 text-sm text-gray-600 ${tabletMode ? 'pl-0' : 'pl-11'}`}
          text={extraCopy}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
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
          <FormattedText
            as="span"
            className="leading-relaxed text-gray-900"
            text={q.statement}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
          />
        </legend>
        <div className={`${fieldIndentClass} flex flex-col gap-3`}>
          {options.map((option) => (
            <label key={option} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name={`q-${q.id}`}
                checked={answer === option}
                onChange={() => onChange(option)}
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
          <FormattedText
            as="span"
            className="text-gray-800"
            text={q.prompt}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
          />
        </div>
        <div className={`${fieldIndentClass} mt-2`}>
          <ProtectedInput
            type="text"
            name={q.id}
            value={typeof answer === 'string' ? answer : ''}
            onChange={(event) => onChange(event.target.value)}
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
          <span className="min-w-[1.75rem] font-bold text-gray-900">{number}.</span>
        <span className="font-medium text-gray-800 text-[length:var(--student-control-font-size)]">
          Paragraph {q.paragraphLabel}
        </span>

        <select
          value={typeof answer === 'string' ? answer : ''}
          onChange={(event) => onChange(event.target.value)}
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

    const toggleOption = (optionId: string) => {
      if (selectedOptions.includes(optionId)) {
        onChange(selectedOptions.filter((candidate) => candidate !== optionId));
        return;
      }

      if (selectedOptions.length < mcqBlock.requiredSelections) {
        onChange([...selectedOptions, optionId]);
      }
    };

    return (
      <fieldset className="flex flex-col gap-4">
        <legend className="flex gap-3">
          <span className="min-w-[1.75rem] font-bold text-gray-900">{blockNum}.</span>
        <FormattedText
          as="span"
          className="text-gray-800"
          text={mcqBlock.stem || 'Select the correct options:'}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
        />
        </legend>
        <div className={`${fieldIndentClass} space-y-3`}>
          {mcqBlock.options?.map((option, index) => {
            const letter = String.fromCharCode(65 + index);
            const isSelected = selectedOptions.includes(option.id);
            const isDisabled = !isSelected && selectedOptions.length >= mcqBlock.requiredSelections;

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
                  <span className="font-bold text-gray-700">{letter}.</span>
                  <FormattedText as="span" className="text-gray-800" text={option.text} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
                </div>
              </label>
            );
          })}
        </div>
        <div className={`${fieldIndentClass} text-[length:var(--student-meta-font-size)] font-medium text-gray-500`}>
          Selections: {selectedOptions.length}/{mcqBlock.requiredSelections} required
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
          <span className="text-gray-800">
            Label <FormattedText as="span" className="text-gray-800" text={q.label} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
          </span>
        </div>
        <div className={`${fieldIndentClass} mt-2`}>
          <ProtectedInput
            type="text"
            name={q.id}
            value={typeof answer === 'string' ? answer : ''}
            onChange={(event) => onChange(event.target.value)}
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

  const renderSingleMCQ = (mcqBlock: SingleMCQBlock, blockNum: number) => (
    <fieldset className="flex flex-col gap-4">
      <legend className="flex gap-3">
        <span className="min-w-[1.75rem] font-bold text-gray-900">{blockNum}.</span>
        <FormattedText
          as="span"
          className="text-gray-800"
          text={mcqBlock.stem || 'Select the correct option:'}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
        />
      </legend>
      <div className={`${fieldIndentClass} space-y-3`}>
        {mcqBlock.options?.map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          return (
            <label key={option.id} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name={`q-${mcqBlock.id}`}
                checked={answer === option.id}
                onChange={() => onChange(option.id)}
                className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <span className="font-bold text-gray-700">{letter}.</span>
                  <FormattedText as="span" className="text-gray-800" text={option.text} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );

  const renderShortAnswer = (shortBlock: ShortAnswerBlock, q: ShortAnswerQuestion, num: number) => {
    void shortBlock;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <span className="min-w-[1.75rem] font-bold text-gray-900">{num}.</span>
          <FormattedText as="span" className="text-gray-800" text={q.prompt} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
        </div>
        <div className={`${fieldIndentClass} mt-2`}>
          <ProtectedInput
            type="text"
            name={q.id}
            value={typeof answer === 'string' ? answer : ''}
            onChange={(event) => onChange(event.target.value)}
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
              <FormattedText as="span" text={part} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
              {index < blanks ? (
                <span
                  id={`question-${getSlotId(index, `${q.id}:${index}`)}`}
                  className={`mx-1 inline-flex items-center gap-2 rounded-lg border px-2 py-1 align-middle ${getSlotClassName(
                    getSlotId(index, `${q.id}:${index}`),
                  )}`}
                >
                  <span className="min-w-[1.75rem] text-[length:var(--student-chip-font-size)] font-bold text-blue-700">
                    {number + index}
                  </span>
                  <ProtectedInput
                    type="text"
                    name={getSlotId(index, `${q.id}:${index}`)}
                    value={stringArrayAnswer[index] ?? ''}
                    onChange={(event) => updateIndexedAnswer(index, event.target.value, blanks)}
                    className={`rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0' : 'w-28'} ${tabletMode && !isCompactPane ? 'max-w-full' : ''}`}
                    placeholder="Answer..."
                    security={security}
                    sessionId={sessionId}
                    studentId={studentId}
                    aria-label={`Answer for question ${number + index}`}
                  />
                  {renderFlagButton(getSlotId(index, `${q.id}:${index}`))}
                </span>
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
              <FormattedText as="span" text={part} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
              {index < blanks ? (
                <span
                  id={`question-${getSlotId(index, `${noteQuestion.id}:${index}`)}`}
                  className={`mx-1 inline-flex items-center gap-2 rounded-lg border px-2 py-1 align-middle ${getSlotClassName(
                    getSlotId(index, `${noteQuestion.id}:${index}`),
                  )}`}
                >
                  <span className="min-w-[1.75rem] text-[length:var(--student-chip-font-size)] font-bold text-blue-700">
                    {number + index}
                  </span>
                  <ProtectedInput
                    type="text"
                    name={getSlotId(index, `${noteQuestion.id}:${index}`)}
                    value={stringArrayAnswer[index] ?? ''}
                    onChange={(event) => updateIndexedAnswer(index, event.target.value, blanks)}
                    className={`rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0' : 'w-28'} ${tabletMode && !isCompactPane ? 'max-w-full' : ''}`}
                    placeholder="Answer..."
                    security={security}
                    sessionId={sessionId}
                    studentId={studentId}
                    aria-label={`Answer for question ${number + index}`}
                  />
                  {renderFlagButton(getSlotId(index, `${noteQuestion.id}:${index}`))}
                </span>
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
            number + index,
            stringArrayAnswer[index] ?? '',
            (nextValue) => updateIndexedAnswer(index, nextValue, diagramBlock.labels.length),
            `Label ${index + 1}`,
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
              <div className="p-6 text-center text-sm text-gray-500">Add a diagram to support this question.</div>
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
          number + index,
          stringArrayAnswer[index] ?? '',
          (nextValue) => updateIndexedAnswer(index, nextValue, flowChartBlock.steps.length),
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
    };

    const cellMap = new Map<string, TableSlot>(
      tableBlock.cells.map((cell, index): [string, TableSlot] => [
        `${cell.row}:${cell.col}`,
        { cell, index, slotId: getSlotId(index, `${tableBlock.id}:${cell.id}`) },
      ]),
    );

    return (
      <div className="overflow-x-auto rounded-2xl border border-gray-200">
        <table className={`w-full border-collapse text-sm ${isCompactPane ? 'min-w-[360px]' : 'min-w-[480px]'}`}>
          <thead className="bg-gray-50">
            <tr>
              {tableBlock.headers.map((header, index) => (
                <th key={`${header}-${index}`} className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900">
                  <FormattedText as="span" className="text-gray-900" text={header} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableBlock.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cellValue, cellIndex) => {
                  const slot = cellMap.get(`${rowIndex}:${cellIndex}`);

                  if (!slot) {
                    return (
                      <td key={`cell-${rowIndex}-${cellIndex}`} className="border border-gray-200 px-3 py-2 text-gray-800">
                        <FormattedText as="span" className="text-gray-800" text={cellValue} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
                      </td>
                    );
                  }

                  return (
                    <td
                      key={slot.cell.id}
                      id={`question-${slot.slotId}`}
                      className={`border border-gray-200 px-3 py-2 align-top ${getSlotClassName(slot.slotId)}`}
                    >
                      <div className="mb-2 text-[length:var(--student-chip-font-size)] font-bold text-blue-700">
                        {number + slot.index}
                      </div>
                      <ProtectedInput
                        type="text"
                        name={slot.slotId}
                        value={stringArrayAnswer[slot.index] ?? ''}
                        onChange={(event) => updateIndexedAnswer(slot.index, event.target.value, tableBlock.cells.length)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="Enter answer..."
                        security={security}
                        sessionId={sessionId}
                        studentId={studentId}
                        aria-label={`Answer for question ${number + slot.index}`}
                      />
                      <div className="mt-2 flex justify-end">{renderFlagButton(slot.slotId)}</div>
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
          return (
            <div key={item.id} id={`question-${slotId}`} className={getSlotClassName(slotId)}>
              <div className={`flex flex-col gap-3 ${isCompactPane ? '' : 'md:flex-row md:items-center'}`}>
                <div className="flex items-start gap-3 md:flex-1">
                  <span className="min-w-[2rem] font-bold text-gray-900">{number + index}.</span>
                  <FormattedText as="span" className="text-gray-800" text={item.text} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
                </div>
                <div className={isCompactPane ? 'flex w-full flex-col items-stretch gap-2' : 'flex items-center gap-3'}>
                  <select
                    value={typeof stringArrayAnswer[index] === 'string' ? stringArrayAnswer[index] : ''}
                    onChange={(event) => updateIndexedAnswer(index, event.target.value, classificationBlock.items.length)}
                    className={`rounded-md border border-gray-300 px-3 py-2 text-[length:var(--student-control-font-size)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0' : 'min-w-[11rem]'}`}
                    aria-label={`Category selection for question ${number + index}`}
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
          return (
            <div key={feature.id} id={`question-${slotId}`} className={getSlotClassName(slotId)}>
              <div className={`flex flex-col gap-3 ${isCompactPane ? '' : 'md:flex-row md:items-center'}`}>
                <div className="flex items-start gap-3 md:flex-1">
                  <span className="min-w-[2rem] font-bold text-gray-900">{number + index}.</span>
                  <FormattedText as="span" className="text-gray-800" text={feature.text} highlightEnabled={highlightEnabled} highlightColor={highlightColor} />
                </div>
                <div className={isCompactPane ? 'flex w-full flex-col items-stretch gap-2' : 'flex items-center gap-3'}>
                  <select
                    value={typeof stringArrayAnswer[index] === 'string' ? stringArrayAnswer[index] : ''}
                    onChange={(event) => updateIndexedAnswer(index, event.target.value, matchingFeaturesBlock.features.length)}
                    className={`rounded-md border border-gray-300 px-3 py-2 text-[length:var(--student-control-font-size)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isCompactPane ? 'w-full min-w-0' : 'min-w-[11rem]'}`}
                    aria-label={`Matching selection for question ${number + index}`}
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
      {block.type === 'SINGLE_MCQ' ? renderSingleMCQ(block as SingleMCQBlock, number) : null}
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
