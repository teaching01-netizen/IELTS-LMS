import { jsPDF } from 'jspdf';

import { renderPdfHeader } from './pdf/header';
import { writeKeyValueRow } from './pdf/header';
import { toDisplayValue, writeWrappedText } from './pdf/text';
import { renderObjectiveQuestionTable } from './objective/renderTable';
import { renderWritingLikeDefaultPrint } from './writing/renderWritingLikeDefaultPrint';
import type { PerStudentZipPdfExportSection, PerStudentZipPdfStudentInput } from './types';

export function buildStudentPdfBytes(
  student: PerStudentZipPdfStudentInput,
  sections: PerStudentZipPdfExportSection[],
  generatedAt: Date,
): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const left = 14;
  const maxWidth = 180;
  const headerContext = {
    studentName: student.studentName,
    studentId: student.studentId,
    submissionId: student.submissionId,
    generatedAt,
    nickname: student.nickname,
    wcode: student.wcode,
    ieltsCourse: student.ieltsCourse,
    level: student.level,
  };
  let y = renderPdfHeader(doc, {
    ...headerContext,
    sectionLabel: sections.length === 1 && sections[0] ? sections[0].toUpperCase() : undefined,
  });

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    if (!section) continue;
    const data = student.sectionData[section];
    if (section === 'writing' && data?.writingTasks) {
      // Match the default "Print all writing" export feel by starting writing on a new page
      // when the PDF already contains other sections.
      if (sectionIndex > 0) doc.addPage();
      y = renderPdfHeader(doc, {
        ...headerContext,
        sectionLabel: 'WRITING',
      });
      y = renderWritingLikeDefaultPrint(
        doc,
        {
          studentName: student.studentName,
          studentId: student.studentId,
          submissionId: student.submissionId,
          nickname: student.nickname,
          wcode: student.wcode,
          ieltsCourse: student.ieltsCourse,
          level: student.level,
          generatedAt,
        },
        data.writingTasks,
        y,
      );
      continue;
    }

    if (sectionIndex > 0) {
      doc.addPage();
      y = renderPdfHeader(doc, {
        ...headerContext,
        sectionLabel: section.toUpperCase(),
      });
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(section.toUpperCase(), left, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    if (!data || data.row === null) {
      y = writeWrappedText(doc, 'No submission', left, y, maxWidth, 4.5, () => {
        y = renderPdfHeader(doc, {
          ...headerContext,
          sectionLabel: section.toUpperCase(),
        });
      });
      y += 3;
      continue;
    }

    if (section === 'reading' || section === 'listening') {
      y = renderObjectiveQuestionTable(
        doc,
        {
          studentName: student.studentName,
          studentId: student.studentId,
          submissionId: student.submissionId,
          generatedAt,
        },
        section.toUpperCase(),
        data.columns,
        data.row,
        y,
      );
    } else {
      const row = data.row;
      for (const column of data.columns) {
        const raw = row[column.key];
        const value = toDisplayValue(raw);
        y = writeKeyValueRow(doc, column.label, value, left, y, maxWidth, 4.6, () => {
          y = renderPdfHeader(doc, {
            ...headerContext,
            sectionLabel: section.toUpperCase(),
          });
        });
        y += 1.2;
      }
    }

    y += 4;
  }

  const arrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}
