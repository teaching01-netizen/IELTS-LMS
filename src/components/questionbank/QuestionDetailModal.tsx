import React from 'react';
import { X, Plus } from 'lucide-react';
import { QuestionBankItem } from '../../types';
import { Button } from '../ui/Button';
import { resolveAcceptedAnswers } from '../../utils/acceptedAnswers';

interface QuestionDetailModalProps {
  item: QuestionBankItem;
  onAddToExam: (item: QuestionBankItem) => void;
  onClose: () => void;
}

export function QuestionDetailModal({ item, onAddToExam, onClose }: QuestionDetailModalProps) {
  const handleAddToExam = () => {
    onAddToExam(item);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Question Details</h2>
            <p className="text-sm text-gray-600 mt-1">{item.block.type}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={20} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Metadata */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Difficulty</p>
                <p className={`text-sm font-semibold mt-1 ${
                  item.metadata.difficulty === 'easy' ? 'text-green-700' :
                  item.metadata.difficulty === 'medium' ? 'text-yellow-700' :
                  'text-red-700'
                }`}>
                  {item.metadata.difficulty}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Topic</p>
                <p className="text-sm font-semibold mt-1">{item.metadata.topic}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Usage Count</p>
                <p className="text-sm font-semibold mt-1">{item.metadata.usageCount}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Author</p>
                <p className="text-sm font-semibold mt-1">{item.metadata.author}</p>
              </div>
            </div>

            {item.metadata.tags.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {item.metadata.tags.map(tag => (
                    <span key={tag} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Question Content */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Instruction</h3>
              <p className="text-gray-900 bg-gray-50 p-3 rounded">{item.block.instruction}</p>
            </div>

            {/* Type-specific content preview */}
            {renderBlockPreview(item)}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-between bg-gray-50">
          <p className="text-sm text-gray-600">
            Created: {new Date(item.metadata.createdAt).toLocaleDateString()}
            {item.metadata.lastUsedAt && ` • Last used: ${new Date(item.metadata.lastUsedAt).toLocaleDateString()}`}
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleAddToExam}>
              <Plus size={16} className="mr-2" />
              Add to Exam
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderBlockPreview(item: QuestionBankItem) {
  const block = item.block;

  switch (block.type) {
    case 'TFNG':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Questions ({block.questions.length})</h3>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q, i) => (
              <div key={q.id} className="bg-gray-50 p-3 rounded">
                <p className="text-sm text-gray-900">{i + 1}. {q.statement}</p>
                <p className="text-xs text-gray-500 mt-1">Answer: {q.correctAnswer}</p>
              </div>
            ))}
            {block.questions.length > 3 && (
              <p className="text-xs text-gray-500">+{block.questions.length - 3} more questions</p>
            )}
          </div>
        </div>
      );

    case 'CLOZE':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Questions ({block.questions.length})</h3>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q, i) => (
              <div key={q.id} className="bg-gray-50 p-3 rounded">
                <p className="text-sm text-gray-900">{i + 1}. {q.prompt}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Answers: {resolveAcceptedAnswers(q).join(' | ')} ({block.answerRule})
                </p>
              </div>
            ))}
            {block.questions.length > 3 && (
              <p className="text-xs text-gray-500">+{block.questions.length - 3} more questions</p>
            )}
          </div>
        </div>
      );

    case 'MATCHING':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Headings ({block.headings.length})</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {block.headings.map((h, i) => (
              <span key={h.id} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                {['i', 'ii', 'iii', 'iv', 'v'][i]}. {h.text}
              </span>
            ))}
          </div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Paragraphs ({block.questions.length})</h3>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q, i) => (
              <div key={q.id} className="bg-gray-50 p-3 rounded">
                <p className="text-sm text-gray-900">{i + 1}. Paragraph {q.paragraphLabel}</p>
                <p className="text-xs text-gray-500 mt-1">Answer: {q.correctHeading}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'MAP':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Map Labels ({block.questions.length})</h3>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q, i) => (
              <div key={q.id} className="bg-gray-50 p-3 rounded">
                <p className="text-sm text-gray-900">{i + 1}. {q.label}</p>
                <p className="text-xs text-gray-500 mt-1">Answer: {q.correctAnswer} (Position: {q.x}%, {q.y}%)</p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'MULTI_MCQ':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Question Stem</h3>
          <p className="text-gray-900 bg-gray-50 p-3 rounded mb-3">{block.stem}</p>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Options ({block.options.length}) - Select {block.requiredSelections}</h3>
          <div className="space-y-2">
            {block.options.map((opt, i) => (
              <div key={opt.id} className={`bg-gray-50 p-3 rounded flex items-center gap-2 ${opt.isCorrect ? 'border-2 border-green-500' : ''}`}>
                <span className="font-bold text-gray-700">{String.fromCharCode(65 + i)}.</span>
                <span className="text-sm text-gray-900">{opt.text}</span>
                {opt.isCorrect && <span className="text-xs text-green-700 ml-auto">✓ Correct</span>}
              </div>
            ))}
          </div>
        </div>
      );

    case 'SINGLE_MCQ':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Question Stem</h3>
          <p className="text-gray-900 bg-gray-50 p-3 rounded mb-3">{block.stem}</p>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Options ({block.options.length})</h3>
          <div className="space-y-2">
            {block.options.map((opt, i) => (
              <div key={opt.id} className={`bg-gray-50 p-3 rounded flex items-center gap-2 ${opt.isCorrect ? 'border-2 border-green-500' : ''}`}>
                <span className="font-bold text-gray-700">{String.fromCharCode(65 + i)}.</span>
                <span className="text-sm text-gray-900">{opt.text}</span>
                {opt.isCorrect && <span className="text-xs text-green-700 ml-auto">✓ Correct</span>}
              </div>
            ))}
          </div>
        </div>
      );

    case 'SHORT_ANSWER':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Questions ({block.questions.length})</h3>
          <div className="space-y-2">
            {block.questions.slice(0, 3).map((q, i) => (
              <div key={q.id} className="bg-gray-50 p-3 rounded">
                <p className="text-sm text-gray-900">{i + 1}. {q.prompt}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Answers: {resolveAcceptedAnswers(q).join(' | ')} ({q.answerRule})
                </p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'SENTENCE_COMPLETION':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Sentences ({block.questions.length})</h3>
          <div className="space-y-2">
            {block.questions.slice(0, 2).map((q, i) => (
              <div key={q.id} className="bg-gray-50 p-3 rounded">
                <p className="text-sm text-gray-900">{i + 1}. {q.sentence}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {q.blanks.map((blank, blankIndex) => `B${blankIndex + 1}: ${resolveAcceptedAnswers(blank).join(' | ')}`).join(' ; ')}
                </p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'NOTE_COMPLETION':
      return (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes ({block.questions.length})</h3>
          <div className="space-y-2">
            {block.questions.slice(0, 2).map((q, i) => (
              <div key={q.id} className="bg-gray-50 p-3 rounded">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-900">{i + 1}. {q.noteText}</pre>
                <p className="text-xs text-gray-500 mt-1">
                  {q.blanks.map((blank, blankIndex) => `B${blankIndex + 1}: ${resolveAcceptedAnswers(blank).join(' | ')}`).join(' ; ')}
                </p>
              </div>
            ))}
          </div>
        </div>
      );

    default:
      return (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded">
          <p className="text-sm text-amber-800">
            Preview for question type "{block.type}" is not yet implemented.
          </p>
        </div>
      );
  }
}
