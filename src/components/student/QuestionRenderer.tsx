import React from 'react';
import {
  QuestionBlock, TFNGBlock, ClozeBlock, MatchingBlock, MapBlock, MultiMCQBlock,
  SingleMCQBlock, ShortAnswerBlock, SentenceCompletionBlock, DiagramLabelingBlock,
  FlowChartBlock, TableCompletionBlock, NoteCompletionBlock, ClassificationBlock,
  MatchingFeaturesBlock, QuestionAnswer,
  TFNGQuestion, ClozeQuestion, MapQuestion, MatchingQuestion,
  ShortAnswerQuestion, SentenceCompletionQuestion, NoteCompletionQuestion
} from '../../types';

interface QuestionRendererProps {
  question: TFNGQuestion | ClozeQuestion | MapQuestion | MatchingQuestion | ShortAnswerQuestion | SentenceCompletionQuestion | NoteCompletionQuestion | null;
  block: QuestionBlock;
  number: number;
  answer: QuestionAnswer;
  onChange: (val: QuestionAnswer) => void;
  isFlagged?: boolean;
  isActive?: boolean;
}

export function QuestionRenderer({ question, block, number, answer, onChange, isFlagged, isActive = false }: QuestionRendererProps) {
  const renderTFNG = (tfngBlock: TFNGBlock, q: TFNGQuestion) => {
    const options = tfngBlock.mode === 'TFNG' 
      ? ['T', 'F', 'NG'] as const
      : ['Y', 'N', 'NG'] as const;
    const labels = tfngBlock.mode === 'TFNG'
      ? { 'T': 'TRUE', 'F': 'FALSE', 'NG': 'NOT GIVEN' }
      : { 'Y': 'YES', 'N': 'NO', 'NG': 'NOT GIVEN' };
    
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 items-start">
          <div className="min-w-[24px] h-[24px] border-2 border-blue-500 text-blue-600 flex items-center justify-center font-bold text-sm mt-0.5">
            {number}
          </div>
          <span className="text-gray-900 leading-relaxed">{q.statement}</span>
        </div>
        <div className="flex flex-col gap-3 ml-9">
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-3 cursor-pointer group">
              <input 
                type="radio" 
                name={`q-${q.id}`} 
                checked={answer === opt} 
                onChange={() => onChange(opt)} 
                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-900 uppercase">{labels[opt as keyof typeof labels]}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  const renderCloze = (clozeBlock: ClozeBlock, q: ClozeQuestion) => {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <span className="font-bold text-gray-900 min-w-[24px]">{number}.</span>
          <span className="text-gray-800">{q.prompt}</span>
        </div>
        <div className="ml-9 mt-2">
          <input
            type="text"
            value={answer || ''}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full max-w-md border-2 rounded-md px-4 py-2 text-base transition-colors focus:outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-100 ${answer ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}
            placeholder={`(${number})`}
            autoComplete="off"
            spellCheck="false"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>
    );
  };

  const renderMatching = (matchingBlock: MatchingBlock, q: MatchingQuestion) => {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <span className="font-bold text-gray-900 min-w-[24px]">{number}.</span>
          <span className="text-gray-800 font-medium">Paragraph {q.paragraphLabel}</span>
          
          <select
            value={answer || ''}
            onChange={(e) => onChange(e.target.value)}
            className={`flex-1 max-w-xs border-2 rounded-md px-3 py-2 text-base transition-colors focus:outline-none focus:border-blue-500 ${answer ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}
          >
            <option value="" disabled>Choose heading...</option>
            {matchingBlock.headings?.map((h, i) => {
              const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][i];
              return (
                <option key={h.id} value={roman}>{roman}. {h.text}</option>
              );
            })}
          </select>
        </div>
      </div>
    );
  };

  const renderMultiMCQ = (mcqBlock: MultiMCQBlock, blockNum: number) => {
    const selectedOptions = Array.isArray(answer) ? answer : [];
    
    const toggleOption = (optId: string) => {
      if (selectedOptions.includes(optId)) {
        onChange(selectedOptions.filter(id => id !== optId));
      } else {
        if (selectedOptions.length < mcqBlock.requiredSelections) {
          onChange([...selectedOptions, optId]);
        }
      }
    };

    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <span className="font-bold text-gray-900 min-w-[24px]">{blockNum}.</span>
          <span className="text-gray-800">{mcqBlock.stem || 'Select the correct options:'}</span>
        </div>
        <div className="ml-9 space-y-3">
          {mcqBlock.options?.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selectedOptions.includes(opt.id);
            const isDisabled = !isSelected && selectedOptions.length >= mcqBlock.requiredSelections;
            
            return (
              <label 
                key={opt.id} 
                className={`flex items-start gap-3 p-3 rounded-md border-2 transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : isDisabled ? 'border-gray-200 opacity-50 cursor-not-allowed' : 'border-gray-200 hover:border-blue-300 cursor-pointer'}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (!isDisabled || isSelected) {
                    toggleOption(opt.id);
                  }
                }}
              >
                <div className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-400'}`}>
                  {isSelected && <div className="w-3 h-3 bg-white" style={{ clipPath: 'polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%)' }}></div>}
                </div>
                <div className="flex gap-2">
                  <span className="font-bold text-gray-700">{letter}.</span>
                  <span className="text-gray-800">{opt.text}</span>
                </div>
              </label>
            );
          })}
        </div>
        <div className="ml-9 text-sm text-gray-500 font-medium">
          Selections: {selectedOptions.length}/{mcqBlock.requiredSelections} required
        </div>
      </div>
    );
  };

  const renderMap = (mapBlock: MapBlock, q: MapQuestion, num: number) => {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <span className="font-bold text-gray-900 min-w-[24px]">{num}.</span>
          <span className="text-gray-800">Label {q.label}</span>
        </div>
        <div className="ml-9 mt-2">
          <input
            type="text"
            value={answer || ''}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full max-w-md border-2 rounded-md px-4 py-2 text-base transition-colors focus:outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-100 ${answer ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}
            placeholder={`(${num})`}
            autoComplete="off"
            spellCheck="false"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>
    );
  };

  const renderSingleMCQ = (mcqBlock: SingleMCQBlock, blockNum: number) => {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <span className="font-bold text-gray-900 min-w-[24px]">{blockNum}.</span>
          <span className="text-gray-800">{mcqBlock.stem || 'Select the correct option:'}</span>
        </div>
        <div className="ml-9 space-y-3">
          {mcqBlock.options?.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            return (
              <label key={opt.id} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="radio"
                  name={`q-${mcqBlock.id}`}
                  checked={answer === opt.id}
                  onChange={() => onChange(opt.id)}
                  className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 mt-1"
                />
                <div className="flex gap-2">
                  <span className="font-bold text-gray-700">{letter}.</span>
                  <span className="text-gray-800">{opt.text}</span>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  const renderShortAnswer = (shortBlock: ShortAnswerBlock, q: ShortAnswerQuestion, num: number) => {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <span className="font-bold text-gray-900 min-w-[24px]">{num}.</span>
          <span className="text-gray-800">{q.prompt}</span>
        </div>
        <div className="ml-9 mt-2">
          <input
            type="text"
            value={answer || ''}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full max-w-md border-2 rounded-md px-4 py-2 text-base transition-colors focus:outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-100 ${answer ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}
            placeholder={`(${num}) - ${q.answerRule.replace('_', ' ')}`}
            autoComplete="off"
            spellCheck="false"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>
    );
  };

  const renderNotImplemented = (blockType: string, blockNum: number) => {
    return (
      <div className="flex flex-col gap-3 p-4 bg-amber-50 border border-amber-200 rounded-md">
        <div className="flex gap-3">
          <span className="font-bold text-gray-900 min-w-[24px]">{blockNum}.</span>
          <span className="text-amber-800 font-medium">Question type "{blockType}" not yet implemented in student view</span>
        </div>
      </div>
    );
  };

  return (
    <div className={`relative ${isActive ? 'animate-pulse-subtle' : ''}`}>
      {isFlagged && (
        <div className="absolute -left-2 -top-2 w-6 h-6 bg-amber-100 rounded-full flex items-center justify-center shadow-sm border border-amber-200">
          <span className="text-amber-500 text-xs">🚩</span>
        </div>
      )}

      {block.type === 'TFNG' && question && renderTFNG(block as TFNGBlock, question as TFNGQuestion)}
      {block.type === 'CLOZE' && question && renderCloze(block as ClozeBlock, question as ClozeQuestion)}
      {block.type === 'MATCHING' && question && renderMatching(block as MatchingBlock, question as MatchingQuestion)}
      {block.type === 'MULTI_MCQ' && renderMultiMCQ(block as MultiMCQBlock, number)}
      {block.type === 'MAP' && question && renderMap(block as MapBlock, question as MapQuestion, number)}
      {block.type === 'SINGLE_MCQ' && renderSingleMCQ(block as SingleMCQBlock, number)}
      {block.type === 'SHORT_ANSWER' && question && renderShortAnswer(block as ShortAnswerBlock, question as ShortAnswerQuestion, number)}
      {block.type === 'SENTENCE_COMPLETION' && renderNotImplemented('Sentence Completion', number)}
      {block.type === 'DIAGRAM_LABELING' && renderNotImplemented('Diagram Labeling', number)}
      {block.type === 'FLOW_CHART' && renderNotImplemented('Flow Chart', number)}
      {block.type === 'TABLE_COMPLETION' && renderNotImplemented('Table Completion', number)}
      {block.type === 'NOTE_COMPLETION' && renderNotImplemented('Note Completion', number)}
      {block.type === 'CLASSIFICATION' && renderNotImplemented('Classification', number)}
      {block.type === 'MATCHING_FEATURES' && renderNotImplemented('Matching Features', number)}
    </div>
  );
}