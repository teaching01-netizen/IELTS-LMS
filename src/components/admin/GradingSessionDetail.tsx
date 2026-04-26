import React, { useState, useEffect } from 'react';
import { Search, Filter, ArrowLeft, Clock, AlertCircle, CheckCircle, User, ChevronRight } from 'lucide-react';
import type { GradingSession, StudentSubmission, SessionDetailFilters, OverallGradingStatus, SectionGradingStatus } from '../../types/grading';
import { gradingService } from '../../services/gradingService';
import { gradingRepository } from '../../services/gradingRepository';
import { examRepository } from '../../services/examRepository';
import { seedDevelopmentFixtures } from '../../services/developmentFixtures';
import { TableLoadingSkeleton } from '@components/ui';
import { GradingExportButtons } from './GradingExportButtons';
import {
  buildCsvContent,
  buildCsvFilename,
  buildObjectiveExportRows,
  buildWritingExportRows,
  downloadCsvFile,
  LISTENING_EXPORT_COLUMNS,
  READING_EXPORT_COLUMNS,
  WRITING_EXPORT_COLUMNS,
  type GradingExportSection,
} from './gradingReviewUtils';
import type { ExamState } from '../../types';

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
  const [filters, setFilters] = useState<SessionDetailFilters>({});
  const [searchQuery, setSearchQuery] = useState('');

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

      const examState = section === 'writing' ? null : await resolveExamState(fullSession.publishedVersionId);
      const bundles = await Promise.all(
        fullSubmissions.map(async (submission) => ({
          submission,
          sections: await gradingRepository.getSectionSubmissionsBySubmissionId(submission.id),
          writing: await gradingRepository.getWritingSubmissionsBySubmissionId(submission.id),
        })),
      );

      const sessionContext = {
        sessionId: fullSession.id,
        examTitle: fullSession.examTitle,
      };

      const rows =
        section === 'writing'
          ? bundles.flatMap(({ submission, writing }) =>
              buildWritingExportRows(sessionContext, submission, writing),
            )
          : bundles.flatMap(({ submission, sections }) => {
              const sectionSubmission = sections.find((item) => item.section === section);
              if (!sectionSubmission) {
                return [];
              }

              return buildObjectiveExportRows({
                session: sessionContext,
                submission,
                sectionSubmission,
                examState,
                moduleType: section,
              });
            });

      const columns =
        section === 'writing'
          ? WRITING_EXPORT_COLUMNS
          : section === 'reading'
            ? READING_EXPORT_COLUMNS
            : LISTENING_EXPORT_COLUMNS;

      downloadCsvFile(
        buildCsvFilename(fullSession.examTitle, section, fullSession.cohortName),
        buildCsvContent(columns, rows),
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export section CSV.');
    } finally {
      setExportingSection(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
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
