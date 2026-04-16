import React from 'react';
import { FileText, MessageSquare, BookOpen, CheckCircle, TrendingUp, AlertCircle, Download, Share2 } from 'lucide-react';
import { StudentResult, WritingAnnotation, DrawingAnnotation } from '../../types/grading';

interface StudentReportPreviewProps {
  result: StudentResult;
  writingAnnotations: WritingAnnotation[];
  writingDrawings: DrawingAnnotation[];
  onClose: () => void;
  onRelease: () => void;
  onScheduleRelease: (date: string) => void;
}

export function StudentReportPreview({
  result,
  writingAnnotations,
  writingDrawings,
  onClose,
  onRelease,
  onScheduleRelease
}: StudentReportPreviewProps) {
  void writingDrawings;
  void onScheduleRelease;

  const renderAnnotatedText = (text: string, annotations: WritingAnnotation[]) => {
    if (annotations.length === 0) {
      return <p className="text-gray-800 whitespace-pre-wrap font-serif leading-relaxed">{text}</p>;
    }
    
    const sortedAnnotations = [...annotations]
      .filter(a => a.visibility === 'student_visible')
      .sort((a, b) => a.startOffset - b.startOffset);
    
    const parts: Array<{ text: string; annotation?: WritingAnnotation }> = [];
    let lastIndex = 0;
    
    for (const annotation of sortedAnnotations) {
      if (annotation.startOffset > lastIndex) {
        parts.push({ text: text.slice(lastIndex, annotation.startOffset) });
      }
      parts.push({
        text: text.slice(annotation.startOffset, annotation.endOffset),
        annotation
      });
      lastIndex = annotation.endOffset;
    }
    
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex) });
    }
    
    return (
      <div className="text-gray-800 whitespace-pre-wrap font-serif leading-relaxed">
        {parts.map((part, index) => {
          if (!part.annotation) return <span key={index}>{part.text}</span>;
          
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
            <span key={index} className={`relative ${className}`} style={style}>
              {part.text}
              {annotation.comment && (
                <span className="absolute -top-6 left-0 bg-blue-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                  {annotation.comment}
                </span>
              )}
            </span>
          );
        })}
      </div>
    );
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Student Report Preview</h2>
              <p className="text-blue-100 text-sm">What the student will see</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <span className="text-2xl">&times;</span>
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Student Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">{result.studentName}</h3>
                <p className="text-sm text-gray-500">Released on {result.releasedAt ? new Date(result.releasedAt).toLocaleDateString() : 'Not yet released'}</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-blue-600">Band {result.overallBand}</div>
                <p className="text-sm text-gray-500">Overall Score</p>
              </div>
            </div>
          </div>
          
          {/* Section Bands */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Listening', band: result.sectionBands.listening, icon: <BookOpen size={16} /> },
              { label: 'Reading', band: result.sectionBands.reading, icon: <BookOpen size={16} /> },
              { label: 'Writing', band: result.sectionBands.writing, icon: <FileText size={16} /> },
              { label: 'Speaking', band: result.sectionBands.speaking, icon: <MessageSquare size={16} /> }
            ].map((section) => (
              <div key={section.label} className="bg-white border border-gray-200 rounded-lg p-4 text-center">
                <div className="flex items-center justify-center gap-2 text-gray-500 mb-2">
                  {section.icon}
                  <span className="text-sm font-medium">{section.label}</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">Band {section.band}</div>
              </div>
            ))}
          </div>
          
          {/* Writing Results */}
          {result.writingResults.task1 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <FileText size={18} className="text-blue-600" />
                  Writing Task 1
                </h3>
              </div>
              <div className="p-4 space-y-4">
                {/* Rubric Scores */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Task Response', score: result.writingResults.task1.rubricScores.taskResponse },
                    { label: 'Coherence & Cohesion', score: result.writingResults.task1.rubricScores.coherence },
                    { label: 'Lexical Resource', score: result.writingResults.task1.rubricScores.lexical },
                    { label: 'Grammar', score: result.writingResults.task1.rubricScores.grammar }
                  ].map((criterion) => (
                    <div key={criterion.label} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-sm text-gray-600">{criterion.label}</span>
                      <span className="font-bold text-gray-900">Band {criterion.score}</span>
                    </div>
                  ))}
                </div>
                
                {/* Criterion Feedback */}
                {result.writingResults.task1.criterionFeedback && (
                  <div className="space-y-2">
                    {Object.entries(result.writingResults.task1.criterionFeedback).map(([key, value]) => (
                      value && (
                        <div key={key} className="p-3 bg-blue-50 rounded-lg">
                          <p className="text-sm font-medium text-blue-900 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                          <p className="text-sm text-blue-800 mt-1">{value}</p>
                        </div>
                      )
                    ))}
                  </div>
                )}
                
                {/* Annotated Text */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <h4 className="font-medium text-gray-700 mb-2">Your Response (with annotations)</h4>
                  {renderAnnotatedText(result.writingResults.task1.studentText, writingAnnotations.filter(a => a.taskId === result.writingResults.task1!.taskId))}
                </div>
              </div>
            </div>
          )}
          
          {result.writingResults.task2 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <FileText size={18} className="text-blue-600" />
                  Writing Task 2
                </h3>
              </div>
              <div className="p-4 space-y-4">
                {/* Rubric Scores */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Task Response', score: result.writingResults.task2.rubricScores.taskResponse },
                    { label: 'Coherence & Cohesion', score: result.writingResults.task2.rubricScores.coherence },
                    { label: 'Lexical Resource', score: result.writingResults.task2.rubricScores.lexical },
                    { label: 'Grammar', score: result.writingResults.task2.rubricScores.grammar }
                  ].map((criterion) => (
                    <div key={criterion.label} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-sm text-gray-600">{criterion.label}</span>
                      <span className="font-bold text-gray-900">Band {criterion.score}</span>
                    </div>
                  ))}
                </div>
                
                {/* Criterion Feedback */}
                {result.writingResults.task2.criterionFeedback && (
                  <div className="space-y-2">
                    {Object.entries(result.writingResults.task2.criterionFeedback).map(([key, value]) => (
                      value && (
                        <div key={key} className="p-3 bg-blue-50 rounded-lg">
                          <p className="text-sm font-medium text-blue-900 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                          <p className="text-sm text-blue-800 mt-1">{value}</p>
                        </div>
                      )
                    ))}
                  </div>
                )}
                
                {/* Annotated Text */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <h4 className="font-medium text-gray-700 mb-2">Your Response (with annotations)</h4>
                  {renderAnnotatedText(result.writingResults.task2.studentText, writingAnnotations.filter(a => a.taskId === result.writingResults.task2!.taskId))}
                </div>
              </div>
            </div>
          )}
          
          {/* Teacher Summary */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <CheckCircle size={18} className="text-emerald-600" />
                Teacher Summary
              </h3>
            </div>
            <div className="p-4 space-y-4">
              {/* Strengths */}
              {result.teacherSummary.strengths.length > 0 && (
                <div className="p-3 bg-emerald-50 rounded-lg">
                  <h4 className="font-medium text-emerald-900 mb-2 flex items-center gap-2">
                    <TrendingUp size={16} />
                    Strengths
                  </h4>
                  <ul className="space-y-1">
                    {result.teacherSummary.strengths.map((strength, index) => (
                      <li key={index} className="text-sm text-emerald-800 flex items-start gap-2">
                        <span className="text-emerald-600 mt-1">•</span>
                        {strength}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Improvement Priorities */}
              {result.teacherSummary.improvementPriorities.length > 0 && (
                <div className="p-3 bg-amber-50 rounded-lg">
                  <h4 className="font-medium text-amber-900 mb-2 flex items-center gap-2">
                    <AlertCircle size={16} />
                    Top 3 Improvement Priorities
                  </h4>
                  <ul className="space-y-1">
                    {result.teacherSummary.improvementPriorities.map((priority, index) => (
                      <li key={index} className="text-sm text-amber-800 flex items-start gap-2">
                        <span className="text-amber-600 mt-1">{index + 1}.</span>
                        {priority}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Recommended Practice */}
              {result.teacherSummary.recommendedPractice.length > 0 && (
                <div className="p-3 bg-blue-50 rounded-lg">
                  <h4 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
                    <BookOpen size={16} />
                    Recommended Next Practice Tasks
                  </h4>
                  <ul className="space-y-1">
                    {result.teacherSummary.recommendedPractice.map((practice, index) => (
                      <li key={index} className="text-sm text-blue-800 flex items-start gap-2">
                        <span className="text-blue-600 mt-1">•</span>
                        {practice}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Footer Actions */}
        <div className="bg-gray-50 border-t border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                <Download size={16} />
                Download PDF
              </button>
              <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                <Share2 size={16} />
                Share Link
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Back to Edit
              </button>
              <button
                onClick={onRelease}
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
              >
                Release Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
