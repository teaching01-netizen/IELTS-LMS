import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ClassificationBlock,
  ClozeBlock,
  DiagramLabelingBlock,
  FlowChartBlock,
  MapBlock,
  MatchingBlock,
  MatchingFeaturesBlock,
  MultiMCQBlock,
  NoteCompletionBlock,
  NoteCompletionQuestion,
  QuestionAnswer,
  QuestionBlock,
  SentenceCompletionBlock,
  SentenceCompletionQuestion,
  ShortAnswerBlock,
  SingleMCQBlock,
  TableCompletionBlock,
  TFNGBlock,
} from '../../../types';
import type { StudentAnswerMutationMeta } from '../../../types/studentAttempt';
import { QuestionRenderer } from '../QuestionRenderer';

/**
 * FEX-020 (F-4): uniform per-renderer matrix — 9 dimensions × 14 render types.
 *
 * Dimensions: accessible label, initial hydrated value, user edit, mutation
 * metadata, clear behavior, keyboard navigation, flag behavior, rerender
 * preservation, reload hydration.
 *
 * Notes on testability boundaries (jsdom):
 * - Native radio arrow-key movement, select dropdown opening, and Space
 *   toggling of checkboxes are browser-owned behaviors that jsdom does not
 *   implement. We pin what the renderer owns: name-grouping (the enabler for
 *   native arrow navigation), focusability, and activation wiring.
 * - Flag wiring for TFNG / CLOZE / MATCHING / MULTI_MCQ / MAP / SINGLE_MCQ /
 *   SHORT_ANSWER lives in the PARENT (StudentQuestionBlockSection FlagButton,
 *   keyed by question id); the renderer only renders flag buttons for the
 *   slot-based types (one per slot). Both contracts are asserted.
 */
const security = { preventAutofill: false, preventAutocorrect: false };

// ---------------------------------------------------------------------------
// Fixtures (one per render type, shapes copied from src/types.ts)
// ---------------------------------------------------------------------------

const tfngBlock: TFNGBlock = {
  id: 'tfng-1',
  type: 'TFNG',
  instruction: 'Do the following statements agree with the passage?',
  mode: 'TFNG',
  questions: [
    { id: 'tfng-q1', statement: 'The study was peer-reviewed.', correctAnswer: 'T' },
  ],
};

const clozeBlock: ClozeBlock = {
  id: 'cloze-1',
  type: 'CLOZE',
  instruction: 'Complete the summary.',
  answerRule: 'ONE_WORD',
  questions: [
    { id: 'cloze-q1', prompt: 'The river flows through a ____ valley.', correctAnswer: 'green' },
  ],
};

const matchingBlock: MatchingBlock = {
  id: 'matching-1',
  type: 'MATCHING',
  instruction: 'Match each paragraph to its heading.',
  headings: [
    { id: 'h-1', text: 'Early history' },
    { id: 'h-2', text: 'Modern developments' },
  ],
  questions: [{ id: 'matching-q1', paragraphLabel: 'A', correctHeading: 'i' }],
};

const multiMcqBlock: MultiMCQBlock = {
  id: 'multi-1',
  type: 'MULTI_MCQ',
  instruction: 'Choose two options.',
  stem: 'Which two features are mentioned?',
  requiredSelections: 2,
  options: [
    { id: 'm-a', text: 'Solar panels', isCorrect: true },
    { id: 'm-b', text: 'Wind turbines', isCorrect: true },
    { id: 'm-c', text: 'Coal power', isCorrect: false },
  ],
};

const mapBlock: MapBlock = {
  id: 'map-1',
  type: 'MAP',
  instruction: 'Label the map.',
  assetUrl: '/map.png',
  questions: [
    { id: 'map-q1', label: 'Entrance', correctAnswer: 'north gate', x: 10, y: 20 },
  ],
};

const singleMcqBlock: SingleMCQBlock = {
  id: 'single-1',
  type: 'SINGLE_MCQ',
  instruction: 'Choose one answer.',
  stem: 'legacy fallback stem',
  options: [],
  questions: [
    {
      id: 'single-q1',
      stem: 'What is the capital?',
      options: [
        { id: 's-a', text: 'Paris', isCorrect: true },
        { id: 's-b', text: 'Rome', isCorrect: false },
      ],
    },
  ],
};

const singleMcqLegacyBlock: SingleMCQBlock = {
  id: 'single-legacy',
  type: 'SINGLE_MCQ',
  instruction: 'Choose one answer.',
  stem: 'Pick one.',
  options: [
    { id: 'l-a', text: 'Alpha', isCorrect: true },
    { id: 'l-b', text: 'Beta', isCorrect: false },
  ],
};

const shortAnswerBlock: ShortAnswerBlock = {
  id: 'short-1',
  type: 'SHORT_ANSWER',
  instruction: 'Answer the question.',
  questions: [
    { id: 'short-q1', prompt: 'What does the passage describe?', correctAnswer: 'geology', answerRule: 'ONE_WORD' },
  ],
};

const sentenceQuestion: SentenceCompletionQuestion = {
  id: 'sent-q1',
  sentence: 'The library is open ____ and ____.',
  blanks: [
    { id: 'sent-b1', correctAnswer: 'daily', position: 0 },
    { id: 'sent-b2', correctAnswer: 'late', position: 1 },
  ],
  answerRule: 'ONE_WORD',
};

const sentenceBlock: SentenceCompletionBlock = {
  id: 'sent-block-1',
  type: 'SENTENCE_COMPLETION',
  instruction: 'Complete the sentence.',
  questions: [sentenceQuestion],
};

