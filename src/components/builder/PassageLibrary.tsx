import React, { useState, useMemo } from 'react';
import { PassageLibraryItem, PassageLibraryQuery, Passage } from '../../types';
import { passageLibraryService } from '../../services/passageLibraryService';
import { Search, Filter, Grid, List, BookOpen, Clock, FileText, Plus } from 'lucide-react';

interface PassageLibraryProps {
  onAddToExam: (passage: Passage) => void;
  onClose: () => void;
}

const DIFFICULTY_COLORS = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700'
};

export function PassageLibrary({ onAddToExam, onClose }: PassageLibraryProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | 'all'>('all');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [minWordCount, setMinWordCount] = useState<number | undefined>();
  const [maxWordCount, setMaxWordCount] = useState<number | undefined>();

  const allPassages = useMemo(() => passageLibraryService.getAllPassages(), []);
  const topics = useMemo(() => passageLibraryService.getTopics(), []);
  const sources = useMemo(() => passageLibraryService.getSources(), []);
  const tags = useMemo(() => passageLibraryService.getTags(), []);

  const filteredPassages = useMemo(() => {
    return passageLibraryService.queryPassages({
      difficulty: selectedDifficulty === 'all' ? undefined : selectedDifficulty,
      topic: selectedTopic === 'all' ? undefined : selectedTopic,
      searchTerm: searchTerm || undefined,
      minWordCount,
      maxWordCount
    });
  }, [allPassages, selectedDifficulty, selectedTopic, searchTerm, minWordCount, maxWordCount]);

  const handleAddToExam = (item: PassageLibraryItem) => {
    onAddToExam(item.passage);
    passageLibraryService.incrementUsageCount(item.id);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 p-4 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <BookOpen size={20} />
            Passage Library
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
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search passages..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
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
          <select
            value={selectedTopic}
            onChange={(e) => setSelectedTopic(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Topics</option>
            {topics.map(topic => (
              <option key={topic} value={topic}>{topic}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Min words"
            value={minWordCount || ''}
            onChange={(e) => setMinWordCount(e.target.value ? parseInt(e.target.value) : undefined)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="number"
            placeholder="Max words"
            value={maxWordCount || ''}
            onChange={(e) => setMaxWordCount(e.target.value ? parseInt(e.target.value) : undefined)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <FileText size={14} />
            {allPassages.length} total passages
          </span>
          <span className="flex items-center gap-1">
            <Filter size={14} />
            {filteredPassages.length} filtered
          </span>
          <span className="flex items-center gap-1">
            {topics.length} topics
          </span>
        </div>
      </div>

      {/* Passage List */}
      <div className="flex-1 overflow-auto p-4 bg-gray-50">
        {filteredPassages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <FileText size={48} className="mb-4 text-gray-300" />
            <p className="text-lg font-medium">No passages found</p>
            <p className="text-sm">Try adjusting your filters or add passages to the library</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPassages.map((item) => (
              <PassageCard
                key={item.id}
                item={item}
                onAddToExam={() => handleAddToExam(item)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredPassages.map((item) => (
              <PassageListItem
                key={item.id}
                item={item}
                onAddToExam={() => handleAddToExam(item)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PassageCard({ item, onAddToExam }: {
  item: PassageLibraryItem;
  onAddToExam: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4">
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs font-semibold px-2 py-1 rounded ${
          DIFFICULTY_COLORS[item.metadata.difficulty]
        }`}>
          {item.metadata.difficulty}
        </span>
        <span className="text-xs text-gray-500">{item.metadata.source}</span>
      </div>

      <div className="mb-3">
        <h3 className="font-medium text-gray-900 mb-1 line-clamp-1">{item.passage.title}</h3>
        <p className="text-sm text-gray-600 line-clamp-2">{item.passage.content.substring(0, 150)}...</p>
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
          <FileText size={12} />
          {item.metadata.wordCount} words
        </span>
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {item.metadata.usageCount} uses
        </span>
      </div>

      <button
        onClick={onAddToExam}
        className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Add to Exam
      </button>
    </div>
  );
}

function PassageListItem({ item, onAddToExam }: {
  item: PassageLibraryItem;
  onAddToExam: () => void;
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
          <span className="text-xs text-gray-500">{item.metadata.source}</span>
        </div>
        <h3 className="text-sm font-medium text-gray-900 truncate">{item.passage.title}</h3>
        <p className="text-xs text-gray-600 truncate">{item.passage.content.substring(0, 100)}...</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{item.metadata.topic}</span>
          <span className="flex items-center gap-1">
            <FileText size={12} />
            {item.metadata.wordCount} words
          </span>
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {item.metadata.usageCount} uses
          </span>
        </div>
      </div>
      <button
        onClick={onAddToExam}
        className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Add
      </button>
    </div>
  );
}
