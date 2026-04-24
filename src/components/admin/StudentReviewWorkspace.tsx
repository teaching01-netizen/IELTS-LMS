import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  ArrowLeft, Save, CheckCircle, Clock, FileText,
  MessageSquare, BookOpen, ChevronLeft, ChevronRight, Eye, Calendar,
  CheckSquare, AlertTriangle
} from 'lucide-react';
import { 
  StudentSubmission, SectionSubmission, WritingTaskSubmission, ReviewDraft, 
  RubricAssessment, ReleaseStatus, GradingChecklist,
  WritingAnnotation, DrawingAnnotation, CommentBankItem
} from '../../types/grading';
import { gradingService } from '../../services/gradingService';
import { gradingRepository } from '../../services/gradingRepository';
import { examRepository } from '../../services/examRepository';
import type { ExamState, WritingTaskContent } from '../../types';
import {
  getQuestionNumberLabel,
  getStudentQuestionsForModule,
  hydrateExamState,
} from '../../services/examAdapterService';
import type { StudentQuestionDescriptor } from '../../services/examAdapterService';
import { WritingAnnotationCanvas } from './WritingAnnotationCanvas';
import { StudentReportPreview } from './StudentReportPreview';
import { logger } from '../../utils/logger';
import { SectionLoadingSkeleton } from '@components/ui';
import {
  extractObjectiveAnswerMap,
  getCorrectAnswerDisplay,
  getQuestionPrompt,
  getStudentAnswerDisplay,
  isStudentAnswerCorrect,
} from './gradingAnswerUtils';

export interface StudentReviewWorkspaceProps {
  submissionId: string;
  onBack: () => void;
  onNextStudent?: (() => void) | undefined;
  onPreviousStudent?: (() => void) | undefined;
  currentTeacherId: string;
  currentTeacherName: string;
}

