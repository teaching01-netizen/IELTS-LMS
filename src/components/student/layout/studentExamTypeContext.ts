import { createContext, useContext } from 'react';
import type { ExamType } from '../../../types';

/**
 * Exam type of the enclosing exam shell. IELTS-only presentation keys off
 * this so ACT keeps its existing controls. `null` outside a shell.
 */
export const StudentExamTypeContext = createContext<ExamType | null>(null);

export function useStudentExamType(): ExamType | null {
  return useContext(StudentExamTypeContext);
}

/** Only the IELTS modules get the redesigned chrome; unknown or missing types keep the legacy UI. */
export function isIeltsExamType(examType: ExamType | null | undefined): boolean {
  return examType === 'Academic' || examType === 'General Training';
}
