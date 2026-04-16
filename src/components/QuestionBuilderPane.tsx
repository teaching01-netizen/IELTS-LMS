import React, { useEffect, useState } from 'react';
import { QuestionBlock, QuestionType, TFNGBlock as TFNGBlockType, ClozeBlock as ClozeBlockType, MatchingBlock as MatchingBlockType, MapBlock as MapBlockType, MultiMCQBlock as MultiMCQBlockType, SingleMCQBlock as SingleMCQBlockType, ShortAnswerBlock as ShortAnswerBlockType, SentenceCompletionBlock as SentenceCompletionBlockType, DiagramLabelingBlock as DiagramLabelingBlockType, FlowChartBlock as FlowChartBlockType, TableCompletionBlock as TableCompletionBlockType, NoteCompletionBlock as NoteCompletionBlockType, ClassificationBlock as ClassificationBlockType, MatchingFeaturesBlock as MatchingFeaturesBlockType, QuestionBankItem } from '../types';
import { Plus, X, Search, Library } from 'lucide-react';
import { TFNGBlock } from './blocks/TFNGBlock';
import { ClozeBlock } from './blocks/ClozeBlock';
import { MatchingBlock } from './blocks/MatchingBlock';
import { MapLabelingBlock } from './blocks/MapLabelingBlock';
import { MultiSelectMCQBlock } from './blocks/MultiSelectMCQBlock';
import { SingleMCQBlock } from './blocks/SingleMCQBlock';
import { ShortAnswerBlock } from './blocks/ShortAnswerBlock';
import { SentenceCompletionBlock } from './blocks/SentenceCompletionBlock';
import { DiagramLabelingBlock } from './blocks/DiagramLabelingBlock';
import { FlowChartBlock } from './blocks/FlowChartBlock';
import { TableCompletionBlock } from './blocks/TableCompletionBlock';
import { NoteCompletionBlock } from './blocks/NoteCompletionBlock';
import { ClassificationBlock } from './blocks/ClassificationBlock';
import { MatchingFeaturesBlock } from './blocks/MatchingFeaturesBlock';
import { getBlockQuestionCount } from '../utils/examUtils';
import { QuestionBankLibrary } from './builder/QuestionBankLibrary';
import { QuestionDetailModal } from './builder/QuestionDetailModal';
import { questionBankService } from '../services/questionBankService';

interface BlockWithNumbers {
  block: QuestionBlock;
  startNum: number;
  endNum: number;
}

