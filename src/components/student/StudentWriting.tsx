import React, { useCallback, useState, useEffect, useRef } from 'react';
import { ExamState } from '../../types';
import { Check, X } from 'lucide-react';
import { getWritingTaskContent } from '../../utils/writingTaskUtils';
import { saveStudentAuditEvent } from '@student/application/studentAttemptFacade';
import { getImageUrlCandidates } from '../../utils/imageUrl';
import { useOptionalStudentAttempt } from './providers/StudentAttemptProvider';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import { useSplitPaneResize } from './useSplitPaneResize';
import { registerAnswerUndoRedoGuard } from './answerUndoRedoGuard';
import { StudentSplitPaneResizer } from './StudentSplitPaneResizer';
import { RichTextHighlighter } from './RichTextHighlighter';
import type { StudentHighlightColor } from './highlightPalette';
import type { StudentLayoutMode } from './layout/studentLayoutMode';

interface StudentWritingProps {
  state: ExamState;
  writingAnswers: Record<string, string>;
  onWritingChange: (taskId: string, text: string) => void;
  onSubmit: () => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  timeRemaining?: number | undefined;
  onTimeExpired?: (() => void) | undefined;
  registerDraftCommit?: ((commitDraft: (() => void) | null) => void) | undefined;
  security?: {
    preventAutofill: boolean;
    preventAutocorrect: boolean;
  } | undefined;
  sessionId?: string | undefined;
  studentId?: string | undefined;
  showSubmitButton?: boolean | undefined;
  tabletMode?: boolean | undefined;
  layoutMode?: StudentLayoutMode | undefined;
  registerLiveWritingAnswer?: ((taskId: string, text: string) => void) | undefined;
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
}

const WRITING_DRAFT_COMMIT_DEBOUNCE_MS = 300;

type WritingPane = 'prompt' | 'response';

type WritingDraftPreview = {
  taskId: string;
  text: string;
};

