import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Header } from '@components/Header';
import { Sidebar } from '@components/Sidebar';
import { Workspace } from '@components/Workspace';
import { CommandPalette, type CommandPaletteCommand } from '@components/CommandPalette';
import { GlobalToast, type GlobalToastItem } from '@components/GlobalToast';
import { BandScoreMatrix } from '@components/scoring/BandScoreMatrix';
import { GradingWorkspace } from '@components/scoring/GradingWorkspace';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useBuilderRouteController } from '@builder/hooks/useBuilderRouteController';
import { useUndoRedo } from '../../../hooks/useUndoRedo';
import { useKeyboardShortcuts } from '../../../hooks/useKeyboardShortcuts';
import type { ExamState, GradeHistoryEntry } from '../../../types';
import {
  DEFAULT_LISTENING_BAND_TABLE,
  DEFAULT_READING_ACADEMIC_BAND_TABLE,
  DEFAULT_READING_GT_BAND_TABLE,
  syncConfigWithStandards,
} from '../../../constants/examDefaults';
import {
  buildSpeakingRubric,
  buildWritingRubric,
  OFFICIAL_SPEAKING_RUBRIC,
  OFFICIAL_WRITING_RUBRIC,
} from '../../../utils/builderEnhancements';
import { normalizeWritingTaskContents } from '../../../utils/writingTaskUtils';

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function ScoringAside({
  state,
  onSubmitGrade,
  onUpdateState,
}: {
  onSubmitGrade: (entry: GradeHistoryEntry) => void;
  onUpdateState: (next: ExamState) => void;
  state: ExamState;
}) {
  if (state.activeModule === 'reading' || state.activeModule === 'listening') {
    const officialReading =
      state.type === 'General Training'
        ? DEFAULT_READING_GT_BAND_TABLE
        : DEFAULT_READING_ACADEMIC_BAND_TABLE;
    const deviationThreshold = state.config.standards.rubricDeviationThreshold;
    const updateConfig = (nextConfig: ExamState['config']) =>
      onUpdateState({
        ...state,
        config: syncConfigWithStandards(nextConfig),
      });

    return (
      <div className="w-[430px] flex-shrink-0 border-l border-gray-200 bg-gray-50/90 backdrop-blur-sm overflow-y-auto p-4 space-y-4">
        <BandScoreMatrix
          deviationThreshold={deviationThreshold}
          moduleLabel="Reading"
          table={state.config.sections.reading.bandScoreTable}
          officialTable={officialReading}
          onChange={(table) =>
            updateConfig({
              ...state.config,
              standards: {
                ...state.config.standards,
                bandScoreTables: {
                  ...state.config.standards.bandScoreTables,
                  [state.config.general.type === 'General Training'
                    ? 'readingGeneralTraining'
                    : 'readingAcademic']: table,
                },
              },
            })
          }
        />
        <BandScoreMatrix
          deviationThreshold={deviationThreshold}
          moduleLabel="Listening"
          table={state.config.sections.listening.bandScoreTable}
          officialTable={DEFAULT_LISTENING_BAND_TABLE}
          onChange={(table) =>
            updateConfig({
              ...state.config,
              standards: {
                ...state.config.standards,
                bandScoreTables: {
                  ...state.config.standards.bandScoreTables,
                  listening: table,
                },
              },
            })
          }
        />
      </div>
    );
  }

  if (state.activeModule === 'writing') {
    const writingTasks = normalizeWritingTaskContents(state.writing, state.config.sections.writing.tasks);
    const previewTask = writingTasks.find((task) => task.taskId === 'task2') ?? writingTasks.at(-1);

    return (
      <div className="w-[520px] flex-shrink-0 border-l border-gray-200 bg-gray-50/90 backdrop-blur-sm overflow-y-auto p-4">
        <GradingWorkspace
          module="writing"
          deviationThreshold={state.config.standards.rubricDeviationThreshold}
          rubric={buildWritingRubric(state.config, state.writing.rubric ?? OFFICIAL_WRITING_RUBRIC)}
          history={state.writing.gradeHistory ?? []}
          submission={{
            title: 'Writing preview submission',
            text:
              previewTask?.prompt ||
              'Student response preview will appear here once writing content is attached.',
            wordCount: previewTask?.prompt.trim().split(/\s+/).filter(Boolean).length ?? 0,
          }}
          onSubmitGrade={onSubmitGrade}
        />
      </div>
    );
  }

  return (
    <div className="w-[520px] flex-shrink-0 border-l border-gray-200 bg-gray-50/90 backdrop-blur-sm overflow-y-auto p-4">
      <GradingWorkspace
        module="speaking"
        deviationThreshold={state.config.standards.rubricDeviationThreshold}
        rubric={buildSpeakingRubric(state.config, state.speaking.rubric ?? OFFICIAL_SPEAKING_RUBRIC)}
        history={state.speaking.gradeHistory ?? []}
        submission={{
          title: 'Speaking transcript preview',
          text: [
            state.speaking.cueCardDetails?.topic || state.speaking.cueCard,
            '',
            ...(state.speaking.part3Discussion ?? []),
          ]
            .filter(Boolean)
            .join('\n'),
          timeSpentSeconds: state.config.sections.speaking.parts.reduce(
            (sum, part) => sum + part.speakingTime + part.prepTime,
            0,
          ),
        }}
        onSubmitGrade={onSubmitGrade}
      />
    </div>
  );
}

