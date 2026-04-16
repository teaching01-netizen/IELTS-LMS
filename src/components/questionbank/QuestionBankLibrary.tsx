import React, { useState } from 'react';
import { Search, Filter, Grid, List, Plus } from 'lucide-react';
import { QuestionBankItem, QuestionBankQuery } from '../../types';
import { questionBankService } from '../../services/questionBankService';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface QuestionBankLibraryProps {
  onSelectQuestion: (item: QuestionBankItem) => void;
  onClose: () => void;
}

export function QuestionBankLibrary({ onSelectQuestion, onClose }: QuestionBankLibraryProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState<QuestionBankQuery>({});
  const [searchTerm, setSearchTerm] = useState('');

  const questions = questionBankService.queryQuestions(query);
  const topics = questionBankService.getTopics();
  const tags = questionBankService.getTags();

  const handleSearch = (term: string) => {
    setSearchTerm(term);
    setQuery({ ...query, searchTerm: term || undefined });
  };

  const handleFilterByType = (type: string) => {
    setQuery({ ...query, type: (type || undefined) as QuestionBankQuery['type'] });
  };

  const handleFilterByDifficulty = (difficulty: string) => {
    setQuery({ ...query, difficulty: (difficulty || undefined) as QuestionBankQuery['difficulty'] });
  };

  const handleFilterByTopic = (topic: string) => {
    setQuery({ ...query, topic: topic || undefined });
  };

  const clearFilters = () => {
    setQuery({});
    setSearchTerm('');
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Question Bank</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('grid')}
              className={viewMode === 'grid' ? 'bg-gray-100' : ''}
            >
              <Grid size={18} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('list')}
              className={viewMode === 'list' ? 'bg-gray-100' : ''}
            >
              <List size={18} />
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <Input
            placeholder="Search questions by type, topic, or tags..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="border-b px-6 py-3 flex items-center gap-4 overflow-x-auto">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filters:</span>
        </div>

        <select
          value={query.type || ''}
          onChange={(e) => handleFilterByType(e.target.value)}
          className="text-sm border rounded-md px-3 py-1.5"
        >
          <option value="">All Types</option>
          <option value="TFNG">TFNG</option>
          <option value="CLOZE">Cloze</option>
          <option value="MATCHING">Matching</option>
          <option value="MAP">Map</option>
          <option value="MULTI_MCQ">Multi MCQ</option>
          <option value="SINGLE_MCQ">Single MCQ</option>
          <option value="SHORT_ANSWER">Short Answer</option>
          <option value="SENTENCE_COMPLETION">Sentence Completion</option>
          <option value="DIAGRAM_LABELING">Diagram Labeling</option>
          <option value="FLOW_CHART">Flow Chart</option>
          <option value="TABLE_COMPLETION">Table Completion</option>
          <option value="NOTE_COMPLETION">Note Completion</option>
          <option value="CLASSIFICATION">Classification</option>
          <option value="MATCHING_FEATURES">Matching Features</option>
        </select>

        <select
          value={query.difficulty || ''}
          onChange={(e) => handleFilterByDifficulty(e.target.value)}
          className="text-sm border rounded-md px-3 py-1.5"
        >
          <option value="">All Difficulties</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>

        <select
          value={query.topic || ''}
          onChange={(e) => handleFilterByTopic(e.target.value)}
          className="text-sm border rounded-md px-3 py-1.5"
        >
          <option value="">All Topics</option>
          {topics.map((topic: string) => (
            <option key={topic} value={topic}>{topic}</option>
          ))}
        </select>

        {(query.type || query.difficulty || query.topic || searchTerm) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear Filters
          </Button>
        )}
      </div>

      {/* Question List */}
      <div className="flex-1 overflow-y-auto p-6">
        {questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Search size={48} className="mb-4 text-gray-300" />
            <p className="text-lg font-medium">No questions found</p>
            <p className="text-sm">Try adjusting your filters or search terms</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {questions.map((item: QuestionBankItem) => (
              <QuestionCard
                key={item.id}
                item={item}
                onSelect={() => onSelectQuestion(item)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((item: QuestionBankItem) => (
              <QuestionListItem
                key={item.id}
                item={item}
                onSelect={() => onSelectQuestion(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-6 py-4 flex items-center justify-between">
        <span className="text-sm text-gray-600">
          {questions.length} question{questions.length !== 1 ? 's' : ''} found
        </span>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function QuestionCard({ item, onSelect }: { item: QuestionBankItem; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className="border rounded-lg p-4 cursor-pointer hover:border-blue-500 hover:shadow-md transition-all bg-white"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">
          {item.block.type}
        </span>
        <span className={`text-xs px-2 py-1 rounded ${
          item.metadata.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
          item.metadata.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
          'bg-red-100 text-red-700'
        }`}>
          {item.metadata.difficulty}
        </span>
      </div>

      <div className="mb-3">
        <p className="text-sm font-medium text-gray-900 mb-1">{item.metadata.topic}</p>
        <p className="text-xs text-gray-600">{item.block.instruction}</p>
      </div>

      {item.metadata.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.metadata.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              {tag}
            </span>
          ))}
          {item.metadata.tags.length > 3 && (
            <span className="text-xs text-gray-400">+{item.metadata.tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-gray-500">
        <span>Used {item.metadata.usageCount} times</span>
        <span>{item.metadata.author}</span>
      </div>
    </div>
  );
}

function QuestionListItem({ item, onSelect }: { item: QuestionBankItem; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className="border rounded-lg p-4 cursor-pointer hover:border-blue-500 hover:bg-gray-50 transition-all flex items-center gap-4"
    >
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded">
            {item.block.type}
          </span>
          <span className={`text-xs px-2 py-1 rounded ${
            item.metadata.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
            item.metadata.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>
            {item.metadata.difficulty}
          </span>
          <span className="text-sm font-medium text-gray-900">{item.metadata.topic}</span>
        </div>
        <p className="text-sm text-gray-600">{item.block.instruction}</p>
      </div>
      <div className="text-right text-xs text-gray-500">
        <div>Used {item.metadata.usageCount} times</div>
        <div>{item.metadata.author}</div>
      </div>
    </div>
  );
}