const diagramBlock: DiagramLabelingBlock = {
  id: 'diagram-1',
  type: 'DIAGRAM_LABELING',
  instruction: 'Label the diagram.',
  imageUrl: '/diagram.png',
  labels: [
    { id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' },
    { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
  ],
};

const flowChartBlock: FlowChartBlock = {
  id: 'flow-1',
  type: 'FLOW_CHART',
  instruction: 'Complete the flow chart.',
  steps: [
    { id: 'step-a', label: 'Step one', correctAnswer: 'collect' },
    { id: 'step-b', label: 'Step two', correctAnswer: 'sort' },
  ],
};

const tableBlock: TableCompletionBlock = {
  id: 'table-1',
  type: 'TABLE_COMPLETION',
  instruction: 'Complete the table.',
  headers: ['Metric', 'Value'],
  rows: [
    ['Temperature', ''],
    ['Humidity', ''],
  ],
  cells: [
    { id: 'cell-1', row: 0, col: 1, correctAnswer: 'Warm' },
    { id: 'cell-2', row: 1, col: 1, correctAnswer: 'High' },
  ],
  answerRule: 'ONE_WORD',
};

const tableMultiSlotBlock: TableCompletionBlock = {
  id: 'table-ms',
  type: 'TABLE_COMPLETION',
  instruction: 'Complete the table.',
  headers: ['Item', 'Details'],
  rows: [['Special dietary requirements:', 'no _______ (red), _______ (green)']],
  cells: [
    { id: 'cell-a', row: 0, col: 1, placeholderIndex: 0, correctAnswer: 'nuts' },
    { id: 'cell-b', row: 0, col: 1, placeholderIndex: 1, correctAnswer: 'fish' },
  ],
  answerRule: 'ONE_WORD',
};

const noteQuestion: NoteCompletionQuestion = {
  id: 'note-q1',
  noteText: 'Rainfall is ____ in winter and ____ in summer.',
  blanks: [
    { id: 'note-b1', correctAnswer: 'heavy', position: 0 },
    { id: 'note-b2', correctAnswer: 'light', position: 1 },
  ],
  answerRule: 'ONE_WORD',
};

const noteBlock: NoteCompletionBlock = {
  id: 'note-block-1',
  type: 'NOTE_COMPLETION',
  instruction: 'Complete the notes.',
  questions: [noteQuestion],
};

const classificationBlock: ClassificationBlock = {
  id: 'classify-1',
  type: 'CLASSIFICATION',
  instruction: 'Classify each item.',
  categories: ['Category A', 'Category B'],
  items: [
    { id: 'item-1', text: 'First item', correctCategory: 'Category A' },
    { id: 'item-2', text: 'Second item', correctCategory: 'Category B' },
  ],
};

const matchingFeaturesBlock: MatchingFeaturesBlock = {
  id: 'features-1',
  type: 'MATCHING_FEATURES',
  instruction: 'Match each feature.',
  options: ['Writer A', 'Writer B'],
  features: [
    { id: 'feature-1', text: 'First feature', correctMatch: 'Writer A' },
    { id: 'feature-2', text: 'Second feature', correctMatch: 'Writer B' },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function questionElement(
  block: QuestionBlock,
  answer: QuestionAnswer,
  onChange: (value: QuestionAnswer, meta?: StudentAnswerMutationMeta) => void,
  extra?: {
    question?: unknown;
    number?: number;
    slotIds?: string[];
    slotNumbers?: number[];
    flags?: Record<string, boolean>;
    onToggleFlag?: (id: string) => void;
    registerLiveAnswer?: (payload: { value: QuestionAnswer }) => void;
    hideDiagramReference?: boolean;
  },
): React.ReactElement {
  const { question, number = 1, slotIds, slotNumbers, flags, onToggleFlag, registerLiveAnswer, hideDiagramReference } = extra ?? {};
  return (
    <QuestionRenderer
      question={(question as never) ?? null}
      block={block}
      number={number}
      answer={answer}
      onChange={onChange}
      slotIds={slotIds}
      slotNumbers={slotNumbers}
      flags={flags ?? {}}
      onToggleFlag={onToggleFlag}
      security={security}
      sessionId="schedule-1"
      studentId="attempt-1"
      registerLiveAnswer={registerLiveAnswer}
      hideDiagramReference={hideDiagramReference}
    />
  );
}

const typingMeta = (slotIndex: number, slotId: string | undefined, slotCount: number, slotValue: string): StudentAnswerMutationMeta => ({
  slotIndex,
  slotId,
  slotCount,
  slotValue,
  interactionType: 'typing',
});

// ---------------------------------------------------------------------------
// 1. TFNG
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: TFNG', () => {
  it('accessible label: fieldset+legend with statement, named radio group, per-option labels', () => {
    const onChange = vi.fn();
    const { container } = render(questionElement(tfngBlock, '', onChange, { question: tfngBlock.questions[0] }));

    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    const legend = fieldset?.querySelector('legend');
    expect(legend).toHaveTextContent('The study was peer-reviewed.');

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    for (const radio of radios) {
      expect(radio.getAttribute('name')).toBe('q-tfng-q1');
    }
    expect(screen.getByRole('radio', { name: 'TRUE' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'FALSE' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'NOT GIVEN' })).toBeInTheDocument();
  });

  it('accessible label: Y/N/NG mode renders YES/NO/NOT GIVEN', () => {
    const block: TFNGBlock = { ...tfngBlock, mode: 'YNG', questions: [{ id: 'tfng-q1', statement: 'Statement.', correctAnswer: 'Y' }] };
    render(questionElement(block, '', vi.fn(), { question: block.questions[0] }));
    expect(screen.getByRole('radio', { name: 'YES' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'NO' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'NOT GIVEN' })).toBeInTheDocument();
  });

  it('initial hydrated value: answer option id is checked', () => {
    render(questionElement(tfngBlock, 'F', vi.fn(), { question: tfngBlock.questions[0] }));
    expect(screen.getByRole('radio', { name: 'FALSE' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'TRUE' })).not.toBeChecked();
  });

  it('user edit: clicking an option emits the option value and live answer, with no meta', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(tfngBlock, '', onChange, { question: tfngBlock.questions[0], registerLiveAnswer }));

    fireEvent.click(screen.getByRole('radio', { name: 'TRUE' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('T');
    expect(onChange.mock.calls[0][1]).toBeUndefined();
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: 'T' });
  });

  it('mutation metadata: single non-slot choices emit no meta', () => {
    const onChange = vi.fn();
    render(questionElement(tfngBlock, 'F', onChange, { question: tfngBlock.questions[0] }));
    fireEvent.click(screen.getByRole('radio', { name: 'NOT GIVEN' }));
    expect(onChange.mock.calls[0][1]).toBeUndefined();
  });

  it('clear behavior: no clear affordance exists; re-activating the checked option emits nothing', () => {
    const onChange = vi.fn();
    render(questionElement(tfngBlock, 'F', onChange, { question: tfngBlock.questions[0] }));
    fireEvent.click(screen.getByRole('radio', { name: 'FALSE' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyboard navigation: radios share one name group (native arrow-key enabler) and are focusable', () => {
    render(questionElement(tfngBlock, 'F', vi.fn(), { question: tfngBlock.questions[0] }));
    const radios = screen.getAllByRole('radio');
    expect(new Set(radios.map((radio) => radio.getAttribute('name')))).toEqual(new Set(['q-tfng-q1']));
    radios[1].focus();
    expect(document.activeElement).toBe(radios[1]);
  });

  it('flag behavior: renderer renders no flag button (parent StudentQuestionBlockSection owns flagging)', () => {
    render(questionElement(tfngBlock, '', vi.fn(), { question: tfngBlock.questions[0], onToggleFlag: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Flag question' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unflag question' })).not.toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps the checked radio', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(tfngBlock, 'F', onChange, { question: tfngBlock.questions[0] }));
    rerender(questionElement(tfngBlock, 'F', onChange, { question: tfngBlock.questions[0] }));
    expect(screen.getByRole('radio', { name: 'FALSE' })).toBeChecked();
  });

  it('reload hydration: fresh mount with persisted answer reflects the saved option', () => {
    const persisted: QuestionAnswer = 'T';
    render(questionElement(tfngBlock, persisted, vi.fn(), { question: tfngBlock.questions[0] }));
    expect(screen.getByRole('radio', { name: 'TRUE' })).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// 2/5/7. CLOZE / MAP / SHORT_ANSWER — identical ProtectedInput text path
// ---------------------------------------------------------------------------

type TextCase = {
  name: string;
  block: QuestionBlock;
  question: unknown;
  number: number;
  ariaLabel: string;
  hydratedAnswer: string;
  editedValue: string;
};

const textCases: TextCase[] = [
  {
    name: 'CLOZE',
    block: clozeBlock,
    question: clozeBlock.questions[0],
    number: 3,
    ariaLabel: 'Answer for question 3',
    hydratedAnswer: 'green valley',
    editedValue: 'fertile valley',
  },
  {
    name: 'MAP',
    block: mapBlock,
    question: mapBlock.questions[0],
    number: 4,
    ariaLabel: 'Answer for question 4',
    hydratedAnswer: 'north gate',
    editedValue: 'south gate',
  },
  {
    name: 'SHORT_ANSWER',
    block: shortAnswerBlock,
    question: shortAnswerBlock.questions[0],
    number: 2,
    ariaLabel: 'Answer for question 2',
    hydratedAnswer: 'geology',
    editedValue: 'geography',
  },
];

describe('QuestionRenderer matrix: CLOZE / MAP / SHORT_ANSWER (ProtectedInput text path)', () => {
  it.each(textCases)('$name: accessible label on the textbox', ({ block, question, number, ariaLabel }) => {
    render(questionElement(block, '', vi.fn(), { question, number }));
    expect(screen.getByRole('textbox', { name: ariaLabel })).toBeInTheDocument();
  });

  it.each(textCases)('$name: initial hydrated value renders into the input', ({ block, question, number, hydratedAnswer }) => {
    render(questionElement(block, hydratedAnswer, vi.fn(), { question, number }));
    expect(screen.getByRole('textbox')).toHaveValue(hydratedAnswer);
  });

  it.each(textCases)('$name: user edit emits the new string and live answer', ({ block, question, number, editedValue }) => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(block, '', onChange, { question, number, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: editedValue } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(editedValue);
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: editedValue });
  });

  it.each(textCases)('$name: mutation metadata is absent (no meta emitted)', ({ block, question, number, editedValue }) => {
    const onChange = vi.fn();
    render(questionElement(block, '', onChange, { question, number }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: editedValue } });
    expect(onChange.mock.calls[0][1]).toBeUndefined();
  });

  it.each(textCases)("$name: clear behavior — emptying the input emits ''", ({ block, question, number, hydratedAnswer }) => {
    const onChange = vi.fn();
    render(questionElement(block, hydratedAnswer, onChange, { question, number }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('', undefined);
  });

  it.each(textCases)('$name: keyboard navigation — input is focusable and typing updates it', ({ block, question, number, editedValue }) => {
    const onChange = vi.fn();
    render(questionElement(block, '', onChange, { question, number }));
    const input = screen.getByRole('textbox');
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: editedValue } });
    expect(onChange).toHaveBeenCalledWith(editedValue, undefined);
  });

  it.each(textCases)('$name: flag behavior — renderer renders no flag button (parent owns flagging)', ({ block, question, number }) => {
    render(questionElement(block, '', vi.fn(), { question, number, onToggleFlag: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Flag question' })).not.toBeInTheDocument();
  });

  it.each(textCases)('$name: rerender preservation — same answer rerender keeps the input value', ({ block, question, number, hydratedAnswer }) => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(block, hydratedAnswer, onChange, { question, number }));
    rerender(questionElement(block, hydratedAnswer, onChange, { question, number }));
    expect(screen.getByRole('textbox')).toHaveValue(hydratedAnswer);
  });

  it.each(textCases)('$name: reload hydration — fresh mount with persisted answer shows saved text', ({ block, question, number, hydratedAnswer }) => {
    const persisted: QuestionAnswer = hydratedAnswer;
    render(questionElement(block, persisted, vi.fn(), { question, number }));
    expect(screen.getByRole('textbox')).toHaveValue(hydratedAnswer);
  });

  it('MAP: renders the map reference image with accessible alt text', () => {
    render(questionElement(mapBlock, '', vi.fn(), { question: mapBlock.questions[0], number: 4 }));
    expect(screen.getByAltText('Map reference')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. MATCHING
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: MATCHING', () => {
  it('accessible label: select has a heading-selection label and roman-numeral options', () => {
    render(questionElement(matchingBlock, '', vi.fn(), { question: matchingBlock.questions[0], number: 1 }));
    const select = screen.getByRole('combobox', { name: 'Heading selection for question 1' });
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'i. Early history' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ii. Modern developments' })).toBeInTheDocument();
  });

  it('initial hydrated value: roman option id is selected', () => {
    render(questionElement(matchingBlock, 'ii', vi.fn(), { question: matchingBlock.questions[0] }));
    expect(screen.getByRole('combobox')).toHaveValue('ii');
  });

  it('user edit: selection change emits the option value and live answer, with no meta', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(matchingBlock, '', onChange, { question: matchingBlock.questions[0], registerLiveAnswer }));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'i' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('i');
    expect(onChange.mock.calls[0][1]).toBeUndefined();
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: 'i' });
  });

  it('clear behavior: selecting the empty "Choose heading…" option emits an empty string', () => {
    const onChange = vi.fn();
    render(questionElement(matchingBlock, 'i', onChange, { question: matchingBlock.questions[0] }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('', undefined);
  });

  it('keyboard navigation: select is focusable and remains operable', () => {
    const onChange = vi.fn();
    render(questionElement(matchingBlock, '', onChange, { question: matchingBlock.questions[0] }));
    const select = screen.getByRole('combobox');
    select.focus();
    expect(document.activeElement).toBe(select);
    fireEvent.change(select, { target: { value: 'ii' } });
    expect(onChange).toHaveBeenCalledWith('ii', undefined);
  });

  it('flag behavior: renderer renders no flag button (parent owns flagging)', () => {
    render(questionElement(matchingBlock, '', vi.fn(), { question: matchingBlock.questions[0], onToggleFlag: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Flag question' })).not.toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps the selection', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(matchingBlock, 'ii', onChange, { question: matchingBlock.questions[0] }));
    rerender(questionElement(matchingBlock, 'ii', onChange, { question: matchingBlock.questions[0] }));
    expect(screen.getByRole('combobox')).toHaveValue('ii');
  });

  it('reload hydration: fresh mount with persisted answer shows the saved heading', () => {
    render(questionElement(matchingBlock, 'i', vi.fn(), { question: matchingBlock.questions[0] }));
    expect(screen.getByRole('combobox')).toHaveValue('i');
  });
});

// ---------------------------------------------------------------------------
// 4. MULTI_MCQ
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: MULTI_MCQ', () => {
  it('accessible label: fieldset+legend with the stem and per-option checkbox aria-labels', () => {
    const { container } = render(questionElement(multiMcqBlock, [], vi.fn()));
    const legend = container.querySelector('fieldset legend');
    expect(legend).toHaveTextContent('Which two features are mentioned?');
    expect(screen.getByRole('checkbox', { name: 'Option A. Solar panels' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Option B. Wind turbines' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Option C. Coal power' })).toBeInTheDocument();
  });

  it('initial hydrated value: selected option ids are checked', () => {
    render(questionElement(multiMcqBlock, ['m-a', 'm-c'], vi.fn()));
    expect(screen.getByRole('checkbox', { name: 'Option A. Solar panels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Option C. Coal power' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Option B. Wind turbines' })).not.toBeChecked();
  });

  it('user edit: toggling emits the real option-id array, replace meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(multiMcqBlock, [], onChange, { registerLiveAnswer }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Option A. Solar panels' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['m-a']);
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['m-a'] });
  });

  it('mutation metadata: every toggle emits replace/discrete meta', () => {
    const onChange = vi.fn();
    render(questionElement(multiMcqBlock, [], onChange));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Option A. Solar panels' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Option B. Wind turbines' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    for (const call of onChange.mock.calls) {
      expect(call[1]).toEqual({ arrayUpdateMode: 'replace', interactionType: 'discrete' });
    }
  });

  it('clear behavior: unselecting every option emits an empty array', () => {
    const onChange = vi.fn();
    function ClearHarness() {
      const [answer, setAnswer] = React.useState<string[]>(['m-a', 'm-b']);
      return (
        <QuestionRenderer
          block={multiMcqBlock}
          number={1}
          answer={answer}
          onChange={(next, meta) => {
            onChange(next, meta);
            setAnswer(next as string[]);
          }}
          security={security}
          sessionId="schedule-1"
          studentId="attempt-1"
        />
      );
    }
    render(<ClearHarness />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Option A. Solar panels' }));
    expect(onChange).toHaveBeenLastCalledWith(['m-b'], { arrayUpdateMode: 'replace', interactionType: 'discrete' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Option B. Wind turbines' }));
    expect(onChange).toHaveBeenLastCalledWith([], { arrayUpdateMode: 'replace', interactionType: 'discrete' });
    expect(screen.getByRole('checkbox', { name: 'Option A. Solar panels' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Option B. Wind turbines' })).not.toBeChecked();
  });

  it('keyboard navigation: checkboxes are focusable and activation (click) toggles selection', () => {
    const onChange = vi.fn();
    render(questionElement(multiMcqBlock, [], onChange));
    const box = screen.getByRole('checkbox', { name: 'Option A. Solar panels' });
    box.focus();
    expect(document.activeElement).toBe(box);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(['m-a'], { arrayUpdateMode: 'replace', interactionType: 'discrete' });
  });

  it('flag behavior: renderer renders no flag button (parent owns flagging)', () => {
    render(questionElement(multiMcqBlock, [], vi.fn(), { onToggleFlag: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Flag question' })).not.toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps the checked options', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(multiMcqBlock, ['m-a'], onChange));
    rerender(questionElement(multiMcqBlock, ['m-a'], onChange));
    expect(screen.getByRole('checkbox', { name: 'Option A. Solar panels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Option B. Wind turbines' })).not.toBeChecked();
  });

  it('reload hydration: fresh mount with persisted array checks the saved options', () => {
    render(questionElement(multiMcqBlock, ['m-b', 'm-c'], vi.fn()));
    expect(screen.getByRole('checkbox', { name: 'Option B. Wind turbines' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Option C. Coal power' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Option A. Solar panels' })).not.toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// 6. SINGLE_MCQ
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: SINGLE_MCQ (question-level)', () => {
  it('accessible label: fieldset+legend with the stem and wrapping-label option names', () => {
    const { container } = render(questionElement(singleMcqBlock, '', vi.fn(), { question: singleMcqBlock.questions![0] }));
    const legend = container.querySelector('fieldset legend');
    expect(legend).toHaveTextContent('What is the capital?');
    expect(screen.getByRole('radio', { name: 'A. Paris' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'B. Rome' })).toBeInTheDocument();
  });

  it('accessible label: legacy block-level options render under the block name group', () => {
    const { container } = render(questionElement(singleMcqLegacyBlock, '', vi.fn()));
    const legend = container.querySelector('fieldset legend');
    expect(legend).toHaveTextContent('Pick one.');
    const radios = screen.getAllByRole('radio');
    expect(new Set(radios.map((radio) => radio.getAttribute('name')))).toEqual(new Set(['q-single-legacy']));
    expect(screen.getByRole('radio', { name: 'A. Alpha' })).toBeInTheDocument();
  });

  it('initial hydrated value: option id is checked', () => {
    render(questionElement(singleMcqBlock, 's-b', vi.fn(), { question: singleMcqBlock.questions![0] }));
    expect(screen.getByRole('radio', { name: 'B. Rome' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'A. Paris' })).not.toBeChecked();
  });

  it('user edit: clicking an option emits the option id and live answer, with no meta', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(singleMcqBlock, '', onChange, { question: singleMcqBlock.questions![0], registerLiveAnswer }));

    fireEvent.click(screen.getByRole('radio', { name: 'A. Paris' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('s-a');
    expect(onChange.mock.calls[0][1]).toBeUndefined();
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: 's-a' });
  });

  it('mutation metadata: single non-slot choices emit no meta', () => {
    const onChange = vi.fn();
    render(questionElement(singleMcqBlock, '', onChange, { question: singleMcqBlock.questions![0] }));
    fireEvent.click(screen.getByRole('radio', { name: 'B. Rome' }));
    expect(onChange.mock.calls[0][1]).toBeUndefined();
  });

  it('clear behavior: no clear affordance exists; re-activating the checked option emits nothing', () => {
    const onChange = vi.fn();
    render(questionElement(singleMcqBlock, 's-a', onChange, { question: singleMcqBlock.questions![0] }));
    fireEvent.click(screen.getByRole('radio', { name: 'A. Paris' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyboard navigation: radios share one name group (native arrow-key enabler) and are focusable', () => {
    render(questionElement(singleMcqBlock, '', vi.fn(), { question: singleMcqBlock.questions![0] }));
    const radios = screen.getAllByRole('radio');
    expect(new Set(radios.map((radio) => radio.getAttribute('name')))).toEqual(new Set(['q-single-q1']));
    radios[0].focus();
    expect(document.activeElement).toBe(radios[0]);
  });

  it('flag behavior: renderer renders no flag button (parent owns flagging)', () => {
    render(questionElement(singleMcqBlock, '', vi.fn(), { question: singleMcqBlock.questions![0], onToggleFlag: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Flag question' })).not.toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps the checked radio', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(singleMcqBlock, 's-b', onChange, { question: singleMcqBlock.questions![0] }));
    rerender(questionElement(singleMcqBlock, 's-b', onChange, { question: singleMcqBlock.questions![0] }));
    expect(screen.getByRole('radio', { name: 'B. Rome' })).toBeChecked();
  });

  it('reload hydration: fresh mount with persisted answer shows the saved option', () => {
    render(questionElement(singleMcqBlock, 's-a', vi.fn(), { question: singleMcqBlock.questions![0] }));
    expect(screen.getByRole('radio', { name: 'A. Paris' })).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// 8. SENTENCE_COMPLETION
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: SENTENCE_COMPLETION', () => {
  const slotIds = ['sent-slot-0', 'sent-slot-1'];
  const slotNumbers = [7, 8];

  it('accessible label: one labelled input per blank', () => {
    render(questionElement(sentenceBlock, ['', ''], vi.fn(), { question: sentenceQuestion, number: 7, slotIds, slotNumbers }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 7' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 8' })).toBeInTheDocument();
  });

  it('initial hydrated value: per-slot strings render into their inputs', () => {
    render(questionElement(sentenceBlock, ['daily', ''], vi.fn(), { question: sentenceQuestion, number: 7, slotIds, slotNumbers }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 7' })).toHaveValue('daily');
    expect(screen.getByRole('textbox', { name: 'Answer for question 8' })).toHaveValue('');
  });

  it('user edit: typing in one blank emits the full array, typing meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(sentenceBlock, ['daily', ''], onChange, { question: sentenceQuestion, number: 7, slotIds, slotNumbers, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 8' }), { target: { value: 'late' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['daily', 'late']);
    expect(onChange.mock.calls[0][1]).toEqual(typingMeta(1, 'sent-slot-1', 2, 'late'));
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['daily', 'late'] });
  });

  it('clear behavior: emptying one blank leaves the other blank value intact and emits the full array', () => {
    const onChange = vi.fn();
    render(questionElement(sentenceBlock, ['daily', 'late'], onChange, { question: sentenceQuestion, number: 7, slotIds, slotNumbers }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 7' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(['', 'late'], typingMeta(0, 'sent-slot-0', 2, ''));
  });

  it('keyboard navigation: blank inputs are focusable and flag buttons are focusable + activatable', () => {
    const onToggleFlag = vi.fn();
    render(questionElement(sentenceBlock, ['', ''], vi.fn(), { question: sentenceQuestion, number: 7, slotIds, slotNumbers, onToggleFlag }));

    const input = screen.getByRole('textbox', { name: 'Answer for question 8' });
    input.focus();
    expect(document.activeElement).toBe(input);

    const flags = screen.getAllByRole('button', { name: 'Flag question' });
    expect(flags).toHaveLength(2);
    flags[1].focus();
    expect(document.activeElement).toBe(flags[1]);
    fireEvent.click(flags[1]);
    expect(onToggleFlag).toHaveBeenCalledWith('sent-slot-1');
  });

  it('flag behavior: one flag per slot, keyed by slotId; aria-label flips with flags state', () => {
    const onToggleFlag = vi.fn();
    const { rerender } = render(questionElement(sentenceBlock, ['', ''], vi.fn(), { question: sentenceQuestion, number: 7, slotIds, slotNumbers, onToggleFlag }));

    expect(screen.getAllByRole('button', { name: 'Flag question' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Flag question' })[0]);
    expect(onToggleFlag).toHaveBeenCalledWith('sent-slot-0');

    rerender(questionElement(sentenceBlock, ['', ''], vi.fn(), { question: sentenceQuestion, number: 7, slotIds, slotNumbers, onToggleFlag, flags: { 'sent-slot-0': true } }));
    expect(screen.getByRole('button', { name: 'Unflag question' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Flag question' })).toHaveLength(1);
  });

  it('rerender preservation: same answer rerender keeps every blank value', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(sentenceBlock, ['daily', 'late'], onChange, { question: sentenceQuestion, number: 7, slotIds, slotNumbers }));
    rerender(questionElement(sentenceBlock, ['daily', 'late'], onChange, { question: sentenceQuestion, number: 7, slotIds, slotNumbers }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 7' })).toHaveValue('daily');
    expect(screen.getByRole('textbox', { name: 'Answer for question 8' })).toHaveValue('late');
  });

  it('reload hydration: fresh mount with persisted array fills every blank', () => {
    render(questionElement(sentenceBlock, ['daily', 'late'], vi.fn(), { question: sentenceQuestion, number: 7, slotIds, slotNumbers }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 7' })).toHaveValue('daily');
    expect(screen.getByRole('textbox', { name: 'Answer for question 8' })).toHaveValue('late');
  });
});

// ---------------------------------------------------------------------------
// 9. DIAGRAM_LABELING
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: DIAGRAM_LABELING', () => {
  const slotIds = ['diagram-1:label-a', 'diagram-1:label-b'];

  it('accessible label: diagram reference image alt plus one labelled input per label', () => {
    render(questionElement(diagramBlock, ['', ''], vi.fn(), { question: null, number: 12, slotIds }));
    expect(screen.getByAltText('Diagram reference')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-sticky-reference')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 12' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toBeInTheDocument();
  });

  it('initial hydrated value: per-label strings render into their inputs', () => {
    render(questionElement(diagramBlock, ['engine', ''], vi.fn(), { question: null, number: 12, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 12' })).toHaveValue('engine');
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toHaveValue('');
  });

  it('user edit: typing in one label emits the full array, typing meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(diagramBlock, ['engine', ''], onChange, { question: null, number: 12, slotIds, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 13' }), { target: { value: 'wheel' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['engine', 'wheel']);
    expect(onChange.mock.calls[0][1]).toEqual(typingMeta(1, 'diagram-1:label-b', 2, 'wheel'));
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['engine', 'wheel'] });
  });

  it('clear behavior: emptying one label leaves the other label value intact', () => {
    const onChange = vi.fn();
    render(questionElement(diagramBlock, ['engine', 'wheel'], onChange, { question: null, number: 12, slotIds }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 12' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(['', 'wheel'], typingMeta(0, 'diagram-1:label-a', 2, ''));
  });

  it('keyboard navigation: label inputs are focusable and flag buttons are focusable + activatable', () => {
    const onToggleFlag = vi.fn();
    render(questionElement(diagramBlock, ['', ''], vi.fn(), { question: null, number: 12, slotIds, onToggleFlag }));

    const input = screen.getByRole('textbox', { name: 'Answer for question 13' });
    input.focus();
    expect(document.activeElement).toBe(input);

    const flags = screen.getAllByRole('button', { name: 'Flag question' });
    expect(flags).toHaveLength(2);
    flags[0].focus();
    expect(document.activeElement).toBe(flags[0]);
  });

  it('flag behavior: one flag per label, keyed by slotId; aria-label flips with flags state', () => {
    const onToggleFlag = vi.fn();
    const { rerender } = render(questionElement(diagramBlock, ['', ''], vi.fn(), { question: null, number: 12, slotIds, onToggleFlag }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Flag question' })[1]);
    expect(onToggleFlag).toHaveBeenCalledWith('diagram-1:label-b');

    rerender(questionElement(diagramBlock, ['', ''], vi.fn(), { question: null, number: 12, slotIds, onToggleFlag, flags: { 'diagram-1:label-b': true } }));
    expect(screen.getByRole('button', { name: 'Unflag question' })).toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps every label value', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(diagramBlock, ['engine', 'wheel'], onChange, { question: null, number: 12, slotIds }));
    rerender(questionElement(diagramBlock, ['engine', 'wheel'], onChange, { question: null, number: 12, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 12' })).toHaveValue('engine');
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toHaveValue('wheel');
  });

  it('reload hydration: fresh mount with persisted array fills every label', () => {
    render(questionElement(diagramBlock, ['wheel', 'engine'], vi.fn(), { question: null, number: 12, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 12' })).toHaveValue('wheel');
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toHaveValue('engine');
  });
});

// ---------------------------------------------------------------------------
// 10. FLOW_CHART
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: FLOW_CHART', () => {
  const slotIds = ['flow-1:step-a', 'flow-1:step-b'];

  it('accessible label: one labelled input per step', () => {
    render(questionElement(flowChartBlock, ['', ''], vi.fn(), { question: null, number: 3, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 3' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 4' })).toBeInTheDocument();
  });

  it('initial hydrated value: per-step strings render into their inputs', () => {
    render(questionElement(flowChartBlock, ['collect', ''], vi.fn(), { question: null, number: 3, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 3' })).toHaveValue('collect');
    expect(screen.getByRole('textbox', { name: 'Answer for question 4' })).toHaveValue('');
  });

  it('user edit: typing in one step emits the full array, typing meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(flowChartBlock, ['collect', ''], onChange, { question: null, number: 3, slotIds, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 4' }), { target: { value: 'sort' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['collect', 'sort']);
    expect(onChange.mock.calls[0][1]).toEqual(typingMeta(1, 'flow-1:step-b', 2, 'sort'));
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['collect', 'sort'] });
  });

  it('clear behavior: emptying one step leaves the other step value intact', () => {
    const onChange = vi.fn();
    render(questionElement(flowChartBlock, ['collect', 'sort'], onChange, { question: null, number: 3, slotIds }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 4' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(['collect', ''], typingMeta(1, 'flow-1:step-b', 2, ''));
  });

  it('keyboard navigation: step inputs are focusable and flag buttons are focusable', () => {
    const onToggleFlag = vi.fn();
    render(questionElement(flowChartBlock, ['', ''], vi.fn(), { question: null, number: 3, slotIds, onToggleFlag }));

    const input = screen.getByRole('textbox', { name: 'Answer for question 3' });
    input.focus();
    expect(document.activeElement).toBe(input);

    const flags = screen.getAllByRole('button', { name: 'Flag question' });
    expect(flags).toHaveLength(2);
    flags[1].focus();
    expect(document.activeElement).toBe(flags[1]);
  });

  it('flag behavior: one flag per step, keyed by slotId; aria-label flips with flags state', () => {
    const onToggleFlag = vi.fn();
    const { rerender } = render(questionElement(flowChartBlock, ['', ''], vi.fn(), { question: null, number: 3, slotIds, onToggleFlag }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Flag question' })[0]);
    expect(onToggleFlag).toHaveBeenCalledWith('flow-1:step-a');

    rerender(questionElement(flowChartBlock, ['', ''], vi.fn(), { question: null, number: 3, slotIds, onToggleFlag, flags: { 'flow-1:step-a': true } }));
    expect(screen.getByRole('button', { name: 'Unflag question' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Flag question' })).toHaveLength(1);
  });

  it('rerender preservation: same answer rerender keeps every step value', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(flowChartBlock, ['collect', 'sort'], onChange, { question: null, number: 3, slotIds }));
    rerender(questionElement(flowChartBlock, ['collect', 'sort'], onChange, { question: null, number: 3, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 3' })).toHaveValue('collect');
    expect(screen.getByRole('textbox', { name: 'Answer for question 4' })).toHaveValue('sort');
  });

  it('reload hydration: fresh mount with persisted array fills every step', () => {
    render(questionElement(flowChartBlock, ['sort', 'collect'], vi.fn(), { question: null, number: 3, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 3' })).toHaveValue('sort');
    expect(screen.getByRole('textbox', { name: 'Answer for question 4' })).toHaveValue('collect');
  });
});

// ---------------------------------------------------------------------------
// 11. TABLE_COMPLETION
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: TABLE_COMPLETION (single-slot cells)', () => {
  const slotIds = ['table-1:cell-1', 'table-1:cell-2'];

  it('accessible label: one labelled input per cell', () => {
    render(questionElement(tableBlock, ['', ''], vi.fn(), { question: null, number: 9, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 9' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 10' })).toBeInTheDocument();
  });

  it('initial hydrated value: per-cell strings render into their inputs', () => {
    render(questionElement(tableBlock, ['Warm', ''], vi.fn(), { question: null, number: 9, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 9' })).toHaveValue('Warm');
    expect(screen.getByRole('textbox', { name: 'Answer for question 10' })).toHaveValue('');
  });

  it('user edit: typing in one cell emits the full array, typing meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(tableBlock, ['Warm', ''], onChange, { question: null, number: 9, slotIds, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 10' }), { target: { value: 'High' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['Warm', 'High']);
    expect(onChange.mock.calls[0][1]).toEqual(typingMeta(1, 'table-1:cell-2', 2, 'High'));
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['Warm', 'High'] });
  });

  it('clear behavior: emptying one cell leaves the other cell value intact', () => {
    const onChange = vi.fn();
    render(questionElement(tableBlock, ['Warm', 'High'], onChange, { question: null, number: 9, slotIds }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 9' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(['', 'High'], typingMeta(0, 'table-1:cell-1', 2, ''));
  });

  it('keyboard navigation: cell inputs are focusable and flag buttons are focusable + activatable', () => {
    const onToggleFlag = vi.fn();
    render(questionElement(tableBlock, ['', ''], vi.fn(), { question: null, number: 9, slotIds, onToggleFlag }));

    const input = screen.getByRole('textbox', { name: 'Answer for question 9' });
    input.focus();
    expect(document.activeElement).toBe(input);

    const flags = screen.getAllByRole('button', { name: 'Flag question' });
    expect(flags).toHaveLength(2);
    flags[1].focus();
    expect(document.activeElement).toBe(flags[1]);
  });

  it('flag behavior: one flag per cell, keyed by slotId; aria-label flips with flags state', () => {
    const onToggleFlag = vi.fn();
    const { rerender } = render(questionElement(tableBlock, ['', ''], vi.fn(), { question: null, number: 9, slotIds, onToggleFlag }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Flag question' })[1]);
    expect(onToggleFlag).toHaveBeenCalledWith('table-1:cell-2');

    rerender(questionElement(tableBlock, ['', ''], vi.fn(), { question: null, number: 9, slotIds, onToggleFlag, flags: { 'table-1:cell-2': true } }));
    expect(screen.getByRole('button', { name: 'Unflag question' })).toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps every cell value', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(tableBlock, ['Warm', 'High'], onChange, { question: null, number: 9, slotIds }));
    rerender(questionElement(tableBlock, ['Warm', 'High'], onChange, { question: null, number: 9, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 9' })).toHaveValue('Warm');
    expect(screen.getByRole('textbox', { name: 'Answer for question 10' })).toHaveValue('High');
  });

  it('reload hydration: fresh mount with persisted array fills every cell', () => {
    render(questionElement(tableBlock, ['High', 'Warm'], vi.fn(), { question: null, number: 9, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 9' })).toHaveValue('High');
    expect(screen.getByRole('textbox', { name: 'Answer for question 10' })).toHaveValue('Warm');
  });
});

describe('QuestionRenderer matrix: TABLE_COMPLETION (multi-slot cell)', () => {
  const slotIds = ['table-ms:cell-a', 'table-ms:cell-b'];

  it('accessible label: one labelled input per placeholder inside the shared cell', () => {
    render(questionElement(tableMultiSlotBlock, ['', ''], vi.fn(), { question: null, number: 5, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 6' })).toBeInTheDocument();
  });

  it('initial hydrated value: per-placeholder strings render into their inputs', () => {
    render(questionElement(tableMultiSlotBlock, ['NUTS', 'FISH'], vi.fn(), { question: null, number: 5, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toHaveValue('NUTS');
    expect(screen.getByRole('textbox', { name: 'Answer for question 6' })).toHaveValue('FISH');
  });

  it('user edit: typing in one placeholder emits the full array, typing meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(tableMultiSlotBlock, ['', ''], onChange, { question: null, number: 5, slotIds, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 5' }), { target: { value: 'nuts' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['nuts', '']);
    expect(onChange.mock.calls[0][1]).toEqual(typingMeta(0, 'table-ms:cell-a', 2, 'nuts'));
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['nuts', ''] });
  });

  it('clear behavior: emptying one placeholder leaves the sibling placeholder intact', () => {
    const onChange = vi.fn();
    render(questionElement(tableMultiSlotBlock, ['nuts', 'fish'], onChange, { question: null, number: 5, slotIds }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 6' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(['nuts', ''], typingMeta(1, 'table-ms:cell-b', 2, ''));
  });

  it('keyboard navigation: multi-slot cell inputs are focusable and operable', () => {
    render(questionElement(tableMultiSlotBlock, ['', ''], vi.fn(), { question: null, number: 5, slotIds }));
    const first = screen.getByRole('textbox', { name: 'Answer for question 5' });
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.change(first, { target: { value: 'at' } });
  });

  it('rerender preservation: same answer rerender keeps every placeholder value', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(tableMultiSlotBlock, ['nuts', 'fish'], onChange, { question: null, number: 5, slotIds }));
    rerender(questionElement(tableMultiSlotBlock, ['nuts', 'fish'], onChange, { question: null, number: 5, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toHaveValue('nuts');
    expect(screen.getByRole('textbox', { name: 'Answer for question 6' })).toHaveValue('fish');
  });

  it('flag behavior: one flag per placeholder, keyed by slotId', () => {
    const onToggleFlag = vi.fn();
    const { rerender } = render(questionElement(tableMultiSlotBlock, ['', ''], vi.fn(), { question: null, number: 5, slotIds, onToggleFlag }));

    const flags = screen.getAllByRole('button', { name: 'Flag question' });
    expect(flags).toHaveLength(2);
    fireEvent.click(flags[0]);
    expect(onToggleFlag).toHaveBeenCalledWith('table-ms:cell-a');

    rerender(questionElement(tableMultiSlotBlock, ['', ''], vi.fn(), { question: null, number: 5, slotIds, onToggleFlag, flags: { 'table-ms:cell-a': true } }));
    expect(screen.getByRole('button', { name: 'Unflag question' })).toBeInTheDocument();
  });

  it('reload hydration: fresh mount with persisted array fills every placeholder', () => {
    render(questionElement(tableMultiSlotBlock, ['FISH', 'NUTS'], vi.fn(), { question: null, number: 5, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toHaveValue('FISH');
    expect(screen.getByRole('textbox', { name: 'Answer for question 6' })).toHaveValue('NUTS');
  });
});

// ---------------------------------------------------------------------------
// 12. NOTE_COMPLETION
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: NOTE_COMPLETION', () => {
  const slotIds = ['note-slot-0', 'note-slot-1'];

  it('accessible label: one labelled input per blank', () => {
    render(questionElement(noteBlock, ['', ''], vi.fn(), { question: noteQuestion, number: 4, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 4' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toBeInTheDocument();
  });

  it('initial hydrated value: per-blank strings render into their inputs', () => {
    render(questionElement(noteBlock, ['heavy', ''], vi.fn(), { question: noteQuestion, number: 4, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 4' })).toHaveValue('heavy');
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toHaveValue('');
  });

  it('user edit: typing in one blank emits the full array, typing meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(noteBlock, ['heavy', ''], onChange, { question: noteQuestion, number: 4, slotIds, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 5' }), { target: { value: 'light' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['heavy', 'light']);
    expect(onChange.mock.calls[0][1]).toEqual(typingMeta(1, 'note-slot-1', 2, 'light'));
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['heavy', 'light'] });
  });

  it('clear behavior: emptying one blank leaves the other blank value intact', () => {
    const onChange = vi.fn();
    render(questionElement(noteBlock, ['heavy', 'light'], onChange, { question: noteQuestion, number: 4, slotIds }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 4' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(['', 'light'], typingMeta(0, 'note-slot-0', 2, ''));
  });

  it('keyboard navigation: blank inputs are focusable and flag buttons are focusable + activatable', () => {
    const onToggleFlag = vi.fn();
    render(questionElement(noteBlock, ['', ''], vi.fn(), { question: noteQuestion, number: 4, slotIds, onToggleFlag }));

    const input = screen.getByRole('textbox', { name: 'Answer for question 5' });
    input.focus();
    expect(document.activeElement).toBe(input);

    const flags = screen.getAllByRole('button', { name: 'Flag question' });
    expect(flags).toHaveLength(2);
    flags[0].focus();
    expect(document.activeElement).toBe(flags[0]);
    fireEvent.click(flags[0]);
    expect(onToggleFlag).toHaveBeenCalledWith('note-slot-0');
  });

  it('flag behavior: one flag per blank, keyed by slotId; aria-label flips with flags state', () => {
    const onToggleFlag = vi.fn();
    const { rerender } = render(questionElement(noteBlock, ['', ''], vi.fn(), { question: noteQuestion, number: 4, slotIds, onToggleFlag }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Flag question' })[1]);
    expect(onToggleFlag).toHaveBeenCalledWith('note-slot-1');

    rerender(questionElement(noteBlock, ['', ''], vi.fn(), { question: noteQuestion, number: 4, slotIds, onToggleFlag, flags: { 'note-slot-1': true } }));
    expect(screen.getByRole('button', { name: 'Unflag question' })).toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps every blank value', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(noteBlock, ['heavy', 'light'], onChange, { question: noteQuestion, number: 4, slotIds }));
    rerender(questionElement(noteBlock, ['heavy', 'light'], onChange, { question: noteQuestion, number: 4, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 4' })).toHaveValue('heavy');
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toHaveValue('light');
  });

  it('reload hydration: fresh mount with persisted array fills every blank', () => {
    render(questionElement(noteBlock, ['light', 'heavy'], vi.fn(), { question: noteQuestion, number: 4, slotIds }));
    expect(screen.getByRole('textbox', { name: 'Answer for question 4' })).toHaveValue('light');
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toHaveValue('heavy');
  });
});

// ---------------------------------------------------------------------------
// 13. CLASSIFICATION
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: CLASSIFICATION', () => {
  const slotIds = ['classify-1:item-1', 'classify-1:item-2'];

  it('accessible label: one category select per item', () => {
    render(questionElement(classificationBlock, ['', ''], vi.fn(), { question: null, number: 6, slotIds }));
    const selectOne = screen.getByRole('combobox', { name: 'Category selection for question 6' });
    const selectTwo = screen.getByRole('combobox', { name: 'Category selection for question 7' });
    expect(within(selectOne).getByRole('option', { name: 'Category A' })).toBeInTheDocument();
    expect(within(selectOne).getByRole('option', { name: 'Category B' })).toBeInTheDocument();
    expect(within(selectTwo).getByRole('option', { name: 'Category B' })).toBeInTheDocument();
  });

  it('initial hydrated value: per-item category renders into its select', () => {
    render(questionElement(classificationBlock, ['Category A', ''], vi.fn(), { question: null, number: 6, slotIds }));
    expect(screen.getByRole('combobox', { name: 'Category selection for question 6' })).toHaveValue('Category A');
    expect(screen.getByRole('combobox', { name: 'Category selection for question 7' })).toHaveValue('');
  });

  it('user edit: selecting a category emits the full array, typing meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(classificationBlock, ['Category A', ''], onChange, { question: null, number: 6, slotIds, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Category selection for question 7' }), { target: { value: 'Category B' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['Category A', 'Category B']);
    expect(onChange.mock.calls[0][1]).toEqual(typingMeta(1, 'classify-1:item-2', 2, 'Category B'));
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['Category A', 'Category B'] });
  });

  it('clear behavior: selecting the empty "Choose category…" option clears only that item', () => {
    const onChange = vi.fn();
    render(questionElement(classificationBlock, ['Category A', 'Category B'], onChange, { question: null, number: 6, slotIds }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Category selection for question 6' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(['', 'Category B'], typingMeta(0, 'classify-1:item-1', 2, ''));
  });

  it('keyboard navigation: selects are focusable and flag buttons are focusable + activatable', () => {
    const onToggleFlag = vi.fn();
    render(questionElement(classificationBlock, ['', ''], vi.fn(), { question: null, number: 6, slotIds, onToggleFlag }));

    const select = screen.getByRole('combobox', { name: 'Category selection for question 7' });
    select.focus();
    expect(document.activeElement).toBe(select);

    const flags = screen.getAllByRole('button', { name: 'Flag question' });
    expect(flags).toHaveLength(2);
    flags[0].focus();
    expect(document.activeElement).toBe(flags[0]);
  });

  it('flag behavior: one flag per item, keyed by slotId; aria-label flips with flags state', () => {
    const onToggleFlag = vi.fn();
    const { rerender } = render(questionElement(classificationBlock, ['', ''], vi.fn(), { question: null, number: 6, slotIds, onToggleFlag }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Flag question' })[0]);
    expect(onToggleFlag).toHaveBeenCalledWith('classify-1:item-1');

    rerender(questionElement(classificationBlock, ['', ''], vi.fn(), { question: null, number: 6, slotIds, onToggleFlag, flags: { 'classify-1:item-1': true } }));
    expect(screen.getByRole('button', { name: 'Unflag question' })).toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps every select value', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(classificationBlock, ['Category A', 'Category B'], onChange, { question: null, number: 6, slotIds }));
    rerender(questionElement(classificationBlock, ['Category A', 'Category B'], onChange, { question: null, number: 6, slotIds }));
    expect(screen.getByRole('combobox', { name: 'Category selection for question 6' })).toHaveValue('Category A');
    expect(screen.getByRole('combobox', { name: 'Category selection for question 7' })).toHaveValue('Category B');
  });

  it('reload hydration: fresh mount with persisted array fills every select', () => {
    render(questionElement(classificationBlock, ['Category B', 'Category A'], vi.fn(), { question: null, number: 6, slotIds }));
    expect(screen.getByRole('combobox', { name: 'Category selection for question 6' })).toHaveValue('Category B');
    expect(screen.getByRole('combobox', { name: 'Category selection for question 7' })).toHaveValue('Category A');
  });
});

// ---------------------------------------------------------------------------
// 14. MATCHING_FEATURES
// ---------------------------------------------------------------------------

describe('QuestionRenderer matrix: MATCHING_FEATURES', () => {
  const slotIds = ['features-1:feature-1', 'features-1:feature-2'];

  it('accessible label: one matching select per feature', () => {
    render(questionElement(matchingFeaturesBlock, ['', ''], vi.fn(), { question: null, number: 8, slotIds }));
    const selectOne = screen.getByRole('combobox', { name: 'Matching selection for question 8' });
    const selectTwo = screen.getByRole('combobox', { name: 'Matching selection for question 9' });
    expect(within(selectOne).getByRole('option', { name: 'Writer A' })).toBeInTheDocument();
    expect(within(selectOne).getByRole('option', { name: 'Writer B' })).toBeInTheDocument();
    expect(within(selectTwo).getByRole('option', { name: 'Writer B' })).toBeInTheDocument();
  });

  it('initial hydrated value: per-feature match renders into its select', () => {
    render(questionElement(matchingFeaturesBlock, ['Writer A', ''], vi.fn(), { question: null, number: 8, slotIds }));
    expect(screen.getByRole('combobox', { name: 'Matching selection for question 8' })).toHaveValue('Writer A');
    expect(screen.getByRole('combobox', { name: 'Matching selection for question 9' })).toHaveValue('');
  });

  it('user edit: selecting a match emits the full array, typing meta, and live answer', () => {
    const onChange = vi.fn();
    const registerLiveAnswer = vi.fn();
    render(questionElement(matchingFeaturesBlock, ['Writer A', ''], onChange, { question: null, number: 8, slotIds, registerLiveAnswer }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Matching selection for question 9' }), { target: { value: 'Writer B' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['Writer A', 'Writer B']);
    expect(onChange.mock.calls[0][1]).toEqual(typingMeta(1, 'features-1:feature-2', 2, 'Writer B'));
    expect(registerLiveAnswer).toHaveBeenCalledWith({ value: ['Writer A', 'Writer B'] });
  });

  it('clear behavior: selecting the empty "Choose match…" option clears only that feature', () => {
    const onChange = vi.fn();
    render(questionElement(matchingFeaturesBlock, ['Writer A', 'Writer B'], onChange, { question: null, number: 8, slotIds }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Matching selection for question 9' }), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(['Writer A', ''], typingMeta(1, 'features-1:feature-2', 2, ''));
  });

  it('keyboard navigation: selects are focusable and flag buttons are focusable + activatable', () => {
    const onToggleFlag = vi.fn();
    render(questionElement(matchingFeaturesBlock, ['', ''], vi.fn(), { question: null, number: 8, slotIds, onToggleFlag }));

    const select = screen.getByRole('combobox', { name: 'Matching selection for question 8' });
    select.focus();
    expect(document.activeElement).toBe(select);

    const flags = screen.getAllByRole('button', { name: 'Flag question' });
    expect(flags).toHaveLength(2);
    flags[1].focus();
    expect(document.activeElement).toBe(flags[1]);
    fireEvent.click(flags[1]);
    expect(onToggleFlag).toHaveBeenCalledWith('features-1:feature-2');
  });

  it('flag behavior: one flag per feature, keyed by slotId; aria-label flips with flags state', () => {
    const onToggleFlag = vi.fn();
    const { rerender } = render(questionElement(matchingFeaturesBlock, ['', ''], vi.fn(), { question: null, number: 8, slotIds, onToggleFlag }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Flag question' })[0]);
    expect(onToggleFlag).toHaveBeenCalledWith('features-1:feature-1');

    rerender(questionElement(matchingFeaturesBlock, ['', ''], vi.fn(), { question: null, number: 8, slotIds, onToggleFlag, flags: { 'features-1:feature-1': true } }));
    expect(screen.getByRole('button', { name: 'Unflag question' })).toBeInTheDocument();
  });

  it('rerender preservation: same answer rerender keeps every select value', () => {
    const onChange = vi.fn();
    const { rerender } = render(questionElement(matchingFeaturesBlock, ['Writer A', 'Writer B'], onChange, { question: null, number: 8, slotIds }));
    rerender(questionElement(matchingFeaturesBlock, ['Writer A', 'Writer B'], onChange, { question: null, number: 8, slotIds }));
    expect(screen.getByRole('combobox', { name: 'Matching selection for question 8' })).toHaveValue('Writer A');
    expect(screen.getByRole('combobox', { name: 'Matching selection for question 9' })).toHaveValue('Writer B');
  });

  it('reload hydration: fresh mount with persisted array fills every select', () => {
    render(questionElement(matchingFeaturesBlock, ['Writer B', 'Writer A'], vi.fn(), { question: null, number: 8, slotIds }));
    expect(screen.getByRole('combobox', { name: 'Matching selection for question 8' })).toHaveValue('Writer B');
    expect(screen.getByRole('combobox', { name: 'Matching selection for question 9' })).toHaveValue('Writer A');
  });
});
