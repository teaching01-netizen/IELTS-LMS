import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import type { GradingSession, StudentSubmission } from '../../types/grading';
import type { ExamState } from '../../types';
import { gradingService } from '../../services/gradingService';
import { gradingRepository } from '../../services/gradingRepository';
import { examRepository } from '../../services/examRepository';
import { Dialog } from '@components/ui';
import {
  downloadBinaryFile,
  resolveObjectiveGradingVersionId,
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
import {
  buildPerStudentZipPdfExportInput,
  type BuildPerStudentZipPdfExportInputDeps,
} from './buildPerStudentZipPdfExportInput';

export interface PerStudentZipPdfExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  session: GradingSession | null;
}

const DEFAULT_SECTIONS: PerStudentZipPdfExportSection[] = ['reading', 'listening', 'writing'];

function getStoredSections(sessionId: string): PerStudentZipPdfExportSection[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`grading:${sessionId}:perStudentExportSections`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(
      (value) => value === 'reading' || value === 'listening' || value === 'writing',
    ) as PerStudentZipPdfExportSection[];
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

function setStoredSections(sessionId: string, sections: PerStudentZipPdfExportSection[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`grading:${sessionId}:perStudentExportSections`, JSON.stringify(sections));
  } catch {
    // Ignore storage failures.
  }
}

function getStoredPdfMode(sessionId: string): PerStudentZipPdfMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(`grading:${sessionId}:perStudentPdfMode`);
    return stored === 'combined' || stored === 'separate' ? stored : null;
  } catch {
    return null;
  }
}

function setStoredPdfMode(sessionId: string, mode: PerStudentZipPdfMode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`grading:${sessionId}:perStudentPdfMode`, mode);
  } catch {
    // Ignore storage failures.
  }
}

function getStoredTemplate(sessionId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(`grading:${sessionId}:perStudentPdfFilenameTemplate`);
    return stored && stored.trim().length > 0 ? stored : null;
  } catch {
    return null;
  }
}

function setStoredTemplate(sessionId: string, template: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`grading:${sessionId}:perStudentPdfFilenameTemplate`, template);
  } catch {
    // Ignore storage failures.
  }
}

async function resolveExamState(
  scheduleId: string,
  publishedVersionId?: string,
): Promise<ExamState | null> {
  const sourceResult = await gradingService.getObjectiveGradingSource(scheduleId);
  const versionId = resolveObjectiveGradingVersionId(
    publishedVersionId,
    sourceResult.success ? sourceResult.data?.draftVersionId : null,
  );
  if (!versionId) return null;
  const version = await examRepository.getVersionById(versionId);
  return (version?.contentSnapshot as ExamState | undefined) ?? null;
}

const buildDeps: BuildPerStudentZipPdfExportInputDeps = {
  getSectionSubmissionsBySubmissionId: (submissionId) =>
    gradingRepository.getSectionSubmissionsBySubmissionId(submissionId),
  getWritingSubmissionsBySubmissionId: (submissionId) =>
    gradingRepository.getWritingSubmissionsBySubmissionId(submissionId),
  resolveExamState,
};

