import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, ArrowLeft, Clock, AlertCircle, CheckCircle, User, ChevronRight } from 'lucide-react';
import type { GradingSession, StudentSubmission, SessionDetailFilters, OverallGradingStatus, SectionGradingStatus, WritingTaskSubmission } from '../../types/grading';
import { gradingService } from '../../services/gradingService';
import { gradingRepository } from '../../services/gradingRepository';
import { examRepository } from '../../services/examRepository';
import { seedDevelopmentFixtures } from '../../services/developmentFixtures';
import { TableLoadingSkeleton } from '@components/ui';
import { GradingExportButtons } from './GradingExportButtons';
import {
  buildCsvContent,
  buildCsvFilename,
  buildWideObjectiveExport,
  downloadCsvFile,
  type GradingExportSection,
} from './gradingReviewUtils';
import type { ExamState } from '../../types';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { htmlToPlainText } from '../../utils/htmlText';

interface SessionWritingPrintDocument {
  pages: SessionWritingPrintPage[];
  requestId: number;
}

type WritingTaskSlot = 'task1' | 'task2';

interface SessionWritingPrintPage {
  id: string;
  studentName: string;
  studentId: string;
  taskLabel: string;
  submittedAt: string;
  task: WritingTaskSubmission | null;
}

const waitForPrintPaint = () =>
  new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    if (typeof window.requestAnimationFrame !== 'function') {
      window.setTimeout(resolve, 0);
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

const waitForFontsReady = async () => {
  if (typeof document === 'undefined' || !document.fonts?.ready) {
    return;
  }

  try {
    await document.fonts.ready;
  } catch {
    // Continue printing even if font readiness cannot be observed.
  }
};

const formatPrintDate = (value?: string) => {
  if (!value) {
    return 'Not submitted';
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const getWritingTaskSlot = (task: Pick<WritingTaskSubmission, 'taskId' | 'taskLabel'>): WritingTaskSlot | null => {
  const normalizedId = task.taskId.trim().toLowerCase();
  const normalizedLabel = task.taskLabel.trim().toLowerCase();

  if (normalizedId === 'task1' || normalizedId === 'task-1' || normalizedLabel === 'task 1') {
    return 'task1';
  }

  if (normalizedId === 'task2' || normalizedId === 'task-2' || normalizedLabel === 'task 2') {
    return 'task2';
  }

  return null;
};

const getTaskLabelForSlot = (slot: WritingTaskSlot) => (slot === 'task1' ? 'Task 1' : 'Task 2');

const buildWritingPrintPages = (
  submission: StudentSubmission,
  writing: WritingTaskSubmission[],
): SessionWritingPrintPage[] => {
  const taskBySlot = new Map<WritingTaskSlot, WritingTaskSubmission>();

  for (const task of writing) {
    const slot = getWritingTaskSlot(task);
    if (slot && !taskBySlot.has(slot)) {
      taskBySlot.set(slot, task);
    }
  }

  return (['task1', 'task2'] as const).map((slot) => {
    const task = taskBySlot.get(slot) ?? null;
    return {
      id: `${submission.id}-${slot}`,
      studentName: submission.studentName,
      studentId: submission.studentId || submission.submissionId,
      taskLabel: getTaskLabelForSlot(slot),
      submittedAt: task?.submittedAt ?? submission.submittedAt,
      task,
    };
  });
};

const getAssessmentRows = (task: WritingTaskSubmission | null) => [
  {
    criterion: 'Task Response / Achievement',
    band: task?.rubricAssessment?.taskResponseBand,
    notes: task?.rubricAssessment?.taskResponseNotes,
  },
  {
    criterion: 'Coherence and Cohesion',
    band: task?.rubricAssessment?.coherenceBand,
    notes: task?.rubricAssessment?.coherenceNotes,
  },
  {
    criterion: 'Lexical Resource',
    band: task?.rubricAssessment?.lexicalBand,
    notes: task?.rubricAssessment?.lexicalNotes,
  },
  {
    criterion: 'Grammatical Range and Accuracy',
    band: task?.rubricAssessment?.grammarBand,
    notes: task?.rubricAssessment?.grammarNotes,
  },
  {
    criterion: 'Overall Band',
    band: task?.rubricAssessment?.overallBand,
    notes: task?.overallFeedback || task?.studentVisibleNotes || task?.rubricAssessment?.internalNotes,
  },
];

interface GradingSessionDetailProps {
  sessionId: string;
  onBack: () => void;
  onStudentSelect: (submissionId: string) => void;
}

export function GradingSessionDetail({ sessionId, onBack, onStudentSelect }: GradingSessionDetailProps) {
  const [session, setSession] = useState<GradingSession | null>(null);
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingSection, setExportingSection] = useState<GradingExportSection | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [writingPrintDocument, setWritingPrintDocument] = useState<SessionWritingPrintDocument | null>(null);
  const [filters, setFilters] = useState<SessionDetailFilters>({});
  const [searchQuery, setSearchQuery] = useState('');
  const writingPrintRequestIdRef = useRef(0);
  const lastPrintedRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSubmissions();
    void seedDevelopmentFixtures()
      .then(() => {
        if (!cancelled) {
          void loadSubmissions();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [sessionId, filters]);

  const loadSubmissions = async () => {
    setLoading(true);
    const [sessionResult, result] = await Promise.all([
      gradingRepository.getSessionById(sessionId),
      gradingService.getSessionStudentSubmissions(sessionId, { ...filters, searchQuery }),
    ]);
    setSession(sessionResult);
    if (result.success && result.data) {
      setSubmissions(result.data);
    }
    setLoading(false);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setFilters({ ...filters, searchQuery: query });
  };

  const getSectionBadge = (status: SectionGradingStatus) => {
    const styles = {
      pending: 'bg-gray-100 text-gray-600',
      auto_graded: 'bg-green-100 text-green-700',
      needs_review: 'bg-amber-100 text-amber-700',
      in_review: 'bg-blue-100 text-blue-700',
      finalized: 'bg-emerald-100 text-emerald-700',
      reopened: 'bg-purple-100 text-purple-700'
    };
    const labels = {
      pending: 'Pending',
      auto_graded: 'Auto',
      needs_review: 'Review',
      in_review: 'In Progress',
      finalized: 'Done',
      reopened: 'Reopened'
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const getOverallStatusBadge = (status: OverallGradingStatus) => {
    const styles: Record<string, string> = {
      not_submitted: 'bg-gray-100 text-gray-700',
      submitted: 'bg-blue-100 text-blue-700',
      in_progress: 'bg-yellow-100 text-yellow-700',
      grading_complete: 'bg-green-100 text-green-700',
      ready_to_release: 'bg-indigo-100 text-indigo-700',
      released: 'bg-emerald-100 text-emerald-700',
      finalized: 'bg-emerald-100 text-emerald-700',
      reopened: 'bg-purple-100 text-purple-700'
    };
    const labels: Record<string, string> = {
      not_submitted: 'Not Submitted',
      submitted: 'Submitted',
      in_progress: 'In Progress',
      grading_complete: 'Grading Complete',
      ready_to_release: 'Ready to Release',
      released: 'Released',
      finalized: 'Finalized',
      reopened: 'Reopened'
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    return 'Just now';
  };

  const resolveExamState = async (publishedVersionId?: string): Promise<ExamState | null> => {
    if (!publishedVersionId) {
      return null;
    }

    const version = await examRepository.getVersionById(publishedVersionId);
    return (version?.contentSnapshot as ExamState | undefined) ?? null;
  };

  const prepareWritingPrint = async (fullSubmissions: StudentSubmission[]) => {
    const printPages = await Promise.all(
      fullSubmissions.map(async (submission) => ({
        submission,
        pages: buildWritingPrintPages(
          submission,
          await gradingRepository.getWritingSubmissionsBySubmissionId(submission.id),
        ),
      })),
    );

    const requestId = writingPrintRequestIdRef.current + 1;
    writingPrintRequestIdRef.current = requestId;

    setWritingPrintDocument({
      pages: printPages.flatMap((entry) => entry.pages),
      requestId,
    });
  };

  useEffect(() => {
    if (!writingPrintDocument) {
      return;
    }

    if (lastPrintedRequestIdRef.current === writingPrintDocument.requestId) {
      return;
    }

    let cancelled = false;

    const printWhenReady = async () => {
      await waitForFontsReady();
      await waitForPrintPaint();

      if (cancelled) {
        return;
      }

      if (lastPrintedRequestIdRef.current === writingPrintDocument.requestId) {
        return;
      }

      lastPrintedRequestIdRef.current = writingPrintDocument.requestId;
      window.print();
    };

    void printWhenReady();

    return () => {
      cancelled = true;
    };
  }, [writingPrintDocument]);

  const handleExportSection = async (section: GradingExportSection) => {
    setExportError(null);
    setExportingSection(section);

    try {
      const [fullSession, fullSubmissions] = await Promise.all([
        session ?? gradingRepository.getSessionById(sessionId),
        gradingRepository.getSubmissionsBySession(sessionId),
      ]);

      if (!fullSession) {
        throw new Error('Could not load grading session metadata.');
      }

      if (section === 'writing') {
        await prepareWritingPrint(fullSubmissions);
        return;
      }

      const examState = await resolveExamState(fullSession.publishedVersionId);
      const bundles = await Promise.all(
        fullSubmissions.map(async (submission) => ({
          submission,
          sections: await gradingRepository.getSectionSubmissionsBySubmissionId(submission.id),
        })),
      );
      const sessionContext = {
        sessionId: fullSession.id,
        examTitle: fullSession.examTitle,
      };
      const exportPayload = buildWideObjectiveExport({
        session: sessionContext,
        submissions: bundles.map(({ submission }) => submission),
        sectionSubmissions: bundles.map(({ submission, sections }) => ({
          submissionId: submission.id,
          sectionSubmission: sections.find((item) => item.section === section),
        })),
        examState,
        moduleType: section,
      });

      downloadCsvFile(
        buildCsvFilename(fullSession.examTitle, section, fullSession.cohortName),
        buildCsvContent(exportPayload.columns, exportPayload.rows),
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export or print section.');
    } finally {
      setExportingSection(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <style>
        {`
          .session-writing-print-root {
            display: none;
          }

          @media print {
            @page {
              size: A4;
              margin: 11mm 10mm;
            }

            body * {
              visibility: hidden !important;
            }

            .session-writing-print-root,
            .session-writing-print-root * {
              visibility: visible !important;
            }

            .session-writing-print-root {
              display: block !important;
              position: absolute;
              inset: 0 auto auto 0;
              width: 100%;
              color: #111827;
              background: #ffffff;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 9.8pt;
              line-height: 1.42;
            }

            .session-writing-print-task-page {
              break-before: page;
              page-break-before: always;
            }

            .session-writing-print-task-page.session-writing-print-task-page-first {
              break-before: auto;
              page-break-before: auto;
            }

            .session-writing-print-page-header {
              border: 1px solid #cbd5e1;
              background: #f8fafc;
              padding: 3mm;
              margin-bottom: 4mm;
            }

            .session-writing-print-page-header h2 {
              margin: 0 0 2mm;
              font-size: 13pt;
              line-height: 1.2;
            }

            .session-writing-print-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 1.5mm 6mm;
            }

            .session-writing-print-field {
              display: grid;
              grid-template-columns: 24mm 1fr;
              gap: 3mm;
            }

            .session-writing-print-field span:first-child {
              color: #4b5563;
              font-weight: 700;
            }

            .session-writing-print-task {
              margin-top: 0;
            }

            .session-writing-print-task h3 {
              margin: 0 0 2mm;
              font-size: 12pt;
              line-height: 1.2;
            }

            .session-writing-print-task-summary {
              display: flex;
              flex-wrap: wrap;
              gap: 2mm 7mm;
              margin-bottom: 3mm;
              color: #374151;
              font-size: 9pt;
            }

            .session-writing-print-block {
              margin-top: 3mm;
            }

            .session-writing-print-block h4 {
              margin: 0 0 1.5mm;
              font-size: 9pt;
              letter-spacing: 0;
              text-transform: uppercase;
            }

            .session-writing-print-rich {
              border: 1px solid #cbd5e1;
              padding: 2.5mm 3mm;
              white-space: normal;
              overflow-wrap: anywhere;
              word-break: break-word;
            }

            .session-writing-print-response {
              border: 1px solid #cbd5e1;
              padding: 2.5mm 3mm;
              color: #111827;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 9.8pt;
              line-height: 1.42;
              white-space: pre-wrap;
              overflow-wrap: anywhere;
              word-break: break-word;
            }

            .session-writing-print-rich p {
              margin: 0 0 2mm;
            }

            .session-writing-print-rich p:last-child {
              margin-bottom: 0;
            }

            .session-writing-print-assessment {
              width: 100%;
              table-layout: fixed;
              border-collapse: collapse;
              margin-top: 2mm;
            }

            .session-writing-print-assessment th,
            .session-writing-print-assessment td {
              border: 1px solid #9ca3af;
              padding: 2mm 2.5mm;
              vertical-align: top;
            }

            .session-writing-print-assessment th {
              background: #f3f4f6;
              text-align: left;
              font-size: 8.8pt;
            }

            .session-writing-print-criterion {
              width: 29%;
              font-weight: 700;
            }

            .session-writing-print-band {
              width: 12%;
              text-align: center;
              font-weight: 700;
            }

            .session-writing-print-comment {
              width: 59%;
              min-height: 10mm;
            }

            .session-writing-print-empty {
              border: 1px dashed #9ca3af;
              color: #6b7280;
              padding: 4mm;
            }
          }
        `}
      </style>
      {writingPrintDocument ? (
        <div className="session-writing-print-root" aria-hidden="true">
          {writingPrintDocument.pages.map((page, index) => (
            <section
              key={page.id}
              className={`session-writing-print-task-page${index === 0 ? ' session-writing-print-task-page-first' : ''}`}
            >
              <header className="session-writing-print-page-header">
                <h2>{page.studentName}</h2>
                <div className="session-writing-print-grid">
                  <div className="session-writing-print-field">
                    <span>Student ID</span>
                    <span>{page.studentId}</span>
                  </div>
                  <div className="session-writing-print-field">
                    <span>Task</span>
                    <span>{page.taskLabel}</span>
                  </div>
                  <div className="session-writing-print-field">
                    <span>Submitted</span>
                    <span>{formatPrintDate(page.submittedAt)}</span>
                  </div>
                </div>
              </header>

              <article className="session-writing-print-task">
                <h3>{page.taskLabel}</h3>
                <div className="session-writing-print-task-summary">
                  <span>Word count: {page.task?.wordCount ?? 0}</span>
                </div>

                <div className="session-writing-print-block">
                  <h4>Prompt</h4>
                  <div
                    className="session-writing-print-rich"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(page.task?.prompt || '<p>Prompt unavailable.</p>'),
                    }}
                  />
                </div>

                <div className="session-writing-print-block">
                  <h4>Student Response</h4>
                  {page.task ? (
                    <div className="session-writing-print-response">
                      {htmlToPlainText(page.task.studentText) || 'No writing response recorded.'}
                    </div>
                  ) : (
                    <div className="session-writing-print-empty">No writing response recorded.</div>
                  )}
                </div>

                <div className="session-writing-print-block">
                  <h4>Assessment Form</h4>
                  <table className="session-writing-print-assessment">
                    <thead>
                      <tr>
                        <th className="session-writing-print-criterion">Criterion</th>
                        <th className="session-writing-print-band">Band</th>
                        <th className="session-writing-print-comment">Comments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getAssessmentRows(page.task).map((row) => (
                        <tr key={`${page.id}-${row.criterion}`}>
                          <td className="session-writing-print-criterion">{row.criterion}</td>
                          <td className="session-writing-print-band">{row.band ?? ''}</td>
                          <td className="session-writing-print-comment">{row.notes || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          ))}
        </div>
      ) : null}
      {/* Header */}
      <div className="flex items-center gap-4">
        <button 
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-md transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {session?.examTitle || 'Session Students'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {session?.cohortName || 'Grading session'} • {submissions.length} students in this session
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Search students..." 
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors">
            <Filter size={16} />
            <span className="hidden sm:inline">Filter</span>
          </button>
          <GradingExportButtons
            exportingSection={exportingSection}
            onExportReading={() => void handleExportSection('reading')}
            onExportListening={() => void handleExportSection('listening')}
            onExportWriting={() => void handleExportSection('writing')}
          />
        </div>
      </div>

      {exportError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {exportError}
        </div>
      ) : null}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Submitted</p>
              <p className="text-xl md:text-2xl font-bold text-gray-900">
                {submissions.filter(s => s.gradingStatus !== 'not_submitted').length}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <User size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Needs Review</p>
              <p className="text-2xl font-bold text-amber-600">
                {submissions.filter(s => s.gradingStatus === 'submitted').length}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
              <Clock size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">In Progress</p>
              <p className="text-2xl font-bold text-blue-600">
                {submissions.filter(s => s.gradingStatus === 'in_progress').length}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <Clock size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Finalized</p>
              <p className="text-2xl font-bold text-emerald-600">
                {submissions.filter(s => s.gradingStatus === 'released').length}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <CheckCircle size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <TableLoadingSkeleton rows={8} />
        ) : submissions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <User size={48} className="mb-4 text-gray-300" />
            <p className="font-medium text-gray-900">No student submissions found</p>
            <p className="text-sm mt-1 text-gray-500">Students will appear here when they submit exams</p>
            <button
              onClick={loadSubmissions}
              className="mt-4 px-4 py-2 bg-blue-50 text-blue-600 rounded-md text-sm font-medium hover:bg-blue-100 transition-colors"
            >
              Refresh
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                  <th className="px-3 md:px-6 py-3 font-medium">Student</th>
                  <th className="px-3 md:px-6 py-3 font-medium hidden sm:table-cell">Submitted</th>
                  <th className="px-3 md:px-6 py-3 font-medium hidden md:table-cell">Listening</th>
                  <th className="px-3 md:px-6 py-3 font-medium hidden md:table-cell">Reading</th>
                  <th className="px-3 md:px-6 py-3 font-medium hidden md:table-cell">Writing</th>
                  <th className="px-3 md:px-6 py-3 font-medium hidden md:table-cell">Speaking</th>
                  <th className="px-3 md:px-6 py-3 font-medium hidden sm:table-cell">Status</th>
                  <th className="px-3 md:px-6 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-sm">
                {submissions.map((submission) => (
                  <tr 
                    key={submission.id} 
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onStudentSelect(submission.id)}
                  >
                    <td className="px-3 md:px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-medium text-sm flex-shrink-0">
                          {submission.studentName.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{submission.studentName}</p>
                          <p className="text-xs text-gray-500 hidden sm:block truncate">{submission.studentEmail}</p>
                        </div>
                        {submission.isFlagged && (
                          <AlertCircle size={16} className="text-red-500" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 md:px-6 py-4 text-gray-700 hidden sm:table-cell">
                      {getTimeAgo(submission.submittedAt)}
                    </td>
                    <td className="px-3 md:px-6 py-4 hidden md:table-cell">
                      {getSectionBadge(submission.sectionStatuses.listening)}
                    </td>
                    <td className="px-3 md:px-6 py-4 hidden md:table-cell">
                      {getSectionBadge(submission.sectionStatuses.reading)}
                    </td>
                    <td className="px-3 md:px-6 py-4 hidden md:table-cell">
                      {getSectionBadge(submission.sectionStatuses.writing)}
                    </td>
                    <td className="px-3 md:px-6 py-4 hidden md:table-cell">
                      {getSectionBadge(submission.sectionStatuses.speaking)}
                    </td>
                    <td className="px-3 md:px-6 py-4 hidden sm:table-cell">
                      {getOverallStatusBadge(submission.gradingStatus)}
                    </td>
                    <td className="px-3 md:px-6 py-4 text-right">
                      <button 
                        className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ml-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStudentSelect(submission.id);
                        }}
                      >
                        Review
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