export function QuestionBuilderPane({
  blocks,
  title,
  updateBlocks,
  startNumber = 1,
  errors = []
}: {
  blocks: QuestionBlock[];
  title: string;
  updateBlocks: (blocks: QuestionBlock[]) => void;
  startNumber?: number;
  errors?: Array<{ blockId: string; errors: Array<{ field: string; message: string }> }>;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showQuestionBank, setShowQuestionBank] = useState(false);
  const [selectedQuestionItem, setSelectedQuestionItem] = useState<QuestionBankItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  useEffect(() => {
    const openModal = () => setShowAddModal(true);
    window.addEventListener('builder:add-question-block', openModal);
    return () => window.removeEventListener('builder:add-question-block', openModal);
  }, []);
  
  const getBlockErrors = (blockId: string) => {
    const blockError = errors.find(e => e.blockId === blockId);
    return blockError?.errors || [];
  };

  const blocksWithNumbers: BlockWithNumbers[] = [];
  let currentNumber = startNumber;
  for (const block of blocks) {
    const count = getBlockQuestionCount(block);
    blocksWithNumbers.push({
      block,
      startNum: currentNumber,
      endNum: currentNumber + Math.max(0, count - 1)
    });
    currentNumber += count;
  }

  const updateBlock = (updatedBlock: QuestionBlock) => {
    const newBlocks = blocks.map(b => b.id === updatedBlock.id ? updatedBlock : b);
    updateBlocks(newBlocks);
  };

  const deleteBlock = (blockId: string) => {
    const newBlocks = blocks.filter(b => b.id !== blockId);
    updateBlocks(newBlocks);
  };

  const moveBlock = (blockId: string, direction: 'up' | 'down') => {
    const index = blocks.findIndex(b => b.id === blockId);
    if (index < 0) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === blocks.length - 1) return;

    const newBlocks = [...blocks];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    const currentBlock = newBlocks[index];
    const swapBlock = newBlocks[swapIndex];
    if (!currentBlock || !swapBlock) {
      return;
    }
    newBlocks[index] = swapBlock;
    newBlocks[swapIndex] = currentBlock;
    updateBlocks(newBlocks);
  };

  const handleSelectQuestion = (item: QuestionBankItem) => {
    setSelectedQuestionItem(item);
  };

  const handleAddQuestionFromBank = (item: QuestionBankItem) => {
    const newBlock = {
      ...item.block,
      id: `b${Date.now()}`
    };
    updateBlocks([...blocks, newBlock]);
    questionBankService.incrementUsageCount(item.id);
    setSelectedQuestionItem(null);
    setShowQuestionBank(false);
  };

  const handleAddQuestionFromDetail = (item: QuestionBankItem) => {
    const newBlock = {
      ...item.block,
      id: `b${Date.now()}`
    };
    updateBlocks([...blocks, newBlock]);
    questionBankService.incrementUsageCount(item.id);
    setSelectedQuestionItem(null);
  };

  const handleAddToBank = () => {
    if (!selectedBlockId) {
      alert('Please select a question block first by clicking on it.');
      return;
    }

    const block = blocks.find(b => b.id === selectedBlockId);
    if (!block) return;

    const metadata = {
      difficulty: 'medium' as const,
      topic: 'General',
      tags: [],
      author: 'Unknown'
    };

    questionBankService.addQuestion(block, metadata);
    alert('Question added to bank successfully!');
  };

  const handleAddQuestionToBlock = (blockId: string) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;

    let newBlock;
    switch (block.type) {
      case 'TFNG':
        newBlock = {
          ...block,
          questions: [...(block as TFNGBlockType).questions, { id: `q${Date.now()}`, statement: '', correctAnswer: 'T' as const }]
        };
        break;
      case 'CLOZE':
        newBlock = {
          ...block,
          questions: [...(block as ClozeBlockType).questions, { id: `q${Date.now()}`, prompt: 'The ____ is important.', correctAnswer: '' }]
        };
        break;
      case 'MATCHING':
        newBlock = {
          ...block,
          headings: [...(block as MatchingBlockType).headings, { id: `h${Date.now()}`, text: 'New Heading' }]
        };
        break;
      case 'MULTI_MCQ':
        newBlock = {
          ...block,
          options: [...(block as MultiMCQBlockType).options, { id: `o${Date.now()}`, text: 'New Option', isCorrect: false }]
        };
        break;
      case 'SINGLE_MCQ':
        newBlock = {
          ...block,
          options: [...(block as SingleMCQBlockType).options, { id: `o${Date.now()}`, text: 'New Option', isCorrect: false }]
        };
        break;
      case 'SHORT_ANSWER':
        newBlock = {
          ...block,
          questions: [...(block as ShortAnswerBlockType).questions, { id: `q${Date.now()}`, prompt: '', correctAnswer: '', answerRule: 'ONE_WORD' as const }]
        };
        break;
      case 'SENTENCE_COMPLETION':
        newBlock = {
          ...block,
          questions: [...(block as SentenceCompletionBlockType).questions, { id: `q${Date.now()}`, sentence: '', blanks: [], answerRule: 'ONE_WORD' as const }]
        };
        break;
      default:
        return;
    }

    updateBlock(newBlock);
  };

  const addBlock = (type: QuestionType) => {
    let newBlock: QuestionBlock;

    switch (type) {
      case 'TFNG':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'TFNG',
          mode: 'TFNG',
          instruction: 'Do the following statements agree with the information given?',
          questions: [{ id: `q${Date.now()}`, statement: '', correctAnswer: 'T' }]
        } as TFNGBlockType;
        break;
      case 'CLOZE':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'CLOZE',
          answerRule: 'TWO_WORDS',
          instruction: 'Complete the summary below. Choose NO MORE THAN TWO WORDS from the passage for each answer.',
          questions: [{ id: `q${Date.now()}`, prompt: 'The ____ is important.', correctAnswer: '' }]
        } as ClozeBlockType;
        break;
      case 'MATCHING':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'MATCHING',
          instruction: 'Choose the correct heading for each paragraph from the list of headings below.',
          headings: [{ id: `h${Date.now()}`, text: 'Heading 1' }],
          questions: [{ id: `q${Date.now()}`, paragraphLabel: 'A', correctHeading: '' }]
        } as MatchingBlockType;
        break;
      case 'MULTI_MCQ':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'MULTI_MCQ',
          instruction: 'Choose TWO letters, A-E.',
          stem: '',
          requiredSelections: 2,
          options: [
            { id: `o${Date.now()}`, text: 'Option A', isCorrect: true },
            { id: `o${Date.now() + 1}`, text: 'Option B', isCorrect: true },
            { id: `o${Date.now() + 2}`, text: 'Option C', isCorrect: false }
          ]
        } as MultiMCQBlockType;
        break;
      case 'MAP':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'MAP',
          instruction: 'Label the map below.',
          assetUrl: '',
          questions: [{ id: `q${Date.now()}`, label: 'Location A', correctAnswer: '', x: 50, y: 50 }]
        } as MapBlockType;
        break;
      case 'SINGLE_MCQ':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'SINGLE_MCQ',
          instruction: 'Choose the correct answer.',
          stem: '',
          options: [
            { id: `o${Date.now()}`, text: 'Option A', isCorrect: true },
            { id: `o${Date.now() + 1}`, text: 'Option B', isCorrect: false },
            { id: `o${Date.now() + 2}`, text: 'Option C', isCorrect: false }
          ]
        } as SingleMCQBlockType;
        break;
      case 'SHORT_ANSWER':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'SHORT_ANSWER',
          instruction: 'Answer the questions below using words from the passage.',
          questions: [{ id: `q${Date.now()}`, prompt: 'What is described?', correctAnswer: '', answerRule: 'TWO_WORDS' }]
        } as ShortAnswerBlockType;
        break;
      case 'SENTENCE_COMPLETION':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'SENTENCE_COMPLETION',
          instruction: 'Complete the sentences below using words from the passage.',
          questions: [{ id: `q${Date.now()}`, sentence: 'The ____ is ____.', blanks: [{ id: `b${Date.now()}`, correctAnswer: '', position: 0 }], answerRule: 'TWO_WORDS' }]
        } as SentenceCompletionBlockType;
        break;
      case 'DIAGRAM_LABELING':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'DIAGRAM_LABELING',
          instruction: 'Label the diagram below.',
          imageUrl: '',
          labels: [{ id: `l${Date.now()}`, x: 50, y: 50, correctAnswer: '' }]
        } as DiagramLabelingBlockType;
        break;
      case 'FLOW_CHART':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'FLOW_CHART',
          instruction: 'Complete the flow chart below.',
          steps: [{ id: `s${Date.now()}`, label: 'Step 1', correctAnswer: '' }]
        } as FlowChartBlockType;
        break;
      case 'TABLE_COMPLETION':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'TABLE_COMPLETION',
          instruction: 'Complete the table below.',
          answerRule: 'TWO_WORDS',
          headers: ['Column 1', 'Column 2'],
          rows: [['', '']],
          cells: [{ id: `c${Date.now()}`, correctAnswer: '', row: 0, col: 0 }]
        } as TableCompletionBlockType;
        break;
      case 'NOTE_COMPLETION':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'NOTE_COMPLETION',
          instruction: 'Complete the notes below.',
          questions: [{ id: `q${Date.now()}`, noteText: 'The ____ is ____.', blanks: [{ id: `b${Date.now()}`, correctAnswer: '', position: 0 }], answerRule: 'TWO_WORDS' }]
        } as NoteCompletionBlockType;
        break;
      case 'CLASSIFICATION':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'CLASSIFICATION',
          instruction: 'Classify the following statements.',
          categories: ['Category A', 'Category B'],
          items: [{ id: `i${Date.now()}`, text: 'Statement 1', correctCategory: 'Category A' }]
        } as ClassificationBlockType;
        break;
      case 'MATCHING_FEATURES':
        newBlock = {
          id: `b${Date.now()}`,
          type: 'MATCHING_FEATURES',
          instruction: 'Match the features with the options.',
          features: [{ id: `f${Date.now()}`, text: 'Feature 1', correctMatch: 'Option A' }],
          options: ['Option A', 'Option B', 'Option C']
        } as MatchingFeaturesBlockType;
        break;
      default:
        return;
    }

    updateBlocks([...blocks, newBlock]);
    setShowAddModal(false);
  };

  const blockTypes: { type: QuestionType; label: string; description: string }[] = [
    { type: 'CLOZE', label: 'Cloze Summary', description: 'Fill in the blanks from passage text' },
    { type: 'TFNG', label: 'T/F/NG or Y/N/NG', description: 'True/False/Not Given questions' },
    { type: 'MATCHING', label: 'Matching Headings', description: 'Match paragraphs to headings' },
    { type: 'MAP', label: 'Map / Diagram', description: 'Label locations on a map or diagram' },
    { type: 'MULTI_MCQ', label: 'Multiple Choice', description: 'Select multiple correct answers' },
    { type: 'SINGLE_MCQ', label: 'Single Choice MCQ', description: 'Select one correct answer' },
    { type: 'SHORT_ANSWER', label: 'Short Answer', description: 'Answer with limited word count' },
    { type: 'SENTENCE_COMPLETION', label: 'Sentence Completion', description: 'Complete sentences with blanks' },
    { type: 'DIAGRAM_LABELING', label: 'Diagram Labeling', description: 'Label parts of a diagram' },
    { type: 'FLOW_CHART', label: 'Flow Chart', description: 'Complete flow chart steps' },
    { type: 'TABLE_COMPLETION', label: 'Table Completion', description: 'Complete table cells' },
    { type: 'NOTE_COMPLETION', label: 'Note Completion', description: 'Complete notes with blanks' },
    { type: 'CLASSIFICATION', label: 'Classification', description: 'Classify statements into categories' },
    { type: 'MATCHING_FEATURES', label: 'Matching Features', description: 'Match features to options' },
  ];

  const filteredTypes = blockTypes.filter(t => 
    t.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderBlock = (item: BlockWithNumbers) => {
    const { block, startNum, endNum } = item;
    const blockErrors = getBlockErrors(block.id);
    const isSelected = selectedBlockId === block.id;

    let blockContent;
    switch (block.type) {
      case 'TFNG':
        blockContent = (
          <TFNGBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'CLOZE':
        blockContent = (
          <ClozeBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'MATCHING':
        blockContent = (
          <MatchingBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'MAP':
        blockContent = (
          <MapLabelingBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'MULTI_MCQ':
        blockContent = (
          <MultiSelectMCQBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'SINGLE_MCQ':
        blockContent = (
          <SingleMCQBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'SHORT_ANSWER':
        blockContent = (
          <ShortAnswerBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'SENTENCE_COMPLETION':
        blockContent = (
          <SentenceCompletionBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'DIAGRAM_LABELING':
        blockContent = (
          <DiagramLabelingBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'FLOW_CHART':
        blockContent = (
          <FlowChartBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'TABLE_COMPLETION':
        blockContent = (
          <TableCompletionBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'NOTE_COMPLETION':
        blockContent = (
          <NoteCompletionBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'CLASSIFICATION':
        blockContent = (
          <ClassificationBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      case 'MATCHING_FEATURES':
        blockContent = (
          <MatchingFeaturesBlock
            key={block.id}
            block={block}
            startNum={startNum}
            endNum={endNum}
            updateBlock={updateBlock}
            deleteBlock={deleteBlock}
            moveBlock={moveBlock}
            errors={blockErrors}
          />
        );
        break;
      default:
        blockContent = null;
    }

    return (
      <div
        onClick={() => setSelectedBlockId(block.id)}
        className={`cursor-pointer transition-all ${isSelected ? 'ring-2 ring-green-500 ring-offset-2' : 'hover:ring-2 hover:ring-gray-300 hover:ring-offset-1'}`}
      >
        {blockContent}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAddQuestionToBlock(block.id);
          }}
          className="mt-3 w-full bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-sm text-xs font-medium flex items-center justify-center gap-1 transition-colors"
        >
          <Plus size={12} /> Add Question
        </button>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden relative h-full min-h-0">
      <div className="border-b border-gray-100 bg-white flex-shrink-0">
        <div className="px-4 py-2">
          <h2 className="font-semibold text-gray-900 text-sm">Questions for {title}</h2>
        </div>
        <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-800 text-white hover:bg-blue-700 px-3 py-1.5 rounded-sm text-xs font-medium flex items-center gap-1 transition-colors shadow-sm"
          >
            <Plus size={14} /> Add Question Block
          </button>
          <button
            onClick={() => setShowQuestionBank(true)}
            className="bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1.5 rounded-sm text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <Library size={14} /> Add from Bank
          </button>
          <button
            onClick={handleAddToBank}
            className="bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1.5 rounded-sm text-xs font-medium flex items-center gap-1 transition-colors"
            title="Save selected question block to bank"
          >
            <Library size={14} /> Save to Bank
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {blocksWithNumbers.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white border border-gray-100 rounded-sm shadow-sm p-8">
            <p className="font-medium text-gray-900 mb-2 text-base">No questions added yet.</p>
            <p className="text-sm text-gray-600 mb-4">Start by adding a question block to this passage.</p>
            <button 
              onClick={() => setShowAddModal(true)} 
              className="text-blue-800 font-semibold hover:underline text-sm flex items-center gap-1 justify-center mx-auto"
            >
              <Plus size={14} /> Add your first question block
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {blocksWithNumbers.map(item => renderBlock(item))}
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px] flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-sm shadow-[0_8px_16px_-4px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)] w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4">
              <h3 className="font-semibold text-gray-900 text-lg">Add question block</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-500 hover:text-gray-700 transition-colors p-1 hover:bg-gray-100 rounded-sm"
                aria-label="Close add question block dialog"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 pb-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Search question types..."
                  className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:bg-white transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search question types"
                />
              </div>
            </div>
            <div className="px-6 py-4 overflow-y-auto border-t border-gray-100 bg-gray-50/50">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">All types</p>
              <div className="grid grid-cols-1 gap-2">
                {filteredTypes.map(t => (
                  <button
                    key={t.type}
                    onClick={() => addBlock(t.type)}
                    className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-sm hover:border-blue-700 hover:bg-blue-50/50 transition-all text-sm font-medium text-gray-800 shadow-sm"
                  >
                    <div className="w-8 h-8 bg-blue-100 text-blue-800 rounded-sm flex items-center justify-center flex-shrink-0">
                      <Plus size={16} />
                    </div>
                    <div className="text-left">
                      <div>{t.label}</div>
                      <div className="text-xs text-gray-500 font-normal">{t.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 bg-white">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuestionBank && (
        <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px] flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl h-[80vh] flex flex-col">
            <QuestionBankLibrary
              onSelectQuestion={handleSelectQuestion}
              onClose={() => setShowQuestionBank(false)}
            />
          </div>
        </div>
      )}

      {selectedQuestionItem && (
        <QuestionDetailModal
          item={selectedQuestionItem}
          isOpen={!!selectedQuestionItem}
          onAddToExam={handleAddQuestionFromDetail}
          onClose={() => setSelectedQuestionItem(null)}
        />
      )}
    </div>
  );
}
