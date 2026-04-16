import React from 'react';
import {
  QuestionBankItem,
  QuestionType,
  QuestionBlock,
  TFNGQuestion,
  ClozeQuestion,
  MatchingQuestion,
  MapQuestion,
  ShortAnswerQuestion,
  SentenceCompletionQuestion,
  MCQOption,
  DiagramLabel,
  FlowChartStep,
  NoteCompletionQuestion,
  ClassificationItem,
  MatchingFeature
} from '../../types';
import { X, Clock, User, Tag, BookOpen, Plus } from 'lucide-react';

interface QuestionDetailModalProps {
  item: QuestionBankItem | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToExam: (item: QuestionBankItem) => void;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  TFNG: 'True/False/Not Given',
  CLOZE: 'Cloze Test',
  MATCHING: 'Matching Headings',
  MAP: 'Map Labeling',
  MULTI_MCQ: 'Multiple Choice (Select All)',
  SINGLE_MCQ: 'Multiple Choice (Single Answer)',
  SHORT_ANSWER: 'Short Answer',
  SENTENCE_COMPLETION: 'Sentence Completion',
  DIAGRAM_LABELING: 'Diagram Labeling',
  FLOW_CHART: 'Flow Chart Completion',
  TABLE_COMPLETION: 'Table Completion',
  NOTE_COMPLETION: 'Note Completion',
  CLASSIFICATION: 'Classification',
  MATCHING_FEATURES: 'Matching Features'
};

const DIFFICULTY_COLORS = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700'
};

