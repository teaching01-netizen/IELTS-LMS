import React from 'react';
import type { WritingChartData } from '../../types';
import { getImageUrlCandidates } from '../../utils/imageUrl';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import { RichTextHighlighter } from './RichTextHighlighter';

interface WritingPromptPaneProps {
  isTabletMode: boolean;
    currentTaskId: string;
currentTaskLabel: string;
  currentChart: WritingChartData | undefined;
  currentPrompt: string;
  currentPromptContainsMarkup: boolean;
  resolvedTimeRemaining: number;
  isTimeCritical: boolean;
  isTimeWarning: boolean;
  progressPercent: number;
  highlightEnabled: boolean;
  highlightColor?: React.ComponentProps<typeof RichTextHighlighter>['highlightColor'];
  highlightClassName?: string | undefined;
  promptPaneRef: React.RefObject<HTMLDivElement | null>;
  lastFocusedPaneRef: React.MutableRefObject<'prompt' | 'response'>;
}

export const WritingPromptPane = React.memo(function WritingPromptPane({
  isTabletMode,
  currentTaskId, currentTaskLabel,
  currentChart,
  currentPrompt,
  currentPromptContainsMarkup,
  resolvedTimeRemaining,
  isTimeCritical,
  isTimeWarning,
  progressPercent,
  highlightEnabled,
  highlightColor,
  highlightClassName,
  promptPaneRef,
  lastFocusedPaneRef,
}: WritingPromptPaneProps) {
  const blockMediaSaveInteraction = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
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
      <div
        className={`h-1.5 flex-shrink-0 transition-all ${
          isTimeCritical ? 'bg-red-600' : isTimeWarning ? 'bg-amber-700' : 'bg-blue-800'
        }`}
        style={{ width: `${progressPercent}%` }}
      />
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
            {currentTaskLabel}
          </h2>
          <div
            role="timer"
            aria-label="Time remaining in writing section"
            className={`px-3 py-1 rounded-md text-sm font-semibold tabular-nums ${
              isTimeCritical
                ? 'bg-red-100 text-red-700'
                : isTimeWarning
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-blue-100 text-blue-700'
            }`}
          >
            {formatTime(resolvedTimeRemaining)}
          </div>
        </div>
        {currentChart ? (
          <div
            className="student-passage-measure mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            onContextMenu={blockMediaSaveInteraction}
            onDragStart={blockMediaSaveInteraction}
            onDrop={blockMediaSaveInteraction}
            role="img"
            aria-label={currentChart.title}>
            <p className="text-[length:var(--student-meta-font-size)] font-semibold text-gray-600 uppercase tracking-wide mb-3">
              Stimulus Chart
            </p>
            {currentChart.imageSrc ? (
              <StudentZoomableMedia
                sources={getImageUrlCandidates(currentChart.imageSrc)}
                alt={currentChart.title}
                label={currentChart.title}
                hint="Tap to zoom the chart"
                className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
              />
            ) : (
              <div className="flex items-end gap-3 h-44">
                {currentChart.values.map((value, index) => (
                  <div key={`${currentChart.labels[index]}-${value}`} className="flex-1 text-center">
                    <div
                      className="mx-auto rounded-t-sm bg-blue-500"
                      style={{ height: `${Math.max(16, value * 12)}px` }}
                    />
                    <p className="text-[length:var(--student-meta-font-size)] font-semibold text-gray-500 mt-2">
                      {currentChart.labels[index]}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div
          data-testid="writing-task-prompt"
          className="student-stimulus-content student-passage-measure text-gray-900 whitespace-break-spaces break-words [overflow-wrap:anywhere]"
        >
          <RichTextHighlighter
            key={currentPrompt}
            content={currentPrompt}
            contentType={currentPromptContainsMarkup ? 'html' : 'text'}
            enabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightClassName={highlightClassName}
            highlightSurfaceId={`writing:prompt:${currentTaskId}`}
          />
        </div>
      </div>
    </div>
  );
}, areWritingPromptPanePropsEqual);

function areWritingPromptPanePropsEqual(
  previous: WritingPromptPaneProps,
  next: WritingPromptPaneProps,
): boolean {
  if (
    previous.isTabletMode !== next.isTabletMode ||
    previous.currentTaskLabel !== next.currentTaskLabel ||
    previous.currentPrompt !== next.currentPrompt ||
    previous.currentPromptContainsMarkup !== next.currentPromptContainsMarkup ||
    previous.resolvedTimeRemaining !== next.resolvedTimeRemaining ||
    previous.isTimeCritical !== next.isTimeCritical ||
    previous.isTimeWarning !== next.isTimeWarning ||
    previous.progressPercent !== next.progressPercent ||
    previous.highlightEnabled !== next.highlightEnabled ||
    previous.highlightColor !== next.highlightColor ||
    previous.highlightClassName !== next.highlightClassName ||
    previous.promptPaneRef !== next.promptPaneRef ||
    previous.lastFocusedPaneRef !== next.lastFocusedPaneRef
  ) {
    return false;
  }

  return areChartsEqual(previous.currentChart, next.currentChart);
}

function areChartsEqual(
  previous: WritingChartData | undefined,
  next: WritingChartData | undefined,
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next) {
    return false;
  }

  return (
    previous.id === next.id &&
    previous.imageSrc === next.imageSrc &&
    previous.title === next.title &&
    previous.type === next.type &&
    previous.labels.length === next.labels.length &&
    previous.values.length === next.values.length &&
    previous.labels.every((label, index) => label === next.labels[index]) &&
    previous.values.every((value, index) => value === next.values[index])
  );
}

interface WritingResponsePaneProps {
  isTabletMode: boolean;
  activeTaskId: string;
  currentText: string;
  showEditorPlaceholder: boolean;
  wordCount: number;
  isOptimal: boolean;
  isOverLength: boolean | undefined;
  isWordCountMet: boolean;
  isWordCountWarning: boolean;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  security: {
    preventAutofill: boolean;
    preventAutocorrect: boolean;
  };
  onEditorInput: () => void;
  onCommitEditorDraft: () => void;
  onEditorFocus: () => void;
  onEditorBlur: () => void;
  blockWritingEditorInteraction: (
    event:
      | React.ClipboardEvent<HTMLTextAreaElement>
      | React.DragEvent<HTMLTextAreaElement>
      | React.MouseEvent<HTMLTextAreaElement>,
  ) => void;
  lastFocusedPaneRef: React.MutableRefObject<'prompt' | 'response'>;
}

export const WritingResponsePane = React.memo(function WritingResponsePane({
  isTabletMode,
  activeTaskId,
  currentText,
  showEditorPlaceholder,
  wordCount,
  isOptimal,
  isOverLength,
  isWordCountMet,
  isWordCountWarning,
  editorRef,
  security,
  onEditorInput,
  onCommitEditorDraft,
  onEditorFocus,
  onEditorBlur,
  blockWritingEditorInteraction,
  lastFocusedPaneRef,
}: WritingResponsePaneProps) {
  return (
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
            className={`flex flex-col gap-2 border-b border-gray-200 bg-gray-50 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 sm:flex-row sm:items-center sm:justify-between ${
              isTabletMode ? 'pl-8 pr-3' : 'px-3'
            }`}
          >
            <span>Writing Response</span>
            <div className="flex items-center gap-2" aria-label="Current word count">
              <span className="text-[length:var(--student-meta-font-size)] font-semibold text-gray-600 uppercase tracking-wide">
                Word Count
              </span>
              <span
                className={`text-lg font-bold tabular-nums leading-none ${
                  isOptimal
                    ? 'text-green-800'
                    : isOverLength
                      ? 'text-red-800'
                      : isWordCountMet
                        ? 'text-blue-800'
                        : isWordCountWarning
                          ? 'text-amber-900'
                          : 'text-gray-900'
                }`}
              >
                {wordCount}
              </span>
            </div>
          </div>
          {showEditorPlaceholder ? (
            <div
              className={`pointer-events-none absolute top-14 md:top-16 lg:top-20 text-base md:text-lg leading-relaxed text-gray-500 font-serif select-none ${
                isTabletMode ? 'left-8 md:left-8 lg:left-8' : 'left-4 md:left-6 lg:left-8'
              }`}
            >
              Write your answer here…
            </div>
          ) : null}
          <textarea
            ref={editorRef}
            defaultValue={currentText}
            onChange={onEditorInput}
            onCompositionEnd={onCommitEditorDraft}
            aria-label="Writing response"
            onFocus={onEditorFocus}
            onBlur={onEditorBlur}
            onPaste={blockWritingEditorInteraction}
            onCopy={blockWritingEditorInteraction}
            onCut={blockWritingEditorInteraction}
            onDrop={blockWritingEditorInteraction}
            onContextMenu={blockWritingEditorInteraction}
            className={`flex-1 w-full text-base md:text-lg leading-relaxed text-gray-800 font-serif overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
              isTabletMode
                ? 'pt-4 pr-4 pb-4 pl-8 md:pt-6 md:pr-6 md:pb-6 md:pl-8 lg:pt-8 lg:pr-8 lg:pb-8 lg:pl-8'
                : 'p-4 md:p-6 lg:p-8'
            } h-full min-h-0 resize-none whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}
            data-student-zoom-scroll
            spellCheck={!security.preventAutocorrect}
            autoCorrect={security.preventAutocorrect ? 'off' : 'on'}
            autoCapitalize={security.preventAutocorrect ? 'off' : 'on'}
            data-task-id={activeTaskId}
          />
        </div>
      </div>
    </div>
  );
});

