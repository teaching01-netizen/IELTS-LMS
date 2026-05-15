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
  PerStudentZipPdfExportResult,
  PerStudentZipPdfMode,
} from './types';

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
  if (pdfMode === 'combined') {
    const desiredPdfFilenames = input.students.map((student) =>
      renderPerStudentPdfFilenameTemplate(template, {
        studentName: student.studentName,
        studentId: student.studentId,
        studentEmail: student.studentEmail,
        nickname: student.nickname,
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
          outputs: [pdfFilename],
          filename: pdfFilename,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } else {
    const desiredFolders = input.students.map((student) => `${student.studentName}_${student.submissionId}`);
    const folderNames = resolveUniqueZipPathSegments(desiredFolders);

    for (let studentIndex = 0; studentIndex < input.students.length; studentIndex += 1) {
      const student = input.students[studentIndex];
      const folderName = folderNames[studentIndex] ?? `student_${studentIndex + 1}`;

      const desiredStudentPdfFilenames = sections.map((section) =>
        renderPerStudentPdfFilenameTemplate(template, {
          studentName: student.studentName,
          studentId: student.studentId,
          studentEmail: student.studentEmail,
          nickname: student.nickname,
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
        outputs,
        filename: folderName,
        status: errors.length === 0 && outputs.length > 0 ? 'ok' : 'failed',
        error: errors.length > 0 ? errors.join('; ') : undefined,
      });
    }
  }

  const manifest: PerStudentZipPdfExportManifest = {
    mode: 'per_student_zip_pdf',
    generatedAt: input.generatedAt.toISOString(),
    filename: zipFilename,
    sections,
    pdfMode,
    students: manifestStudents,
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

