import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, ArrowLeft, Clock, AlertCircle, CheckCircle, User, ChevronRight, Download } from 'lucide-react';
import type { GradingSession, StudentSubmission, SessionDetailFilters, OverallGradingStatus, SectionGradingStatus, WritingTaskSubmission } from '../../types/grading';
import { gradingService } from '../../services/gradingService';
import { gradingRepository } from '../../services/gradingRepository';
import { examRepository } from '../../services/examRepository';
import { seedDevelopmentFixtures } from '../../services/developmentFixtures';
import { TableLoadingSkeleton, Dialog } from '@components/ui';
import { GradingExportButtons } from './GradingExportButtons';
import {
  buildCsvContent,
  buildCsvFilename,
  buildWideObjectiveExport,
  buildWideWritingExport,
  downloadBinaryFile,
  downloadCsvFile,
  type GradingExportSection,
} from './gradingReviewUtils';
import {
  createPerStudentZipPdfExport,
  type PerStudentZipPdfExportSection,
  type PerStudentZipPdfMode,
} from './gradingPerStudentExport';
import {
  DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE,
  PER_STUDENT_PDF_FILENAME_TEMPLATE_FIELDS,
  renderPerStudentPdfFilenameTemplate,
  resolvePerStudentPdfFilenameCollisions,
} from './gradingPerStudentPdfFilenameTemplate';
import type { ExamState } from '../../types';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { htmlToPlainTextPreserveLineBreaks } from '../../utils/htmlText';

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
  const [exportMode, setExportMode] = useState<'default' | 'per_student_zip_pdf'>('default');
  const [perStudentDialogOpen, setPerStudentDialogOpen] = useState(false);
  const [perStudentDialogLoading, setPerStudentDialogLoading] = useState(false);
  const [perStudentDialogError, setPerStudentDialogError] = useState<string | null>(null);
  const [perStudentDialogSearch, setPerStudentDialogSearch] = useState('');
  const [perStudentDialogSubmissions, setPerStudentDialogSubmissions] = useState<StudentSubmission[]>([]);
  const [perStudentSelectedSubmissionIds, setPerStudentSelectedSubmissionIds] = useState<string[]>([]);
  const [perStudentSections, setPerStudentSections] = useState<PerStudentZipPdfExportSection[]>([
    'reading',
    'listening',
    'writing',
  ]);
  const [perStudentPdfMode, setPerStudentPdfMode] = useState<PerStudentZipPdfMode>('combined');
  const [perStudentPdfFilenameTemplate, setPerStudentPdfFilenameTemplate] = useState(
    DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE,
  );
  const [perStudentExporting, setPerStudentExporting] = useState(false);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, filters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(`grading:${sessionId}:exportMode`);
      if (stored === 'per_student_zip_pdf' || stored === 'default') {
        setExportMode(stored);
      } else {
        setExportMode('default');
      }
    } catch {
      setExportMode('default');
    }
  }, [sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(`grading:${sessionId}:exportMode`, exportMode);
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }, [exportMode, sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(`grading:${sessionId}:perStudentExportSections`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (value) => value === 'reading' || value === 'listening' || value === 'writing',
        ) as PerStudentZipPdfExportSection[];
        if (valid.length > 0) {
          setPerStudentSections(valid);
        }
      }
    } catch {
      // Ignore invalid storage.
    }
  }, [sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        `grading:${sessionId}:perStudentExportSections`,
        JSON.stringify(perStudentSections),
      );
    } catch {
      // Ignore storage failures.
    }
  }, [perStudentSections, sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(`grading:${sessionId}:perStudentPdfMode`);
      if (stored === 'combined' || stored === 'separate') {
        setPerStudentPdfMode(stored);
      } else {
        setPerStudentPdfMode('combined');
      }
    } catch {
      setPerStudentPdfMode('combined');
    }
  }, [sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        `grading:${sessionId}:perStudentPdfMode`,
        perStudentPdfMode,
      );
    } catch {
      // Ignore storage failures.
    }
  }, [perStudentPdfMode, sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(`grading:${sessionId}:perStudentPdfFilenameTemplate`);
      if (stored && stored.trim().length > 0) {
        setPerStudentPdfFilenameTemplate(stored);
      } else {
        setPerStudentPdfFilenameTemplate(DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE);
      }
    } catch {
      setPerStudentPdfFilenameTemplate(DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE);
    }
  }, [sessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        `grading:${sessionId}:perStudentPdfFilenameTemplate`,
        perStudentPdfFilenameTemplate,
      );
    } catch {
      // Ignore storage failures.
    }
  }, [perStudentPdfFilenameTemplate, sessionId]);

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

      const objectiveSection =
        section === 'reading_manual'
          ? 'reading'
          : section === 'listening_manual'
            ? 'listening'
            : section;
      const exportMode = section === 'reading_manual' || section === 'listening_manual'
        ? 'manual'
        : 'auto';

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
          sectionSubmission: sections.find((item) => item.section === objectiveSection),
        })),
        examState,
        moduleType: objectiveSection,
        mode: exportMode,
      });

      downloadCsvFile(
        buildCsvFilename(
          fullSession.examTitle,
          objectiveSection,
          fullSession.cohortName,
          exportMode === 'manual' ? 'manual-check' : undefined,
        ),
        buildCsvContent(exportPayload.columns, exportPayload.rows),
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export or print section.');
    } finally {
      setExportingSection(null);
    }
  };

  const openPerStudentExportDialog = async () => {
    setPerStudentDialogError(null);
    setPerStudentDialogSearch('');
    setPerStudentSelectedSubmissionIds([]);
    setPerStudentDialogOpen(true);
    setPerStudentDialogLoading(true);

    try {
      const fullSubmissions = await gradingRepository.getSubmissionsBySession(sessionId);
      setPerStudentDialogSubmissions(fullSubmissions);
    } catch (error) {
      setPerStudentDialogError(
        error instanceof Error ? error.message : 'Failed to load students for export.',
      );
    } finally {
      setPerStudentDialogLoading(false);
    }
  };

  const closePerStudentExportDialog = () => {
    if (perStudentExporting) return;
    setPerStudentDialogOpen(false);
    setPerStudentDialogError(null);
  };

  const togglePerStudentSection = (section: PerStudentZipPdfExportSection) => {
    setPerStudentSections((current) => {
      if (current.includes(section)) {
        return current.filter((value) => value !== section);
      }
      return [...current, section];
    });
  };

  const togglePerStudentSelected = (submissionId: string) => {
    setPerStudentSelectedSubmissionIds((current) => {
      if (current.includes(submissionId)) {
        return current.filter((id) => id !== submissionId);
      }
      return [...current, submissionId];
    });
  };

  const setPerStudentSelectedAll = (submissionIds: string[]) => {
    setPerStudentSelectedSubmissionIds(Array.from(new Set(submissionIds)));
  };

  const runPerStudentZipExport = async () => {
    setPerStudentDialogError(null);

    const selectedSections = perStudentSections;
    if (selectedSections.length === 0) {
      setPerStudentDialogError('Select at least one section (Reading, Listening, and/or Writing).');
      return;
    }
    if (perStudentSelectedSubmissionIds.length === 0) {
      setPerStudentDialogError('Select at least one student.');
      return;
    }

    setPerStudentExporting(true);
    try {
      const fullSession = session ?? (await gradingRepository.getSessionById(sessionId));
      if (!fullSession) {
        throw new Error('Could not load grading session metadata.');
      }

      const selectedSubmissions = perStudentDialogSubmissions.filter((submission) =>
        perStudentSelectedSubmissionIds.includes(submission.id),
      );

      const sessionContext = {
        sessionId: fullSession.id,
        examTitle: fullSession.examTitle,
      };

      const sectionDataBySubmissionId = new Map<
        string,
        Partial<
          Record<
            PerStudentZipPdfExportSection,
            { columns: Array<{ key: string; label: string }>; row: Record<string, unknown> | null }
          >
        >
      >();

      const objectiveSections = (['reading', 'listening'] as const).filter((section) =>
        selectedSections.includes(section),
      );
      if (objectiveSections.length > 0) {
        const examState = await resolveExamState(fullSession.publishedVersionId);
        const objectiveSectionEntriesBySection = await Promise.all(
          objectiveSections.map(async (objectiveSection) => {
            const entries = await Promise.all(
              selectedSubmissions.map(async (submission) => {
                const sections = await gradingRepository.getSectionSubmissionsBySubmissionId(submission.id);
                const sectionSubmission =
                  sections.find((item) => item.section === objectiveSection) ?? null;
                return { submissionId: submission.id, sectionSubmission };
              }),
            );
            return { objectiveSection, entries };
          }),
        );

        for (const { objectiveSection, entries } of objectiveSectionEntriesBySection) {
          const hasSubmission = new Set(
            entries.filter((entry) => Boolean(entry.sectionSubmission)).map((entry) => entry.submissionId),
          );
          const exportData = buildWideObjectiveExport({
            session: sessionContext,
            submissions: selectedSubmissions,
            sectionSubmissions: entries,
            examState,
            moduleType: objectiveSection,
            mode: 'auto',
          });

          const rowBySubmissionId = new Map(
            exportData.rows.map((row) => [String(row['submissionId']), row] as const),
          );

          for (const submission of selectedSubmissions) {
            const existing = sectionDataBySubmissionId.get(submission.id) ?? {};
            sectionDataBySubmissionId.set(submission.id, {
              ...existing,
              [objectiveSection]: {
                columns: exportData.columns,
                row: hasSubmission.has(submission.id) ? (rowBySubmissionId.get(submission.id) ?? null) : null,
              },
            });
          }
        }
      }

      if (selectedSections.includes('writing')) {
        const writingEntries = await Promise.all(
          selectedSubmissions.map(async (submission) => ({
            submissionId: submission.id,
            writing: await gradingRepository.getWritingSubmissionsBySubmissionId(submission.id),
          })),
        );
        const hasWritingSubmission = new Set(
          writingEntries.filter((entry) => entry.writing.length > 0).map((entry) => entry.submissionId),
        );
        const writingExport = buildWideWritingExport({
          session: sessionContext,
          submissions: selectedSubmissions,
          writingSubmissions: writingEntries,
        });
        const rowBySubmissionId = new Map(
          writingExport.rows.map((row) => [String(row['submissionId']), row] as const),
        );

        for (const submission of selectedSubmissions) {
          const existing = sectionDataBySubmissionId.get(submission.id) ?? {};
          const writingTasks =
            writingEntries.find((entry) => entry.submissionId === submission.id)?.writing ?? [];
          sectionDataBySubmissionId.set(submission.id, {
            ...existing,
            writing: {
              columns: writingExport.columns,
              row: hasWritingSubmission.has(submission.id) ? (rowBySubmissionId.get(submission.id) ?? null) : null,
              writingTasks,
            },
          });
        }
      }

      const exportPayload = await createPerStudentZipPdfExport({
        filenameBase: `${fullSession.examTitle}-${fullSession.cohortName || ''}`.trim(),
        generatedAt: new Date(),
        sections: selectedSections,
        pdfMode: perStudentPdfMode,
        pdfFilenameTemplate: perStudentPdfFilenameTemplate,
        session: {
          examTitle: fullSession.examTitle,
          cohortName: fullSession.cohortName,
          sessionId: fullSession.id,
        },
        students: selectedSubmissions.map((submission) => ({
          submissionId: submission.id,
          studentName: submission.studentName,
          studentId: submission.studentId || submission.submissionId,
          studentEmail: submission.studentEmail,
          nickname: submission.nickname,
          ieltsCourse: submission.ieltsCourse,
          sectionData: sectionDataBySubmissionId.get(submission.id) ?? {},
        })),
      });

      downloadBinaryFile(exportPayload.filename, exportPayload.bytes, exportPayload.contentType);
      setPerStudentDialogOpen(false);
    } catch (error) {
      setPerStudentDialogError(
        error instanceof Error ? error.message : 'Failed to export per-student PDFs.',
      );
    } finally {
      setPerStudentExporting(false);
    }
  };

  const normalizedPerStudentSearch = perStudentDialogSearch.trim().toLowerCase();
  const perStudentFilteredSubmissions = normalizedPerStudentSearch
    ? perStudentDialogSubmissions.filter((submission) => {
        const id = (submission.studentId || submission.submissionId || '').toLowerCase();
        const name = (submission.studentName || '').toLowerCase();
        const email = (submission.studentEmail || '').toLowerCase();
        const nickname = (submission.nickname || '').toLowerCase();
        const course = (submission.ieltsCourse || '').toLowerCase();
        return (
          name.includes(normalizedPerStudentSearch) ||
          id.includes(normalizedPerStudentSearch) ||
          email.includes(normalizedPerStudentSearch) ||
          nickname.includes(normalizedPerStudentSearch) ||
          course.includes(normalizedPerStudentSearch)
        );
      })
    : perStudentDialogSubmissions;
  const perStudentFilteredIds = perStudentFilteredSubmissions.map((submission) => submission.id);
  const perStudentAllFilteredSelected =
    perStudentFilteredIds.length > 0 &&
    perStudentFilteredIds.every((id) => perStudentSelectedSubmissionIds.includes(id));

  const perStudentPreviewGeneratedAt = new Date();
  const perStudentPreviewOrderedSections = (['reading', 'listening', 'writing'] as const).filter(
    (section) => perStudentSections.includes(section),
  );
  const perStudentPreviewSubmission =
    perStudentSelectedSubmissionIds.length > 0
      ? perStudentDialogSubmissions.find((submission) => submission.id === perStudentSelectedSubmissionIds[0]) ??
        null
      : null;
  const perStudentPreviewContextSession = session ?? null;
  const perStudentPreviewExamples = (() => {
    if (!perStudentPreviewSubmission) return [];
    const baseContext = {
      studentName: perStudentPreviewSubmission.studentName,
      studentId: perStudentPreviewSubmission.studentId || perStudentPreviewSubmission.submissionId,
      studentEmail: perStudentPreviewSubmission.studentEmail,
      nickname: perStudentPreviewSubmission.nickname,
      ieltsCourse: perStudentPreviewSubmission.ieltsCourse,
      submissionId: perStudentPreviewSubmission.id,
      examTitle: perStudentPreviewContextSession?.examTitle,
      cohortName: perStudentPreviewContextSession?.cohortName,
      sessionId: sessionId,
      sections: perStudentSections,
      generatedAt: perStudentPreviewGeneratedAt,
    };

    if (perStudentPdfMode === 'combined') {
      const result = renderPerStudentPdfFilenameTemplate(perStudentPdfFilenameTemplate, baseContext);
      return [{ key: 'combined', label: 'Combined', filename: result.filename, unknown: result.unknownPlaceholders }];
    }

    return perStudentPreviewOrderedSections.map((section) => {
      const result = renderPerStudentPdfFilenameTemplate(perStudentPdfFilenameTemplate, {
        ...baseContext,
        section,
      });
      return {
        key: section,
        label: section.toUpperCase(),
        filename: result.filename,
        unknown: result.unknownPlaceholders,
      };
    });
  })();

  const perStudentTemplateUnknown = Array.from(
    new Set(perStudentPreviewExamples.flatMap((entry) => entry.unknown)),
  );

  const perStudentCollisionInfo = (() => {
    if (perStudentPdfMode === 'combined') {
      if (perStudentSelectedSubmissionIds.length <= 1) return { collisionsResolved: 0, filenames: [] as string[] };
      const selected = perStudentDialogSubmissions.filter((submission) =>
        perStudentSelectedSubmissionIds.includes(submission.id),
      );
      const desired = selected.map((submission) =>
        renderPerStudentPdfFilenameTemplate(perStudentPdfFilenameTemplate, {
          studentName: submission.studentName,
          studentId: submission.studentId || submission.submissionId,
          studentEmail: submission.studentEmail,
          nickname: submission.nickname,
          ieltsCourse: submission.ieltsCourse,
          submissionId: submission.id,
          examTitle: perStudentPreviewContextSession?.examTitle,
          cohortName: perStudentPreviewContextSession?.cohortName,
          sessionId,
          sections: perStudentSections,
          generatedAt: perStudentPreviewGeneratedAt,
        }).filename,
      );
      return resolvePerStudentPdfFilenameCollisions(desired);
    }

    if (!perStudentPreviewSubmission) return { collisionsResolved: 0, filenames: [] as string[] };
    const desired = perStudentPreviewOrderedSections.map((section) =>
      renderPerStudentPdfFilenameTemplate(perStudentPdfFilenameTemplate, {
        studentName: perStudentPreviewSubmission.studentName,
        studentId: perStudentPreviewSubmission.studentId || perStudentPreviewSubmission.submissionId,
        studentEmail: perStudentPreviewSubmission.studentEmail,
        nickname: perStudentPreviewSubmission.nickname,
        ieltsCourse: perStudentPreviewSubmission.ieltsCourse,
        submissionId: perStudentPreviewSubmission.id,
        examTitle: perStudentPreviewContextSession?.examTitle,
        cohortName: perStudentPreviewContextSession?.cohortName,
        sessionId,
        sections: perStudentSections,
        section,
        generatedAt: perStudentPreviewGeneratedAt,
      }).filename,
    );
    return resolvePerStudentPdfFilenameCollisions(desired);
  })();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <Dialog
        isOpen={perStudentDialogOpen}
        onClose={closePerStudentExportDialog}
        title="Export per student (ZIP PDFs)"
        preventCloseOnOverlayClick={perStudentExporting}
        closeOnEscape={!perStudentExporting}
        footer={
          <>
            <button
              type="button"
              onClick={closePerStudentExportDialog}
              disabled={perStudentExporting}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void runPerStudentZipExport()}
              disabled={
                perStudentExporting ||
                perStudentSelectedSubmissionIds.length === 0 ||
                perStudentSections.length === 0
              }
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {perStudentExporting ? 'Exporting…' : 'Export ZIP'}
            </button>
          </>
        }
        size="full"
      >
        {perStudentDialogError ? (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {perStudentDialogError}
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <div>
            <div className="text-xs font-semibold text-gray-700">Sections</div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label htmlFor="per-student-export-section-reading" className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  id="per-student-export-section-reading"
                  type="checkbox"
                  checked={perStudentSections.includes('reading')}
                  onChange={() => togglePerStudentSection('reading')}
                  aria-label="Include reading section"
                  disabled={perStudentExporting}
                />
                Reading
              </label>
              <label htmlFor="per-student-export-section-listening" className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  id="per-student-export-section-listening"
                  type="checkbox"
                  checked={perStudentSections.includes('listening')}
                  onChange={() => togglePerStudentSection('listening')}
                  aria-label="Include listening section"
                  disabled={perStudentExporting}
                />
                Listening
              </label>
              <label htmlFor="per-student-export-section-writing" className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  id="per-student-export-section-writing"
                  type="checkbox"
                  checked={perStudentSections.includes('writing')}
                  onChange={() => togglePerStudentSection('writing')}
                  aria-label="Include writing section"
                  disabled={perStudentExporting}
                />
                Writing
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              PDFs include the same fields as the current grading CSV export for the selected sections.
              Writing includes full essay text. Missing data is shown as “No submission”.
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-700">PDF mode</div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <label htmlFor="per-student-export-pdf-mode-combined" className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  id="per-student-export-pdf-mode-combined"
                  type="radio"
                  name="per-student-export-pdf-mode"
                  checked={perStudentPdfMode === 'combined'}
                  onChange={() => setPerStudentPdfMode('combined')}
                  aria-label="Combined PDFs (one per student)"
                  disabled={perStudentExporting}
                />
                Combined (1 PDF per student)
              </label>
              <label htmlFor="per-student-export-pdf-mode-separate" className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  id="per-student-export-pdf-mode-separate"
                  type="radio"
                  name="per-student-export-pdf-mode"
                  checked={perStudentPdfMode === 'separate'}
                  onChange={() => setPerStudentPdfMode('separate')}
                  aria-label="Separate PDFs (one per student per section)"
                  disabled={perStudentExporting}
                />
                Separate (1 PDF per section)
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Separate mode creates a folder per student inside the ZIP, with one PDF per selected section.
            </p>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-700">PDF filename template</div>
            <p className="mt-1 text-xs text-gray-500">
              Template affects PDF filenames inside the ZIP only. Use <code className="font-mono">{'{{field}}'}</code> placeholders.
            </p>
            <input
              type="text"
              value={perStudentPdfFilenameTemplate}
              onChange={(e) => setPerStudentPdfFilenameTemplate(e.target.value)}
              aria-label="PDF filename template"
              disabled={perStudentExporting}
              className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {PER_STUDENT_PDF_FILENAME_TEMPLATE_FIELDS.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  disabled={perStudentExporting}
                  onClick={() =>
                    setPerStudentPdfFilenameTemplate((current) => `${current}{{${field.key}}}`)
                  }
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {field.label}
                </button>
              ))}
            </div>

            <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <div className="font-semibold text-gray-800">Example</div>
              {perStudentPreviewExamples.length > 0 ? (
                <ul className="mt-1 space-y-1 font-mono text-gray-800">
                  {perStudentPreviewExamples.map((entry) => (
                    <li key={entry.key}>
                      <span className="text-gray-500">{entry.label}:</span> {entry.filename}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 font-mono text-gray-800">Select a student to preview</div>
              )}
              {perStudentTemplateUnknown.length > 0 ? (
                <div className="mt-2 text-amber-900">
                  Unknown placeholders: {perStudentTemplateUnknown.map((value) => `{{${value}}}`).join(', ')}
                </div>
              ) : null}
              {perStudentCollisionInfo.collisionsResolved > 0 ? (
                <div className="mt-1 text-amber-900">
                  Duplicate filenames detected. The export will suffix duplicates with <span className="font-mono">(2)</span>, <span className="font-mono">(3)</span>, etc.
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-gray-700">
                Students ({perStudentSelectedSubmissionIds.length} selected)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    perStudentAllFilteredSelected
                      ? setPerStudentSelectedAll(
                          perStudentSelectedSubmissionIds.filter(
                            (id) => !perStudentFilteredIds.includes(id),
                          ),
                        )
                      : setPerStudentSelectedAll([
                          ...perStudentSelectedSubmissionIds,
                          ...perStudentFilteredIds,
                        ])
                  }
                  disabled={perStudentExporting || perStudentDialogLoading}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {perStudentAllFilteredSelected ? 'Unselect all' : 'Select all'}
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Search by name, id, or email..."
                value={perStudentDialogSearch}
                onChange={(e) => setPerStudentDialogSearch(e.target.value)}
                aria-label="Search students for export"
                className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={perStudentExporting}
              />
            </div>

            <div className="max-h-[46vh] overflow-y-auto rounded-md border border-gray-200">
              {perStudentDialogLoading ? (
                <div className="px-4 py-3 text-sm text-gray-500">Loading students…</div>
              ) : perStudentFilteredSubmissions.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500">No students match your search.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {perStudentFilteredSubmissions.map((submission) => {
                    const checked = perStudentSelectedSubmissionIds.includes(submission.id);
                    const studentId = submission.studentId || submission.submissionId;
                    const checkboxId = `per-student-export-select-${submission.id}`;
                    return (
                      <li key={submission.id} className="px-4 py-3">
                        <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-3">
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePerStudentSelected(submission.id)}
                            aria-label={`Select ${submission.studentName} for export`}
                            disabled={perStudentExporting}
                            className="mt-1"
                          />
                          <span className="flex flex-col">
                            <span className="text-sm font-semibold text-gray-900">{submission.studentName}</span>
                            <span className="text-xs text-gray-500">
                              {studentId}
                              {submission.studentEmail ? ` • ${submission.studentEmail}` : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </Dialog>
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
                      {htmlToPlainTextPreserveLineBreaks(page.task.studentText) || 'No writing response recorded.'}
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
              aria-label="Search students"
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors">
            <Filter size={16} />
            <span className="hidden sm:inline">Filter</span>
          </button>
          <div className="flex items-start gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                Export Mode
              </span>
              <select
                value={exportMode}
                onChange={(e) => setExportMode(e.target.value as 'default' | 'per_student_zip_pdf')}
                disabled={exportingSection !== null || perStudentExporting}
                className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="default">CSV / Print (Default)</option>
                <option value="per_student_zip_pdf">Per-student ZIP (PDF)</option>
              </select>
            </div>

            {exportMode === 'default' ? (
              <GradingExportButtons
                exportingSection={exportingSection}
                onExportReading={() => void handleExportSection('reading')}
                onExportReadingManual={() => void handleExportSection('reading_manual')}
                onExportListening={() => void handleExportSection('listening')}
                onExportListeningManual={() => void handleExportSection('listening_manual')}
                onPrintWriting={() => void handleExportSection('writing')}
              />
            ) : (
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                  Export PDFs
                </span>
                <button
                  type="button"
                  onClick={() => void openPerStudentExportDialog()}
                  disabled={perStudentExporting || perStudentDialogLoading}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={14} />
                  Per-student ZIP PDFs
                </button>
              </div>
            )}
          </div>
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
                          <p className="text-xs text-gray-500 hidden sm:block truncate">
                            {submission.studentEmail ? submission.studentEmail : ''}
                          </p>
                          <p className="text-xs text-gray-500 hidden md:block truncate">
                            {[submission.nickname ? `Nickname: ${submission.nickname}` : null, submission.ieltsCourse ? `Course: ${submission.ieltsCourse}` : null]
                              .filter(Boolean)
                              .join(' • ')}
                          </p>
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
