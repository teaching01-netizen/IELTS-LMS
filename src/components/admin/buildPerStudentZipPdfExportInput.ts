import type { ExamState } from '../../types';
import type { GradingSession, SectionSubmission, StudentSubmission, WritingTaskSubmission } from '../../types/grading';

import { getStudentQuestionsForModule } from '../../features/exam-authoring/api/examAuthoringGateway';
import { buildCaseSensitiveMap } from './gradingAnswerUtils';
import { buildScoreGroupThresholdMap } from './gradingReviewUtils';
import {
  buildWideObjectiveExport,
  buildWideWritingExport,
  type CsvColumn,
} from './gradingReviewUtils';
import type {
  ObjectiveRowContext,
  PerStudentZipPdfExportInput,
  PerStudentZipPdfExportSection,
  PerStudentZipPdfMode,
  PerStudentZipPdfSectionData,
} from './gradingPerStudentExport';
import type { ExportPlan } from './gradingExportBuilder/exportPlan';

export interface BuildPerStudentZipPdfExportInputDeps {
  getSectionSubmissionsBySubmissionId: (submissionId: string) => Promise<SectionSubmission[]>;
  getWritingSubmissionsBySubmissionId: (submissionId: string) => Promise<WritingTaskSubmission[]>;
  resolveExamState: (
    scheduleId: string,
    publishedVersionId?: string,
  ) => Promise<ExamState | null>;
  /**
   * Preferred objective source: the version recorded on each saved section
   * result (`autoGradingResults.integrity.gradingSourceVersionId`). When
   * present, submissions are grouped by that version; `resolveExamState`
   * remains the legacy fallback for callers/tests without version pinning.
   */
  resolveExamStateByVersionId?: ((versionId: string) => Promise<ExamState | null>) | undefined;
}

export interface BuildPerStudentZipPdfExportInputArgs {
  session: GradingSession;
  selectedSubmissions: StudentSubmission[];
  selectedSections: PerStudentZipPdfExportSection[];
  pdfMode: PerStudentZipPdfMode;
  pdfFilenameTemplate: string;
  generatedAt?: Date | undefined;
  exportPlan?: ExportPlan | undefined;
}

type ExportSectionRow = {
  columns: CsvColumn[];
  row: Record<string, unknown> | null;
  objectiveContext?: ObjectiveRowContext | undefined;
};

/**
 * The exam version recorded on the saved section result. Hidden behind one
 * helper so the nested integrity walk cannot drift between call sites.
 */