export function PerStudentZipPdfExportDialog({
  isOpen,
  onClose,
  sessionId,
  session,
}: PerStudentZipPdfExportDialogProps) {
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogSearch, setDialogSearch] = useState('');
  const [dialogSubmissions, setDialogSubmissions] = useState<StudentSubmission[]>([]);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);

  const [sections, setSections] = useState<PerStudentZipPdfExportSection[]>(DEFAULT_SECTIONS);
  const [pdfMode, setPdfMode] = useState<PerStudentZipPdfMode>('combined');
  const [pdfFilenameTemplate, setPdfFilenameTemplate] = useState(DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDialogError(null);
    setDialogSearch('');
    setSelectedSubmissionIds([]);
    setDialogLoading(true);

    const storedSections = getStoredSections(sessionId);
    if (storedSections) setSections(storedSections);
    const storedMode = getStoredPdfMode(sessionId);
    if (storedMode) setPdfMode(storedMode);
    const storedTemplate = getStoredTemplate(sessionId);
    if (storedTemplate) setPdfFilenameTemplate(storedTemplate);

    let cancelled = false;
    gradingRepository
      .getSubmissionsBySession(sessionId)
      .then((fullSubmissions) => {
        if (cancelled) return;
        setDialogSubmissions(fullSubmissions);
      })
      .catch((error) => {
        if (cancelled) return;
        setDialogError(error instanceof Error ? error.message : 'Failed to load students for export.');
      })
      .finally(() => {
        if (cancelled) return;
        setDialogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId]);

  useEffect(() => {
    if (!isOpen) return;
    setStoredSections(sessionId, sections);
  }, [isOpen, sessionId, sections]);

  useEffect(() => {
    if (!isOpen) return;
    setStoredPdfMode(sessionId, pdfMode);
  }, [isOpen, sessionId, pdfMode]);

  useEffect(() => {
    if (!isOpen) return;
    setStoredTemplate(sessionId, pdfFilenameTemplate);
  }, [isOpen, sessionId, pdfFilenameTemplate]);

  const closeDialog = () => {
    if (exporting) return;
    setDialogError(null);
    onClose();
  };

  const toggleSection = (section: PerStudentZipPdfExportSection) => {
    setSections((current) => {
      if (current.includes(section)) return current.filter((value) => value !== section);
      return [...current, section];
    });
  };

  const toggleSelected = (submissionId: string) => {
    setSelectedSubmissionIds((current) => {
      if (current.includes(submissionId)) return current.filter((id) => id !== submissionId);
      return [...current, submissionId];
    });
  };

  const setSelectedAll = (submissionIds: string[]) => {
    setSelectedSubmissionIds(Array.from(new Set(submissionIds)));
  };

  const normalizedSearch = dialogSearch.trim().toLowerCase();
  const filteredSubmissions = useMemo(() => {
    if (!normalizedSearch) return dialogSubmissions;
    return dialogSubmissions.filter((submission) => {
      const id = (submission.studentId || submission.submissionId || '').toLowerCase();
      const name = (submission.studentName || '').toLowerCase();
      const email = (submission.studentEmail || '').toLowerCase();
      const nickname = (submission.nickname || '').toLowerCase();
      const course = (submission.ieltsCourse || '').toLowerCase();
      return (
        name.includes(normalizedSearch) ||
        id.includes(normalizedSearch) ||
        email.includes(normalizedSearch) ||
        nickname.includes(normalizedSearch) ||
        course.includes(normalizedSearch)
      );
    });
  }, [dialogSubmissions, normalizedSearch]);

  const filteredIds = useMemo(() => filteredSubmissions.map((submission) => submission.id), [filteredSubmissions]);

  const allFilteredSelected = useMemo(() => {
    return filteredIds.length > 0 && filteredIds.every((id) => selectedSubmissionIds.includes(id));
  }, [filteredIds, selectedSubmissionIds]);

  const previewGeneratedAt = useMemo(() => new Date(), []);
  const previewOrderedSections = useMemo(
    () => (['reading', 'listening', 'writing'] as const).filter((section) => sections.includes(section)),
    [sections],
  );
  const previewSubmission = useMemo(() => {
    if (selectedSubmissionIds.length === 0) return null;
    return dialogSubmissions.find((submission) => submission.id === selectedSubmissionIds[0]) ?? null;
  }, [dialogSubmissions, selectedSubmissionIds]);

  const previewExamples = useMemo(() => {
    if (!previewSubmission) return [];
    const baseContext = {
      studentName: previewSubmission.studentName,
      studentId: previewSubmission.studentId || previewSubmission.submissionId,
      studentEmail: previewSubmission.studentEmail,
      nickname: previewSubmission.nickname,
      ieltsCourse: previewSubmission.ieltsCourse,
      submissionId: previewSubmission.id,
      examTitle: session?.examTitle,
      cohortName: session?.cohortName,
      sessionId: sessionId,
      sections,
      generatedAt: previewGeneratedAt,
    };

    if (pdfMode === 'combined') {
      const result = renderPerStudentPdfFilenameTemplate(pdfFilenameTemplate, baseContext);
      return [{ key: 'combined', label: 'Combined', filename: result.filename, unknown: result.unknownPlaceholders }];
    }

    return previewOrderedSections.map((section) => {
      const result = renderPerStudentPdfFilenameTemplate(pdfFilenameTemplate, {
        ...baseContext,
        section,
      });
      return { key: section, label: section.toUpperCase(), filename: result.filename, unknown: result.unknownPlaceholders };
    });
  }, [pdfFilenameTemplate, pdfMode, previewGeneratedAt, previewOrderedSections, previewSubmission, sections, session?.cohortName, session?.examTitle, sessionId]);

  const templateUnknown = useMemo(() => Array.from(new Set(previewExamples.flatMap((entry) => entry.unknown))), [previewExamples]);

  const collisionInfo = useMemo(() => {
    if (pdfMode === 'combined') {
      if (selectedSubmissionIds.length <= 1) return { collisionsResolved: 0, filenames: [] as string[] };
      const selected = dialogSubmissions.filter((submission) => selectedSubmissionIds.includes(submission.id));
      const desired = selected.map((submission) =>
        renderPerStudentPdfFilenameTemplate(pdfFilenameTemplate, {
          studentName: submission.studentName,
          studentId: submission.studentId || submission.submissionId,
          studentEmail: submission.studentEmail,
          nickname: submission.nickname,
          ieltsCourse: submission.ieltsCourse,
          submissionId: submission.id,
          examTitle: session?.examTitle,
          cohortName: session?.cohortName,
          sessionId,
          sections,
          generatedAt: previewGeneratedAt,
        }).filename,
      );
      return resolvePerStudentPdfFilenameCollisions(desired);
    }

    if (!previewSubmission) return { collisionsResolved: 0, filenames: [] as string[] };
    const desired = previewOrderedSections.map((section) =>
      renderPerStudentPdfFilenameTemplate(pdfFilenameTemplate, {
        studentName: previewSubmission.studentName,
        studentId: previewSubmission.studentId || previewSubmission.submissionId,
        studentEmail: previewSubmission.studentEmail,
        nickname: previewSubmission.nickname,
        ieltsCourse: previewSubmission.ieltsCourse,
        submissionId: previewSubmission.id,
        examTitle: session?.examTitle,
        cohortName: session?.cohortName,
        sessionId,
        sections,
        section,
        generatedAt: previewGeneratedAt,
      }).filename,
    );
    return resolvePerStudentPdfFilenameCollisions(desired);
  }, [dialogSubmissions, pdfFilenameTemplate, pdfMode, previewGeneratedAt, previewOrderedSections, previewSubmission, sections, selectedSubmissionIds, session?.cohortName, session?.examTitle, sessionId]);

  const runExport = async () => {
    setDialogError(null);

    if (sections.length === 0) {
      setDialogError('Select at least one section (Reading, Listening, and/or Writing).');
      return;
    }
    if (selectedSubmissionIds.length === 0) {
      setDialogError('Select at least one student.');
      return;
    }

    setExporting(true);
    try {
      const fullSession = session ?? (await gradingRepository.getSessionById(sessionId));
      if (!fullSession) throw new Error('Could not load grading session metadata.');

      const selectedSubmissions = dialogSubmissions.filter((submission) => selectedSubmissionIds.includes(submission.id));

      const exportInput = await buildPerStudentZipPdfExportInput(
        {
          session: fullSession,
          selectedSections: sections,
          pdfMode,
          pdfFilenameTemplate,
          selectedSubmissions,
        },
        buildDeps,
      );

      const exportPayload = await createPerStudentZipPdfExport(exportInput);
      downloadBinaryFile(exportPayload.filename, exportPayload.bytes, exportPayload.contentType);
      onClose();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Failed to export per-student PDFs.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={closeDialog}
      title="Export per student (ZIP PDFs)"
      preventCloseOnOverlayClick={exporting}
      closeOnEscape={!exporting}
      footer={
        <>
          <button
            type="button"
            onClick={closeDialog}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void runExport()}
            disabled={exporting || selectedSubmissionIds.length === 0 || sections.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export ZIP'}
          </button>
        </>
      }
      size="full"
    >
      {dialogError ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {dialogError}
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
                checked={sections.includes('reading')}
                onChange={() => toggleSection('reading')}
                aria-label="Include reading section"
                disabled={exporting}
              />
              Reading
            </label>
            <label htmlFor="per-student-export-section-listening" className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                id="per-student-export-section-listening"
                type="checkbox"
                checked={sections.includes('listening')}
                onChange={() => toggleSection('listening')}
                aria-label="Include listening section"
                disabled={exporting}
              />
              Listening
            </label>
            <label htmlFor="per-student-export-section-writing" className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                id="per-student-export-section-writing"
                type="checkbox"
                checked={sections.includes('writing')}
                onChange={() => toggleSection('writing')}
                aria-label="Include writing section"
                disabled={exporting}
              />
              Writing
            </label>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            PDFs include the same fields as the current grading CSV export for the selected sections. Writing includes full essay text.
            Missing data is shown as “No submission”.
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
                checked={pdfMode === 'combined'}
                onChange={() => setPdfMode('combined')}
                aria-label="Combined PDFs (one per student)"
                disabled={exporting}
              />
              Combined (1 PDF per student)
            </label>
            <label htmlFor="per-student-export-pdf-mode-separate" className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                id="per-student-export-pdf-mode-separate"
                type="radio"
                name="per-student-export-pdf-mode"
                checked={pdfMode === 'separate'}
                onChange={() => setPdfMode('separate')}
                aria-label="Separate PDFs (one per student per section)"
                disabled={exporting}
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
            value={pdfFilenameTemplate}
            onChange={(e) => setPdfFilenameTemplate(e.target.value)}
            aria-label="PDF filename template"
            disabled={exporting}
            className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {PER_STUDENT_PDF_FILENAME_TEMPLATE_FIELDS.map((field) => (
              <button
                key={field.key}
                type="button"
                onClick={() => setPdfFilenameTemplate((value) => (value.trim().length ? `${value}_{{${field.key}}}` : `{{${field.key}}}`))}
                disabled={exporting}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {field.label}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
            <div className="text-xs font-semibold text-gray-600">Example</div>
            {previewExamples.length === 0 ? (
              <div className="mt-1 text-gray-500">Select a student to preview filenames.</div>
            ) : (
              <div className="mt-1 flex flex-col gap-1">
                {previewExamples.map((entry) => (
                  <div key={entry.key} className="font-mono text-xs text-gray-800">
                    {pdfMode === 'combined' ? entry.filename : `${entry.label}: ${entry.filename}`}
                  </div>
                ))}
              </div>
            )}
            {templateUnknown.length > 0 ? (
              <div className="mt-2 text-xs text-amber-800">
                Unknown placeholders: <span className="font-mono">{templateUnknown.join(', ')}</span>
              </div>
            ) : null}
            {collisionInfo.collisionsResolved > 0 ? (
              <div className="mt-1 text-xs text-amber-900">
                Duplicate filenames detected. The export will suffix duplicates with <span className="font-mono">(2)</span>, <span className="font-mono">(3)</span>, etc.
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-700">
              Students ({selectedSubmissionIds.length} selected)
            </div>
            <button
              type="button"
              onClick={() =>
                allFilteredSelected
                  ? setSelectedAll(selectedSubmissionIds.filter((id) => !filteredIds.includes(id)))
                  : setSelectedAll([...selectedSubmissionIds, ...filteredIds])
              }
              disabled={exporting || dialogLoading}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {allFilteredSelected ? 'Unselect all' : 'Select all'}
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search by name, id, or email..."
              value={dialogSearch}
              onChange={(e) => setDialogSearch(e.target.value)}
              aria-label="Search students for export"
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={exporting}
            />
          </div>

          <div className="max-h-[46vh] overflow-y-auto rounded-md border border-gray-200">
            {dialogLoading ? (
              <div className="px-4 py-3 text-sm text-gray-500">Loading students…</div>
            ) : filteredSubmissions.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500">No students match your search.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredSubmissions.map((submission) => {
                  const checked = selectedSubmissionIds.includes(submission.id);
                  const studentId = submission.studentId || submission.submissionId;
                  const checkboxId = `per-student-export-select-${submission.id}`;
                  return (
                    <li key={submission.id} className="px-4 py-3">
                      <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-3">
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelected(submission.id)}
                          aria-label={`Select ${submission.studentName} for export`}
                          disabled={exporting}
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
  );
}
