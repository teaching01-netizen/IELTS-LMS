import React, { useState, useEffect, useRef } from 'react';
import { ExamState } from '../../types';
import { ArrowLeftRight, Check, X, AlertTriangle } from 'lucide-react';
import { getWritingTaskContent } from '../../utils/writingTaskUtils';
import { stripHtml } from '../../utils/builderEnhancements';
import { MIN_HEIGHTS } from '../../constants/uiConstants';
import { saveStudentAuditEvent } from '../../services/studentAuditService';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { useOptionalStudentAttempt } from './providers/StudentAttemptProvider';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import { WritingChartPreview } from '../writing/WritingChartPreview';

interface StudentWritingProps {
  state: ExamState;
  writingAnswers: Record<string, string>;
  onWritingChange: (taskId: string, text: string) => void;
  onSubmit: () => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  timeRemaining?: number | undefined;
  onTimeExpired?: (() => void) | undefined;
  security?: {
    preventAutofill: boolean;
    preventAutocorrect: boolean;
  } | undefined;
  sessionId?: string | undefined;
  studentId?: string | undefined;
  showSubmitButton?: boolean | undefined;
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
  security = { preventAutofill: false, preventAutocorrect: false },
  sessionId,
  studentId,
  showSubmitButton = true,
}: StudentWritingProps) {
  const attemptContext = useOptionalStudentAttempt();
  const resolvedSessionId = sessionId ?? attemptContext?.state.attempt?.scheduleId;
  const resolvedStudentId = studentId ?? attemptContext?.state.attemptId ?? undefined;
  const writingConfig = state.config.sections.writing;
  const [activeTaskId, setActiveTaskId] = useState<string>(currentQuestionId || writingConfig.tasks[0]?.id || 'task1');
  const [leftWidth, setLeftWidth] = useState(50);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const lastKeydownRef = useRef<number>(0);
  const previousValueRef = useRef<string>('');
  const editorHasFocusRef = useRef(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const handleDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const firstTouch = 'touches' in e ? e.touches[0] : undefined;
      if ('touches' in e && !firstTouch) {
        return;
      }
      const clientX = firstTouch ? firstTouch.clientX : (e as MouseEvent).clientX;
      const newWidth = (clientX / window.innerWidth) * 100;
      if (newWidth > 30 && newWidth < 70) {
        setLeftWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleMouseMove);
      document.removeEventListener('touchend', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleMouseMove);
    document.addEventListener('touchend', handleMouseUp);
  };

  const currentTask = writingConfig.tasks.find(t => t.id === activeTaskId) || writingConfig.tasks[0];
  const currentText = writingAnswers[activeTaskId] || '';
  const currentPlainText = currentText.replace(/<[^>]*>/g, '').trim();
  const showEditorPlaceholder = !isEditorFocused && currentPlainText.length === 0;

  useEffect(() => {
    if (currentQuestionId && currentQuestionId !== activeTaskId) {
      setActiveTaskId(currentQuestionId);
    }
  }, [activeTaskId, currentQuestionId]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editorHasFocusRef.current) return;
    if (currentText !== editor.innerHTML) {
      editor.innerHTML = currentText;
      previousValueRef.current = editor.innerHTML;
    }
  }, [activeTaskId, currentText]);

  useEffect(() => {
    if (timeRemaining === 0) {
      onTimeExpired?.();
    }
  }, [timeRemaining, onTimeExpired]);

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
      const target = event.target as HTMLDivElement;
      const newValue = target.innerHTML;
      const previousValue = previousValueRef.current;
      
      const textLength = newValue.replace(/<[^>]*>/g, '').length;
      const previousTextLength = previousValue.replace(/<[^>]*>/g, '').length;
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

    editor.addEventListener('beforeinput', handleBeforeInput);
    editor.addEventListener('input', handleInput);
    editor.addEventListener('keydown', handleKeydown);

    return () => {
      editor.removeEventListener('beforeinput', handleBeforeInput);
      editor.removeEventListener('input', handleInput);
      editor.removeEventListener('keydown', handleKeydown);
    };
  }, [resolvedSessionId, resolvedStudentId]);

  if (!currentTask) {
    return null;
  }

  const currentTaskContent = getWritingTaskContent(state.writing, writingConfig.tasks, currentTask.id);
  const currentPrompt = currentTaskContent?.prompt ?? '';
  const currentPromptText = stripHtml(currentPrompt);
  const minWords = currentTask.minWords || 150;
  const currentChart = currentTaskContent?.chart;

  const wordCount = currentText.trim() === '' ? 0 : currentText.replace(/<[^>]*>/g, '').trim().split(/\s+/).length;

  const isWordCountMet = wordCount >= minWords;
  const isWordCountWarning = wordCount > 0 && wordCount < minWords && wordCount >= minWords * 0.9;

  // Word count guidance
  const optimalMin = currentTask.optimalMin || Math.ceil(minWords * 1.1);
  const optimalMax = currentTask.optimalMax || Math.ceil(minWords * 1.5);
  const isOptimal = wordCount >= optimalMin && wordCount <= optimalMax;
  const isOverLength = currentTask.maxWords && wordCount > currentTask.maxWords;
  const overLengthWarning = currentTask.maxWords && wordCount > currentTask.maxWords * 0.9;

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

  // Rich text formatting commands
  const handleFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      const htmlContent = editorRef.current.innerHTML;
      onWritingChange(activeTaskId, htmlContent);
    }
  };

  const handleEditorInput = () => {
    if (editorRef.current) {
      const htmlContent = editorRef.current.innerHTML;
      onWritingChange(activeTaskId, htmlContent);
    }
  };

  const insertPlainTextAtCursor = (text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text/plain') ?? '';
    if (!pasted) return;
    insertPlainTextAtCursor(pasted);
    handleEditorInput();
  };

  const handleEditorDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleSubmitClick = () => {
    setShowReviewModal(true);
  };

  const handleConfirmSubmit = () => {
    setShowReviewModal(false);
    onSubmit();
  };

  const handleCancelSubmit = () => {
    setShowReviewModal(false);
  };

  // Calculate word count for HTML content
  const getWordCount = (html: string) => {
    const text = html.replace(/<[^>]*>/g, '').trim();
    return text === '' ? 0 : text.split(/\s+/).length;
  };

  // Check if all tasks meet minimum word count
  const allTasksMet = writingConfig.tasks.every(task => {
    const text = writingAnswers[task.id] || '';
    const count = getWordCount(text);
    return count >= task.minWords;
  });

	return (
    <div className="flex flex-col h-full w-full bg-white">
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden relative border-t border-gray-300">
        <div style={{ width: `${leftWidth}%` }} className="h-full flex flex-col relative min-w-[260px] md:min-w-[280px] lg:min-w-[300px]">
          {/* Timer Bar */}
          <div className={`h-1.5 flex-shrink-0 transition-all ${isTimeCritical ? 'bg-red-500' : isTimeWarning ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${progressPercent}%` }} />

          <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pr-4 md:pr-6 lg:pr-12 pb-6 md:pb-8 font-sans text-sm md:text-base leading-relaxed text-gray-900" data-student-zoom-scroll>
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <h2 className="text-lg md:text-xl font-bold">{currentTask.label}</h2>
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
              <div className="mb-5 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[length:var(--student-meta-font-size)] font-black text-gray-400 uppercase tracking-[0.22em] mb-3">
                  Stimulus Chart
                </p>
                {currentChart.imageSrc ? (
                  <StudentZoomableMedia
                    sources={[currentChart.imageSrc]}
                    alt={currentChart.title}
                    label={currentChart.title}
                    hint="Tap to zoom the chart"
                    className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                  />
                ) : (
                  <WritingChartPreview chart={currentChart} variant="student" />
                )}
              </div>
            )}
            
            <div className="prose prose-sm md:prose-lg max-w-none text-gray-900 whitespace-pre-wrap leading-relaxed">
              {currentPromptText}
            </div>
          </div>
        </div>

        <div 
          onMouseDown={handleDrag}
          onTouchStart={handleDrag}
          className="hidden lg:flex w-4 bg-gray-400 relative flex items-center justify-center cursor-col-resize flex-shrink-0 hover:bg-gray-600 transition-colors"
        >
          <div className="w-8 h-8 bg-white border border-gray-400 flex items-center justify-center absolute z-10 shadow-sm pointer-events-none">
            <ArrowLeftRight size={14} className="text-gray-600" />
          </div>
        </div>

        <div style={{ width: `calc(${100 - leftWidth}% - 16px)` }} className="h-full flex flex-col relative min-w-[280px] md:min-w-[320px]">
          <div className="flex-1 overflow-hidden flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 animate-in slide-in-from-right-4 duration-300">
            <div className="relative flex-1 w-full">
              <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-600">
                <span>Writing Response</span>
              </div>
              {showEditorPlaceholder && (
                  <div className="pointer-events-none absolute left-4 top-14 md:left-6 md:top-16 lg:left-8 lg:top-20 text-base md:text-lg leading-relaxed text-gray-400 font-serif select-none">
                    Write your answer here…
                  </div>
              )}
	              <div
	                ref={editorRef}
	                contentEditable
	                onInput={handleEditorInput}
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Writing response"
                  onFocus={() => {
                    editorHasFocusRef.current = true;
                    setIsEditorFocused(true);
                  }}
                  onBlur={() => {
                    editorHasFocusRef.current = false;
                    setIsEditorFocused(false);
                    if (editorRef.current) {
                      const sanitized = sanitizeHtml(editorRef.current.innerHTML);
                      if (sanitized !== editorRef.current.innerHTML) {
                        editorRef.current.innerHTML = sanitized;
                      }
                      onWritingChange(activeTaskId, editorRef.current.innerHTML);
                    }
                  }}
                  onPaste={handleEditorPaste}
                  onDrop={handleEditorDrop}
	                className="flex-1 w-full p-4 md:p-6 lg:p-8 text-base md:text-lg leading-relaxed text-gray-800 font-serif overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  data-student-zoom-scroll
	                style={{ minHeight: MIN_HEIGHTS.WRITING_EDITOR }}
	                spellCheck={!security.preventAutocorrect}
	                autoCorrect={security.preventAutocorrect ? 'off' : 'on'}
	                autoCapitalize={security.preventAutocorrect ? 'off' : 'on'}
	              />
              </div>
            
	            <div className="border-t border-gray-200 p-3 md:p-5 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs md:text-sm flex-shrink-0">
	              <div className="flex gap-4 md:gap-8 w-full sm:w-auto">
	                <div className="flex flex-col">
	                  <span className="text-[length:var(--student-meta-font-size)] font-bold text-gray-400 uppercase tracking-widest">
	                    Word Count
	                  </span>
	                  <span className={`text-lg md:text-xl font-black ${
	                    isOptimal ? 'text-emerald-600' :
	                    isOverLength ? 'text-red-600' :
	                    isWordCountMet ? 'text-blue-600' :
	                    isWordCountWarning ? 'text-amber-500' : 'text-gray-900'
	                  }`}>
	                    {wordCount}
	                  </span>
	                </div>
	              </div>
	            </div>
	          </div>

        </div>
      </div>

      <footer
        className="border-t border-gray-200 bg-white flex flex-shrink-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.03)]"
        role="contentinfo"
        aria-label="Writing task navigation and submission"
      >
        <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 lg:px-4 py-2 md:py-2.5 overflow-x-auto w-full">
          {writingConfig.tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => {
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
                const text = writingAnswers[task.id] || '';
                const wordCount = getWordCount(text);
                const isMet = wordCount >= task.minWords;
                const previewText = text.replace(/<[^>]*>/g, '').trim();

                return (
                  <div key={task.id} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-gray-900">{task.label}</h3>
                      <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${
                        isMet ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {isMet ? <Check size={14} /> : <AlertTriangle size={14} />}
                        {wordCount} / {task.minWords} words
                      </div>
                    </div>
                    <div className="text-sm text-gray-600 max-h-32 overflow-y-auto bg-gray-50 rounded-lg p-3">
                      {previewText || <span className="text-gray-400 italic">No response written</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50">
              {!allTasksMet && (
                <div className="flex items-start gap-3 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Word count warning</p>
                    <p className="text-xs text-amber-700 mt-1">Some tasks do not meet the minimum word count requirement. You may still submit, but your score may be affected.</p>
                  </div>
                </div>
              )}
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
