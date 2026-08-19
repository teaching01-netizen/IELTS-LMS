import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { ExamState, Passage, PassageMetadata, QuestionBlock } from '../types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StimulusPane } from './StimulusPane';
import { QuestionBuilderPane } from './QuestionBuilderPane';
import { ListeningWorkspace } from './workspaces/ListeningWorkspace';
import { WritingWorkspace } from './workspaces/WritingWorkspace';
import { SpeakingWorkspace } from './workspaces/SpeakingWorkspace';
import { getBlockQuestionCount } from '../utils/examUtils';
import { PassageListSidebar } from './passage/PassageListSidebar';
import { PassageMetadataEditor } from './passage/PassageMetadataEditor';
import { passageLibraryService } from '../features/content-library/infrastructure/libraryGateway';
import { createId } from '../utils/idUtils';
import { countWords } from '../utils/builderEnhancements';

export function Workspace({
  state,
  setState,
}: {
  state: ExamState;
  setState: (next: ExamState | ((previous: ExamState) => ExamState)) => void | Promise<void>;
}) {
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

  const setStateRef = useRef(setState);
  useEffect(() => {
    setStateRef.current = setState;
  }, [setState]);

  /**
   * Stable callback for memoized children (StimulusPane, QuestionBuilderPane,
   * workspaces). The parent routes pass an inline arrow that changes identity
   * on every render; without a stable handle, memo boundaries never skip.
   */
  const stableSetState = useCallback(
    (next: ExamState | ((previous: ExamState) => ExamState)) => {
      void setStateRef.current(next);
    },
    [],
  );

  const updateBlocks = useCallback((nextBlocks: React.SetStateAction<QuestionBlock[]>) => {
    void setStateRef.current((previous) => {
      const previousActivePassage = previous.reading.passages.find(
        (passage) => passage.id === previous.activePassageId,
      );
      if (!previousActivePassage) {
        return previous;
      }

      const resolvedBlocks =
        typeof nextBlocks === 'function' ? nextBlocks(previousActivePassage.blocks) : nextBlocks;

      const newPassages = previous.reading.passages.map((passage) =>
        passage.id === previousActivePassage.id ? { ...passage, blocks: resolvedBlocks } : passage,
      );
      return { ...previous, reading: { ...previous.reading, passages: newPassages } };
    });
  }, []);

  useEffect(() => {
    // Consolidate all localStorage persistence into a single effect
    localStorage.setItem('workspace-passage-list-collapsed', isPassageListCollapsed.toString());
    localStorage.setItem('workspace-question-builder-collapsed', isQuestionBuilderCollapsed.toString());
    localStorage.setItem('workspace-stimulus-pane-collapsed', isStimulusPaneCollapsed.toString());
    localStorage.setItem('workspace-question-focus-mode', isQuestionFocusMode.toString());
  }, [isPassageListCollapsed, isQuestionBuilderCollapsed, isStimulusPaneCollapsed, isQuestionFocusMode]);

  const activePassage = state.reading.passages.find((passage) => passage.id === state.activePassageId);

  // Recover from a dangling activePassageId (e.g. after a passage delete).
  // This heals state in an effect instead of calling setState during render.
  useEffect(() => {
    if (state.reading.passages.length === 0) return;
    if (state.reading.passages.some((passage) => passage.id === state.activePassageId)) return;

    const fallbackPassageId = state.reading.passages[0]!.id;
    setStateRef.current((previous) =>
      previous.activePassageId === fallbackPassageId ? previous : { ...previous, activePassageId: fallbackPassageId },
    );
  }, [state.activePassageId, state.reading.passages]);

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

  if (state.activeModule === 'listening') {
    return <ListeningWorkspace state={state} setState={stableSetState} />;
  }
  if (state.activeModule === 'writing') {
    return <WritingWorkspace state={state} setState={stableSetState} />;
  }
  if (state.activeModule === 'speaking') {
    return <SpeakingWorkspace state={state} setState={stableSetState} />;
  }

  const handlePassageAdd = () => {
    void stableSetState((previous) => {
      const newPassage: Passage = {
        id: createId('passage'),
        title: `Passage ${previous.reading.passages.length + 1}`,
        content: '',
        blocks: [],
        wordCount: 0,
      };

      return {
        ...previous,
        reading: { ...previous.reading, passages: [...previous.reading.passages, newPassage] },
        activePassageId: newPassage.id,
      };
    });
  };

  if (!activePassage) {
    if (state.reading.passages.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center bg-gray-50 p-8">
          <div className="max-w-md w-full bg-white border border-gray-100 rounded-2xl shadow-sm p-6 space-y-3">
            <h2 className="text-lg font-bold text-gray-900">Reading</h2>
            <p className="text-sm text-gray-600">
              No passages exist for this exam. Add a passage to continue building the reading module.
            </p>
            <button
              type="button"
              onClick={handlePassageAdd}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
              aria-label="Add passage"
            >
              Add Passage
            </button>
          </div>
        </div>
      );
    }

    // The recovery effect above re-selects the first passage; nothing to
    // render until it commits.
    return null;
  }

  const handlePassageSelect = (passageId: string) => {
    void stableSetState((previous) =>
      previous.activePassageId === passageId ? previous : { ...previous, activePassageId: passageId },
    );
  };

  // handlePassageAdd declared above (used for empty state recovery).

  const handlePassageDelete = (passageId: string) => {
    if (editingPassageId === passageId) {
      setEditingPassageId(null);
    }

    void stableSetState((previous) => {
      const newPassages = previous.reading.passages.filter((p) => p.id !== passageId);
      if (newPassages.length === previous.reading.passages.length) {
        return previous;
      }

      const newActiveId =
        previous.activePassageId === passageId ? newPassages[0]?.id ?? '' : previous.activePassageId;

      return {
        ...previous,
        reading: { ...previous.reading, passages: newPassages },
        activePassageId: newActiveId,
      };
    });
  };

  const handlePassageReorder = (fromIndex: number, toIndex: number) => {
    void stableSetState((previous) => {
      const newPassages = [...previous.reading.passages];
      const [removed] = newPassages.splice(fromIndex, 1);
      if (!removed) {
        return previous;
      }

      newPassages.splice(toIndex, 0, removed);
      return { ...previous, reading: { ...previous.reading, passages: newPassages } };
    });
  };

  const handlePassageEdit = (passageId: string) => {
    setEditingPassageId(passageId);
  };

  const handleMetadataSave = (metadataUpdates: Omit<PassageMetadata, 'id' | 'createdAt' | 'usageCount'>) => {
    const passageId = editingPassageId;
    if (!passageId) return;

    void stableSetState((previous) => {
      const passage = previous.reading.passages.find((p) => p.id === passageId);
      if (!passage) {
        return previous;
      }

      const updatedMetadata: PassageMetadata = {
        id: passage.metadata?.id || createId('passage_meta'),
        createdAt: passage.metadata?.createdAt || new Date().toISOString(),
        usageCount: passage.metadata?.usageCount || 0,
        lastUsedAt: passage.metadata?.lastUsedAt,
        ...metadataUpdates,
      };

      const newPassages = previous.reading.passages.map((p) =>
        p.id === passageId ? { ...p, metadata: updatedMetadata } : p,
      );

      return { ...previous, reading: { ...previous.reading, passages: newPassages } };
    });
    setEditingPassageId(null);
  };

  const handleAddPassageToLibrary = async (passageId: string) => {
    const passage = state.reading.passages.find(p => p.id === passageId);
    if (!passage) return;

    // Use existing metadata if available, otherwise use defaults
    const metadata = passage.metadata || {
      difficulty: 'medium',
      source: 'Custom',
      topic: 'General',
      tags: [],
      wordCount: passage.wordCount ?? countWords(passage.content),
      estimatedTimeMinutes: 20,
      author: 'Unknown'
    };

    try {
      await passageLibraryService.addPassage(passage, metadata);
      alert('Passage added to library successfully!');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add passage to library.');
    }
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
        <StimulusPane passage={activePassage} state={state} setState={stableSetState} />
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