/**
 * BuilderRoot Route
 *
 * The route owns orchestration only; exam loading, save-draft orchestration,
 * and publish controls live in the route controller hook.
 */
export function BuilderRoot() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const {
    error,
    exam,
    isLoading,
    publishReadiness,
    state,
    versions,
    handleArchive,
    handleOpenScheduling,
    handlePublish,
    handleReturnToAdmin,
    handleSaveDraft,
    handleSchedulePublish,
    handleUnpublish,
    handleUpdateExamContent,
    reload,
  } = useBuilderRouteController(examId);
  const history = useUndoRedo<ExamState | null>(null, { initialLabel: 'Loaded exam' });
  const [initializedExamId, setInitializedExamId] = useState<string | undefined>(undefined);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isScoringOpen, setIsScoringOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('builder-sidebar-collapsed');
    return saved === 'true';
  });
  const [toasts, setToasts] = useState<GlobalToastItem[]>([]);
  const currentStateRef = useRef<ExamState | null>(null);

  useEffect(() => {
    if (examId !== initializedExamId) {
      setInitializedExamId(undefined);
    }
  }, [examId, initializedExamId]);

  useEffect(() => {
    localStorage.setItem('builder-sidebar-collapsed', isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (state && examId && initializedExamId !== examId) {
      history.reset(state, 'Loaded exam');
      currentStateRef.current = state;
      setInitializedExamId(examId);
    }
  }, [examId, history, initializedExamId, state]);

  const currentState = history.state ?? state;

  useEffect(() => {
    currentStateRef.current = currentState;
  }, [currentState]);

  const pushToast = (toast: Omit<GlobalToastItem, 'id'>) => {
    setToasts((current) => [
      ...current,
      {
        ...toast,
        id: `toast-${Date.now()}-${Math.random()}`,
      },
    ]);
  };

  const dismissToast = (id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const persistState = async (nextState: ExamState) => {
    try {
      await handleUpdateExamContent(nextState);
    } catch {
      pushToast({
        variant: 'error',
        title: 'Save failed',
        message: 'Latest change could not be saved.',
        actionLabel: 'Retry',
        onAction: () => {
          void persistState(nextState);
        },
      });
    }
  };

  const updateBuilderState = (
    nextState: ExamState | ((previous: ExamState) => ExamState),
    label = 'Updated exam',
  ) => {
    const baseState = currentStateRef.current;
    if (!baseState) {
      return;
    }

    const resolvedState = typeof nextState === 'function' ? nextState(baseState) : nextState;
    history.setState(resolvedState, label);
    currentStateRef.current = resolvedState;
    void persistState(resolvedState);
  };

  const handleUndo = () => {
    if (!history.canUndo || !history.undoState) {
      return;
    }

    history.undo();
    currentStateRef.current = history.undoState;
    void persistState(history.undoState);
    pushToast({
      variant: 'info',
      title: 'Undo',
      message: history.lastActionLabel,
      timestamp: nowLabel(),
    });
  };

  const handleRedo = () => {
    if (!history.canRedo || !history.redoState) {
      return;
    }

    history.redo();
    currentStateRef.current = history.redoState;
    void persistState(history.redoState);
    pushToast({
      variant: 'info',
      title: 'Redo',
      message: history.redoStackLabels[0] ?? 'Restored change',
      timestamp: nowLabel(),
    });
  };

  const saveDraftNow = async () => {
    const nextState = currentStateRef.current;
    if (!nextState) {
      return;
    }

    await handleSaveDraft(nextState);
    pushToast({
      variant: 'success',
      title: 'Saved',
      message: 'All changes saved.',
      timestamp: nowLabel(),
    });
  };

  const handleNavigateToConfig = () => {
    if (!examId) return;
    navigate(`/builder/${examId}`);
  };

  const handleNavigateToReview = () => {
    if (!examId) return;
    navigate(`/builder/${examId}/review`);
  };

  const duplicateActiveLocation = () => {
    const nextState = currentStateRef.current;
    if (!nextState) {
      return;
    }

    if (nextState.activeModule === 'reading') {
      const activePassage = nextState.reading.passages.find(
        (passage) => passage.id === nextState.activePassageId,
      );
      if (!activePassage) {
        return;
      }

      updateBuilderState(
        {
          ...nextState,
          reading: {
            ...nextState.reading,
            passages: [
              ...nextState.reading.passages,
              {
                ...activePassage,
                id: `p${Date.now()}`,
                title: `${activePassage.title} Copy`,
              },
            ],
          },
        },
        'Duplicate passage',
      );
      return;
    }

    if (nextState.activeModule === 'listening') {
      const activePart = nextState.listening.parts.find(
        (part) => part.id === nextState.activeListeningPartId,
      );
      if (!activePart) {
        return;
      }

      updateBuilderState(
        {
          ...nextState,
          listening: {
            ...nextState.listening,
            parts: [
              ...nextState.listening.parts,
              {
                ...activePart,
                id: `l${Date.now()}`,
                title: `${activePart.title} Copy`,
              },
            ],
          },
        },
        'Duplicate part',
      );
    }
  };

  const submitGrade = (entry: GradeHistoryEntry) => {
    const nextState = currentStateRef.current;
    if (!nextState) {
      return;
    }

    if (nextState.activeModule === 'writing') {
      updateBuilderState(
        {
          ...nextState,
          writing: {
            ...nextState.writing,
            gradeHistory: [...(nextState.writing.gradeHistory ?? []), entry],
          },
        },
        'Submit writing grade',
      );
    } else {
      updateBuilderState(
        {
          ...nextState,
          speaking: {
            ...nextState.speaking,
            gradeHistory: [...(nextState.speaking.gradeHistory ?? []), entry],
          },
        },
        'Submit speaking grade',
      );
    }

    pushToast({
      variant: 'success',
      title: 'Grade saved',
      message: `Band ${entry.finalBand.toFixed(1)} recorded.`,
      timestamp: nowLabel(),
    });
  };

  const commands = useMemo<CommandPaletteCommand[]>(() => {
    if (!currentState) {
      return [];
    }

    return [
      {
        id: 'nav-reading',
        title: 'Open Reading',
        subtitle: 'Jump to reading builder',
        category: 'Navigation',
        keywords: ['reading', 'module'],
        perform: () => updateBuilderState({ ...currentState, activeModule: 'reading' }, 'Open reading'),
      },
      {
        id: 'nav-listening',
        title: 'Open Listening',
        subtitle: 'Jump to listening builder',
        category: 'Navigation',
        keywords: ['listening', 'module'],
        perform: () => updateBuilderState({ ...currentState, activeModule: 'listening' }, 'Open listening'),
      },
      {
        id: 'nav-writing',
        title: 'Open Writing',
        subtitle: 'Jump to writing builder',
        category: 'Navigation',
        keywords: ['writing', 'module'],
        perform: () => updateBuilderState({ ...currentState, activeModule: 'writing' }, 'Open writing'),
      },
      {
        id: 'nav-speaking',
        title: 'Open Speaking',
        subtitle: 'Jump to speaking builder',
        category: 'Navigation',
        keywords: ['speaking', 'module'],
        perform: () => updateBuilderState({ ...currentState, activeModule: 'speaking' }, 'Open speaking'),
      },
      {
        id: 'save',
        title: 'Save Exam',
        subtitle: 'Persist latest builder state',
        category: 'Actions',
        keywords: ['save', 'draft'],
        perform: () => {
          void saveDraftNow();
        },
      },
      {
        id: 'undo',
        title: 'Undo',
        subtitle:
          (history.undoStackLabels[history.undoStackLabels.length - 1] ?? 'No previous action'),
        category: 'Actions',
        keywords: ['undo', 'history'],
        perform: handleUndo,
      },
      {
        id: 'redo',
        title: 'Redo',
        subtitle: (history.redoStackLabels[0] ?? 'No next action'),
        category: 'Actions',
        keywords: ['redo', 'history'],
        perform: handleRedo,
      },
      {
        id: 'toggle-scoring',
        title: isScoringOpen ? 'Hide Scoring Panel' : 'Open Scoring Panel',
        subtitle: 'Show scoring, rubrics, and grader preview',
        category: 'Tools',
        keywords: ['grading', 'rubric', 'score'],
        perform: () => setIsScoringOpen((open) => !open),
      },
      {
        id: 'add-block',
        title: 'Add Question Block',
        subtitle: 'Open question block picker',
        category: 'Tools',
        keywords: ['question', 'block', 'new'],
        perform: () => window.dispatchEvent(new Event('builder:add-question-block')),
      },
    ];
  }, [
    currentState,
    handleRedo,
    history.redoStackLabels,
    history.undoStackLabels,
    isScoringOpen,
  ]);

  useKeyboardShortcuts([
    {
      combo: 'mod+s',
      enabled: !!currentState,
      handler: () => {
        void saveDraftNow();
      },
    },
    {
      combo: 'mod+z',
      enabled: !!currentState,
      handler: handleUndo,
    },
    {
      combo: 'mod+shift+z',
      enabled: !!currentState,
      handler: handleRedo,
    },
    {
      combo: 'mod+k',
      enabled: !!currentState,
      handler: () => setIsPaletteOpen(true),
    },
    {
      combo: 'mod+f',
      enabled: !!currentState,
      handler: () => setIsPaletteOpen(true),
    },
    {
      combo: 'mod+n',
      enabled: !!currentState,
      handler: () => window.dispatchEvent(new Event('builder:add-question-block')),
    },
    {
      combo: 'mod+d',
      enabled: !!currentState,
      handler: duplicateActiveLocation,
    },
  ]);

  if (isLoading) {
    return <LoadingSurface label="Loading Exam..." />;
  }

  if (error) {
    return (
      <ErrorSurface
        title="Loading Error"
        description={error}
        actionLabel="Retry"
        onAction={() => {
          void reload();
        }}
      />
    );
  }

  if (!currentState) {
    return (
      <ErrorSurface
        title="Exam Not Found"
        description="The requested exam could not be loaded."
        actionLabel="Return to Admin"
        onAction={handleReturnToAdmin}
      />
    );
  }

  return (
    <div className="flex h-screen w-full bg-gray-50 text-gray-900 font-sans overflow-hidden">
      <div className={`flex-shrink-0 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'w-0 overflow-hidden' : 'w-56'}`}>
        <Sidebar state={currentState} setState={(next) => updateBuilderState(next, 'Update navigation')} />
      </div>
      <button
        onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all duration-200 rounded-r-md p-1 group"
        style={{ left: isSidebarCollapsed ? '0' : '14rem' }}
        aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isSidebarCollapsed ? (
          <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
        ) : (
          <ChevronLeft size={16} className="text-gray-600 group-hover:text-blue-600 transition-colors" />
        )}
      </button>
      <div className="flex flex-col flex-1 min-w-0">
        <Header
          state={currentState}
          onUpdateState={(next) => updateBuilderState(next, 'Update exam header')}
          onReturnToAdmin={handleReturnToAdmin}
          onNavigateToConfig={handleNavigateToConfig}
          onNavigateToReview={handleNavigateToReview}
          onSaveDraft={() => {
            void saveDraftNow();
          }}
          saveStatusLabel="All changes saved"
        />
        <div className="flex flex-1 min-w-0 overflow-hidden">
          <Workspace state={currentState} setState={(next) => updateBuilderState(next, 'Update workspace')} />
          {isScoringOpen && (
            <ScoringAside
              state={currentState}
              onUpdateState={(next) => updateBuilderState(next, 'Update scoring')}
              onSubmitGrade={submitGrade}
            />
          )}
        </div>
      </div>

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        commands={commands}
        recentActions={history.undoStackLabels}
      />
      <GlobalToast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
