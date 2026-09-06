import React, { useState, useRef, useCallback } from 'react';
import {
  Highlighter,
  Underline,
  Strikethrough,
  MessageSquare,
  Eye,
  EyeOff,
  Type,
  Minus,
  Undo2,
  Redo2,
} from 'lucide-react';
import {
  WritingAnnotation,
  DrawingAnnotation,
  AnnotationToolState,
  CommentBankItem
} from '../../types/grading';

interface WritingAnnotationCanvasProps {
  taskId: string;
  studentText: string;
  annotations: WritingAnnotation[];
  drawings: DrawingAnnotation[];
  commentBank?: CommentBankItem[];
  currentTeacherId: string;
  onAnnotationAdd: (annotation: WritingAnnotation) => void;
  onAnnotationUpdate: (annotation: WritingAnnotation) => void;
  onAnnotationDelete: (annotationId: string) => void;
  onDrawingAdd: (drawing: DrawingAnnotation) => void;
  onDrawingDelete: (drawingId: string) => void;
}

interface HistorySnapshot {
  annotations: WritingAnnotation[];
  drawings: DrawingAnnotation[];
}

const buildAnnotationId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `anno-${crypto.randomUUID()}`
    : `anno-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Renders annotated student text with overlap-safe segmentation.
 * Overlapping ranges are split at every boundary so nested/partial overlaps
 * each render their own combined span instead of dropping covered ranges.
 */
function segmentAnnotatedText(
  studentText: string,
  annotations: WritingAnnotation[],
): Array<{ text: string; covering: WritingAnnotation[] }> {
  if (annotations.length === 0) {
    return [{ text: studentText, covering: [] }];
  }

  const boundaries = new Set<number>([0, studentText.length]);
  for (const annotation of annotations) {
    const start = Math.max(0, Math.min(annotation.startOffset, studentText.length));
    const end = Math.max(0, Math.min(annotation.endOffset, studentText.length));
    if (end > start) {
      boundaries.add(start);
      boundaries.add(end);
    }
  }
  const sorted = [...boundaries].sort((a, b) => a - b);

  const segments: Array<{ text: string; covering: WritingAnnotation[] }> = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index] as number;
    const end = sorted[index + 1] as number;
    if (end <= start) continue;
    const covering = annotations.filter((annotation) => annotation.startOffset < end && annotation.endOffset > start);
    segments.push({ text: studentText.slice(start, end), covering });
  }
  return segments;
}

export function WritingAnnotationCanvas({
  taskId,
  studentText,
  annotations,
  drawings,
  commentBank = [],
  currentTeacherId,
  onAnnotationAdd,
  onAnnotationUpdate,
  onAnnotationDelete,
  onDrawingAdd,
  onDrawingDelete
}: WritingAnnotationCanvasProps) {
  const [toolState, setToolState] = useState<AnnotationToolState>({
    activeTool: 'select',
    color: 'rgba(255, 255, 0, 0.5)', // Yellow highlighter with 50% opacity
    strokeWidth: 2,
    visibility: 'student_visible'
  });

  const [selectedText, setSelectedText] = useState<{ start: number; end: number; text: string } | null>(null);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  // Working undo/redo: snapshots of the prop-driven lists. Snapshots are
  // computed locally at mutation time (prev props + mutation) so undo/redo
  // restore via the wired add/update/delete props. Index points at the
  // currently-applied snapshot; index 0 is the initial prop state.
  const [historyState, setHistoryState] = useState<{ snapshots: HistorySnapshot[]; index: number }>(() => ({
    snapshots: [{ annotations, drawings }],
    index: 0,
  }));
  // Latest prop values, mirrored for use inside undo/redo callbacks without
  // going stale between renders.
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;

  // Reset the stack when the canvas switches to a different writing task.
  const taskIdRef = useRef(taskId);
  if (taskIdRef.current !== taskId) {
    taskIdRef.current = taskId;
    setHistoryState({ snapshots: [{ annotations, drawings }], index: 0 });
  }

  const pushNextSnapshot = useCallback((snapshot: HistorySnapshot) => {
    setHistoryState((previous) => {
      const snapshots = [...previous.snapshots.slice(0, previous.index + 1), snapshot];
      // Cap the stack so long grading sessions stay bounded.
      const capped = snapshots.length > 50 ? snapshots.slice(snapshots.length - 50) : snapshots;
      return { snapshots: capped, index: capped.length - 1 };
    });
  }, []);

  const currentSnapshot = useCallback((): HistorySnapshot => ({
    annotations: annotationsRef.current,
    drawings: drawingsRef.current,
  }), []);

  const restoreSnapshot = useCallback((snapshot: HistorySnapshot) => {
    const currentAnnotations = annotationsRef.current;
    const currentDrawings = drawingsRef.current;
    const snapshotIds = new Set(snapshot.annotations.map((annotation) => annotation.id));
    const snapshotDrawingIds = new Set(snapshot.drawings.map((drawing) => drawing.id));

    // Delete annotations that did not exist in the snapshot.
    for (const annotation of currentAnnotations) {
      if (!snapshotIds.has(annotation.id)) {
        onAnnotationDelete(annotation.id);
      }
    }
    // Re-add missing snapshot annotations; update ones whose content changed.
    for (const annotation of snapshot.annotations) {
      const current = currentAnnotations.find((candidate) => candidate.id === annotation.id);
      if (!current) {
        onAnnotationAdd(annotation);
      } else if (JSON.stringify(current) !== JSON.stringify(annotation)) {
        onAnnotationUpdate(annotation);
      }
    }
    for (const drawing of currentDrawings) {
      if (!snapshotDrawingIds.has(drawing.id)) {
        onDrawingDelete(drawing.id);
      }
    }
    for (const drawing of snapshot.drawings) {
      if (!currentDrawings.some((candidate) => candidate.id === drawing.id)) {
        onDrawingAdd(drawing);
      }
    }
  }, [onAnnotationAdd, onAnnotationDelete, onAnnotationUpdate, onDrawingAdd, onDrawingDelete]);

  const canUndo = historyState.index > 0;
  const canRedo = historyState.index + 1 < historyState.snapshots.length;

  const handleUndo = useCallback(() => {
    const target = historyState.snapshots[historyState.index - 1];
    if (!target) return;
    setHistoryState((previous) => ({ snapshots: previous.snapshots, index: previous.index - 1 }));
    restoreSnapshot(target);
  }, [historyState.index, historyState.snapshots, restoreSnapshot]);

  const handleRedo = useCallback(() => {
    const target = historyState.snapshots[historyState.index + 1];
    if (!target) return;
    setHistoryState((previous) => ({ snapshots: previous.snapshots, index: previous.index + 1 }));
    restoreSnapshot(target);
  }, [historyState.index, historyState.snapshots, restoreSnapshot]);

  const textRef = useRef<HTMLDivElement>(null);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const text = range.toString();

    if (text.length > 0 && textRef.current) {
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(textRef.current);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      const start = preCaretRange.toString().length;
      const end = start + text.length;

      setSelectedText({ start, end, text });

      // Google Docs style: if highlight/underline/strike tool is active, apply immediately
      if (toolState.activeTool === 'highlight') {
        addHighlight();
      } else if (toolState.activeTool === 'underline') {
        addUnderline();
      } else if (toolState.activeTool === 'strike_through') {
        addStrikeThrough();
      } else if (toolState.activeTool === 'comment') {
        setShowCommentInput(true);
      }
    }
  };

  const buildBaseAnnotation = (type: WritingAnnotation['type'], comment: string): WritingAnnotation | null => {
    if (!selectedText) return null;
    return {
      id: buildAnnotationId(),
      taskId,
      type,
      startOffset: selectedText.start,
      endOffset: selectedText.end,
      selectedText: selectedText.text,
      comment,
      visibility: toolState.visibility,
      color: toolState.color,
      createdBy: currentTeacherId,
      createdAt: new Date().toISOString()
    };
  };

  const commitAnnotation = (annotation: WritingAnnotation | null) => {
    if (!annotation) return;
    pushNextSnapshot({ annotations: [...currentSnapshot().annotations, annotation], drawings: currentSnapshot().drawings });
    onAnnotationAdd(annotation);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  };

  const addInlineComment = () => {
    if (!selectedText || !commentInput.trim()) return;

    const annotation = buildBaseAnnotation('inline_comment', commentInput);
    if (!annotation) return;
    pushNextSnapshot({ annotations: [...currentSnapshot().annotations, annotation], drawings: currentSnapshot().drawings });
    onAnnotationAdd(annotation);

    // Reset
    setSelectedText(null);
    setCommentInput('');
    setShowCommentInput(false);
    window.getSelection()?.removeAllRanges();
  };

  const addHighlight = () => {
    commitAnnotation(buildBaseAnnotation('highlight', ''));
  };

  const addUnderline = () => {
    commitAnnotation(buildBaseAnnotation('underline', ''));
  };

  const addStrikeThrough = () => {
    commitAnnotation(buildBaseAnnotation('strike_through', ''));
  };

  const applyCommentBankItem = (item: CommentBankItem) => {
    if (!selectedText) {
      setCommentInput(item.text);
      setShowCommentInput(true);
      return;
    }

    const annotation = buildBaseAnnotation('inline_comment', item.text);
    if (!annotation) return;
    annotation.visibility = item.isStudentVisible ? 'student_visible' : 'internal_only';
    pushNextSnapshot({ annotations: [...currentSnapshot().annotations, annotation], drawings: currentSnapshot().drawings });
    onAnnotationAdd(annotation);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleDeleteAnnotation = (annotationId: string) => {
    const next = currentSnapshot();
    pushNextSnapshot({
      annotations: next.annotations.filter((candidate) => candidate.id !== annotationId),
      drawings: next.drawings,
    });
    onAnnotationDelete(annotationId);
  };

  const renderAnnotatedText = () => {
    const segments = segmentAnnotatedText(studentText, annotations);
    if (segments.length === 1 && segments[0]?.covering.length === 0) {
      return <div className="prose prose-lg max-w-none text-gray-800 whitespace-pre-wrap font-serif leading-relaxed">{studentText}</div>;
    }

    return (
      <div className="prose prose-lg max-w-none text-gray-800 whitespace-pre-wrap font-serif leading-relaxed">
        {segments.map((segment, index) => {
          if (segment.covering.length === 0) {
            return <span key={index}>{segment.text}</span>;
          }

          const [primary, ...overlapping] = segment.covering;
          if (!primary) {
            return <span key={index}>{segment.text}</span>;
          }
          let className = '';
          let style: React.CSSProperties = {};

          switch (primary.type) {
            case 'inline_comment':
              // Comments can also have highlight color
              if (primary.color) {
                style = { backgroundColor: primary.color };
              }
              break;
            case 'highlight':
              // Use inline style with RGBA color (Google Docs highlighter style)
              style = { backgroundColor: primary.color || 'rgba(255, 255, 0, 0.5)' };
              break;
            case 'underline':
              style = { textDecoration: 'underline', textDecorationColor: primary.color };
              break;
            case 'strike_through':
              style = { textDecoration: 'line-through', textDecorationColor: primary.color };
              break;
            default:
              className = 'bg-blue-100';
          }
          // Extra underline marker when additional ranges overlap this segment.
          if (overlapping.length > 0 && primary.type !== 'underline' && primary.type !== 'strike_through') {
            style = { ...style, textDecoration: style.textDecoration ?? 'underline dotted' };
          }
          const tooltip = [primary.comment || primary.type, ...overlapping.map((extra) => extra.comment || extra.type)]
            .filter(Boolean)
            .join(' · ');

          return (
            <span
              key={index}
              className={`relative cursor-pointer ${className}`}
              style={style}
              title={tooltip}
            >
              {segment.text}
              {primary.comment && primary.type === 'inline_comment' && (
                <span className="absolute -top-6 left-0 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                  {primary.comment}
                </span>
              )}
            </span>
          );
        })}
      </div>
    );
  };

  const ToolButton = ({ tool, icon: Icon, label }: { tool: AnnotationToolState['activeTool']; icon: React.ComponentType<{ size?: number }>; label: string }) => {
    const handleClick = () => {
      setToolState({ ...toolState, activeTool: tool });

      // If text is already selected, immediately apply the annotation (Google Docs style)
      if (selectedText && tool !== 'select' && tool !== 'comment') {
        if (tool === 'highlight') {
          addHighlight();
        } else if (tool === 'underline') {
          addUnderline();
        } else if (tool === 'strike_through') {
          addStrikeThrough();
        }
      }
    };

    return (
      <button
        onClick={handleClick}
        className={`p-2 rounded-lg transition-colors ${
          toolState.activeTool === tool
            ? 'bg-blue-100 text-blue-700'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
        title={label}
      >
        <Icon size={18} />
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-2">
        <div className="flex items-center gap-1 border-r border-gray-200 pr-2">
          <ToolButton tool="select" icon={Type} label="Select" />
          <ToolButton tool="highlight" icon={Highlighter} label="Highlight" />
          <ToolButton tool="underline" icon={Underline} label="Underline" />
          <ToolButton tool="strike_through" icon={Strikethrough} label="Strike Through" />
        </div>

        <div className="flex items-center gap-1 border-r border-gray-200 pr-2">
          <ToolButton tool="comment" icon={MessageSquare} label="Add Comment" />
        </div>

        <div className="flex items-center gap-1 border-r border-gray-200 pr-2">
          <button
            onClick={() => setToolState({
              ...toolState,
              visibility: toolState.visibility === 'student_visible' ? 'internal_only' : 'student_visible'
            })}
            className={`p-2 rounded-lg transition-colors ${
              toolState.visibility === 'student_visible'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600'
            }`}
            title={toolState.visibility === 'student_visible' ? 'Student Visible' : 'Internal Only'}
          >
            {toolState.visibility === 'student_visible' ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>

        <div className="flex items-center gap-1 border-r border-gray-200 pr-2">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-2 rounded-lg transition-colors text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo annotation change"
            aria-label="Undo annotation change"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-2 rounded-lg transition-colors text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Redo annotation change"
            aria-label="Redo annotation change"
          >
            <Redo2 size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setToolState({ ...toolState, color: 'rgba(255, 255, 0, 0.5)' })}
            className={`w-6 h-6 rounded ${toolState.color === 'rgba(255, 255, 0, 0.5)' ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
            style={{ backgroundColor: 'rgba(255, 255, 0, 0.5)' }}
            title="Yellow"
          />
          <button
            onClick={() => setToolState({ ...toolState, color: 'rgba(255, 107, 107, 0.5)' })}
            className={`w-6 h-6 rounded ${toolState.color === 'rgba(255, 107, 107, 0.5)' ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
            style={{ backgroundColor: 'rgba(255, 107, 107, 0.5)' }}
            title="Red"
          />
          <button
            onClick={() => setToolState({ ...toolState, color: 'rgba(78, 205, 196, 0.5)' })}
            className={`w-6 h-6 rounded ${toolState.color === 'rgba(78, 205, 196, 0.5)' ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
            style={{ backgroundColor: 'rgba(78, 205, 196, 0.5)' }}
            title="Blue"
          />
          <button
            onClick={() => setToolState({ ...toolState, color: 'rgba(149, 225, 211, 0.5)' })}
            className={`w-6 h-6 rounded ${toolState.color === 'rgba(149, 225, 211, 0.5)' ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
            style={{ backgroundColor: 'rgba(149, 225, 211, 0.5)' }}
            title="Green"
          />
        </div>
      </div>

      {/* Comment Bank */}
      {commentBank.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Quick Comments</h4>
          <div className="flex flex-wrap gap-2">
            {commentBank.slice(0, 8).map((item) => (
              <button
                key={item.id}
                onClick={() => applyCommentBankItem(item)}
                className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 transition-colors"
                title={item.text}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Text Canvas */}
      <div
        ref={textRef}
        className="relative bg-white border border-gray-200 rounded-lg p-6 min-h-[400px]"
        onMouseUp={handleTextSelection}
      >
        {renderAnnotatedText()}

        {/* Comment Input Popup */}
        {showCommentInput && selectedText && (
          <div className="absolute bg-white border border-gray-300 rounded-lg shadow-lg p-3 z-20" style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}>
            <textarea
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder="Add your comment..."
              className="w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setShowCommentInput(false);
                  setCommentInput('');
                  setSelectedText(null);
                }}
                className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
              <button
                onClick={addInlineComment}
                disabled={!commentInput.trim()}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Comment
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Annotations List */}
      {annotations.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Annotations ({annotations.length})</h4>
          <div className="space-y-2">
            {annotations.map((annotation) => (
              <div
                key={annotation.id}
                className="flex items-start gap-3 p-2 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-500 uppercase">{annotation.type}</span>
                    {annotation.visibility === 'student_visible' ? (
                      <Eye size={12} className="text-green-600" />
                    ) : (
                      <EyeOff size={12} className="text-gray-400" />
                    )}
                  </div>
                  <p className="text-sm text-gray-700 font-medium">"{annotation.selectedText}"</p>
                  {annotation.comment && (
                    <p className="text-sm text-gray-600 mt-1">{annotation.comment}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteAnnotation(annotation.id)}
                  className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                  aria-label={`Delete ${annotation.type} annotation`}
                >
                  <Minus size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