function normalizeWritingPlainText(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function readEditorPlainText(editor: HTMLTextAreaElement): string {
  const raw = editor.value ?? '';
  return normalizeWritingPlainText(raw);
}

function writeEditorPlainText(editor: HTMLTextAreaElement, value: string): void {
  const normalized = normalizeWritingPlainText(value);
  if ((editor.value ?? '') !== normalized) {
    editor.value = normalized;
  }
}

function canonicalizeWritingTaskId(taskId: string): string {
  return taskId.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveWritingTaskId(taskIds: string[], candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  if (taskIds.includes(trimmed)) {
    return trimmed;
  }

  const canonicalCandidate = canonicalizeWritingTaskId(trimmed);
  const matched = taskIds.find((taskId) => canonicalizeWritingTaskId(taskId) === canonicalCandidate);
  return matched ?? null;
}

function readWritingAnswerByTaskId(
  writingAnswers: Record<string, string>,
  taskId: string,
): string {
  const exact = writingAnswers[taskId];
  if (typeof exact === 'string') {
    return exact;
  }

  const canonicalTaskId = canonicalizeWritingTaskId(taskId);
  if (!canonicalTaskId) {
    return '';
  }

  for (const [candidateTaskId, value] of Object.entries(writingAnswers)) {
    if (canonicalizeWritingTaskId(candidateTaskId) === canonicalTaskId && typeof value === 'string') {
      return value;
    }
  }

  return '';
}
export function StudentWriting({
  state,
  writingAnswers,
  onWritingChange,
  onSubmit,
  currentQuestionId,
  onNavigate,
  timeRemaining,
  onTimeExpired,
  registerDraftCommit,
  security = { preventAutofill: false, preventAutocorrect: false },
  sessionId,
  studentId,
  showSubmitButton = true,
  tabletMode = false,
  layoutMode = 'wide',
  registerLiveWritingAnswer,
  highlightEnabled = false,
  highlightColor,
  highlightClassName,
}: StudentWritingProps) {
  const isTabletMode = Boolean(tabletMode);
  const isCompactLayout = layoutMode === 'compact';
  const attemptContext = useOptionalStudentAttempt();
  const resolvedSessionId = sessionId ?? attemptContext?.state.attempt?.scheduleId;
  const resolvedStudentId = studentId ?? attemptContext?.state.attemptId ?? undefined;
  const writingConfig = state.config.sections.writing;
  const configuredTaskIds = writingConfig.tasks.map((task) => task.id);
  const resolvedCurrentQuestionTaskId =
    resolveWritingTaskId(configuredTaskIds, currentQuestionId);
  const [activeTaskId, setActiveTaskId] = useState<string>(
    resolvedCurrentQuestionTaskId ?? configuredTaskIds[0] ?? 'task1',
  );
  const [draftPreview, setDraftPreview] = useState<WritingDraftPreview>(() => {
    const initialTaskId = resolvedCurrentQuestionTaskId ?? configuredTaskIds[0] ?? 'task1';
    return {
      taskId: initialTaskId,
      text: readWritingAnswerByTaskId(writingAnswers, initialTaskId),
    };
  });
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lastKeydownRef = useRef<number>(0);
  const previousValueRef = useRef<string>('');
  const lastCommittedDraftByTaskRef = useRef<Record<string, string>>({});
  const deferredBlurCommitTimerRef = useRef<number | null>(null);
  const draftCommitTimerRef = useRef<number | null>(null);
  const liveDraftsByTaskRef = useRef<Record<string, string>>({});
  const editorHasFocusRef = useRef(false);
  const commitEditorDraftRef = useRef<() => void>(() => undefined);
  const previousResolvedTaskIdRef = useRef<string | null>(resolvedCurrentQuestionTaskId);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [activeCompactPane, setActiveCompactPane] = useState<WritingPane>('prompt');
  const lastFocusedPaneRef = useRef<WritingPane>('prompt');
  const previousCompactLayoutRef = useRef(isCompactLayout);
  const promptPaneRef = useRef<HTMLDivElement>(null);
  const promptScrollTopRef = useRef(0);
  const responseScrollTopRef = useRef(0);
  const { handleDrag, handleKeyboardResize, leftWidth, splitPaneStyle, workspaceRef } = useSplitPaneResize({
    isTabletMode,
    materialPaneWidthProperty: '--writing-prompt-pane-width',
    answerPaneWidthProperty: '--writing-editor-pane-width',
    defaultLeftWidth: 50,
    dividerMode: isTabletMode ? 'overlay' : 'consumes-space',
  });

  const currentTask = writingConfig.tasks.find((t) => t.id === activeTaskId) || writingConfig.tasks[0];
  const readLiveDraftForTask = useCallback(
    (taskId: string) => {
      const liveDraft = liveDraftsByTaskRef.current[taskId];
      return typeof liveDraft === 'string'
        ? liveDraft
        : readWritingAnswerByTaskId(writingAnswers, taskId);
    },
    [writingAnswers],
  );

  const currentText = readLiveDraftForTask(activeTaskId);
  const previewText =
    draftPreview.taskId === activeTaskId ? draftPreview.text : currentText;
  const showEditorPlaceholder = !isEditorFocused && previewText.trim().length === 0;

  const clearScheduledDraftCommit = useCallback(() => {
    if (draftCommitTimerRef.current !== null) {
      window.clearTimeout(draftCommitTimerRef.current);
      draftCommitTimerRef.current = null;
    }
  }, []);

  const commitDraftText = useCallback(
    (taskId: string, rawText: string, options?: { flushDurability?: boolean }) => {
      const normalizedText = normalizeWritingPlainText(rawText);
      const previous = lastCommittedDraftByTaskRef.current[taskId] ?? '';
      liveDraftsByTaskRef.current = {
        ...liveDraftsByTaskRef.current,
        [taskId]: normalizedText,
      };
      if (normalizedText !== previous) {
        onWritingChange(taskId, normalizedText);
        lastCommittedDraftByTaskRef.current[taskId] = normalizedText;
      }
      setDraftPreview((current) =>
        current.taskId === taskId && current.text === normalizedText
          ? current
          : { taskId, text: normalizedText },
      );
      registerLiveWritingAnswer?.(taskId, normalizedText);
      if (options?.flushDurability !== false) {
        attemptContext?.actions.flushAnswerDurabilityNow?.();
      }
      return normalizedText;
    },
    [attemptContext, onWritingChange, registerLiveWritingAnswer],
  );

  const scheduleDraftCommit = useCallback(
    (taskId: string, text: string) => {
      clearScheduledDraftCommit();
      draftCommitTimerRef.current = window.setTimeout(() => {
        draftCommitTimerRef.current = null;
        commitDraftText(taskId, text, { flushDurability: false });
      }, WRITING_DRAFT_COMMIT_DEBOUNCE_MS);
    },
    [clearScheduledDraftCommit, commitDraftText],
  );

  const commitEditorDraft = useCallback(() => {
    const editor = editorRef.current;
    clearScheduledDraftCommit();
    const committed = commitDraftText(
      activeTaskId,
      editor ? readEditorPlainText(editor) : readLiveDraftForTask(activeTaskId),
    );
    if (editor) {
      writeEditorPlainText(editor, committed);
    }
  }, [activeTaskId, clearScheduledDraftCommit, commitDraftText, readLiveDraftForTask]);
  const selectCompactPane = useCallback(
    (nextPane: WritingPane) => {
      if (nextPane === activeCompactPane) {
        lastFocusedPaneRef.current = nextPane;
        return;
      }

      lastFocusedPaneRef.current = nextPane;
      if (activeCompactPane === 'prompt') {
        promptScrollTopRef.current = promptPaneRef.current?.scrollTop ?? 0;
      } else {
        responseScrollTopRef.current = editorRef.current?.scrollTop ?? 0;
      }

      commitEditorDraft();
      setActiveCompactPane(nextPane);
    },
    [activeCompactPane, commitEditorDraft],
  );

  useEffect(() => {
    if (isCompactLayout && !previousCompactLayoutRef.current) {
      setActiveCompactPane(lastFocusedPaneRef.current);
    }
    previousCompactLayoutRef.current = isCompactLayout;
  }, [isCompactLayout]);

  useEffect(() => {
    if (!isCompactLayout) {
      return;
    }

    if (activeCompactPane === 'prompt') {
      if (promptPaneRef.current) {
        promptPaneRef.current.scrollTop = promptScrollTopRef.current;
      }
      return;
    }

    if (editorRef.current) {
      editorRef.current.scrollTop = responseScrollTopRef.current;
    }
  }, [activeCompactPane, isCompactLayout]);

  useEffect(() => {
    commitEditorDraftRef.current = commitEditorDraft;
  }, [commitEditorDraft]);

  useEffect(() => {
    if (!registerDraftCommit) {
      return;
    }

    const commitLatestEditorDraft = () => {
      commitEditorDraftRef.current();
    };

    registerDraftCommit(commitLatestEditorDraft);
    return () => {
      commitLatestEditorDraft();
      registerDraftCommit(null);
    };
  }, [registerDraftCommit]);

  useEffect(() => {
    const previousResolvedTaskId = previousResolvedTaskIdRef.current;
    previousResolvedTaskIdRef.current = resolvedCurrentQuestionTaskId;

    if (
      resolvedCurrentQuestionTaskId &&
      resolvedCurrentQuestionTaskId !== activeTaskId &&
      previousResolvedTaskId !== resolvedCurrentQuestionTaskId
    ) {
      commitEditorDraftRef.current();
      setActiveTaskId(resolvedCurrentQuestionTaskId);
    }
  }, [activeTaskId, resolvedCurrentQuestionTaskId]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editorHasFocusRef.current) return;
    writeEditorPlainText(editor, currentText);
    previousValueRef.current = readEditorPlainText(editor);
    if (typeof liveDraftsByTaskRef.current[activeTaskId] !== 'string') {
      lastCommittedDraftByTaskRef.current[activeTaskId] = readEditorPlainText(editor);
      setDraftPreview({ taskId: activeTaskId, text: currentText });
    }
  }, [activeTaskId, currentText]);

  useEffect(() => {
    return () => {
      if (deferredBlurCommitTimerRef.current !== null) {
        window.clearTimeout(deferredBlurCommitTimerRef.current);
        deferredBlurCommitTimerRef.current = null;
      }
      clearScheduledDraftCommit();
    };
  }, [clearScheduledDraftCommit]);

  useEffect(() => {
    if (timeRemaining === 0) {
      onTimeExpired?.();
    }
  }, [timeRemaining, onTimeExpired]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') {
        return;
      }

      commitEditorDraft();
    };

    const handlePageHide = () => {
      commitEditorDraft();
    };

    const handleBeforeUnload = () => {
      commitEditorDraft();
    };

    const handleFreeze = () => {
      commitEditorDraft();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('freeze', handleFreeze as EventListener);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('freeze', handleFreeze as EventListener);
    };
  }, [commitEditorDraft]);

  // Add input protection event listeners to the editor
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const handleBeforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertReplacementText') {
        saveStudentAuditEvent(
          resolvedSessionId,
          'AUTOFILL_SUSPECTED',
          {
            inputType: event.inputType,
            data: event.data,
            target: 'writing-editor',
          },
          resolvedStudentId,
        );
      }
    };

    const handleInput = (event: Event) => {
      const target = event.currentTarget as HTMLTextAreaElement | null;
      const newValue = target ? readEditorPlainText(target) : '';
      const previousValue = previousValueRef.current;
      
      const textLength = newValue.length;
      const previousTextLength = previousValue.length;
      const textChange = Math.abs(textLength - previousTextLength);
      const timeSinceKeydown = Date.now() - lastKeydownRef.current;
      
      if (textChange > 50 && timeSinceKeydown > 500) {
        saveStudentAuditEvent(
          resolvedSessionId,
          'REPLACEMENT_SUSPECTED',
          {
            previousLength: previousTextLength,
            newLength: textLength,
            timeSinceKeydown,
            target: 'writing-editor',
          },
          resolvedStudentId,
        );
      }
      
      previousValueRef.current = newValue;
    };

    const handleKeydown = () => {
      lastKeydownRef.current = Date.now();
    };

    const releaseUndoRedoGuard = registerAnswerUndoRedoGuard({
      element: editor,
      readLatestSnapshot: () => readEditorPlainText(editor),
      restoreLatestSnapshot: (snapshot) => {
        writeEditorPlainText(editor, snapshot);
        previousValueRef.current = snapshot;
        commitDraftText(activeTaskId, snapshot, { flushDurability: false });
      },
      flushPersist: () => {
        attemptContext?.actions.flushAnswerDurabilityNow?.();
      },
      onBlocked: (signal) => {
        saveStudentAuditEvent(
          resolvedSessionId,
          signal.kind === 'undo' ? 'UNDO_BLOCKED' : 'REDO_BLOCKED',
          {
            surface: 'writing',
            targetName: 'writing-editor',
            via: signal.via,
            cancelable: signal.cancelable,
          },
          resolvedStudentId,
        );
      },
      onRestored: (signal) => {
        saveStudentAuditEvent(
          resolvedSessionId,
          signal.kind === 'undo' ? 'UNDO_RESTORED' : 'REDO_RESTORED',
          {
            surface: 'writing',
            targetName: 'writing-editor',
            via: signal.via,
            cancelable: signal.cancelable,
          },
          resolvedStudentId,
        );
      },
    });

    editor.addEventListener('beforeinput', handleBeforeInput);
    editor.addEventListener('input', handleInput);
    editor.addEventListener('keydown', handleKeydown);

    return () => {
      editor.removeEventListener('beforeinput', handleBeforeInput);
      editor.removeEventListener('input', handleInput);
      editor.removeEventListener('keydown', handleKeydown);
      releaseUndoRedoGuard();
    };
  }, [activeTaskId, attemptContext, commitDraftText, resolvedSessionId, resolvedStudentId]);

  if (!currentTask) {
    return null;
  }

  const currentTaskContent = getWritingTaskContent(state.writing, writingConfig.tasks, currentTask.id);
  const currentPrompt = currentTaskContent?.prompt ?? '';
  const currentPromptContainsMarkup = /<[^>]+>/.test(currentPrompt);
  const minWords = currentTask.minWords || 150;
  const currentChart = currentTaskContent?.chart;

  const wordCount = previewText.trim() === '' ? 0 : previewText.trim().split(/\s+/).length;

  const isWordCountMet = wordCount >= minWords;
  const isWordCountWarning = wordCount > 0 && wordCount < minWords && wordCount >= minWords * 0.9;

  // Word count guidance
  const optimalMin = currentTask.optimalMin || Math.ceil(minWords * 1.1);
  const optimalMax = currentTask.optimalMax || Math.ceil(minWords * 1.5);
  const isOptimal = wordCount >= optimalMin && wordCount <= optimalMax;
  const isOverLength = currentTask.maxWords && wordCount > currentTask.maxWords;
  const resolvedTimeRemaining = timeRemaining ?? writingConfig.duration * 60;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const totalTime = writingConfig.duration * 60;
  const progressPercent = Math.max(0, Math.min(100, ((totalTime - resolvedTimeRemaining) / totalTime) * 100));

  const isTimeCritical = resolvedTimeRemaining <= 300;
  const isTimeWarning = resolvedTimeRemaining <= 600;

  const handleEditorInput = () => {
    if (editorRef.current) {
      const textContent = readEditorPlainText(editorRef.current);
      liveDraftsByTaskRef.current = {
        ...liveDraftsByTaskRef.current,
        [activeTaskId]: textContent,
      };
      registerLiveWritingAnswer?.(activeTaskId, textContent);
      setDraftPreview((current) =>
        current.taskId === activeTaskId && current.text === textContent
          ? current
          : { taskId: activeTaskId, text: textContent },
      );
      scheduleDraftCommit(activeTaskId, textContent);
    }
  };

  const blockWritingEditorInteraction = (
    event:
      | React.ClipboardEvent<HTMLTextAreaElement>
      | React.DragEvent<HTMLTextAreaElement>
      | React.MouseEvent<HTMLTextAreaElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'paste') {
      saveStudentAuditEvent(
        resolvedSessionId,
        'PASTE_BLOCKED',
        {
          targetName: event.currentTarget.tagName,
          targetType: 'writing-editor',
          isContentEditable: Boolean(event.currentTarget.isContentEditable),
        },
        resolvedStudentId,
      );
    }
  };

  const blockMediaSaveInteraction = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleSubmitClick = () => {
    commitEditorDraft();
    setShowReviewModal(true);
  };

  const handleConfirmSubmit = () => {
    commitEditorDraft();
    setShowReviewModal(false);
    onSubmit();
  };

  const handleCancelSubmit = () => {
    setShowReviewModal(false);
  };

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-t border-gray-300"
        ref={workspaceRef}
        style={splitPaneStyle}
        data-testid="writing-split-workspace"
      >
        {isCompactLayout ? (
          <div className="student-compact-pane-tabs flex flex-shrink-0 gap-2 border-b border-gray-200 bg-gray-50 p-2">
            <button
              type="button"
              className="student-touch-target flex-1 rounded-sm border border-gray-300 px-3 text-sm font-semibold text-gray-900"
              aria-pressed={activeCompactPane === 'prompt'}
              onClick={() => selectCompactPane('prompt')}
            >
              Show prompt
            </button>
            <button
              type="button"
              className="student-touch-target flex-1 rounded-sm border border-gray-300 px-3 text-sm font-semibold text-gray-900"
              aria-pressed={activeCompactPane === 'response'}
              onClick={() => selectCompactPane('response')}
            >
              Show response
            </button>
          </div>
        ) : null}
        <div
          className={`relative flex min-h-0 flex-1 overflow-hidden ${
            isTabletMode ? 'flex-row' : 'flex-col md:flex-row'
          }`}
        >
        {!isCompactLayout || activeCompactPane === 'prompt' ? (
          <div
            className={`h-full flex flex-col relative ${
              isTabletMode
                ? 'w-[var(--writing-prompt-pane-width)] min-w-[48px] border-r border-gray-200'
                : 'min-w-[260px] md:min-w-[280px] lg:w-[var(--writing-prompt-pane-width)] lg:min-w-[300px]'
            }`}
            onFocusCapture={() => {
              lastFocusedPaneRef.current = 'prompt';
            }}
          >
          {/* Timer Bar */}
          <div className={`h-1.5 flex-shrink-0 transition-all ${isTimeCritical ? 'bg-red-600' : isTimeWarning ? 'bg-amber-700' : 'bg-blue-800'}`} style={{ width: `${progressPercent}%` }} />

          <div
            ref={promptPaneRef}
            data-student-zoom-scroll
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{
              fontSize: 'var(--student-passage-font-size)',
              lineHeight: 'var(--student-passage-line-height)',
            }}
          >
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <h2 className="font-bold" style={{ fontSize: 'var(--student-passage-title-font-size)' }}>
                {currentTask.label}
              </h2>
              <div className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest ${
                isTimeCritical
                  ? 'bg-red-100 text-red-700 animate-pulse'
                  : isTimeWarning
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-blue-700'
              }`}>
                {formatTime(resolvedTimeRemaining)}
              </div>
            </div>
            {currentChart && (
              <div
                className="mb-5 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm"
                onContextMenu={blockMediaSaveInteraction}
                onDragStart={blockMediaSaveInteraction}
                onDrop={blockMediaSaveInteraction}
              >
                <p className="text-[length:var(--student-meta-font-size)] font-black text-gray-400 uppercase tracking-[0.22em] mb-3">
                  Stimulus Chart
                </p>
                {currentChart.imageSrc ? (
                  <StudentZoomableMedia
                    sources={getImageUrlCandidates(currentChart.imageSrc)}
                    alt={currentChart.title}
                    label={currentChart.title}
                    hint="Tap to zoom the chart"
                    className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                  />
                ) : (
                  <div className="flex items-end gap-3 h-44">
                    {currentChart.values.map((value, index) => (
                      <div key={`${currentChart.labels[index]}-${value}`} className="flex-1 text-center">
                        <div className="mx-auto rounded-t-2xl bg-blue-500" style={{ height: `${Math.max(16, value * 12)}px` }} />
                        <p className="text-[length:var(--student-meta-font-size)] font-semibold text-gray-500 mt-2">
                          {currentChart.labels[index]}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            <div
              data-testid="writing-task-prompt"
              className="student-stimulus-content max-w-none text-gray-900 whitespace-break-spaces break-words [overflow-wrap:anywhere]"
            >
              <RichTextHighlighter
                key={currentTask.id}
                content={currentPrompt}
                contentType={currentPromptContainsMarkup ? 'html' : 'text'}
                enabled={highlightEnabled}
                highlightColor={highlightColor}
                highlightClassName={highlightClassName}
                highlightSurfaceId={`writing:prompt:${currentTask.id}`}
              />
            </div>
          </div>
          </div>
        ) : null}
        {!isCompactLayout ? (
          <StudentSplitPaneResizer
            isTabletMode={isTabletMode}
            leftWidth={leftWidth}
            onDividerPointerDown={handleDrag}
            onDividerKeyDown={handleKeyboardResize}
            ariaLabel="Resize writing prompt and answer panels"
            testId="writing-pane-resizer"
          />
        ) : null}

        {!isCompactLayout || activeCompactPane === 'response' ? (
          <div
            className={`h-full flex flex-col relative ${
              isTabletMode
                ? 'w-[var(--writing-editor-pane-width)] min-w-[48px]'
                : 'min-w-[280px] md:min-w-[320px] lg:w-[var(--writing-editor-pane-width)]'
            }`}
            onFocusCapture={() => {
              lastFocusedPaneRef.current = 'response';
            }}
        >
          <div className="flex-1 overflow-hidden flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 animate-in slide-in-from-right-4 duration-300">
            <div className="relative flex flex-1 min-h-0 w-full flex-col">
              <div
                className={`flex flex-col gap-2 border-b border-gray-200 bg-gray-50 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-600 sm:flex-row sm:items-center sm:justify-between ${
                  isTabletMode ? 'pl-8 pr-3' : 'px-3'
                }`}
              >
                <span>Writing Response</span>
                <div className="flex items-center gap-2" aria-label="Current word count">
                  <span className="text-[length:var(--student-meta-font-size)] font-bold text-gray-400 uppercase tracking-widest">
                    Word Count
                  </span>
                  <span className={`text-lg font-black leading-none ${
                    isOptimal ? 'text-green-800' :
                    isOverLength ? 'text-red-800' :
                    isWordCountMet ? 'text-blue-800' :
                    isWordCountWarning ? 'text-amber-950' : 'text-gray-900'
                  }`}>
                    {wordCount}
                  </span>
                </div>
              </div>
              {showEditorPlaceholder && (
                  <div
                    className={`pointer-events-none absolute top-14 md:top-16 lg:top-20 text-base md:text-lg leading-relaxed text-gray-400 font-serif select-none ${
                      isTabletMode ? 'left-8 md:left-8 lg:left-8' : 'left-4 md:left-6 lg:left-8'
                    }`}
                  >
                    Write your answer here…
                  </div>
              )}
              <textarea
                ref={editorRef}
                defaultValue={currentText}
                onChange={handleEditorInput}
                onCompositionEnd={() => {
                  if (editorRef.current) {
                    clearScheduledDraftCommit();
                    commitDraftText(activeTaskId, readEditorPlainText(editorRef.current));
                  }
                }}
                aria-label="Writing response"
                  onFocus={() => {
                    editorHasFocusRef.current = true;
                    setIsEditorFocused(true);
                  }}
                  onBlur={() => {
                    editorHasFocusRef.current = false;
                    setIsEditorFocused(false);
                    if (editorRef.current) {
                      clearScheduledDraftCommit();
                      const committed = commitDraftText(activeTaskId, readEditorPlainText(editorRef.current));
                      writeEditorPlainText(editorRef.current, committed);
                    }
                  }}
                  onPaste={blockWritingEditorInteraction}
                  onCopy={blockWritingEditorInteraction}
                  onCut={blockWritingEditorInteraction}
                  onDrop={blockWritingEditorInteraction}
                  onContextMenu={blockWritingEditorInteraction}
                className={`flex-1 w-full text-base md:text-lg leading-relaxed text-gray-800 font-serif overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                  isTabletMode
                    ? 'pt-4 pr-4 pb-4 pl-8 md:pt-6 md:pr-6 md:pb-6 md:pl-8 lg:pt-8 lg:pr-8 lg:pb-8 lg:pl-8'
                    : 'p-4 md:p-6 lg:p-8'
                } h-full min-h-0 resize-none whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}
                data-student-zoom-scroll
                spellCheck={!security.preventAutocorrect}
                autoCorrect={security.preventAutocorrect ? 'off' : 'on'}
                autoCapitalize={security.preventAutocorrect ? 'off' : 'on'}
              />
              </div>
	          </div>

          </div>
        ) : null}
        </div>
      </div>

      <footer
        className="student-exam-footer flex"
        role="contentinfo"
        aria-label="Writing task navigation and submission"
      >
        <div
          className="flex w-full items-center gap-2 overflow-x-auto overscroll-x-contain px-2 py-2 md:gap-3 md:px-3 md:py-2.5 lg:px-4"
          data-testid="student-writing-footer-row"
        >
          {writingConfig.tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => {
                commitEditorDraft();
                setActiveTaskId(task.id);
                onNavigate(task.id);
              }}
              className={`min-w-[5rem] md:min-w-[5.75rem] px-3 md:px-4 py-1.5 md:py-2 rounded-sm text-[length:var(--student-control-font-size)] font-bold transition-all flex-shrink-0 ${
                activeTaskId === task.id
                  ? 'bg-blue-800 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {task.label}
            </button>
          ))}
          {showSubmitButton ? (
            <button
              onClick={handleSubmitClick}
              className="min-w-[8.25rem] md:min-w-[9.5rem] px-4 md:px-6 py-1.5 md:py-2 bg-blue-800 hover:bg-blue-700 text-white rounded-sm text-[length:var(--student-control-font-size)] font-bold transition-colors shadow-md flex-shrink-0"
            >
              Review & Submit
            </button>
          ) : null}
        </div>
      </footer>

      {/* Submission Review Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Review Your Responses</h2>
              <p className="text-sm text-gray-500 mt-1">Please review your answers before submitting.</p>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {writingConfig.tasks.map((task) => {
                const text = readWritingAnswerByTaskId(writingAnswers, task.id);
                const hasResponse = text.length > 0;

                return (
                  <div key={task.id} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-gray-900">{task.label}</h3>
                    </div>
                    <div className="text-sm text-gray-600 max-h-32 overflow-y-auto bg-gray-50 rounded-lg p-3">
                      {hasResponse ? (
                        <pre className="m-0 whitespace-pre-wrap font-sans">{text}</pre>
                      ) : (
                        <span className="text-gray-400 italic">No response written</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50">
              <div className="flex gap-3">
                <button
                  onClick={handleCancelSubmit}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
                >
                  <X size={16} />
                  Continue Writing
                </button>
                <button
                  onClick={handleConfirmSubmit}
                  className="flex-1 px-4 py-3 bg-blue-800 hover:bg-blue-700 rounded-xl text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
                >
                  <Check size={16} />
                  Confirm Submission
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