export function QuestionDetailModal({ item, isOpen, onClose, onAddToExam }: QuestionDetailModalProps) {
  if (!isOpen || !item) return null;

  const handleAddToExam = () => {
    if (item) {
      onAddToExam(item);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 p-6 flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-semibold text-gray-900">Question Details</h3>
              <span className={`text-xs font-semibold px-2 py-1 rounded ${
                DIFFICULTY_COLORS[item.metadata.difficulty]
              }`}>
                {item.metadata.difficulty}
              </span>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                {QUESTION_TYPE_LABELS[item.block.type]}
              </span>
            </div>
            <p className="text-sm text-gray-500">ID: {item.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Metadata */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <BookOpen size={16} />
              Metadata
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Topic:</span>
                <span className="ml-2 text-gray-900 font-medium">{item.metadata.topic}</span>
              </div>
              <div>
                <span className="text-gray-500">Author:</span>
                <span className="ml-2 text-gray-900 font-medium">{item.metadata.author}</span>
              </div>
              <div>
                <span className="text-gray-500 flex items-center gap-1">
                  <Clock size={14} />
                  Usage Count:
                </span>
                <span className="ml-2 text-gray-900 font-medium">{item.metadata.usageCount}</span>
              </div>
              <div>
                <span className="text-gray-500">Created:</span>
                <span className="ml-2 text-gray-900 font-medium">
                  {new Date(item.metadata.createdAt).toLocaleDateString()}
                </span>
              </div>
              {item.metadata.lastUsedAt && (
                <div className="col-span-2">
                  <span className="text-gray-500">Last Used:</span>
                  <span className="ml-2 text-gray-900 font-medium">
                    {new Date(item.metadata.lastUsedAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {/* Tags */}
            {item.metadata.tags.length > 0 && (
              <div className="mt-4">
                <span className="text-gray-500 text-sm flex items-center gap-1 mb-2">
                  <Tag size={14} />
                  Tags:
                </span>
                <div className="flex flex-wrap gap-2">
                  {item.metadata.tags.map((tag) => (
                    <span key={tag} className="text-xs bg-white border border-gray-300 text-gray-700 px-2 py-1 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Question Content */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Question Content</h4>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <QuestionContentRenderer block={item.block} />
            </div>
          </div>

          {/* Statistics */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Question Statistics</h4>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-white rounded p-3">
                <div className="text-2xl font-bold text-gray-900">{getQuestionCount(item.block)}</div>
                <div className="text-xs text-gray-500">Questions</div>
              </div>
              <div className="bg-white rounded p-3">
                <div className="text-2xl font-bold text-gray-900">{item.metadata.difficulty}</div>
                <div className="text-xs text-gray-500">Difficulty</div>
              </div>
              <div className="bg-white rounded p-3">
                <div className="text-2xl font-bold text-gray-900">{item.metadata.tags.length}</div>
                <div className="text-xs text-gray-500">Tags</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAddToExam}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus size={16} />
            Add to Exam
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionContentRenderer({ block }: { block: QuestionBlock }) {
  switch (block.type) {
    case 'TFNG':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q: TFNGQuestion, idx: number) => (
              <div key={q.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                {q.statement}
              </div>
            ))}
            {block.questions.length > 3 && (
              <p className="text-xs text-gray-500">+ {block.questions.length - 3} more questions</p>
            )}
          </div>
        </div>
      );

    case 'CLOZE':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q: ClozeQuestion, idx: number) => (
              <div key={q.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                {q.prompt}
              </div>
            ))}
            {block.questions.length > 3 && (
              <p className="text-xs text-gray-500">+ {block.questions.length - 3} more questions</p>
            )}
          </div>
        </div>
      );

    case 'MATCHING':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q: MatchingQuestion, idx: number) => (
              <div key={q.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                {q.paragraphLabel}
              </div>
            ))}
            {block.questions.length > 3 && (
              <p className="text-xs text-gray-500">+ {block.questions.length - 3} more questions</p>
            )}
          </div>
        </div>
      );

    case 'MAP':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="bg-gray-100 rounded p-4 text-center text-sm text-gray-500">
            Map image would be displayed here
          </div>
          <div className="space-y-2 mt-2">
            {block.questions.slice(0, 3).map((q: MapQuestion, idx: number) => (
              <div key={q.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                {q.label}
              </div>
            ))}
          </div>
        </div>
      );

    case 'MULTI_MCQ':
    case 'SINGLE_MCQ':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <p className="text-sm font-medium text-gray-900 mb-3">{block.stem}</p>
          <div className="space-y-2">
            {block.options.map((opt: MCQOption, idx: number) => (
              <div key={opt.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{String.fromCharCode(65 + idx)}.</span>
                <span>{opt.text}</span>
                {opt.isCorrect && <span className="ml-auto text-green-600 text-xs">✓ Correct</span>}
              </div>
            ))}
          </div>
        </div>
      );

    case 'SHORT_ANSWER':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q: ShortAnswerQuestion, idx: number) => (
              <div key={q.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                {q.prompt}
                <div className="text-xs text-gray-500 mt-1">Answer: {q.correctAnswer}</div>
              </div>
            ))}
            {block.questions.length > 3 && (
              <p className="text-xs text-gray-500">+ {block.questions.length - 3} more questions</p>
            )}
          </div>
        </div>
      );

    case 'SENTENCE_COMPLETION':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q: SentenceCompletionQuestion, idx: number) => (
              <div key={q.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                {q.sentence}
                <div className="text-xs text-gray-500 mt-1">
                  Blanks: {q.blanks.length} | Answer rule: {q.answerRule}
                </div>
              </div>
            ))}
            {block.questions.length > 3 && (
              <p className="text-xs text-gray-500">+ {block.questions.length - 3} more sentences</p>
            )}
          </div>
        </div>
      );

    case 'DIAGRAM_LABELING':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="bg-gray-100 rounded p-4 text-center text-sm text-gray-500">
            Diagram image would be displayed here
          </div>
          <div className="space-y-2 mt-2">
            {block.labels.slice(0, 5).map((label: DiagramLabel, idx: number) => (
              <div key={label.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">Label {idx + 1}:</span> {label.correctAnswer}
              </div>
            ))}
          </div>
        </div>
      );

    case 'FLOW_CHART':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="bg-gray-100 rounded p-4 text-center text-sm text-gray-500">
            Flow chart would be displayed here
          </div>
          <div className="space-y-2 mt-2">
            {block.steps.slice(0, 5).map((step: FlowChartStep, idx: number) => (
              <div key={step.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">Step {idx + 1}:</span> {step.label}
              </div>
            ))}
          </div>
        </div>
      );

    case 'TABLE_COMPLETION':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  {block.headers.map((header: string, idx: number) => (
                    <th key={idx} className="border border-gray-300 px-3 py-2 text-left">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.slice(0, 3).map((row: string[], rowIdx: number) => (
                  <tr key={rowIdx}>
                    {row.map((cell: string, cellIdx: number) => (
                      <td key={cellIdx} className="border border-gray-300 px-3 py-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );

    case 'NOTE_COMPLETION':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="space-y-2">
            {block.questions.slice(0, 2).map((q: NoteCompletionQuestion, idx: number) => (
              <div key={q.id} className="p-3 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                <pre className="whitespace-pre-wrap font-sans">{q.noteText}</pre>
                <div className="text-xs text-gray-500 mt-1">
                  Blanks: {q.blanks.length} | Answer rule: {q.answerRule}
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case 'CLASSIFICATION':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="mb-3">
            <span className="text-sm font-medium">Categories: </span>
            {block.categories.map((cat: string, idx: number) => (
              <span key={idx} className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded ml-1">
                {cat}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {block.items.slice(0, 5).map((item: ClassificationItem, idx: number) => (
              <div key={item.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                {item.text}
                <span className="ml-2 text-xs text-gray-500">→ {item.correctCategory}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'MATCHING_FEATURES':
      return (
        <div>
          <p className="text-sm text-gray-700 mb-2">{block.instruction}</p>
          <div className="space-y-2">
            {block.features.slice(0, 5).map((feature: MatchingFeature, idx: number) => (
              <div key={feature.id} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{idx + 1}. </span>
                {feature.text}
                <span className="ml-2 text-xs text-gray-500">→ {feature.correctMatch}</span>
              </div>
            ))}
          </div>
        </div>
      );

    default:
      return <p className="text-sm text-gray-500">Unknown question type</p>;
  }
}

function getQuestionCount(block: QuestionBlock): number {
  switch (block.type) {
    case 'TFNG':
    case 'CLOZE':
    case 'MATCHING':
    case 'MAP':
    case 'SHORT_ANSWER':
    case 'SENTENCE_COMPLETION':
    case 'NOTE_COMPLETION':
      return block.questions?.length || 0;
    case 'MULTI_MCQ':
    case 'SINGLE_MCQ':
      return 1;
    case 'DIAGRAM_LABELING':
      return block.labels?.length || 0;
    case 'FLOW_CHART':
      return block.steps?.length || 0;
    case 'TABLE_COMPLETION':
      return block.cells?.length || 0;
    case 'CLASSIFICATION':
      return block.items?.length || 0;
    case 'MATCHING_FEATURES':
      return block.features?.length || 0;
    default:
      return 0;
  }
}
