import React, { useCallback, useState, useEffect, useRef } from 'react';
import { ExamState } from '../../types';
import { ArrowLeftRight, Check, X } from 'lucide-react';
import { getWritingTaskContent } from '../../utils/writingTaskUtils';
import { saveStudentAuditEvent } from '../../services/studentAuditService';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { getImageUrlCandidates } from '../../utils/imageUrl';
import { useOptionalStudentAttempt } from './providers/StudentAttemptProvider';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import { useSplitPaneResize } from './useSplitPaneResize';
import { registerAnswerUndoRedoGuard } from './answerUndoRedoGuard';

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
  registerLiveWritingAnswer?: ((taskId: string, text: string) => void) | undefined;
}

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
  registerLiveWritingAnswer,
}: StudentWritingProps) {
  const isTabletMode = Boolean(tabletMode);
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
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [localDraftsByTask, setLocalDraftsByTask] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lastKeydownRef = useRef<number>(0);
  const previousValueRef = useRef<string>('');
  const lastCommittedDraftByTaskRef = useRef<Record<string, string>>({});
  const deferredBlurCommitTimerRef = useRef<number | null>(null);
  const editorHasFocusRef = useRef(false);
  const commitEditorDraftRef = useRef<() => void>(() => undefined);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const { handleDrag, leftWidth, splitPaneStyle, workspaceRef } = useSplitPaneResize({
    isTabletMode,
    materialPaneWidthProperty: '--writing-prompt-pane-width',
    answerPaneWidthProperty: '--writing-editor-pane-width',
    defaultLeftWidth: 50,
    dividerMode: isTabletMode ? 'overlay' : 'consumes-space',
  });

  const currentTask = writingConfig.tasks.find((t) => t.id === activeTaskId) || writingConfig.tasks[0];
  const externalCurrentText = readWritingAnswerByTaskId(writingAnswers, activeTaskId);
  const currentText = localDraftsByTask[activeTaskId] ?? externalCurrentText;
  const showEditorPlaceholder = !isEditorFocused && currentText.trim().length === 0;

  const commitDraftText = useCallback(
    (taskId: string, rawText: string, options?: { flushDurability?: boolean }) => {
      const normalizedText = normalizeWritingPlainText(rawText);
      const previous = lastCommittedDraftByTaskRef.current[taskId] ?? '';
      if (normalizedText !== previous) {
        onWritingChange(taskId, normalizedText);
        lastCommittedDraftByTaskRef.current[taskId] = normalizedText;
      }
      setLocalDraftsByTask((current) => (
        current[taskId] === normalizedText
          ? current
          : { ...current, [taskId]: normalizedText }
      ));
      registerLiveWritingAnswer?.(taskId, normalizedText);
      if (options?.flushDurability !== false) {
        attemptContext?.actions.flushAnswerDurabilityNow?.();
      }
      return normalizedText;
    },
    [attemptContext, onWritingChange, registerLiveWritingAnswer],
  );

  const commitEditorDraft = useCallback(() => {
    if (!editorRef.current) {
      return;
    }

    const committed = commitDraftText(activeTaskId, readEditorPlainText(editorRef.current));
    writeEditorPlainText(editorRef.current, committed);
  }, [activeTaskId, commitDraftText]);

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
    if (
      resolvedCurrentQuestionTaskId &&
      resolvedCurrentQuestionTaskId !== activeTaskId
    ) {
      setActiveTaskId(resolvedCurrentQuestionTaskId);
    }
  }, [activeTaskId, resolvedCurrentQuestionTaskId]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editorHasFocusRef.current) return;
    if (currentText !== readEditorPlainText(editor)) {
      writeEditorPlainText(editor, currentText);
      previousValueRef.current = readEditorPlainText(editor);
    }
    lastCommittedDraftByTaskRef.current[activeTaskId] = readEditorPlainText(editor);
  }, [activeTaskId, currentText]);

  useEffect(() => {
    return () => {
      if (deferredBlurCommitTimerRef.current !== null) {
        window.clearTimeout(deferredBlurCommitTimerRef.current);
        deferredBlurCommitTimerRef.current = null;
      }
    };
  }, []);

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
  const sanitizedPromptHtml = sanitizeHtml(currentPrompt);
  const minWords = currentTask.minWords || 150;
  const currentChart = currentTaskContent?.chart;

  const wordCount = currentText.trim() === '' ? 0 : currentText.trim().split(/\s+/).length;

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
      setLocalDraftsByTask((current) => (
        current[activeTaskId] === textContent
          ? current
          : { ...current, [activeTaskId]: textContent }
      ));
      onWritingChange(activeTaskId, textContent);
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
    <div className="flex flex-col h-full w-full bg-white">
      <div
        className={`relative flex flex-1 min-h-0 overflow-hidden border-t border-gray-300 ${
          isTabletMode ? 'flex-row' : 'flex-col md:flex-row'
        }`}
        ref={workspaceRef}
        style={splitPaneStyle}
        data-testid="writing-split-workspace"
      >
        <div
          className={`h-full flex flex-col relative ${
            isTabletMode
              ? 'w-[var(--writing-prompt-pane-width)] min-w-[48px] border-r border-gray-200'
              : 'min-w-[260px] md:min-w-[280px] lg:w-[var(--writing-prompt-pane-width)] lg:min-w-[300px]'
          }`}
        >
          {/* Timer Bar */}
          <div className={`h-1.5 flex-shrink-0 transition-all ${isTimeCritical ? 'bg-red-500' : isTimeWarning ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${progressPercent}%` }} />

          <div
            className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pr-4 md:pr-6 lg:pr-12 pb-6 md:pb-8 font-sans text-gray-900"
            data-student-zoom-scroll
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
              {currentPromptContainsMarkup ? (
                <div dangerouslySetInnerHTML={{ __html: sanitizedPromptHtml }} />
              ) : (
                currentPrompt
              )}
            </div>
          </div>
        </div>

        <div 
          onMouseDown={handleDrag}
          onTouchStart={handleDrag}
          className={`${isTabletMode ? 'absolute inset-y-0 z-20 flex w-11 items-center justify-center' : 'hidden w-4 lg:flex relative items-center justify-center flex-shrink-0'} bg-gray-400 cursor-col-resize touch-none hover:bg-gray-600 transition-colors`}
          style={isTabletMode ? { left: `calc(${leftWidth}% - 22px)` } : undefined}
          role="separator"
          aria-label="Resize writing prompt and answer panels"
          aria-orientation="vertical"
          data-testid="writing-pane-resizer"
        >
          <div className={`${isTabletMode ? 'h-[5.5rem] w-14' : 'h-10 w-8'} bg-white border border-gray-400 flex items-center justify-center absolute z-10 shadow-sm pointer-events-none`}>
            <ArrowLeftRight size={isTabletMode ? 22 : 14} className="text-gray-600" />
          </div>
        </div>

        <div
          className={`h-full flex flex-col relative ${
            isTabletMode
              ? 'w-[var(--writing-editor-pane-width)] min-w-[48px]'
              : 'min-w-[280px] md:min-w-[320px] lg:w-[var(--writing-editor-pane-width)]'
          }`}
        >
          <div className="flex-1 overflow-hidden flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 animate-in slide-in-from-right-4 duration-300">
            <div className="relative flex flex-1 min-h-0 w-full flex-col">
              <div
                className={`flex flex-col gap-2 border-b border-gray-200 bg-gray-50 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-600 sm:flex-row sm:items-center sm:justify-between ${
                  isTabletMode ? 'pl-10 pr-3' : 'px-3'
                }`}
              >
                <span>Writing Response</span>
                <div className="flex items-center gap-2" aria-label="Current word count">
                  <span className="text-[length:var(--student-meta-font-size)] font-bold text-gray-400 uppercase tracking-widest">
                    Word Count
                  </span>
                  <span className={`text-lg font-black leading-none ${
                    isOptimal ? 'text-emerald-600' :
                    isOverLength ? 'text-red-600' :
                    isWordCountMet ? 'text-blue-600' :
                    isWordCountWarning ? 'text-amber-500' : 'text-gray-900'
                  }`}>
                    {wordCount}
                  </span>
                </div>
              </div>
              {showEditorPlaceholder && (
                  <div
                    className={`pointer-events-none absolute top-14 md:top-16 lg:top-20 text-base md:text-lg leading-relaxed text-gray-400 font-serif select-none ${
                      isTabletMode ? 'left-10 md:left-10 lg:left-10' : 'left-4 md:left-6 lg:left-8'
                    }`}
                  >
                    Write your answer here…
                  </div>
              )}
              <textarea
                ref={editorRef}
                value={currentText}
                onChange={handleEditorInput}
                aria-label="Writing response"
                  onFocus={() => {
                    editorHasFocusRef.current = true;
                    setIsEditorFocused(true);
                  }}
                  onBlur={() => {
                    editorHasFocusRef.current = false;
                    setIsEditorFocused(false);
                    if (editorRef.current) {
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
                    ? 'pt-4 pr-4 pb-4 pl-10 md:pt-6 md:pr-6 md:pb-6 md:pl-10 lg:pt-8 lg:pr-8 lg:pb-8 lg:pl-10'
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
      </div>

      <footer
        className="student-exam-footer border-t border-gray-200 bg-white flex flex-shrink-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.03)]"
        role="contentinfo"
        aria-label="Writing task navigation and submission"
      >
        <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 lg:px-4 py-2 md:py-2.5 overflow-x-auto w-full">
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
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-100'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {task.label}
            </button>
          ))}
          {showSubmitButton ? (
            <button
              onClick={handleSubmitClick}
              className="min-w-[8.25rem] md:min-w-[9.5rem] px-4 md:px-6 py-1.5 md:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-sm text-[length:var(--student-control-font-size)] font-bold transition-colors shadow-md flex-shrink-0"
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
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
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
