import type { ExamState } from '../../types';
import type { GradingSession, SectionSubmission, StudentSubmission, WritingTaskSubmission } from '../../types/grading';

import {
  buildWideObjectiveExport,
  buildWideWritingExport,
  type CsvColumn,
} from './gradingReviewUtils';
import type {
  PerStudentZipPdfExportInput,
  PerStudentZipPdfExportSection,
  PerStudentZipPdfMode,
  PerStudentZipPdfSectionData,
} from './gradingPerStudentExport';

export interface BuildPerStudentZipPdfExportInputDeps {
  getSectionSubmissionsBySubmissionId: (submissionId: string) => Promise<SectionSubmission[]>;
  getWritingSubmissionsBySubmissionId: (submissionId: string) => Promise<WritingTaskSubmission[]>;
  resolveExamState: (
    scheduleId: string,
    publishedVersionId?: string,
  ) => Promise<ExamState | null>;
}

export interface BuildPerStudentZipPdfExportInputArgs {
  session: GradingSession;
  selectedSubmissions: StudentSubmission[];
  selectedSections: PerStudentZipPdfExportSection[];
  pdfMode: PerStudentZipPdfMode;
  pdfFilenameTemplate: string;
  generatedAt?: Date | undefined;
}

type ExportSectionRow = { columns: CsvColumn[]; row: Record<string, unknown> | null };

function toSessionContext(session: GradingSession) {
  return { sessionId: session.id, examTitle: session.examTitle };
}

function setSectionData(
  sectionDataBySubmissionId: Map<string, Partial<Record<PerStudentZipPdfExportSection, PerStudentZipPdfSectionData>>>,
  submissionId: string,
  section: PerStudentZipPdfExportSection,
  data: ExportSectionRow & { writingTasks?: WritingTaskSubmission[] | undefined },
) {
  const existing = sectionDataBySubmissionId.get(submissionId) ?? {};
  sectionDataBySubmissionId.set(submissionId, { ...existing, [section]: data });
}

export async function buildPerStudentZipPdfExportInput(
  args: BuildPerStudentZipPdfExportInputArgs,
  deps: BuildPerStudentZipPdfExportInputDeps,
): Promise<PerStudentZipPdfExportInput> {
  const generatedAt = args.generatedAt ?? new Date();
  const selectedSections = (['reading', 'listening', 'writing'] as const).filter((section) =>
    args.selectedSections.includes(section),
  );

  const sectionDataBySubmissionId = new Map<
    string,
    Partial<Record<PerStudentZipPdfExportSection, PerStudentZipPdfSectionData>>
  >();

  const sessionContext = toSessionContext(args.session);

  const objectiveSections = (['reading', 'listening'] as const).filter((section) =>
    selectedSections.includes(section),
  );

  if (objectiveSections.length > 0) {
    const examState = await deps.resolveExamState(
      args.session.scheduleId,
      args.session.publishedVersionId,
    );
    const sectionSubmissionsBySubmissionId = new Map<string, SectionSubmission[]>(
      await Promise.all(
        args.selectedSubmissions.map(async (submission) => [
          submission.id,
          await deps.getSectionSubmissionsBySubmissionId(submission.id),
        ]),
      ),
    );

    for (const objectiveSection of objectiveSections) {
      const entries = args.selectedSubmissions.map((submission) => {
        const sections = sectionSubmissionsBySubmissionId.get(submission.id) ?? [];
        const sectionSubmission = sections.find((item) => item.section === objectiveSection) ?? null;
        return { submissionId: submission.id, sectionSubmission };
      });

      const hasSubmission = new Set(
        entries.filter((entry) => Boolean(entry.sectionSubmission)).map((entry) => entry.submissionId),
      );

      const exportData = buildWideObjectiveExport({
        session: sessionContext,
        submissions: args.selectedSubmissions,
        sectionSubmissions: entries,
        examState,
        moduleType: objectiveSection,
        mode: 'auto',
      });

      const rowBySubmissionId = new Map(
        exportData.rows.map((row) => [String(row['submissionId']), row] as const),
      );

      for (const submission of args.selectedSubmissions) {
        setSectionData(sectionDataBySubmissionId, submission.id, objectiveSection, {
          columns: exportData.columns,
          row: hasSubmission.has(submission.id) ? (rowBySubmissionId.get(submission.id) ?? null) : null,
        });
      }
    }
  }

  if (selectedSections.includes('writing')) {
    const writingEntries = await Promise.all(
      args.selectedSubmissions.map(async (submission) => ({
        submissionId: submission.id,
        writing: await deps.getWritingSubmissionsBySubmissionId(submission.id),
      })),
    );

    const hasWritingSubmission = new Set(
      writingEntries.filter((entry) => entry.writing.length > 0).map((entry) => entry.submissionId),
    );

    const writingExport = buildWideWritingExport({
      session: sessionContext,
      submissions: args.selectedSubmissions,
      writingSubmissions: writingEntries,
    });

    const rowBySubmissionId = new Map(
      writingExport.rows.map((row) => [String(row['submissionId']), row] as const),
    );

    for (const submission of args.selectedSubmissions) {
      const writingTasks = writingEntries.find((entry) => entry.submissionId === submission.id)?.writing ?? [];
      setSectionData(sectionDataBySubmissionId, submission.id, 'writing', {
        columns: writingExport.columns,
        row: hasWritingSubmission.has(submission.id) ? (rowBySubmissionId.get(submission.id) ?? null) : null,
        writingTasks,
      });
    }
  }

  return {
    filenameBase: `${args.session.examTitle}-${args.session.cohortName || ''}`.trim(),
    generatedAt,
    sections: selectedSections,
    pdfMode: args.pdfMode,
    pdfFilenameTemplate: args.pdfFilenameTemplate,
    session: {
      examTitle: args.session.examTitle,
      cohortName: args.session.cohortName,
      sessionId: args.session.id,
    },
    students: args.selectedSubmissions.map((submission) => ({
      submissionId: submission.id,
      studentName: submission.studentName,
      studentId: submission.studentId || submission.submissionId,
      studentEmail: submission.studentEmail,
      nickname: submission.nickname,
      ieltsCourse: submission.ieltsCourse,
      sectionData: sectionDataBySubmissionId.get(submission.id) ?? {},
    })),
  };
}