export const StudentReviewWorkspace = React.memo(function StudentReviewWorkspace({ 
  submissionId, 
  onBack, 
  onNextStudent,
  onPreviousStudent,
  currentTeacherId, 
  currentTeacherName 
}: StudentReviewWorkspaceProps) {
  void onNextStudent;
  void onPreviousStudent;

  const [submission, setSubmission] = useState<StudentSubmission | null>(null);
  const [sectionSubmissions, setSectionSubmissions] = useState<SectionSubmission[]>([]);
  const [writingSubmissions, setWritingSubmissions] = useState<WritingTaskSubmission[]>([]);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null);
  const [examState, setExamState] = useState<ExamState | null>(null);
  const [examLoading, setExamLoading] = useState(false);
  const [examError, setExamError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'listening' | 'reading' | 'writing' | 'speaking'>('reading');
  const [activeTask, setActiveTask] = useState<string>('task1');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const examLoadSeq = useRef(0);
  const [releaseAction, setReleaseAction] = useState<
    | 'mark_grading_complete'
    | 'mark_ready_to_release'
    | 'release_now'
    | 'schedule_release'
    | 'reopen'
    | null
  >(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [commentBank] = useState<CommentBankItem[]>([
    { id: '1', category: 'grammar', label: 'Subject-verb agreement', text: 'Check subject-verb agreement in this sentence.', isStudentVisible: true, createdBy: 'system', createdAt: '', usageCount: 0 },
    { id: '2', category: 'vocabulary', label: 'Word choice', text: 'Consider using a more precise vocabulary word here.', isStudentVisible: true, createdBy: 'system', createdAt: '', usageCount: 0 },
    { id: '3', category: 'coherence', label: 'Transition needed', text: 'Add a transition word to improve flow between ideas.', isStudentVisible: true, createdBy: 'system', createdAt: '', usageCount: 0 },
    { id: '4', category: 'task_response', label: 'Address the prompt', text: 'Ensure you fully address all parts of the prompt.', isStudentVisible: true, createdBy: 'system', createdAt: '', usageCount: 0 },
  ]);

  useEffect(() => {
    loadData();
  }, [submissionId]);

  useEffect(() => {
    const publishedVersionId = submission?.publishedVersionId;
    if (!publishedVersionId) {
      setExamState(null);
      setExamError(null);
      setExamLoading(false);
      return;
    }

    const seq = (examLoadSeq.current += 1);
    setExamLoading(true);
    setExamError(null);

    void (async () => {
      try {
        const version = await examRepository.getVersionById(publishedVersionId);
        if (seq !== examLoadSeq.current) return;

        if (!version) {
          setExamState(null);
          setExamError('Exam version not found for this submission.');
          return;
        }

        setExamState(hydrateExamState(version.contentSnapshot as ExamState));
      } catch (error) {
        if (seq !== examLoadSeq.current) return;
        setExamState(null);
        setExamError(error instanceof Error ? error.message : 'Failed to load exam version.');
      } finally {
        if (seq === examLoadSeq.current) {
          setExamLoading(false);
        }
      }
    })();
  }, [submission?.publishedVersionId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [subData, sectionsData, writingsData] = await Promise.all([
        gradingRepository.getSubmissionById(submissionId),
        gradingRepository.getSectionSubmissionsBySubmissionId(submissionId),
        gradingRepository.getWritingSubmissionsBySubmissionId(submissionId)
      ]);

      setSubmission(subData);
      setSectionSubmissions(sectionsData);
      setWritingSubmissions(writingsData);

      // Load or create review draft
      const existingDraft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (existingDraft) {
        setReviewDraft(existingDraft);
      } else if (subData) {
        const result = await gradingService.startReview(submissionId, currentTeacherId, currentTeacherName);
        if (result.success && result.data) {
          // Initialize with default checklist
          const initializedDraft = {
            ...result.data,
            releaseStatus: 'draft' as ReleaseStatus,
            drawings: [],
            checklist: {
              listeningReviewed: false,
              readingReviewed: false,
              writingTask1Reviewed: false,
              writingTask2Reviewed: false,
              speakingReviewed: false,
              overallFeedbackWritten: false,
              rubricComplete: false,
              annotationsComplete: false
            }
          };
          setReviewDraft(initializedDraft);
        }
      }
    } catch (error) {
      logger.error('Failed to load submission:', error);
    }
    setLoading(false);
  }, [submissionId, currentTeacherId, currentTeacherName]);

  const handleSaveDraft = async () => {
    if (!reviewDraft) return;
    setSaving(true);
    const result = await gradingService.saveReviewDraft(reviewDraft, currentTeacherId, currentTeacherName);
    if (result.success && result.data) {
      setReviewDraft(result.data);
    }
    setSaving(false);
  };

  const handleMarkGradingComplete = async () => {
    if (!reviewDraft) return;
    setReleaseAction('mark_grading_complete');
    setReleaseError(null);
    try {
      const result = await gradingService.markGradingComplete(
        submissionId,
        currentTeacherId,
        currentTeacherName,
      );
      if (result.success && result.data) {
        setReviewDraft(result.data);
      } else {
        throw new Error(result.error ?? 'Failed to mark grading complete');
      }
    } catch (error) {
      logger.error('Failed to mark grading complete:', error);
      setReleaseError(error instanceof Error ? error.message : 'Failed to mark grading complete.');
    } finally {
      setReleaseAction(null);
    }
  };

  const handleMarkReadyToRelease = async () => {
    if (!reviewDraft) return;
    setReleaseAction('mark_ready_to_release');
    setReleaseError(null);
    try {
      const result = await gradingService.markReadyToRelease(
        submissionId,
        currentTeacherId,
        currentTeacherName,
      );
      if (result.success && result.data) {
        setReviewDraft(result.data);
      } else {
        throw new Error(result.error ?? 'Failed to mark ready to release');
      }
    } catch (error) {
      logger.error('Failed to mark ready to release:', error);
      setReleaseError(error instanceof Error ? error.message : 'Failed to mark ready to release.');
    } finally {
      setReleaseAction(null);
    }
  };

  const handleReleaseNow = async () => {
    if (!reviewDraft) return;
    setReleaseAction('release_now');
    setReleaseError(null);
    try {
      const result = await gradingService.releaseResult(
        submissionId,
        currentTeacherId,
        currentTeacherName,
      );
      if (result.success) {
        await loadData();
      } else {
        throw new Error(result.error ?? 'Failed to release result');
      }
    } catch (error) {
      logger.error('Failed to release result:', error);
      setReleaseError(error instanceof Error ? error.message : 'Failed to release result.');
    } finally {
      setReleaseAction(null);
    }
  };

  const handleScheduleRelease = async (date: string) => {
    if (!reviewDraft) return;
    setReleaseAction('schedule_release');
    setReleaseError(null);
    try {
      const result = await gradingService.scheduleRelease(
        submissionId,
        date,
        currentTeacherId,
        currentTeacherName,
      );
      if (result.success && result.data) {
        setReviewDraft(result.data);
      } else {
        throw new Error(result.error ?? 'Failed to schedule release');
      }
    } catch (error) {
      logger.error('Failed to schedule release:', error);
      setReleaseError(error instanceof Error ? error.message : 'Failed to schedule release.');
    } finally {
      setReleaseAction(null);
    }
  };

  const handleReopen = async () => {
    if (!reviewDraft) return;
    setReleaseAction('reopen');
    setReleaseError(null);
    try {
      const result = await gradingService.reopenReview(
        submissionId,
        currentTeacherId,
        currentTeacherName,
        'Manual reopen',
      );
      if (result.success && result.data) {
        setReviewDraft(result.data);
      } else {
        throw new Error(result.error ?? 'Failed to reopen review');
      }
    } catch (error) {
      logger.error('Failed to reopen review:', error);
      setReleaseError(error instanceof Error ? error.message : 'Failed to reopen review.');
    } finally {
      setReleaseAction(null);
    }
  };

  const updateRubricAssessment = (section: 'listening' | 'reading' | 'writing' | 'speaking', assessment: Partial<RubricAssessment>, taskId?: string) => {
    if (!reviewDraft) return;
    
    const updatedDraft = { ...reviewDraft };
    if (section === 'writing' && taskId) {
      if (!updatedDraft.sectionDrafts.writing) {
        updatedDraft.sectionDrafts.writing = {};
      }
      updatedDraft.sectionDrafts.writing[taskId as 'task1' | 'task2'] = {
        ...updatedDraft.sectionDrafts.writing[taskId as 'task1' | 'task2'],
        ...assessment
      } as RubricAssessment;
    } else {
      updatedDraft.sectionDrafts[section] = {
        ...updatedDraft.sectionDrafts[section],
        ...assessment
      } as RubricAssessment;
    }
    
    updatedDraft.hasUnsavedChanges = true;
    setReviewDraft(updatedDraft);
  };

  const updateChecklist = (updates: Partial<GradingChecklist>) => {
    if (!reviewDraft) return;
    const updatedDraft = {
      ...reviewDraft,
      checklist: { ...reviewDraft.checklist, ...updates },
      hasUnsavedChanges: true
    };
    setReviewDraft(updatedDraft);
  };

  const handleAnnotationAdd = (annotation: WritingAnnotation) => {
    if (!reviewDraft) return;
    const updatedDraft = {
      ...reviewDraft,
      annotations: [...reviewDraft.annotations, annotation],
      hasUnsavedChanges: true
    };
    setReviewDraft(updatedDraft);
  };

  const handleAnnotationDelete = (annotationId: string) => {
    if (!reviewDraft) return;
    const updatedDraft = {
      ...reviewDraft,
      annotations: reviewDraft.annotations.filter(a => a.id !== annotationId),
      hasUnsavedChanges: true
    };
    setReviewDraft(updatedDraft);
  };

  const handleDrawingAdd = (drawing: DrawingAnnotation) => {
    if (!reviewDraft) return;
    const updatedDraft = {
      ...reviewDraft,
      drawings: [...reviewDraft.drawings, drawing],
      hasUnsavedChanges: true
    };
    setReviewDraft(updatedDraft);
  };

  const getSectionSubmission = (section: 'listening' | 'reading' | 'writing' | 'speaking') => {
    return sectionSubmissions.find(s => s.section === section);
  };

  const getWritingTaskSubmission = (taskId: string) => {
    return writingSubmissions.find(w => w.taskId === taskId);
  };

  const writingTasks = useMemo<WritingTaskContent[]>(() => {
    const tasks = examState?.writing?.tasks;
    if (Array.isArray(tasks) && tasks.length > 0) {
      return tasks;
    }

    return [
      {
        taskId: 'task1',
        prompt: examState?.writing?.task1Prompt ?? '',
        chart: examState?.writing?.task1Chart,
      },
      {
        taskId: 'task2',
        prompt: examState?.writing?.task2Prompt ?? '',
      },
    ];
  }, [examState]);

  useEffect(() => {
    if (activeSection !== 'writing') return;
    if (writingTasks.some((task) => task.taskId === activeTask)) return;
    setActiveTask(writingTasks[0]?.taskId ?? 'task1');
  }, [activeSection, activeTask, writingTasks]);

  const getWritingPrompt = useCallback((taskId: string) => {
    const fromSubmission = getWritingTaskSubmission(taskId)?.prompt;
    if (typeof fromSubmission === 'string' && fromSubmission.trim() !== '') {
      return fromSubmission;
    }
    return writingTasks.find((task) => task.taskId === taskId)?.prompt ?? '';
  }, [writingSubmissions, writingTasks]);

  const getWritingResponseText = useCallback((taskId: string) => {
    const fromWritingTasks = getWritingTaskSubmission(taskId)?.studentText;
    if (typeof fromWritingTasks === 'string' && fromWritingTasks.trim() !== '') {
      return fromWritingTasks;
    }

    const writingSection = getSectionSubmission('writing');
    const sectionAnswers = (writingSection?.answers as unknown) as Record<string, unknown> | null;
    const tasks = sectionAnswers && typeof sectionAnswers === 'object' ? (sectionAnswers['tasks'] as unknown) : null;
    if (Array.isArray(tasks)) {
      const match = tasks.find(
        (entry): entry is { taskId?: unknown; text?: unknown } =>
          Boolean(entry) && typeof entry === 'object' && (entry as any).taskId === taskId,
      );
      const text = match?.text;
      if (typeof text === 'string' && text.trim() !== '') {
        return text;
      }
    }

    return '';
  }, [sectionSubmissions, writingSubmissions]);

  const getReleaseStatusBadge = (status: ReleaseStatus) => {
    const styles = {
      draft: 'bg-gray-100 text-gray-700',
      grading_complete: 'bg-blue-100 text-blue-700',
      ready_to_release: 'bg-amber-100 text-amber-700',
      released: 'bg-emerald-100 text-emerald-700',
      reopened: 'bg-purple-100 text-purple-700'
    };
    const labels = {
      draft: 'Draft',
      grading_complete: 'Grading Complete',
      ready_to_release: 'Ready to Release',
      released: 'Released',
      reopened: 'Reopened'
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  if (loading || !submission) {
    return (
      <div className="h-full bg-gray-50">
        <SectionLoadingSkeleton message="Loading review workspace..." />
      </div>
    );
  }

  const currentSectionSubmission = getSectionSubmission(activeSection);
  const objectiveAnswerMap = currentSectionSubmission
    ? extractObjectiveAnswerMap(currentSectionSubmission.answers)
    : {};
  const objectiveDescriptors: StudentQuestionDescriptor[] =
    examState && (activeSection === 'reading' || activeSection === 'listening')
      ? getStudentQuestionsForModule(examState, activeSection)
      : [];
  const currentWritingTaskId = activeSection === 'writing' ? activeTask : null;
  const currentWritingPrompt = currentWritingTaskId ? getWritingPrompt(currentWritingTaskId) : '';
  const currentWritingText = currentWritingTaskId ? getWritingResponseText(currentWritingTaskId) : '';

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} aria-label="Back" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft size={20} className="text-gray-600" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-medium">
                {submission.studentName.charAt(0)}
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">{submission.studentName}</h1>
                <p className="text-sm text-gray-500">{submission.cohortName} • {submission.examId}</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {reviewDraft && getReleaseStatusBadge(reviewDraft.releaseStatus)}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock size={16} />
              <span>Submitted {new Date(submission.submittedAt).toLocaleString()}</span>
            </div>
            <button
              onClick={handleSaveDraft}
              disabled={!reviewDraft?.hasUnsavedChanges || saving}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Rail - Student Info, Navigation, Checklist */}
        <div className="w-72 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          {/* Student Overview */}
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Student Overview</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Status</span>
                {getReleaseStatusBadge(reviewDraft?.releaseStatus || 'draft')}
              </div>
              {submission.assignedTeacherName && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Grader</span>
                  <span className="text-gray-900">{submission.assignedTeacherName}</span>
                </div>
              )}
              {submission.isFlagged && (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle size={14} />
                  <span className="text-xs">Flagged: {submission.flagReason}</span>
                </div>
              )}
            </div>
          </div>

          {/* Section Navigation */}
          <div className="p-4 border-b border-gray-200 overflow-y-auto flex-1">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Sections</h2>
            <div className="space-y-1">
              {(['listening', 'reading', 'writing', 'speaking'] as const).map((section) => {
                const sectionSub = getSectionSubmission(section);
                return (
                  <button
                    key={section}
                    onClick={() => {
                      setActiveSection(section);
                      if (section === 'writing') setActiveTask('task1');
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeSection === section 
                        ? 'bg-blue-50 text-blue-700' 
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="capitalize">{section}</span>
                    {sectionSub && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        sectionSub.gradingStatus === 'finalized' 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : sectionSub.gradingStatus === 'in_review'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}>
                        {sectionSub.gradingStatus}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeSection === 'writing' && (
              <>
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 mt-6">Writing Tasks</h2>
                <div className="space-y-1">
                  {writingTasks.map((task, index) => (
                    <button
                      key={task.taskId}
                      onClick={() => setActiveTask(task.taskId)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        activeTask === task.taskId
                          ? 'bg-blue-50 text-blue-700' 
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="capitalize">
                        {task.taskId === 'task1'
                          ? 'Task 1'
                          : task.taskId === 'task2'
                            ? 'Task 2'
                            : `Task ${index + 1}`}
                      </span>
                      {getWritingTaskSubmission(task.taskId) && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          getWritingTaskSubmission(task.taskId)!.gradingStatus === 'finalized' 
                            ? 'bg-emerald-100 text-emerald-700' 
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {getWritingTaskSubmission(task.taskId)!.gradingStatus}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Grading Checklist */}
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Grading Checklist</h2>
            <div className="space-y-2">
              {Object.entries(reviewDraft?.checklist || {}).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => updateChecklist({ [key]: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-700 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Next/Previous Student */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex gap-2">
              <button
                onClick={onPreviousStudent}
                disabled={!onPreviousStudent}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <button
                onClick={onNextStudent}
                disabled={!onNextStudent}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Center Canvas - Evidence with Annotations */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Section Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2 capitalize">{activeSection}</h2>
              {currentSectionSubmission && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Clock size={14} />
                  <span>Submitted {new Date(currentSectionSubmission.submittedAt).toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Writing Task with Annotation Canvas */}
            {activeSection === 'writing' && currentWritingTaskId && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {writingSubmissions.length === 0 && (
                  <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900 flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 text-amber-700" />
                    <div>
                      <p className="font-medium">Writing response may be missing</p>
                      <p className="text-amber-800">
                        No `writingTasks` rows were returned for this submission. The student may not have answered writing, or writing was not persisted.
                      </p>
                    </div>
                  </div>
                )}
                {/* Prompt */}
                <div className="p-6 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={18} className="text-blue-600" />
                    <h3 className="font-bold text-gray-900">Prompt</h3>
                  </div>
                  <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap">
                    {currentWritingPrompt || <span className="text-gray-500">Prompt unavailable.</span>}
                  </div>
                  {!currentWritingText && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      No writing response recorded for this task.
                    </div>
                  )}
                </div>

                {/* Annotation Canvas */}
                <div className="p-6">
                  <WritingAnnotationCanvas
                    taskId={currentWritingTaskId}
                    studentText={currentWritingText}
                    annotations={(reviewDraft?.annotations || []).filter(a => a.taskId === currentWritingTaskId)}
                    drawings={(reviewDraft?.drawings || []).filter(d => d.taskId === currentWritingTaskId)}
                    commentBank={commentBank}
                    currentTeacherId={currentTeacherId}
                    onAnnotationAdd={handleAnnotationAdd}
                    onAnnotationUpdate={(a) => handleAnnotationAdd(a)}
                    onAnnotationDelete={handleAnnotationDelete}
                    onDrawingAdd={handleDrawingAdd}
                    onDrawingDelete={() => {}}
                  />
                </div>
              </div>
            )}

            {/* Reading/Listening Content */}
            {(activeSection === 'reading' || activeSection === 'listening') && currentSectionSubmission && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={18} className="text-blue-600" />
                    <h3 className="font-bold text-gray-900">Objective Answers</h3>
                  </div>
                  {examLoading && (
                    <span className="text-xs font-medium text-gray-500">Loading exam…</span>
                  )}
                </div>

                {examError && (
                  <div className="px-6 py-4 border-b border-gray-200 bg-red-50 text-sm text-red-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="mt-0.5 text-red-700" />
                      <div>
                        <p className="font-medium">Could not load exam content</p>
                        <p className="mt-1">{examError}</p>
                        <p className="mt-2 text-red-700">Showing raw answers from the submission bundle:</p>
                      </div>
                    </div>
                    <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-white p-3 text-xs text-gray-800">
                      {JSON.stringify(objectiveAnswerMap, null, 2)}
                    </pre>
                  </div>
                )}

                {!examError && objectiveDescriptors.length === 0 && (
                  <div className="px-6 py-6 text-sm text-gray-700">
                    <p className="font-medium text-gray-900">No question schema available</p>
                    <p className="mt-1 text-gray-600">
                      The exam version loaded, but no questions were found for this section. Showing raw answers:
                    </p>
                    <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                      {JSON.stringify(objectiveAnswerMap, null, 2)}
                    </pre>
                  </div>
                )}

                {!examError && objectiveDescriptors.length > 0 && (
                  <div className="divide-y divide-gray-200">
                    {Object.entries(
                      objectiveDescriptors.reduce<Record<string, { label: string; items: StudentQuestionDescriptor[] }>>(
                        (acc, descriptor) => {
                          const key = descriptor.groupId || descriptor.groupLabel || 'group';
                          if (!acc[key]) {
                            acc[key] = { label: descriptor.groupLabel || 'Group', items: [] };
                          }
                          acc[key]!.items.push(descriptor);
                          return acc;
                        },
                        {},
                      ),
                    ).map(([groupId, group]) => (
                      <div key={groupId} className="px-6 py-5">
                        <h4 className="text-sm font-bold text-gray-900">{group.label}</h4>
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
                                <th className="py-2 pr-4 font-medium">#</th>
                                <th className="py-2 pr-4 font-medium">Prompt</th>
                                <th className="py-2 pr-4 font-medium">Student</th>
                                <th className="py-2 pr-4 font-medium">Correct</th>
                                <th className="py-2 font-medium text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="text-sm text-gray-800">
                              {group.items.map((descriptor) => {
                                const number = getQuestionNumberLabel(objectiveDescriptors, descriptor.id);
                                const studentText = getStudentAnswerDisplay(descriptor, objectiveAnswerMap);
                                const correctText = getCorrectAnswerDisplay(descriptor);
                                const correctness = isStudentAnswerCorrect(descriptor, objectiveAnswerMap);
                                const prompt = getQuestionPrompt(descriptor);

                                return (
                                  <tr key={descriptor.id} className="border-b border-gray-100 last:border-b-0 align-top">
                                    <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{number}</td>
                                    <td className="py-3 pr-4">
                                      <div className="text-gray-900">{prompt || <span className="text-gray-500">—</span>}</div>
                                    </td>
                                    <td className="py-3 pr-4">
                                      <div className="whitespace-pre-wrap break-words">{studentText || <span className="text-gray-500">—</span>}</div>
                                    </td>
                                    <td className="py-3 pr-4">
                                      <div className="whitespace-pre-wrap break-words">{correctText || <span className="text-gray-500">—</span>}</div>
                                    </td>
                                    <td className="py-3 text-right">
                                      {correctness === null ? (
                                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                                          —
                                        </span>
                                      ) : correctness ? (
                                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                          Correct
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                          Incorrect
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Speaking Content */}
            {activeSection === 'speaking' && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <MessageSquare size={18} className="text-blue-600" />
                  <h3 className="font-bold text-gray-900">Speaking Assessment</h3>
                </div>
                <div className="text-sm text-gray-600">
                  <p>Speaking submissions will display audio recordings and transcripts here.</p>
                  <p className="mt-2">This section is deferred until recording/transcript persistence is implemented.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Rail - Rubric, Score Summary, Release Controls */}
        <div className="w-96 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
          {/* Rubric Assessment */}
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Rubric Assessment</h2>
            
            {activeSection === 'writing' && currentWritingTaskId && (
              <div className="space-y-4">
                {[
                  { key: 'taskResponseBand', label: 'Task Response', notesKey: 'taskResponseNotes' },
                  { key: 'coherenceBand', label: 'Coherence & Cohesion', notesKey: 'coherenceNotes' },
                  { key: 'lexicalBand', label: 'Lexical Resource', notesKey: 'lexicalNotes' },
                  { key: 'grammarBand', label: 'Grammar', notesKey: 'grammarNotes' }
                ].map((criterion) => (
                  <div key={criterion.key} className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">
                      {criterion.label}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="9"
                      step="0.5"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="0-9"
                      value={
                        ((reviewDraft?.sectionDrafts as any)?.writing?.[activeTask]?.[
                          criterion.key as keyof RubricAssessment
                        ] as number | undefined) ?? ''
                      }
                      onChange={(e) => updateRubricAssessment('writing', {
                        [criterion.key]: parseFloat(e.target.value) || 0
                      }, activeTask)}
                    />
                    <textarea
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                      rows={2}
                      placeholder="Notes..."
                      value={
                        ((reviewDraft?.sectionDrafts as any)?.writing?.[activeTask]?.[
                          criterion.notesKey as keyof RubricAssessment
                        ] as string | undefined) ?? ''
                      }
                      onChange={(e) => updateRubricAssessment('writing', {
                        [criterion.notesKey]: e.target.value
                      }, activeTask)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-gray-200">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Student-Visible Feedback</h2>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                rows={4}
                placeholder="Summary feedback visible to student..."
                value={reviewDraft?.overallFeedback || ''}
                onChange={(e) => {
                  if (reviewDraft) {
                    setReviewDraft({ ...reviewDraft, overallFeedback: e.target.value, hasUnsavedChanges: true });
                  }
                }}
              />
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Internal Notes</h2>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                rows={4}
                placeholder="Private grader notes (not visible to student)..."
                value={reviewDraft?.internalNotes || ''}
                onChange={(e) => {
                  if (reviewDraft) {
                    setReviewDraft({ ...reviewDraft, internalNotes: e.target.value, hasUnsavedChanges: true });
                  }
                }}
              />
            </div>

            {/* Teacher Summary for Result */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Teacher Summary</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Strengths</label>
                  <textarea
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                    rows={2}
                    placeholder="List strengths (one per line)"
                    value={reviewDraft?.teacherSummary?.strengths?.join('\n') || ''}
                    onChange={(e) => {
                      if (reviewDraft) {
                        setReviewDraft({
                          ...reviewDraft,
                          teacherSummary: {
                            ...reviewDraft.teacherSummary,
                            strengths: e.target.value.split('\n').filter(s => s.trim()),
                            improvementPriorities: reviewDraft.teacherSummary?.improvementPriorities || [],
                            recommendedPractice: reviewDraft.teacherSummary?.recommendedPractice || []
                          },
                          hasUnsavedChanges: true
                        });
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Top 3 Improvement Priorities</label>
                  <textarea
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                    rows={2}
                    placeholder="List priorities (one per line)"
                    value={reviewDraft?.teacherSummary?.improvementPriorities?.join('\n') || ''}
                    onChange={(e) => {
                      if (reviewDraft) {
                        setReviewDraft({
                          ...reviewDraft,
                          teacherSummary: {
                            ...reviewDraft.teacherSummary,
                            strengths: reviewDraft.teacherSummary?.strengths || [],
                            improvementPriorities: e.target.value.split('\n').filter(s => s.trim()),
                            recommendedPractice: reviewDraft.teacherSummary?.recommendedPractice || []
                          },
                          hasUnsavedChanges: true
                        });
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Recommended Practice</label>
                  <textarea
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                    rows={2}
                    placeholder="List practice tasks (one per line)"
                    value={reviewDraft?.teacherSummary?.recommendedPractice?.join('\n') || ''}
                    onChange={(e) => {
                      if (reviewDraft) {
                        setReviewDraft({
                          ...reviewDraft,
                          teacherSummary: {
                            ...reviewDraft.teacherSummary,
                            strengths: reviewDraft.teacherSummary?.strengths || [],
                            improvementPriorities: reviewDraft.teacherSummary?.improvementPriorities || [],
                            recommendedPractice: e.target.value.split('\n').filter(s => s.trim())
                          },
                          hasUnsavedChanges: true
                        });
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Release Controls */}
          <div className="p-4 border-t border-gray-200 bg-gray-50 space-y-3">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Release Workflow</h2>

            {releaseError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="status" aria-live="polite">
                {releaseError}
              </div>
            ) : null}
            
            {reviewDraft?.releaseStatus === 'draft' && (
              <button
                onClick={handleMarkGradingComplete}
                disabled={releaseAction !== null}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckSquare size={16} />
                {releaseAction === 'mark_grading_complete' ? 'Working…' : 'Mark Grading Complete'}
              </button>
            )}
            
            {reviewDraft?.releaseStatus === 'grading_complete' && (
              <button
                onClick={handleMarkReadyToRelease}
                disabled={releaseAction !== null}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckSquare size={16} />
                {releaseAction === 'mark_ready_to_release' ? 'Working…' : 'Mark Ready to Release'}
              </button>
            )}
            
            {reviewDraft?.releaseStatus === 'ready_to_release' && (
              <>
                <button
                  onClick={() => setShowReportPreview(true)}
                  disabled={releaseAction !== null}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Eye size={16} />
                  Preview as Student
                </button>
                <button
                  onClick={handleReleaseNow}
                  disabled={releaseAction !== null}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md text-sm font-medium hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCircle size={16} />
                  {releaseAction === 'release_now' ? 'Releasing…' : 'Release Now'}
                </button>
                <button
                  onClick={() => {
                    const date = prompt('Enter release date (YYYY-MM-DD):');
                    if (date) handleScheduleRelease(date);
                  }}
                  disabled={releaseAction !== null}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Calendar size={16} />
                  {releaseAction === 'schedule_release' ? 'Scheduling…' : 'Schedule Release'}
                </button>
              </>
            )}
            
            {reviewDraft?.releaseStatus === 'released' && (
              <button
                onClick={handleReopen}
                disabled={releaseAction !== null}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {releaseAction === 'reopen' ? 'Working…' : 'Reopen Result'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Report Preview Modal */}
      {showReportPreview && reviewDraft && (
        <StudentReportPreview
          result={{
            id: 'preview',
            submissionId: reviewDraft.submissionId,
            studentId: reviewDraft.studentId,
            studentName: submission.studentName,
            releaseStatus: reviewDraft.releaseStatus,
            overallBand: 6.5,
            sectionBands: {
              listening: 6.0,
              reading: 6.5,
              writing: 6.5,
              speaking: 6.5
            },
            writingResults: {
              task1: currentWritingTaskId ? {
                taskId: currentWritingTaskId,
                taskLabel: currentWritingTaskId === 'task1' ? 'Task 1' : currentWritingTaskId === 'task2' ? 'Task 2' : 'Writing Task',
                prompt: currentWritingPrompt,
                studentText: currentWritingText,
                wordCount: currentWritingText ? currentWritingText.trim().split(/\s+/).filter(Boolean).length : 0,
                rubricScores: {
                  taskResponse: ((reviewDraft.sectionDrafts as any)?.writing?.[currentWritingTaskId]?.taskResponseBand as number | undefined) ?? 6,
                  coherence: ((reviewDraft.sectionDrafts as any)?.writing?.[currentWritingTaskId]?.coherenceBand as number | undefined) ?? 6,
                  lexical: ((reviewDraft.sectionDrafts as any)?.writing?.[currentWritingTaskId]?.lexicalBand as number | undefined) ?? 6,
                  grammar: ((reviewDraft.sectionDrafts as any)?.writing?.[currentWritingTaskId]?.grammarBand as number | undefined) ?? 6
                },
                annotations: reviewDraft.annotations.filter(a => a.taskId === currentWritingTaskId && a.visibility === 'student_visible'),
                drawings: reviewDraft.drawings.filter(d => d.taskId === currentWritingTaskId && d.visibility === 'student_visible'),
                criterionFeedback: {
                  taskResponse: (reviewDraft.sectionDrafts as any)?.writing?.[currentWritingTaskId]?.taskResponseNotes,
                  coherence: (reviewDraft.sectionDrafts as any)?.writing?.[currentWritingTaskId]?.coherenceNotes,
                  lexical: (reviewDraft.sectionDrafts as any)?.writing?.[currentWritingTaskId]?.lexicalNotes,
                  grammar: (reviewDraft.sectionDrafts as any)?.writing?.[currentWritingTaskId]?.grammarNotes
                }
              } : undefined,
              task2: undefined
            },
            teacherSummary: reviewDraft.teacherSummary || {
              strengths: [],
              improvementPriorities: [],
              recommendedPractice: []
            },
            version: 1,
            createdAt: reviewDraft.createdAt,
            updatedAt: reviewDraft.updatedAt
          }}
          writingAnnotations={reviewDraft.annotations}
          writingDrawings={reviewDraft.drawings}
          onClose={() => setShowReportPreview(false)}
          onRelease={handleReleaseNow}
          onScheduleRelease={handleScheduleRelease}
        />
      )}
    </div>
  );
});
