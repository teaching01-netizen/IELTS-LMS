export const STUDENT_EXAM_PHASE = {
  PRE_CHECK: 'pre-check',
  LOBBY: 'lobby',
  EXAM: 'exam',
  POST_EXAM: 'post-exam',
  SUBMITTED: 'submitted',
} as const;

export type StudentExamPhase = (typeof STUDENT_EXAM_PHASE)[keyof typeof STUDENT_EXAM_PHASE];
