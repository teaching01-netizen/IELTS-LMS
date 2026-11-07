import type { StudentSession } from '../../types';

export function getExamEndLabel(session: StudentSession): string | null {
  if (session.runtimeStatus === 'completed') return 'Exam ended';
  if (session.runtimeStatus === 'cancelled') return 'Exam cancelled';
  return null;
}

export function getStudentSectionLabel(session: StudentSession): string {
  return getExamEndLabel(session)
    ?? session.ieltsPersonalSectionKey
    ?? session.runtimeCurrentSection
    ?? session.currentSection
    ?? 'Waiting';
}
