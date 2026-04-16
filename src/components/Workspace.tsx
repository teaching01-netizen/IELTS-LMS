import React, { useEffect, useState, useMemo } from 'react';
import { ExamState, Passage, PassageMetadata } from '../types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StimulusPane } from './StimulusPane';
import { QuestionBuilderPane } from './QuestionBuilderPane';
import { ListeningWorkspace } from './workspaces/ListeningWorkspace';
import { WritingWorkspace } from './workspaces/WritingWorkspace';
import { SpeakingWorkspace } from './workspaces/SpeakingWorkspace';
import { getBlockQuestionCount } from '../utils/examUtils';
import { PassageListSidebar } from './passage/PassageListSidebar';
import { PassageMetadataEditor } from './passage/PassageMetadataEditor';
import { passageLibraryService } from '../services/passageLibraryService';
import { TIMING } from '../constants/uiConstants';

function WorkspaceSkeleton({ progress }: { progress: number }) {
  return (
    <div className="flex-1 bg-gray-50 p-8 animate-in fade-in duration-200">
      <div className="mb-6">
        <p className="text-xs font-black text-gray-400 uppercase tracking-[0.22em] mb-3">
          Loading modules... {progress}%
        </p>
        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full rounded-full bg-blue-600 transition-all duration-200" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="h-12 rounded-2xl bg-white border border-gray-100" />
          <div className="h-[520px] rounded-[28px] bg-white border border-gray-100" />
        </div>
        <div className="space-y-4">
          <div className="h-12 rounded-2xl bg-white border border-gray-100" />
          <div className="h-[520px] rounded-[28px] bg-white border border-gray-100" />
        </div>
      </div>
    </div>
  );
}

