import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  ClassificationBlock as ClassificationBlockType,
  DiagramLabelingBlock as DiagramLabelingBlockType,
  FlowChartBlock as FlowChartBlockType,
  MapBlock as MapBlockType,
  MatchingFeaturesBlock as MatchingFeaturesBlockType,
  NoteCompletionBlock as NoteCompletionBlockType,
  SentenceCompletionBlock as SentenceCompletionBlockType,
  ShortAnswerBlock as ShortAnswerBlockType,
} from '../../../types';
import { ClassificationBlock } from '../ClassificationBlock';
import { DiagramLabelingBlock } from '../DiagramLabelingBlock';
import { FlowChartBlock } from '../FlowChartBlock';
import { MapLabelingBlock } from '../MapLabelingBlock';
import { MatchingFeaturesBlock } from '../MatchingFeaturesBlock';
import { NoteCompletionBlock } from '../NoteCompletionBlock';
import { SentenceCompletionBlock } from '../SentenceCompletionBlock';
import { ShortAnswerBlock } from '../ShortAnswerBlock';

describe('accepted answer chips in block editors', () => {
  it('keeps short-answer primary correctAnswer synced with acceptedAnswers', () => {
    const initialBlock: ShortAnswerBlockType = {
      id: 'short-1',
      type: 'SHORT_ANSWER',
      instruction: 'Answer the question',
      questions: [
        {
          id: 'q-1',
          prompt: 'Name one pet',
          correctAnswer: 'dog',
          acceptedAnswers: ['dog'],
          answerRule: 'ONE_WORD',
        },
      ],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <ShortAnswerBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText('Enter the accepted answer...');
    fireEvent.change(input, { target: { value: 'cat' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(latestBlock.questions[0]?.acceptedAnswers).toEqual(['dog', 'cat']);
    expect(latestBlock.questions[0]?.correctAnswer).toBe('dog');

    fireEvent.click(screen.getByLabelText('Remove accepted answer dog'));

    expect(latestBlock.questions[0]?.acceptedAnswers).toEqual(['cat']);
    expect(latestBlock.questions[0]?.correctAnswer).toBe('cat');

    const inputAgain = screen.getByPlaceholderText('Enter the accepted answer...');
    fireEvent.change(inputAgain, { target: { value: 'crowd noise' } });
    fireEvent.keyDown(inputAgain, { key: 'Enter' });

    expect(latestBlock.questions[0]?.answerRule).toBe('TWO_WORDS');
  });

  it('syncs sentence blank primary correctAnswer from acceptedAnswers chips', () => {
    const initialBlock: SentenceCompletionBlockType = {
      id: 'sentence-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence',
      questions: [
        {
          id: 'q-1',
          sentence: 'Bring your ____.',
          blanks: [{ id: 'blank-1', correctAnswer: '', acceptedAnswers: [], position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <SentenceCompletionBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText('Answer...');
    fireEvent.change(input, { target: { value: 'ticket' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(latestBlock.questions[0]?.blanks[0]?.acceptedAnswers).toEqual(['ticket']);
    expect(latestBlock.questions[0]?.blanks[0]?.correctAnswer).toBe('ticket');

    const inputAgain = screen.getByPlaceholderText('Answer...');
    fireEvent.change(inputAgain, { target: { value: 'crowd noise' } });
    fireEvent.keyDown(inputAgain, { key: 'Enter' });

    expect(latestBlock.questions[0]?.answerRule).toBe('TWO_WORDS');
  });

  it('follows category renames in items but ignores pure reorders', () => {
    const initialBlock: ClassificationBlockType = {
      id: 'class-1',
      type: 'CLASSIFICATION',
      instruction: 'Classify.',
      categories: ['A', 'B'],
      items: [{ id: 'i1', text: 'Item', correctCategory: 'A', acceptedAnswers: ['A'] }],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <ClassificationBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    fireEvent.change(screen.getAllByPlaceholderText(/Category \d/)[0]!, { target: { value: 'Alpha' } });

    expect(latestBlock.categories).toEqual(['Alpha', 'B']);
    expect(latestBlock.items[0]?.correctCategory).toBe('Alpha');
    expect(latestBlock.items[0]?.acceptedAnswers).toEqual(['Alpha']);

    // Pure reorder keeps every value present: item keys must not move.
    fireEvent.change(screen.getAllByPlaceholderText(/Category \d/)[0]!, { target: { value: 'B' } });
    fireEvent.change(screen.getAllByPlaceholderText(/Category \d/)[1]!, { target: { value: 'Alpha' } });

    expect(latestBlock.categories).toEqual(['B', 'Alpha']);
    expect(latestBlock.items[0]?.correctCategory).toBe('Alpha');
  });

  it('follows option renames in feature accepted answers', () => {
    const initialBlock: MatchingFeaturesBlockType = {
      id: 'feat-1',
      type: 'MATCHING_FEATURES',
      instruction: 'Match.',
      options: ['X', 'Y'],
      features: [{ id: 'f1', text: 'Feat', correctMatch: 'X', acceptedAnswers: ['X'] }],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <MatchingFeaturesBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const optionInputs = screen.getAllByPlaceholderText(/Option \d/);
    fireEvent.change(optionInputs[0]!, { target: { value: 'Zed' } });

    expect(latestBlock.features[0]?.correctMatch).toBe('Zed');
    expect(latestBlock.features[0]?.acceptedAnswers).toEqual(['Zed']);
  });

  it('toggles case sensitivity on a note blank', () => {
    const initialBlock: NoteCompletionBlockType = {
      id: 'note-1',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'nq',
          noteText: 'A ____.',
          blanks: [{ id: 'b1', correctAnswer: 'Urwin', acceptedAnswers: ['Urwin'], position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <NoteCompletionBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const toggle = screen.getByLabelText('Require exact capitalization');
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(latestBlock.questions[0]?.blanks[0]?.caseSensitive).toBe(false);
    fireEvent.click(screen.getByLabelText('Require exact capitalization'));

    expect(latestBlock.questions[0]?.blanks[0]?.caseSensitive).toBeUndefined();
  });

  it('keeps the MAP hotspot primary correctAnswer intact when other accepted answers are edited', () => {
    const initialBlock: MapBlockType = {
      id: 'map-1',
      type: 'MAP',
      instruction: 'Label the map.',
      assetUrl: '',
      questions: [
        { id: 'h1', label: 'Location A', correctAnswer: 'bank', acceptedAnswers: ['banknote'], x: 10, y: 10 },
      ],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <MapLabelingBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText('Other accepted answers...');
    fireEvent.change(input, { target: { value: 'bank branch' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(latestBlock.questions[0]?.acceptedAnswers).toEqual(['banknote', 'bank branch']);
    expect(latestBlock.questions[0]?.correctAnswer).toBe('bank');

    // Editing the alternative list down to its last entry must not rewrite
    // the authoritative primary key (the accepted-answers editor keeps one).
    fireEvent.click(screen.getByLabelText('Remove accepted answer banknote'));

    expect(latestBlock.questions[0]?.acceptedAnswers).toEqual(['bank branch']);
    expect(latestBlock.questions[0]?.correctAnswer).toBe('bank');
  });

  it('keeps the diagram label primary correctAnswer intact when other accepted answers are edited', () => {
    const initialBlock: DiagramLabelingBlockType = {
      id: 'diagram-1',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label the diagram.',
      imageUrl: '',
      labels: [
        { id: 'l1', x: 0, y: 0, prompt: 'Label 1', correctAnswer: 'valve', acceptedAnswers: ['tap'] },
      ],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <DiagramLabelingBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText('Other accepted answers...');
    fireEvent.change(input, { target: { value: 'faucet' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(latestBlock.labels[0]?.acceptedAnswers).toEqual(['tap', 'faucet']);
    expect(latestBlock.labels[0]?.correctAnswer).toBe('valve');

    fireEvent.click(screen.getByLabelText('Remove accepted answer tap'));

    expect(latestBlock.labels[0]?.acceptedAnswers).toEqual(['faucet']);
    expect(latestBlock.labels[0]?.correctAnswer).toBe('valve');
  });

  it('keeps the flow step primary correctAnswer intact when other accepted answers are edited', () => {
    const initialBlock: FlowChartBlockType = {
      id: 'flow-1',
      type: 'FLOW_CHART',
      instruction: 'Complete the flow chart.',
      steps: [{ id: 's1', label: 'Step 1', correctAnswer: 'heat', acceptedAnswers: ['boil'] }],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <FlowChartBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText('Other accepted answers...');
    fireEvent.change(input, { target: { value: 'warm' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(latestBlock.steps[0]?.acceptedAnswers).toEqual(['boil', 'warm']);
    expect(latestBlock.steps[0]?.correctAnswer).toBe('heat');

    fireEvent.click(screen.getByLabelText('Remove accepted answer boil'));

    expect(latestBlock.steps[0]?.acceptedAnswers).toEqual(['warm']);
    expect(latestBlock.steps[0]?.correctAnswer).toBe('heat');
  });
});
