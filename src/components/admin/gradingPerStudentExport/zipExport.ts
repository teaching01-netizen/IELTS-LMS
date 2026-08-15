import { strToU8, zipSync } from 'fflate';

import {
  DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE,
  renderPerStudentPdfFilenameTemplate,
  resolvePerStudentPdfFilenameCollisions,
} from '../gradingPerStudentPdfFilenameTemplate';
import { formatSectionList, resolveUniqueZipPathSegments, sanitizeFilenameSegment } from './filename';
import { buildStudentPdfBytes } from './studentPdf';
import type {
  PerStudentZipPdfExportInput,
  PerStudentZipPdfExportManifest,
  PerStudentZipPdfExportManifestStudent,
  PerStudentZipPdfPlannedOutput,
  PerStudentZipPdfExportResult,
  PerStudentZipPdfMode,
} from './types';

function safePlannedOutputPath(output: PerStudentZipPdfPlannedOutput): string {
  const folderPath = output.folderPath
    .map((segment) => sanitizeFilenameSegment(segment) || 'Unlabelled')
    .filter((segment) => segment.length > 0);
  const filename = output.filename.trim() || 'student.pdf';
  return [...folderPath, filename].join('/');
}

export async function createPerStudentZipPdfExport(
  input: PerStudentZipPdfExportInput,
): Promise<PerStudentZipPdfExportResult> {
  const sections = (['reading', 'listening', 'writing'] as const).filter((section) =>
    input.sections.includes(section),
  );
  const sectionSuffix = formatSectionList(sections);
  const base = sanitizeFilenameSegment(input.filenameBase) || 'grading-export';
  const zipFilename = `${base}-${input.generatedAt.toISOString().slice(0, 10)}.zip`;

  const files: Record<string, Uint8Array> = {};
  const manifestStudents: PerStudentZipPdfExportManifestStudent[] = [];

  const pdfMode: PerStudentZipPdfMode = input.pdfMode ?? 'combined';
  const template = (input.pdfFilenameTemplate || '').trim() || DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE;
  const hasPlannedOutputs = input.students.length > 0 && input.students.every((student) => student.plannedOutputs !== undefined);
  if (hasPlannedOutputs) {
    for (const student of input.students) {
      const plannedOutputs = student.plannedOutputs ?? [];
      const outputs: string[] = [];
      const errors: string[] = [];

      for (const output of plannedOutputs) {
        const zipPath = safePlannedOutputPath(output);
        try {
          const sectionsForPdf = output.section ? [output.section] : sections;
          const pdfBytes = buildStudentPdfBytes(student, sectionsForPdf, input.generatedAt);
          files[zipPath] = pdfBytes;
          outputs.push(zipPath);
        } catch (error) {
          const prefix = output.section ? `${output.section}: ` : '';
          errors.push(`${prefix}${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      const firstOutput = plannedOutputs[0];
      manifestStudents.push({
        submissionId: student.submissionId,
        studentId: student.studentId,
        studentName: student.studentName,
        nickname: student.nickname ?? undefined,
        ieltsCourse: student.ieltsCourse ?? undefined,
        wcode: student.wcode ?? student.studentId,
        level: student.level ?? student.ieltsCourse ?? undefined,
        outputs,
        filename: pdfMode === 'combined'
          ? (outputs[0] ?? '')
          : (firstOutput?.folderPath.join('/') ?? ''),
        status: errors.length === 0 && outputs.length > 0 ? 'ok' : 'failed',
        error: errors.length > 0 ? errors.join('; ') : undefined,
      });
    }
  } else if (pdfMode === 'combined') {
    const desiredPdfFilenames = input.students.map((student) =>
      renderPerStudentPdfFilenameTemplate(template, {
        studentName: student.studentName,
        studentId: student.studentId,
        fullName: student.studentName,
        wcode: student.studentId,
        level: student.ieltsCourse ?? 'No level',
        studentEmail: student.studentEmail,
        nickname: student.nickname ?? 'No nickname',
        course: student.ieltsCourse,
        ieltsCourse: student.ieltsCourse,
        submissionId: student.submissionId,
        examTitle: input.session?.examTitle,
        cohortName: input.session?.cohortName,
        sessionId: input.session?.sessionId,
        sections,
        generatedAt: input.generatedAt,
      }).filename,
    );
    const { filenames: pdfFilenames } = resolvePerStudentPdfFilenameCollisions(desiredPdfFilenames);

    for (let i = 0; i < input.students.length; i += 1) {
      const student = input.students[i];
      if (!student) continue;
      const pdfFilename = pdfFilenames[i] ?? `student_${i + 1}_${sectionSuffix}.pdf`;

      try {
        const pdfBytes = buildStudentPdfBytes(student, sections, input.generatedAt);
        files[pdfFilename] = pdfBytes;
        manifestStudents.push({
          submissionId: student.submissionId,
          studentId: student.studentId,
          studentName: student.studentName,
          nickname: student.nickname ?? undefined,
          ieltsCourse: student.ieltsCourse ?? undefined,
          wcode: student.studentId,
          level: student.ieltsCourse ?? undefined,
          outputs: [pdfFilename],
          filename: pdfFilename,
          status: 'ok',
        });
      } catch (error) {
        manifestStudents.push({
          submissionId: student.submissionId,
          studentId: student.studentId,
          studentName: student.studentName,
          nickname: student.nickname ?? undefined,
          ieltsCourse: student.ieltsCourse ?? undefined,
          wcode: student.studentId,
          level: student.ieltsCourse ?? undefined,
          outputs: [pdfFilename],
          filename: pdfFilename,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } else if (pdfMode === 'separate') {
    const desiredFolders = input.students.map((student) => `${student.studentName}_${student.submissionId}`);
    const folderNames = resolveUniqueZipPathSegments(desiredFolders);

    for (let studentIndex = 0; studentIndex < input.students.length; studentIndex += 1) {
      const student = input.students[studentIndex];
      if (!student) continue;
      const folderName = folderNames[studentIndex] ?? `student_${studentIndex + 1}`;

      const desiredStudentPdfFilenames = sections.map((section) =>
        renderPerStudentPdfFilenameTemplate(template, {
          studentName: student.studentName,
          studentId: student.studentId,
          fullName: student.studentName,
          wcode: student.studentId,
          level: student.ieltsCourse ?? 'No level',
          studentEmail: student.studentEmail,
          nickname: student.nickname ?? 'No nickname',
          course: student.ieltsCourse,
          ieltsCourse: student.ieltsCourse,
          submissionId: student.submissionId,
          examTitle: input.session?.examTitle,
          cohortName: input.session?.cohortName,
          sessionId: input.session?.sessionId,
          sections,
          section,
          generatedAt: input.generatedAt,
        }).filename,
      );
      const { filenames: studentPdfFilenames } = resolvePerStudentPdfFilenameCollisions(desiredStudentPdfFilenames);

      const outputs: string[] = [];
      const errors: string[] = [];
      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
        const section = sections[sectionIndex];
        if (!section) continue;
        const pdfFilename = studentPdfFilenames[sectionIndex] ?? `${section}.pdf`;
        const zipPath = `${folderName}/${pdfFilename}`;

        try {
          const pdfBytes = buildStudentPdfBytes(student, [section], input.generatedAt);
          files[zipPath] = pdfBytes;
          outputs.push(zipPath);
        } catch (error) {
          errors.push(`${section}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      manifestStudents.push({
        submissionId: student.submissionId,
        studentId: student.studentId,
        studentName: student.studentName,
        nickname: student.nickname ?? undefined,
        ieltsCourse: student.ieltsCourse ?? undefined,
        wcode: student.studentId,
        level: student.ieltsCourse ?? undefined,
        outputs,
        filename: folderName,
        status: errors.length === 0 && outputs.length > 0 ? 'ok' : 'failed',
        error: errors.length > 0 ? errors.join('; ') : undefined,
      });
    }
  } else {
    // bySection: one folder per selected section (module), with each student's
    // PDF for that section inside. No per-student sub-folders.
    const sectionFolderNames = sections.map((section) => sanitizeFilenameSegment(section) || section);
    const desiredBySection = sections.map(() => [] as string[]);
    for (const student of input.students) {
      sections.forEach((section, sectionIndex) => {
        desiredBySection[sectionIndex]?.push(
          renderPerStudentPdfFilenameTemplate(template, {
            studentName: student.studentName,
            studentId: student.studentId,
            fullName: student.studentName,
            wcode: student.studentId,
            level: student.ieltsCourse ?? 'No level',
            studentEmail: student.studentEmail,
            nickname: student.nickname ?? 'No nickname',
            course: student.ieltsCourse,
            ieltsCourse: student.ieltsCourse,
            submissionId: student.submissionId,
            examTitle: input.session?.examTitle,
            cohortName: input.session?.cohortName,
            sessionId: input.session?.sessionId,
            sections,
            section,
            generatedAt: input.generatedAt,
          }).filename,
        );
      });
    }
    const resolvedBySection = desiredBySection.map((desired) =>
      resolvePerStudentPdfFilenameCollisions(desired).filenames,
    );

    input.students.forEach((student, studentIndex) => {
      const outputs: string[] = [];
      const errors: string[] = [];
      sections.forEach((section, sectionIndex) => {
        const folderName = sectionFolderNames[sectionIndex] ?? section;
        const pdfFilename = resolvedBySection[sectionIndex]?.[studentIndex] ?? `${section}.pdf`;
        const zipPath = `${folderName}/${pdfFilename}`;

        try {
          const pdfBytes = buildStudentPdfBytes(student, [section], input.generatedAt);
          files[zipPath] = pdfBytes;
          outputs.push(zipPath);
        } catch (error) {
          errors.push(`${section}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      });

      manifestStudents.push({
        submissionId: student.submissionId,
        studentId: student.studentId,
        studentName: student.studentName,
        nickname: student.nickname ?? undefined,
        ieltsCourse: student.ieltsCourse ?? undefined,
        wcode: student.studentId,
        level: student.ieltsCourse ?? undefined,
        outputs,
        filename: sectionFolderNames.join('/'),
        status: errors.length === 0 && outputs.length > 0 ? 'ok' : 'failed',
        error: errors.length > 0 ? errors.join('; ') : undefined,
      });
    });
  }

  const manifest: PerStudentZipPdfExportManifest = {
    mode: 'per_student_zip_pdf',
    generatedAt: input.generatedAt.toISOString(),
    filename: zipFilename,
    sections,
    pdfMode,
    students: manifestStudents,
    plan: input.plan,
    files: Object.keys(files).filter((path) => path !== 'manifest.json'),
  };

  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  files['manifest.json'] = new Uint8Array(
    manifestBytes.buffer.slice(manifestBytes.byteOffset, manifestBytes.byteOffset + manifestBytes.byteLength),
  );

  // PDFs are already compressed; avoid wasting CPU on recompressing.
  const bytes = zipSync(files, { level: 0 });

  return {
    filename: zipFilename,
    contentType: 'application/zip',
    bytes,
    manifest,
  };
}
