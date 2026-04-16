import React, { useState, useRef, useEffect } from 'react';
import {
  Highlighter,
  Underline,
  Strikethrough,
  MessageSquare,
  Eye,
  EyeOff,
  Type,
  Minus
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
  void onAnnotationUpdate;
  void onDrawingAdd;
  void onDrawingDelete;

  const [toolState, setToolState] = useState<AnnotationToolState>({
    activeTool: 'select',
    color: 'rgba(255, 255, 0, 0.5)', // Yellow highlighter with 50% opacity
    strokeWidth: 2,
    visibility: 'student_visible'
  });
  
  const [selectedText, setSelectedText] = useState<{ start: number; end: number; text: string } | null>(null);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [, setHistory] = useState<{ annotations: WritingAnnotation[]; drawings: DrawingAnnotation[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const textRef = useRef<HTMLDivElement>(null);
  
  // Save history for undo/redo
  useEffect(() => {
    if (historyIndex === -1) {
      setHistory([{ annotations, drawings }]);
      setHistoryIndex(0);
    }
  }, []);
  
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
  
  const addInlineComment = () => {
    if (!selectedText || !commentInput.trim()) return;
    
    const annotation: WritingAnnotation = {
      id: `anno-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      type: 'inline_comment',
      startOffset: selectedText.start,
      endOffset: selectedText.end,
      selectedText: selectedText.text,
      comment: commentInput,
      visibility: toolState.visibility,
      color: toolState.color,
      createdBy: currentTeacherId,
      createdAt: new Date().toISOString()
    };
    
    onAnnotationAdd(annotation);
    
    // Reset
    setSelectedText(null);
    setCommentInput('');
    setShowCommentInput(false);
    window.getSelection()?.removeAllRanges();
  };
  
  const addHighlight = () => {
    if (!selectedText) return;
    
    const annotation: WritingAnnotation = {
      id: `anno-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      type: 'highlight',
      startOffset: selectedText.start,
      endOffset: selectedText.end,
      selectedText: selectedText.text,
      comment: '',
      visibility: toolState.visibility,
      color: toolState.color,
      createdBy: currentTeacherId,
      createdAt: new Date().toISOString()
    };
    
    onAnnotationAdd(annotation);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  };
  
  const addUnderline = () => {
    if (!selectedText) return;
    
    const annotation: WritingAnnotation = {
      id: `anno-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      type: 'underline',
      startOffset: selectedText.start,
      endOffset: selectedText.end,
      selectedText: selectedText.text,
      comment: '',
      visibility: toolState.visibility,
      color: toolState.color,
      createdBy: currentTeacherId,
      createdAt: new Date().toISOString()
    };
    
    onAnnotationAdd(annotation);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  };
  
  const addStrikeThrough = () => {
    if (!selectedText) return;
    
    const annotation: WritingAnnotation = {
      id: `anno-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      type: 'strike_through',
      startOffset: selectedText.start,
      endOffset: selectedText.end,
      selectedText: selectedText.text,
      comment: '',
      visibility: toolState.visibility,
      color: toolState.color,
      createdBy: currentTeacherId,
      createdAt: new Date().toISOString()
    };
    
    onAnnotationAdd(annotation);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  };
  
  const applyCommentBankItem = (item: CommentBankItem) => {
    if (!selectedText) {
      setCommentInput(item.text);
      setShowCommentInput(true);
      return;
    }
    
    const annotation: WritingAnnotation = {
      id: `anno-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      type: 'inline_comment',
      startOffset: selectedText.start,
      endOffset: selectedText.end,
      selectedText: selectedText.text,
      comment: item.text,
      visibility: item.isStudentVisible ? 'student_visible' : 'internal_only',
      color: toolState.color,
      createdBy: currentTeacherId,
      createdAt: new Date().toISOString()
    };
    
    onAnnotationAdd(annotation);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  };
  
  const renderAnnotatedText = () => {
    if (annotations.length === 0) {
      return <div className="prose prose-lg max-w-none text-gray-800 whitespace-pre-wrap font-serif leading-relaxed">{studentText}</div>;
    }
    
    // Sort annotations by start offset
    const sortedAnnotations = [...annotations].sort((a, b) => a.startOffset - b.startOffset);
    
    const parts: Array<{ text: string; annotation?: WritingAnnotation }> = [];
    let lastIndex = 0;
    
    for (const annotation of sortedAnnotations) {
      if (annotation.startOffset > lastIndex) {
        parts.push({ text: studentText.slice(lastIndex, annotation.startOffset) });
      }
      
      parts.push({
        text: studentText.slice(annotation.startOffset, annotation.endOffset),
        annotation
      });
      
      lastIndex = annotation.endOffset;
    }
    
    if (lastIndex < studentText.length) {
      parts.push({ text: studentText.slice(lastIndex) });
    }
    
    return (
      <div className="prose prose-lg max-w-none text-gray-800 whitespace-pre-wrap font-serif leading-relaxed">
        {parts.map((part, index) => {
          if (!part.annotation) {
            return <span key={index}>{part.text}</span>;
          }
          
          const annotation = part.annotation;
          let className = '';
          let style: React.CSSProperties = {};
          
          switch (annotation.type) {
            case 'inline_comment':
              // Comments can also have highlight color
              if (annotation.color) {
                style = { backgroundColor: annotation.color };
              }
              break;
            case 'highlight':
              // Use inline style with RGBA color (Google Docs highlighter style)
              style = { backgroundColor: annotation.color || 'rgba(255, 255, 0, 0.5)' };
              break;
            case 'underline':
              style = { textDecoration: 'underline', textDecorationColor: annotation.color };
              break;
            case 'strike_through':
              style = { textDecoration: 'line-through', textDecorationColor: annotation.color };
              break;
            default:
              className = 'bg-blue-100';
          }
          
          return (
            <span
              key={index}
              className={`relative cursor-pointer ${className}`}
              style={style}
              title={annotation.comment || annotation.type}
            >
              {part.text}
              {annotation.comment && annotation.type === 'inline_comment' && (
                <span className="absolute -top-6 left-0 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                  {annotation.comment}
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
                  onClick={() => onAnnotationDelete(annotation.id)}
                  className="p-1 text-gray-400 hover:text-red-600 transition-colors"
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