export function Workspace({
  state,
  setState,
}: {
  state: ExamState;
  setState: (next: ExamState | ((previous: ExamState) => ExamState)) => void | Promise<void>;
}) {
  const [progress, setProgress] = useState(34);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [editingPassageId, setEditingPassageId] = useState<string | null>(null);
  const [isPassageListCollapsed, setIsPassageListCollapsed] = useState(() => {
    const saved = localStorage.getItem('workspace-passage-list-collapsed');
    return saved === 'true';
  });
  const [isQuestionBuilderCollapsed, setIsQuestionBuilderCollapsed] = useState(() => {
    const saved = localStorage.getItem('workspace-question-builder-collapsed');
    return saved === 'true';
  });
  const [isStimulusPaneCollapsed, setIsStimulusPaneCollapsed] = useState(() => {
    const saved = localStorage.getItem('workspace-stimulus-pane-collapsed');
    return saved === 'true';
  });
  const [isQuestionFocusMode, setIsQuestionFocusMode] = useState(() => {
    const saved = localStorage.getItem('workspace-question-focus-mode');
    return saved === 'true';
  });

  useEffect(() => {
    setIsTransitioning(true);
    setProgress(TIMING.PROGRESS_INITIAL_VALUE);
    const progressTimer = window.setTimeout(() => setProgress(TIMING.PROGRESS_SECONDARY_VALUE), TIMING.PROGRESS_INITIAL_DELAY_MS);
    const doneTimer = window.setTimeout(() => {
      setProgress(100);
      setIsTransitioning(false);
    }, TIMING.PROGRESS_INITIAL_DELAY_MS + TIMING.PROGRESS_SECONDARY_DELAY_MS);

    return () => {
      window.clearTimeout(progressTimer);
      window.clearTimeout(doneTimer);
    };
  }, [state.activeModule]);

  useEffect(() => {
    // Consolidate all localStorage persistence into a single effect
    localStorage.setItem('workspace-passage-list-collapsed', isPassageListCollapsed.toString());
    localStorage.setItem('workspace-question-builder-collapsed', isQuestionBuilderCollapsed.toString());
    localStorage.setItem('workspace-stimulus-pane-collapsed', isStimulusPaneCollapsed.toString());
    localStorage.setItem('workspace-question-focus-mode', isQuestionFocusMode.toString());
  }, [isPassageListCollapsed, isQuestionBuilderCollapsed, isStimulusPaneCollapsed, isQuestionFocusMode]);

  const activePassage = state.reading.passages.find((passage) => passage.id === state.activePassageId);

  const startNumber = useMemo(() => {
    if (!activePassage) return 1;
    const passageIndex = state.reading.passages.findIndex((passage) => passage.id === activePassage.id);
    let num = 1;
    for (let index = 0; index < passageIndex; index += 1) {
      const previousPassage = state.reading.passages[index];
      if (!previousPassage) {
        continue;
      }
      num += previousPassage.blocks.reduce(
        (count, block) => count + getBlockQuestionCount(block),
        0,
      );
    }
    return num;
  }, [state.reading.passages, activePassage]);

  if (isTransitioning) {
    return <WorkspaceSkeleton progress={progress} />;
  }

  if (state.activeModule === 'listening') {
    return <ListeningWorkspace state={state} setState={(next) => void setState(next)} />;
  }
  if (state.activeModule === 'writing') {
    return <WritingWorkspace state={state} setState={(next) => void setState(next)} />;
  }
  if (state.activeModule === 'speaking') {
    return <SpeakingWorkspace state={state} setState={(next) => void setState(next)} />;
  }

  if (!activePassage) {
    return null;
  }

  const updateBlocks = (blocks: typeof activePassage.blocks) => {
    const newPassages = state.reading.passages.map((passage) =>
      passage.id === activePassage.id ? { ...passage, blocks } : passage,
    );
    void setState({ ...state, reading: { ...state.reading, passages: newPassages } });
  };

  const handlePassageSelect = (passageId: string) => {
    void setState({ ...state, activePassageId: passageId });
  };

  const handlePassageAdd = () => {
    const newPassage: Passage = {
      id: `p${Date.now()}`,
      title: `Passage ${state.reading.passages.length + 1}`,
      content: '',
      blocks: [],
      wordCount: 0
    };
    const newPassages = [...state.reading.passages, newPassage];
    void setState({ ...state, reading: { ...state.reading, passages: newPassages }, activePassageId: newPassage.id });
  };

  const handlePassageDelete = (passageId: string) => {
    const newPassages = state.reading.passages.filter(p => p.id !== passageId);
    const newActiveId = state.activePassageId === passageId
      ? (newPassages[0]?.id || '')
      : state.activePassageId;
    void setState({ ...state, reading: { ...state.reading, passages: newPassages }, activePassageId: newActiveId });
  };

  const handlePassageReorder = (fromIndex: number, toIndex: number) => {
    const newPassages = [...state.reading.passages];
    const [removed] = newPassages.splice(fromIndex, 1);
    if (removed) {
      newPassages.splice(toIndex, 0, removed);
      void setState({ ...state, reading: { ...state.reading, passages: newPassages } });
    }
  };

  const handlePassageEdit = (passageId: string) => {
    setEditingPassageId(passageId);
  };

  const handleMetadataSave = (metadataUpdates: Omit<PassageMetadata, 'id' | 'createdAt' | 'usageCount'>) => {
    if (!editingPassageId) return;

    const passage = state.reading.passages.find(p => p.id === editingPassageId);
    if (!passage) return;

    // Create or update metadata
    const updatedMetadata: PassageMetadata = {
      id: passage.metadata?.id || `pm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: passage.metadata?.createdAt || new Date().toISOString(),
      usageCount: passage.metadata?.usageCount || 0,
      lastUsedAt: passage.metadata?.lastUsedAt,
      ...metadataUpdates
    };

    const newPassages = state.reading.passages.map(p =>
      p.id === editingPassageId ? { ...p, metadata: updatedMetadata } : p
    );

    void setState({ ...state, reading: { ...state.reading, passages: newPassages } });
    setEditingPassageId(null);
  };

  const handleAddPassageToLibrary = (passageId: string) => {
    const passage = state.reading.passages.find(p => p.id === passageId);
    if (!passage) return;

    // Use existing metadata if available, otherwise use defaults
    const metadata = passage.metadata || {
      difficulty: 'medium',
      source: 'Custom',
      topic: 'General',
      tags: [],
      wordCount: passage.wordCount || passage.content.split(/\s+/).length,
      estimatedTimeMinutes: 20,
      author: 'Unknown'
    };

    passageLibraryService.addPassage(passage, metadata);
    alert('Passage added to library successfully!');
  };

  return (
    <div className="flex-1 flex overflow-x-auto overflow-y-hidden transition-opacity duration-200 relative">
      {/* Question Focus Mode Toggle Button */}
      <button
        onClick={() => setIsQuestionFocusMode(!isQuestionFocusMode)}
        className={`absolute bottom-4 z-30 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-md px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 ${
          isQuestionFocusMode ? 'left-4 text-blue-800 border-blue-300' : 'right-4 text-gray-600'
        }`}
        aria-label={isQuestionFocusMode ? 'Exit question focus mode' : 'Enter question focus mode'}
      >
        {isQuestionFocusMode ? (
          <>
            <ChevronLeft size={14} />
            Exit Focus
          </>
        ) : (
          <>
            <ChevronRight size={14} />
            Focus on Questions
          </>
        )}
      </button>

      {/* Passage List Sidebar with Collapse Toggle */}
      <div className={`flex-shrink-0 transition-all duration-300 ease-in-out ${isQuestionFocusMode || isPassageListCollapsed ? 'w-0 overflow-hidden' : 'w-64'}`}>
        <PassageListSidebar
          passages={state.reading.passages}
          activePassageId={state.activePassageId}
          onPassageSelect={handlePassageSelect}
          onPassageAdd={handlePassageAdd}
          onPassageDelete={handlePassageDelete}
          onPassageReorder={handlePassageReorder}
          onPassageEdit={handlePassageEdit}
          onAddToLibrary={handleAddPassageToLibrary}
        />
      </div>

      {!isQuestionFocusMode && !isPassageListCollapsed && (
        <>
          <button
            onClick={() => setIsPassageListCollapsed(true)}
            className="absolute left-64 top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-r-md p-1 group"
            style={{ left: '16rem' }}
            aria-label="Collapse passage list"
          >
            <ChevronLeft size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
          </button>
          <div className="w-px bg-gray-200" />
        </>
      )}

      {isPassageListCollapsed && !isQuestionFocusMode && (
        <button
          onClick={() => setIsPassageListCollapsed(false)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-r-md p-1 group"
          aria-label="Expand passage list"
        >
          <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
        </button>
      )}

      {/* Stimulus Pane (Center) */}
      <div className={`flex-shrink-0 transition-all duration-300 ease-in-out ${isQuestionFocusMode || isStimulusPaneCollapsed ? 'w-0 overflow-hidden' : 'flex-1 min-w-0'}`}>
        <StimulusPane passage={activePassage} state={state} setState={setState} />
      </div>

      {!isQuestionFocusMode && (
        <>
          {/* Stimulus Pane Collapse Toggle Button */}
          {!isStimulusPaneCollapsed && !isQuestionBuilderCollapsed && (
            <button
              onClick={() => setIsStimulusPaneCollapsed(true)}
              className="absolute top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-l-md p-1 group"
              style={{ right: '30rem' }}
              aria-label="Collapse paragraph editor"
            >
              <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
            </button>
          )}

          {!isStimulusPaneCollapsed && isQuestionBuilderCollapsed && (
            <button
              onClick={() => setIsStimulusPaneCollapsed(true)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-l-md p-1 group"
              aria-label="Collapse paragraph editor"
            >
              <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
            </button>
          )}

          {isStimulusPaneCollapsed && (
            <button
              onClick={() => setIsStimulusPaneCollapsed(false)}
              className="absolute top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-r-md p-1 group"
              style={{ left: isPassageListCollapsed ? '0' : '16rem' }}
              aria-label="Expand paragraph editor"
            >
              <ChevronLeft size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
            </button>
          )}

          {!isQuestionBuilderCollapsed && <div className="w-px bg-gray-200" />}
        </>
      )}

      {/* Question Builder Pane with Collapse Toggle */}
      <div className={`flex-shrink-0 transition-all duration-300 ease-in-out h-full ${isQuestionBuilderCollapsed ? 'w-0 overflow-hidden' : isQuestionFocusMode ? 'flex-1' : 'w-[480px] min-w-[400px]'}`}>
        <QuestionBuilderPane
          blocks={activePassage.blocks}
          title={activePassage.title}
          updateBlocks={updateBlocks}
          startNumber={startNumber}
        />
      </div>

      {!isQuestionFocusMode && (
        <>
          {/* Question Builder Collapse Toggle Button */}
          {!isQuestionBuilderCollapsed && (
            <button
              onClick={() => setIsQuestionBuilderCollapsed(true)}
              className="absolute right-[480px] top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-l-md p-1 group"
              style={{ right: '30rem' }}
              aria-label="Collapse question builder"
            >
              <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
            </button>
          )}

          {isQuestionBuilderCollapsed && (
            <button
              onClick={() => setIsQuestionBuilderCollapsed(false)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-l-md p-1 group"
              aria-label="Expand question builder"
            >
              <ChevronLeft size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
            </button>
          )}
        </>
      )}

      {editingPassageId && (
        <PassageMetadataEditor
          metadata={state.reading.passages.find(p => p.id === editingPassageId)?.metadata || null}
          onSave={handleMetadataSave}
          onClose={() => setEditingPassageId(null)}
        />
      )}
    </div>
  );
}
