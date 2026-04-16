import React, { useState } from 'react';
import { BookOpen, HelpCircle, Plus, Trash2, Edit2, Search, Filter, Grid, List } from 'lucide-react';
import { passageLibraryService } from '@services/passageLibraryService';
import { questionBankService } from '@services/questionBankService';
import { PassageLibraryItem, QuestionBankItem, Passage, QuestionBlock, PassageMetadata, QuestionMetadata } from '../../../types';

export function LibraryRoute() {
  const [activeTab, setActiveTab] = useState<'passages' | 'questions'>('passages');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'easy' | 'medium' | 'hard' | 'all'>('all');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');

  const passages = passageLibraryService.getAllPassages();
  const questions = questionBankService.getAllQuestions();
  const passageTopics = passageLibraryService.getTopics();
  const questionTopics = questionBankService.getTopics();

  const filteredPassages = passageLibraryService.queryPassages({
    difficulty: selectedDifficulty === 'all' ? undefined : selectedDifficulty,
    topic: selectedTopic === 'all' ? undefined : selectedTopic,
    searchTerm: searchTerm || undefined,
  });

  const filteredQuestions = questionBankService.queryQuestions({
    difficulty: selectedDifficulty === 'all' ? undefined : selectedDifficulty,
    topic: selectedTopic === 'all' ? undefined : selectedTopic,
    searchTerm: searchTerm || undefined,
  });

  const handleDeletePassage = (id: string) => {
    if (confirm('Are you sure you want to delete this passage from the library?')) {
      passageLibraryService.deletePassage(id);
    }
  };

  const handleDeleteQuestion = (id: string) => {
    if (confirm('Are you sure you want to delete this question from the library?')) {
      questionBankService.deleteQuestion(id);
    }
  };

  const handleClearAll = () => {
    if (confirm(`Are you sure you want to clear all ${activeTab} from the library? This cannot be undone.`)) {
      if (activeTab === 'passages') {
        passageLibraryService.clear();
      } else {
        questionBankService.clear();
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Library</h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage your reusable passages and questions for exam building
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleClearAll}
            className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('passages')}
            className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'passages'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <BookOpen size={18} />
            Passages
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">
              {passages.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('questions')}
            className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'questions'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <HelpCircle size={18} />
            Questions
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">
              {questions.length}
            </span>
          </button>
        </nav>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
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
            {(activeTab === 'passages' ? passageTopics : questionTopics).map(topic => (
              <option key={topic} value={topic}>{topic}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded ${viewMode === 'grid' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
              title="Grid view"
            >
              <Grid size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded ${viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
              title="List view"
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'passages' ? (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            Showing {filteredPassages.length} of {passages.length} passages
          </div>
          {filteredPassages.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <BookOpen size={48} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No passages found</h3>
              <p className="text-sm text-gray-600">
                {passages.length === 0
                  ? 'Your passage library is empty. Add passages from the exam builder to build your library.'
                  : 'Try adjusting your filters or search terms.'}
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPassages.map(item => (
                <PassageCard key={item.id} item={item} onDelete={() => handleDeletePassage(item.id)} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPassages.map(item => (
                <PassageListItem key={item.id} item={item} onDelete={() => handleDeletePassage(item.id)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            Showing {filteredQuestions.length} of {questions.length} questions
          </div>
          {filteredQuestions.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <HelpCircle size={48} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No questions found</h3>
              <p className="text-sm text-gray-600">
                {questions.length === 0
                  ? 'Your question bank is empty. Add questions from the exam builder to build your bank.'
                  : 'Try adjusting your filters or search terms.'}
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredQuestions.map(item => (
                <QuestionCard key={item.id} item={item} onDelete={() => handleDeleteQuestion(item.id)} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredQuestions.map(item => (
                <QuestionListItem key={item.id} item={item} onDelete={() => handleDeleteQuestion(item.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PassageCard({ item, onDelete }: { item: PassageLibraryItem; onDelete: () => void }) {
  const wordCount = item.passage.wordCount || item.passage.content.split(/\s+/).length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 relative group">
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete passage"
      >
        <Trash2 size={16} />
      </button>
      <div className="flex items-start justify-between mb-3 pr-6">
        <span className={`text-xs font-semibold px-2 py-1 rounded ${
          item.metadata.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
          item.metadata.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
          'bg-red-100 text-red-700'
        }`}>
          {item.metadata.difficulty}
        </span>
        <span className="text-xs text-gray-500">{item.metadata.source}</span>
      </div>

      <div className="mb-3">
        <h3 className="font-medium text-gray-900 mb-1 line-clamp-2">{item.passage.title}</h3>
        <p className="text-sm text-gray-600 line-clamp-3">{item.passage.content.substring(0, 150)}...</p>
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

      <div className="flex items-center justify-between text-xs text-gray-500 border-t pt-3">
        <div className="flex items-center gap-3">
          <span>{wordCount} words</span>
          <span>{item.metadata.usageCount} uses</span>
        </div>
        <span className="text-xs text-gray-400">{new Date(item.metadata.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function PassageListItem({ item, onDelete }: { item: PassageLibraryItem; onDelete: () => void }) {
  const wordCount = item.passage.wordCount || item.passage.content.split(/\s+/).length;

  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm hover:shadow-md transition-shadow p-4 flex items-center gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${
            item.metadata.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
            item.metadata.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>
            {item.metadata.difficulty}
          </span>
          <span className="text-sm font-medium text-gray-900 truncate">{item.passage.title}</span>
        </div>
        <p className="text-xs text-gray-600 truncate">{item.passage.content.substring(0, 100)}...</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{item.metadata.topic}</span>
          <span>{wordCount} words</span>
          <span>{item.metadata.usageCount} uses</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{new Date(item.metadata.createdAt).toLocaleDateString()}</span>
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete passage"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function QuestionCard({ item, onDelete }: { item: QuestionBankItem; onDelete: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 relative group">
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete question"
      >
        <Trash2 size={16} />
      </button>
      <div className="flex items-start justify-between mb-3 pr-6">
        <span className={`text-xs font-semibold px-2 py-1 rounded ${
          item.metadata.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
          item.metadata.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
          'bg-red-100 text-red-700'
        }`}>
          {item.metadata.difficulty}
        </span>
        <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
          {item.block.type}
        </span>
      </div>

      <div className="mb-3">
        <h3 className="font-medium text-gray-900 mb-1 line-clamp-2">
          {item.block.type} Question
        </h3>
        <p className="text-sm text-gray-600 line-clamp-3">
          {JSON.stringify(item.block).substring(0, 150)}...
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

      <div className="flex items-center justify-between text-xs text-gray-500 border-t pt-3">
        <div className="flex items-center gap-3">
          <span>{item.metadata.topic}</span>
          <span>{item.metadata.usageCount} uses</span>
        </div>
        <span className="text-xs text-gray-400">{new Date(item.metadata.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function QuestionListItem({ item, onDelete }: { item: QuestionBankItem; onDelete: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm hover:shadow-md transition-shadow p-4 flex items-center gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${
            item.metadata.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
            item.metadata.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>
            {item.metadata.difficulty}
          </span>
          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
            {item.block.type}
          </span>
          <span className="text-sm font-medium text-gray-900 truncate">{item.metadata.topic}</span>
        </div>
        <p className="text-xs text-gray-600 truncate">
          {JSON.stringify(item.block).substring(0, 100)}...
        </p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{item.metadata.usageCount} uses</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{new Date(item.metadata.createdAt).toLocaleDateString()}</span>
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete question"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
