import { BookOpen, HelpCircle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CollectionLoadingSkeleton } from '@components/ui';
import {
  useClearLibraryPassagesMutation,
  useClearLibraryQuestionsMutation,
  useDeleteLibraryPassageMutation,
  useDeleteLibraryQuestionMutation,
  useLibraryPassagesQuery,
  useLibraryQuestionsQuery,
} from '../../api/libraryQueries';
import {
  PassageCard,
  PassageListItem,
  QuestionCard,
  QuestionListItem,
} from './LibraryCards';
import {
  LibraryControls,
  type LibraryTab,
  type LibraryViewMode,
} from './LibraryControls';
import {
  filterPassages,
  filterQuestions,
  type LibraryDifficulty,
} from './libraryFilters';

export function Library() {
  const [activeTab, setActiveTab] = useState<LibraryTab>('passages');
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<LibraryDifficulty>('all');
  const [selectedTopic, setSelectedTopic] = useState('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const passagesQuery = useLibraryPassagesQuery();
  const questionsQuery = useLibraryQuestionsQuery();
  const deletePassageMutation = useDeleteLibraryPassageMutation();
  const deleteQuestionMutation = useDeleteLibraryQuestionMutation();
  const clearPassagesMutation = useClearLibraryPassagesMutation();
  const clearQuestionsMutation = useClearLibraryQuestionsMutation();
  const passages = useMemo(() => passagesQuery.data ?? [], [passagesQuery.data]);
  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);
  const isLoading = passagesQuery.isLoading || questionsQuery.isLoading;
  const queryError = passagesQuery.error ?? questionsQuery.error;

  const passageTopics = useMemo(
    () => Array.from(new Set(passages.map((item) => item.metadata.topic))).sort(),
    [passages],
  );
  const questionTopics = useMemo(
    () => Array.from(new Set(questions.map((item) => item.metadata.topic))).sort(),
    [questions],
  );
  const filteredPassages = useMemo(
    () => filterPassages(passages, { difficulty: selectedDifficulty, topic: selectedTopic, searchTerm }),
    [passages, searchTerm, selectedDifficulty, selectedTopic],
  );
  const filteredQuestions = useMemo(
    () => filterQuestions(questions, { difficulty: selectedDifficulty, topic: selectedTopic, searchTerm }),
    [questions, searchTerm, selectedDifficulty, selectedTopic],
  );

  const handleDeletePassage = async (id: string) => {
    if (!confirm('Are you sure you want to delete this passage from the library?')) return;
    try {
      await deletePassageMutation.mutateAsync(id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete passage.');
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (!confirm('Are you sure you want to delete this question from the library?')) return;
    try {
      await deleteQuestionMutation.mutateAsync(id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete question.');
    }
  };

  const handleClearAll = async () => {
    if (!confirm(`Are you sure you want to clear all ${activeTab} from the library? This cannot be undone.`)) {
      return;
    }
    try {
      if (activeTab === 'passages') {
        await clearPassagesMutation.mutateAsync();
      } else {
        await clearQuestionsMutation.mutateAsync();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Failed to clear ${activeTab}.`);
    }
  };

  return (
    <div className="space-y-6">
      <LibraryControls
        activeTab={activeTab}
        viewMode={viewMode}
        searchTerm={searchTerm}
        selectedDifficulty={selectedDifficulty}
        selectedTopic={selectedTopic}
        passageTopics={passageTopics}
        questionTopics={questionTopics}
        passageCount={passages.length}
        questionCount={questions.length}
        onActiveTabChange={setActiveTab}
        onViewModeChange={setViewMode}
        onSearchTermChange={setSearchTerm}
        onDifficultyChange={setSelectedDifficulty}
        onTopicChange={setSelectedTopic}
        onClearAll={handleClearAll}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      ) : queryError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {queryError instanceof Error ? queryError.message : 'Failed to load library content.'}
        </div>
      ) : null}

      {isLoading ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading library…</span>
          <CollectionLoadingSkeleton variant={viewMode} />
        </div>
      ) : null}

      {!isLoading && activeTab === 'passages' ? (
        <LibraryCollection
          kind="passages"
          total={passages.length}
          filtered={filteredPassages.length}
          isEmpty={passages.length === 0}
          viewMode={viewMode}
        >
          {filteredPassages.map((item) =>
            viewMode === 'grid' ? (
              <PassageCard key={item.id} item={item} onDelete={() => handleDeletePassage(item.id)} />
            ) : (
              <PassageListItem key={item.id} item={item} onDelete={() => handleDeletePassage(item.id)} />
            ),
          )}
        </LibraryCollection>
      ) : !isLoading ? (
        <LibraryCollection
          kind="questions"
          total={questions.length}
          filtered={filteredQuestions.length}
          isEmpty={questions.length === 0}
          viewMode={viewMode}
        >
          {filteredQuestions.map((item) =>
            viewMode === 'grid' ? (
              <QuestionCard key={item.id} item={item} onDelete={() => handleDeleteQuestion(item.id)} />
            ) : (
              <QuestionListItem key={item.id} item={item} onDelete={() => handleDeleteQuestion(item.id)} />
            ),
          )}
        </LibraryCollection>
      ) : null}
    </div>
  );
}

type LibraryCollectionProps = Readonly<{
  kind: LibraryTab;
  total: number;
  filtered: number;
  isEmpty: boolean;
  viewMode: LibraryViewMode;
  children: ReactNode;
}>;

function LibraryCollection({ kind, total, filtered, isEmpty, viewMode, children }: LibraryCollectionProps) {
  const label = kind === 'passages' ? 'passages' : 'questions';
  const EmptyIcon = kind === 'passages' ? BookOpen : HelpCircle;

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">Showing {filtered} of {total} {label}</div>
      {filtered === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <EmptyIcon size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No {label} found</h3>
          <p className="text-sm text-gray-600">
            {isEmpty
              ? `Your ${kind === 'passages' ? 'passage library' : 'question bank'} is empty. Add ${label} from the exam builder to build your ${kind === 'passages' ? 'library' : 'bank'}.`
              : 'Try adjusting your filters or search terms.'}
          </p>
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-2'}>
          {children}
        </div>
      )}
    </div>
  );
}
