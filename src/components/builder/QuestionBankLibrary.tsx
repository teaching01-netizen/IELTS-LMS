import React, { useEffect, useMemo, useState } from 'react';
import { QuestionBankItem, QuestionBlock, QuestionType } from '../../types';
import { questionBankService } from '../../features/content-library/infrastructure/libraryGateway';
import { Search, Filter, Grid, List, BookOpen, Clock, TrendingUp, X } from 'lucide-react';
import { CollectionLoadingSkeleton } from '../ui/CollectionLoadingSkeleton';

interface QuestionBankLibraryProps {
  onSelectQuestion: (item: QuestionBankItem) => void;
  onClose: () => void;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  TFNG: 'True/False/NG',
  CLOZE: 'Cloze',
  MATCHING: 'Matching Headings',
  MAP: 'Map Labeling',
  MULTI_MCQ: 'Multi-Select MCQ',
  SINGLE_MCQ: 'Single-Choice MCQ',
  SHORT_ANSWER: 'Short Answer',
  SENTENCE_COMPLETION: 'Sentence Completion',
  DIAGRAM_LABELING: 'Diagram Labeling',
  FLOW_CHART: 'Flow Chart',
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

export function QuestionBankLibrary({ onSelectQuestion, onClose }: QuestionBankLibraryProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedType, setSelectedType] = useState<QuestionType | 'all'>('all');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [allQuestions, setAllQuestions] = useState<QuestionBankItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const items = await questionBankService.getAllQuestions();
        if (!cancelled) {
          setAllQuestions(items);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load questions.';
        if (!cancelled) {
          setLoadError(message);
          setAllQuestions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const topics = useMemo(() => {
    const unique = new Set<string>();
    allQuestions.forEach((item) => unique.add(item.metadata.topic));
    return Array.from(unique).sort();
  }, [allQuestions]);

  const filteredQuestions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return allQuestions.filter((item) => {
      if (selectedType !== 'all' && item.block.type !== selectedType) {
        return false;
      }

      if (selectedDifficulty !== 'all' && item.metadata.difficulty !== selectedDifficulty) {
        return false;
      }

      if (normalizedSearch.length > 0) {
        const blockJson = JSON.stringify(item.block).toLowerCase();
        const topicMatch = item.metadata.topic.toLowerCase().includes(normalizedSearch);
        const tagMatch = item.metadata.tags.some((t) => t.toLowerCase().includes(normalizedSearch));
        if (!blockJson.includes(normalizedSearch) && !topicMatch && !tagMatch) {
          return false;
        }
      }

      return true;
    });
  }, [allQuestions, selectedType, selectedDifficulty, searchTerm]);