function savedGradingSourceVersion(sectionSubmission: SectionSubmission | null): string | undefined {
  return sectionSubmission?.autoGradingResults?.integrity?.gradingSourceVersionId;
}

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
    // Default (legacy callers without version pinning): one session-level state.
    const legacyExamState = deps.resolveExamStateByVersionId
      ? null
      : await deps.resolveExamState(args.session.scheduleId, args.session.publishedVersionId);
    const examStateByVersionId = new Map<string, ExamState | null>();

    const resolveVersionState = async (versionId: string | undefined): Promise<ExamState | null> => {
      if (!versionId) return legacyExamState;
      if (examStateByVersionId.has(versionId)) {
        return examStateByVersionId.get(versionId) ?? null;
      }
      const state = deps.resolveExamStateByVersionId
        ? await deps.resolveExamStateByVersionId(versionId)
        : legacyExamState;
      examStateByVersionId.set(versionId, state);
      return state;
    };

    const sectionSubmissionsBySubmissionId = new Map<string, SectionSubmission[]>(
      await Promise.all(
        args.selectedSubmissions.map(async (submission) => [
          submission.id,
          await deps.getSectionSubmissionsBySubmissionId(submission.id),
        ] as const),
      ),
    );

    const buildObjectiveSection = (
      objectiveSection: 'reading' | 'listening',
      entries: Array<{ submissionId: string; sectionSubmission: SectionSubmission | null }>,
      examState: ExamState | null,
    ): void => {
      const hasSubmission = new Set(
        entries.filter((entry) => Boolean(entry.sectionSubmission)).map((entry) => entry.submissionId),
      );

      const exportData = buildWideObjectiveExport({
        session: sessionContext,
        submissions: args.selectedSubmissions.filter((submission) => hasSubmission.has(submission.id)),
        sectionSubmissions: entries,
        examState,
        moduleType: objectiveSection,
        mode: 'auto',
      });

      const rowBySubmissionId = new Map(
        exportData.rows.map((row) => [String(row['submissionId']), row] as const),
      );

      const objectiveContext: ObjectiveRowContext | undefined = examState
        ? (() => {
            const descriptors = getStudentQuestionsForModule(examState, objectiveSection);
            return {
              caseSensitiveByQuestionId: buildCaseSensitiveMap(descriptors),
              groupThresholdByScoreKey: buildScoreGroupThresholdMap(descriptors),
            };
          })()
        : undefined;

      for (const entry of entries) {
        setSectionData(sectionDataBySubmissionId, entry.submissionId, objectiveSection, {
          columns: exportData.columns,
          row: hasSubmission.has(entry.submissionId)
            ? (rowBySubmissionId.get(entry.submissionId) ?? null)
            : null,
          objectiveContext,
        });
      }
    };

    for (const objectiveSection of objectiveSections) {
      const entries = args.selectedSubmissions.map((submission) => {
        const sections = sectionSubmissionsBySubmissionId.get(submission.id) ?? [];
        const sectionSubmission = sections.find((item) => item.section === objectiveSection) ?? null;
        return { submissionId: submission.id, sectionSubmission };
      });

      if (!deps.resolveExamStateByVersionId) {
        buildObjectiveSection(objectiveSection, entries, legacyExamState);
        continue;
      }

      // Each saved section names the version that produced it. Group by that
      // version so the exported key/display never comes from a different exam
      // version than the saved score (admin README invariant). An absent
      // version stays `undefined` all the way to the resolver instead of
      // round-tripping through a string sentinel.
      const entriesByVersionId = new Map<string | undefined, typeof entries>();
      for (const entry of entries) {
        const versionId = savedGradingSourceVersion(entry.sectionSubmission)
          ?? args.session.publishedVersionId;
        const group = entriesByVersionId.get(versionId) ?? [];
        group.push(entry);
        entriesByVersionId.set(versionId, group);
      }

      for (const [versionId, versionEntries] of entriesByVersionId) {
        const examState = await resolveVersionState(versionId);
        buildObjectiveSection(objectiveSection, versionEntries, examState);
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
    plan: args.exportPlan
      ? {
          profile: {
            id: args.exportPlan.profileSnapshot.id,
            name: args.exportPlan.profileSnapshot.name,
            version: args.exportPlan.profileSnapshot.version,
          },
          grouping: args.exportPlan.profileSnapshot.grouping.map((grouping) => grouping.field),
          filenameTemplate: args.exportPlan.profileSnapshot.filenameTemplate,
          matchedCount: args.exportPlan.matchedCount,
          selectedCount: args.exportPlan.selectedCount,
          folderCount: args.exportPlan.folderCount,
          pdfCount: args.exportPlan.pdfCount,
          warnings: args.exportPlan.warnings,
          conflicts: args.exportPlan.conflicts,
        }
      : undefined,
    students: args.selectedSubmissions.map((submission) => {
      const plannedStudent = args.exportPlan?.students.find(
        (student) => student.submissionId === submission.id,
      );
      return {
        submissionId: submission.id,
        studentName: submission.studentName,
        studentId: submission.studentId || submission.submissionId,
        studentEmail: submission.studentEmail,
        nickname: submission.nickname,
        ieltsCourse: submission.ieltsCourse,
        wcode: plannedStudent?.identity.wcode,
        level: plannedStudent?.identity.level,
        sectionData: sectionDataBySubmissionId.get(submission.id) ?? {},
        plannedOutputs: plannedStudent?.outputs.map((output) => ({
          folderPath: output.folderPath,
          filename: output.filename,
          path: output.path,
          section: output.section,
        })),
      };
    }),
  };
}
