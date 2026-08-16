import { BookOpen, Grid, HelpCircle, List, Search } from 'lucide-react';
import type { LibraryDifficulty } from './libraryFilters';

export type LibraryTab = 'passages' | 'questions';
export type LibraryViewMode = 'grid' | 'list';

type LibraryControlsProps = Readonly<{
  activeTab: LibraryTab;
  viewMode: LibraryViewMode;
  searchTerm: string;
  selectedDifficulty: LibraryDifficulty;
  selectedTopic: string;
  passageTopics: readonly string[];
  questionTopics: readonly string[];
  passageCount: number;
  questionCount: number;
  onActiveTabChange: (tab: LibraryTab) => void;
  onViewModeChange: (mode: LibraryViewMode) => void;
  onSearchTermChange: (value: string) => void;
  onDifficultyChange: (value: LibraryDifficulty) => void;
  onTopicChange: (value: string) => void;
  onClearAll: () => void;
}>;

function parseDifficulty(value: string): LibraryDifficulty {
  switch (value) {
    case 'easy':
    case 'medium':
    case 'hard':
    case 'all':
      return value;
    default:
      return 'all';
  }
}

export function LibraryControls({
  activeTab,
  viewMode,
  searchTerm,
  selectedDifficulty,
  selectedTopic,
  passageTopics,
  questionTopics,
  passageCount,
  questionCount,
  onActiveTabChange,
  onViewModeChange,
  onSearchTermChange,
  onDifficultyChange,
  onTopicChange,
  onClearAll,
}: LibraryControlsProps) {
  const topics = activeTab === 'passages' ? passageTopics : questionTopics;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Library</h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage your reusable passages and questions for exam building
          </p>
        </div>
        <button
          onClick={onClearAll}
          className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
        >
          Clear All
        </button>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-8" aria-label="Tabs">
          <button
            onClick={() => onActiveTabChange('passages')}
            className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'passages'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <BookOpen size={18} />
            Passages
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{passageCount}</span>
          </button>
          <button
            onClick={() => onActiveTabChange('questions')}
            className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'questions'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <HelpCircle size={18} />
            Questions
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{questionCount}</span>
          </button>
        </nav>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              aria-label={`Search ${activeTab}`}
              placeholder={`Search ${activeTab}...`}
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={selectedDifficulty}
            onChange={(event) => onDifficultyChange(parseDifficulty(event.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <select
            value={selectedTopic}
            onChange={(event) => onTopicChange(event.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Topics</option>
            {topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
          </select>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => onViewModeChange('grid')}
              className={`p-2 rounded ${viewMode === 'grid' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
              aria-label="Grid view"
              title="Grid view"
            >
              <Grid size={18} />
            </button>
            <button
              onClick={() => onViewModeChange('list')}
              className={`p-2 rounded ${viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
              aria-label="List view"
              title="List view"
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