  const handleAddToExam = (item: QuestionBankItem) => {
    onSelectQuestion(item);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 p-4 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <BookOpen size={20} />
            Question Bank
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded ${
                viewMode === 'grid' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
              }`}
              title="Grid view"
            >
              <Grid size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded ${
                viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
              }`}
              title="List view"
            >
              <List size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search questions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as QuestionType | 'all')}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            {Object.entries(QUESTION_TYPE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>{label}</option>
            ))}
          </select>
          <select
            value={selectedDifficulty}
            onChange={(e) => setSelectedDifficulty(e.target.value as 'easy' | 'medium' | 'hard' | 'all')}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <BookOpen size={14} />
            {allQuestions.length} total questions
          </span>
          <span className="flex items-center gap-1">
            <Filter size={14} />
            {filteredQuestions.length} filtered
          </span>
          <span className="flex items-center gap-1">
            <TrendingUp size={14} />
            {topics.length} topics
          </span>
        </div>
      </div>

      {/* Question List */}
      <div className="flex-1 overflow-auto p-4 bg-gray-50">
        {isLoading ? (
          <div role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">Loading questions…</span>
            <CollectionLoadingSkeleton variant={viewMode} />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <BookOpen size={48} className="mb-4 text-gray-300" />
            <p className="text-lg font-medium">Couldn’t load question bank</p>
            <p className="text-sm">{loadError}</p>
          </div>
        ) : filteredQuestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <BookOpen size={48} className="mb-4 text-gray-300" />
            <p className="text-lg font-medium">No questions found</p>
            <p className="text-sm">Try adjusting your filters or add questions to the bank</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredQuestions.map((item) => (
              <QuestionCard
                key={item.id}
                item={item}
                onAddToExam={() => handleAddToExam(item)}
                onSelectQuestion={() => onSelectQuestion(item)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredQuestions.map((item) => (
              <QuestionListItem
                key={item.id}
                item={item}
                onAddToExam={() => handleAddToExam(item)}
                onSelectQuestion={() => onSelectQuestion(item)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionCard({ item, onAddToExam, onSelectQuestion }: {
  item: QuestionBankItem;
  onAddToExam: () => void;
  onSelectQuestion: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4">
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs font-semibold px-2 py-1 rounded ${
          DIFFICULTY_COLORS[item.metadata.difficulty]
        }`}>
          {item.metadata.difficulty}
        </span>
        <span className="text-xs text-gray-500">{item.block.type}</span>
      </div>

      <div className="mb-3">
        <p className="text-sm text-gray-700 line-clamp-2">
          {getQuestionPreview(item.block)}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {item.metadata.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            {tag}
          </span>
        ))}
        {item.metadata.tags.length > 3 && (
          <span className="text-xs text-gray-400">+{item.metadata.tags.length - 3}</span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {item.metadata.usageCount} uses
        </span>
        <span>{item.metadata.topic}</span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSelectQuestion}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          View Details
        </button>
        <button
          onClick={onAddToExam}
          className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Add to Exam
        </button>
      </div>
    </div>
  );
}

function QuestionListItem({ item, onAddToExam, onSelectQuestion }: {
  item: QuestionBankItem;
  onAddToExam: () => void;
  onSelectQuestion: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm hover:shadow-md transition-shadow p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${
            DIFFICULTY_COLORS[item.metadata.difficulty]
          }`}>
            {item.metadata.difficulty}
          </span>
          <span className="text-xs text-gray-500">{QUESTION_TYPE_LABELS[item.block.type]}</span>
        </div>
        <p className="text-sm text-gray-700 truncate">{getQuestionPreview(item.block)}</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{item.metadata.topic}</span>
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {item.metadata.usageCount} uses
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSelectQuestion}
          className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          View
        </button>
        <button
          onClick={onAddToExam}
          className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function getQuestionPreview(block: QuestionBlock): string {
  switch (block.type) {
    case 'TFNG':
      return block.questions[0]?.statement || 'True/False/Not Given question';
    case 'CLOZE':
      return block.questions[0]?.prompt || 'Cloze question';
    case 'MATCHING':
      return block.questions[0]?.paragraphLabel || 'Matching headings question';
    case 'MAP':
      return block.questions[0]?.label || 'Map labeling question';
    case 'MULTI_MCQ':
      return block.stem || 'Multiple choice question';
    case 'SINGLE_MCQ':
      return block.questions?.[0]?.stem || block.stem || 'Single choice question';
    case 'SHORT_ANSWER':
      return block.questions[0]?.prompt || 'Short answer question';
    case 'SENTENCE_COMPLETION':
      return block.questions[0]?.sentence || 'Sentence completion question';
    case 'DIAGRAM_LABELING':
      return 'Diagram labeling question';
    case 'FLOW_CHART':
      return 'Flow chart completion question';
    case 'TABLE_COMPLETION':
      return 'Table completion question';
    case 'NOTE_COMPLETION':
      return block.questions[0]?.noteText || 'Note completion question';
    case 'CLASSIFICATION':
      return block.items[0]?.text || 'Classification question';
    case 'MATCHING_FEATURES':
      return block.features[0]?.text || 'Matching features question';
    default:
      return 'Question';
  }
}
